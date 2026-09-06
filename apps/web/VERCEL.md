# Vercel settings that cannot live in `vercel.json`

Set these in the project's dashboard; the file next to this one covers the rest.

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Include files outside root directory | **On** — the build needs `packages/*` and the lockfile |
| Node.js version | 20.x |
| Production domain | `projects.vektracorp.in` |

`regions: ["bom1"]` in `vercel.json` is Mumbai. It is set deliberately: the
Supabase project is in `ap-southeast-2` (Sydney), and every server-rendered page
makes several sequential queries, so the round trip is the dominant cost. If the
database moves, change this to match — the two should always be in the same
region, or as close as the providers allow.
