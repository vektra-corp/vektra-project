import 'server-only'

import type { PlannedStep } from '@pm/db'
import { WORKFLOW_LIMITS } from '@pm/shared/constants'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from './client'
import {
  executeStep,
  finishRun,
  loadWorkflow,
  logStep,
  planFor,
  startRun,
  type WorkflowRow,
} from './workflow-runner'

/**
 * One workflow run, as a durable function.
 *
 * The dispatcher used to walk the graph inline, which meant a `delay` node
 * could not be honoured: there was nowhere to suspend. Here each step is its
 * own Inngest step, so a delay becomes `step.sleep` and the run genuinely
 * resumes later — surviving a deploy, a crash, or a week of waiting.
 *
 * Two budgets, and they measure different things:
 *
 *  - MAX_STEPS (50) bounds the walk, and is applied by the planner.
 *  - MAX_RUNTIME_MS (5 min) bounds COMPUTE, not wall-clock. A delay is by
 *    definition not computing, so time asleep does not count against it —
 *    otherwise "wait a day, then act" would be illegal by construction.
 *
 * Idempotency is unchanged: `startRun` claims the (workflow, event) pair
 * through a unique index, so a redelivered event exits immediately.
 */
export const executeWorkflow = inngest.createFunction(
  {
    id: 'workflow-execute',
    retries: WORKFLOW_LIMITS.MAX_RETRIES,
    // A run holds actions that write; two at once for the same workflow and
    // event would double them even with the idempotency claim, because a retry
    // resumes rather than restarts.
    concurrency: { limit: 20 },
  },
  { event: 'workflow/run' },
  async ({ event, step }) => {
    const { workflow_id: workflowId, trigger } = event.data

    const prepared = await step.run('claim-run', async () => {
      const db = createAdminClient()

      const workflow = await loadWorkflow(db, workflowId)
      if (!workflow) return null

      const runId = await startRun(db, workflow, trigger)
      // Already claimed by another delivery. Not an error.
      if (!runId) return null

      const plan = planFor(workflow, trigger.payload)
      // Captured inside the memoized step, not outside it. Everything before
      // the first `step.sleep` re-executes when the run resumes, so a
      // `Date.now()` in the function body would restart the clock on every
      // wake-up and report a multi-day run as taking a millisecond.
      return {
        workflow,
        runId,
        steps: plan.steps,
        truncated: plan.truncated,
        startedAt: Date.now(),
      }
    })

    if (!prepared) return { ran: false, reason: 'already running or workflow inactive' }

    const { workflow, runId, steps, truncated, startedAt } = prepared as {
      workflow: WorkflowRow
      runId: string
      steps: PlannedStep[]
      truncated: boolean
      startedAt: number
    }

    let computeMs = 0
    let failed: string | null = null
    let executed = 0

    for (const [index, planned] of steps.entries()) {
      // Sleeping first means the delay's own log entry records a wait that has
      // actually happened.
      if (planned.node.type === 'delay' && typeof planned.delaySeconds === 'number') {
        await step.sleep(`delay-${index}-${planned.node.id}`, `${planned.delaySeconds}s`)
      }

      const outcome = await step.run(`step-${index}-${planned.node.id}`, async () => {
        const db = createAdminClient()
        const began = Date.now()
        const result = await executeStep(db, workflow, planned, trigger.payload)
        const duration = Date.now() - began
        await logStep(db, runId, workflow.organization_id, planned, result, duration)
        return { status: result.status, error: result.error ?? null, duration }
      })

      executed += 1
      computeMs += outcome.duration

      // A failed action stops the run: later steps assumed it succeeded.
      if (outcome.status === 'failed') {
        failed = outcome.error ?? 'Step failed'
        break
      }

      if (computeMs > WORKFLOW_LIMITS.MAX_RUNTIME_MS) {
        failed = 'Runtime budget exhausted'
        break
      }
    }

    await step.run('finish-run', async () => {
      await finishRun(createAdminClient(), runId, {
        failed,
        truncated,
        steps: executed,
        startedAt,
      })
      return true
    })

    // run_count is a display counter, so a lost increment is not worth a
    // transaction; it is bumped once the run is recorded.
    await step.run('bump-count', async () => {
      const db = createAdminClient()
      const { data } = await db.from('workflows').select('run_count').eq('id', workflowId).maybeSingle()
      await db
        .from('workflows')
        .update({ run_count: (data?.run_count ?? 0) + 1, last_run_at: new Date().toISOString() })
        .eq('id', workflowId)
      return true
    })

    return { ran: true, steps: executed, failed }
  },
)
