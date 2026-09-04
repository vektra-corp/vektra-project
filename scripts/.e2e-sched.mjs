import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const { rows: [ctx] } = await c.query(`
  SELECT o.id AS org_id, o.timezone, w.id AS ws_id,
         (SELECT user_id FROM org_members WHERE organization_id=o.id AND role='owner' LIMIT 1) AS user_id
  FROM organizations o JOIN workspaces w ON w.organization_id=o.id WHERE o.slug='acme' LIMIT 1`)

// "Hourly at :00" is always already past within any given hour, so this is due
// the moment the poller looks.
const graph = {
  nodes: [
    { id: 'n1', type: 'trigger', config: {}, position: { x: 0, y: 0 } },
    { id: 'n2', type: 'action', action_type: 'send_notification',
      config: { user_id: ctx.user_id, title: 'E2E scheduled fired', body: 'from the scheduler' },
      position: { x: 0, y: 100 } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
}
await c.query(`DELETE FROM workflows WHERE name = 'E2E schedule test'`)
await c.query(`DELETE FROM notifications WHERE title = 'E2E scheduled fired'`)
const { rows: [wf] } = await c.query(
  `INSERT INTO workflows (organization_id, workspace_id, name, trigger_type, is_active, graph,
                          trigger_config, cron_expression)
   VALUES ($1,$2,'E2E schedule test','schedule',true,$3,
           '{"schedule":{"frequency":"hourly","hour":0,"minute":0,"weekday":1,"day":1}}'::jsonb,
           '0 * * * *')
   RETURNING id`, [ctx.org_id, ctx.ws_id, JSON.stringify(graph)])
console.log(JSON.stringify({ workflowId: wf.id, timezone: ctx.timezone }))
await c.end()
