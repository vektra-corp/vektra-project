import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const token = randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(token).digest('hex')

const { rows: [ctx] } = await c.query(`
  SELECT o.id AS org_id, w.id AS ws_id, p.id AS project_id,
         (SELECT id FROM tasks WHERE project_id = p.id LIMIT 1) AS task_id
  FROM organizations o
  JOIN workspaces w ON w.organization_id = o.id
  JOIN projects p ON p.workspace_id = w.id
  WHERE o.slug = 'acme' LIMIT 1`)

// Four actions in parallel off the trigger:
//   metadata SSRF target, public URL, create_task, add_comment.
const graph = {
  nodes: [
    { id: 'n1', type: 'trigger', config: {}, position: { x: 0, y: 0 } },
    { id: 'ssrf', type: 'action', action_type: 'call_webhook',
      config: { url: 'http://169.254.169.254/latest/meta-data/' }, position: { x: 0, y: 100 } },
    { id: 'loopback', type: 'action', action_type: 'call_webhook',
      config: { url: 'http://127.0.0.1:3000/api/inngest' }, position: { x: 100, y: 100 } },
    { id: 'mktask', type: 'action', action_type: 'create_task',
      config: { project_id: ctx.project_id, title: 'E2E workflow-created task', priority: 'high' },
      position: { x: 200, y: 100 } },
    { id: 'comment', type: 'action', action_type: 'add_comment',
      config: { body: 'Automated note from the workflow engine.' }, position: { x: 300, y: 100 } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'mktask' },
    { id: 'e2', source: 'mktask', target: 'comment' },
    { id: 'e3', source: 'comment', target: 'loopback' },
    { id: 'e4', source: 'loopback', target: 'ssrf' },
  ],
}

await c.query(`DELETE FROM workflows WHERE name = 'E2E actions test'`)
const { rows: [wf] } = await c.query(
  `INSERT INTO workflows (organization_id, workspace_id, name, trigger_type, is_active, graph, webhook_token_hash)
   VALUES ($1,$2,'E2E actions test','webhook',true,$3,$4) RETURNING id`,
  [ctx.org_id, ctx.ws_id, JSON.stringify(graph), hash])

console.log(JSON.stringify({ token, workflowId: wf.id, taskId: ctx.task_id }))
await c.end()
