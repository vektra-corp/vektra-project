import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const token = randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(token).digest('hex')

const { rows: [ctx] } = await c.query(`
  SELECT o.id AS org_id, w.id AS ws_id, m.user_id
  FROM organizations o
  JOIN workspaces w ON w.organization_id = o.id
  JOIN org_members m ON m.organization_id = o.id AND m.role = 'owner'
  WHERE o.slug = 'acme' LIMIT 1`)

// trigger -> delay 5s -> condition -> send_notification
// The delay proves the run genuinely suspends and resumes; the condition proves
// the inbound body is readable the same way a row event is.
const graph = {
  nodes: [
    { id: 'n1', type: 'trigger', config: {}, position: { x: 0, y: 0 } },
    { id: 'n2', type: 'delay', config: { duration: '5s' }, position: { x: 0, y: 100 } },
    { id: 'n3', type: 'condition', config: { field: 'severity', equals: 'high' }, position: { x: 0, y: 200 } },
    { id: 'n4', type: 'action', action_type: 'send_notification', config: { user_id: ctx.user_id, title: 'E2E webhook fired', body: 'from the workflow engine' }, position: { x: 0, y: 300 } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4', label: 'yes' },
  ],
}

await c.query(`DELETE FROM workflows WHERE name = 'E2E webhook test'`)
const { rows: [wf] } = await c.query(
  `INSERT INTO workflows (organization_id, workspace_id, name, trigger_type, is_active, graph, webhook_token_hash)
   VALUES ($1,$2,'E2E webhook test','webhook',true,$3,$4) RETURNING id`,
  [ctx.org_id, ctx.ws_id, JSON.stringify(graph), hash])

console.log(JSON.stringify({ token, workflowId: wf.id, userId: ctx.user_id }))
await c.end()
