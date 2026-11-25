### WorkGraph release sites, part 9 (#5585, D5585-p9)

No page or canvas is implemented here. A public read with no sign-in, and **off by default**: until
`WORK_GRAPH_RELEASE_SITES` is `on`, it answers 404 `release_sites_off` before any D1 or R2 read. Mounted at
`/api/public/release-sites` by `cloudflare-worker/src/routes/release_sites_public.ts`, ahead of the legacy
`/api/public` routers.

| Route | Purpose |
| --- | --- |
| `GET /:tenant/:company/:site` | Which manifest the site shows now (the line's publication pointer, never an older manifest) and its ids-only site record; 410 `withdrawn` while a takedown or a tombstone covers it |

Never cached (`no-store`), rate-limited per IP (`release_site_read`, 60 a minute).
