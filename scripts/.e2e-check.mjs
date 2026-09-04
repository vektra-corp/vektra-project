import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const id = process.argv[2]
const { rows: runs } = await c.query(
  `SELECT status, step_count, duration_ms, error FROM workflow_runs WHERE workflow_id=$1 ORDER BY started_at DESC LIMIT 3`, [id])
console.log('runs:', JSON.stringify(runs))
const { rows: steps } = await c.query(
  `SELECT l.node_id, l.node_type, l.status, l.output, l.error
   FROM workflow_step_logs l JOIN workflow_runs r ON r.id = l.run_id
   WHERE r.workflow_id=$1 ORDER BY l.started_at`, [id])
console.log('steps:')
for (const s of steps) console.log(' ', s.node_id, s.node_type, '->', s.status, JSON.stringify(s.output ?? {}), s.error ?? '')
const { rows: n } = await c.query(
  `SELECT title, body FROM notifications WHERE title = 'E2E webhook fired' ORDER BY created_at DESC LIMIT 2`)
console.log('notifications created:', JSON.stringify(n))
await c.end()
