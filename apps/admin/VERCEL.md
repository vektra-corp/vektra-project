# Vercel settings that cannot live in `vercel.json`

| Setting | Value |
|---|---|
| Root Directory | `apps/admin` |
| Include files outside root directory | **On** |
| Node.js version | 20.x |
| Production domain | `admin.vektracorp.in` |

## The console is served at `/project`

`next.config.mjs` sets `basePath: '/project'`, so the app answers on
`admin.vektracorp.in/project/...` and its bare root redirects there.

`admin.vektracorp.in` is meant to hold the admin console for every Vektra
product. A Vercel domain belongs to exactly one project, so for now this app
owns the subdomain. **When a second product needs a console**, do not try to
attach the domain twice — it cannot be done. Instead:

1. Create a small "admin shell" Vercel project and give it the domain.
2. Rewrite `/project/*` to this deployment and `/<next-product>/*` to that one.

No code in this app changes at that point, which is the reason `basePath` was
set before it was strictly needed.
