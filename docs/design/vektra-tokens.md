# Vektra design spec (extracted from `UI Design/Vektra Project.dc.html`)

Source of truth for the re-skin. Values below are lifted verbatim from the
design canvas, not approximated.

## Palette

| Token | Dark | Light |
|---|---|---|
| bg | `#0A0C10` | `#FBFBFC` |
| panel (sidebar) | `#0C0F14` | `#F3F4F7` |
| card | `#11151B` | `#FFFFFF` |
| card2 | `#0D1015` | `#F7F8FA` |
| sunk (inputs) | `#0E1218` | `#EFF1F5` |
| line | `rgba(255,255,255,.07)` | `rgba(20,24,36,.10)` |
| line2 | `rgba(255,255,255,.12)` | `rgba(20,24,36,.16)` |
| ink | `#E4E8EF` | `#171B24` |
| ink2 | `#9AA3B2` | `#5A6270` |
| ink3 | `#6B7484` | `#838B99` |
| ink4 | `#4E5666` | `#A6ADB9` |
| teal | `#23C4AC` | `#0E9B85` |
| purple | `#A855F7` | `#7A18C9` |
| navy | `#3D6FB5` | `#1C3D6C` |
| amber | `#C7913A` | `#8F6413` |
| red | `#E06A6A` | `#C24A4A` |
| btn / btnInk | `#F0F3F8` / `#0A0C10` | `#171B24` / `#FFFFFF` |
| chip | `rgba(255,255,255,.06)` | `rgba(20,24,36,.05)` |

Canvas behind artboards: `#08090C`. Links: teal, hover `#4FE0C9`.

## Type

- Sans: `'Gotham','Gotham HTF','Montserrat',sans-serif` — Montserrat is the
  shipping face (Gotham is licensed and absent).
- Mono: `'JetBrains Mono',monospace` — every id, count, status label and
  section heading.
- Body 13px, tracking `-0.005em`.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Sidebar nav item | 13px | 400 | — |
| Sidebar project | 12.5px | 400 | — |
| Sidebar project view | 12px | 400 | — |
| Section label (mono) | 9px | 400 | .14em |
| Column label (mono) | 10px | 400 | .12em |
| Card id / pts (mono) | 9.5px | 400 | — |
| Card title | 13.5px | 400 | lh 1.35 |
| Button | 12.5px | 600 primary / 400 subtle | — |
| Org name | 13px | 600 | .02em |

## Shape

- Card radius 9px; button/tab radius 6–7px; chip radius 4–5px; menu radius 9–11px.
- Board grid is `display:grid; gap:1px; background:var(--line)` — the 1px gap
  over a line-coloured ground *is* the column separator.
- Sidebar 242px, padding `14px 12px`, gap 15px.
- Card padding `11px 12px`, gap 8px, `border-left` carries the priority stripe.
- Sprint progress fill: `linear-gradient(90deg,#23C4AC,#8E20E8)`.

## Status / priority colour roles

- Column dots: todo grey, in-progress teal, testing amber, review purple, done navy.
- Priority: urgent red, high amber, med/low grey.
