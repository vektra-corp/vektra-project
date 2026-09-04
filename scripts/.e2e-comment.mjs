import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const { rows } = await c.query(
  `SELECT author_type, author_id, author_workflow_id IS NOT NULL AS attributed, is_internal,
          body -> 'content' -> 0 -> 'content' -> 0 ->> 'text' AS text
   FROM comments WHERE author_type = 'workflow' ORDER BY created_at DESC LIMIT 3`)
console.log('workflow-authored comments:', JSON.stringify(rows, null, 1))
await c.end()
