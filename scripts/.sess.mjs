import { writeFileSync } from 'node:fs'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@acme.test', password: 'password123' }),
})
const j = await r.json()
const ref = new URL(url).hostname.split('.')[0]
const p = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString())
const session = { access_token: j.access_token, refresh_token: j.refresh_token, token_type: 'bearer',
  expires_in: 3600, expires_at: p.exp,
  user: { id: p.sub, email: p.email, role: p.role, aud: p.aud, app_metadata: p.app_metadata ?? {}, user_metadata: p.user_metadata ?? {} } }
writeFileSync(process.argv[2], `sb-${ref}-auth-token=base64-` + Buffer.from(JSON.stringify(session)).toString('base64'))
console.log('session ready')
