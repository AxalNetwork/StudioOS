# Vercel REST reads

`api.ts` is the only caller of `api.vercel.com` (D1096, #2961). It exports
`vercelClient(auth)` with one typed method for each planned read, plus uninstall,
and the OAuth code exchange. Requests use the token's team, reject redirects,
limit bodies and time, and expose static error codes and rate-limit headers.
No deployment, cancellation, rollback, environment variable or domain write exists.
Logs, runtime logs and Web Analytics wrappers are reserved, never called by the
part 1 sync. Analytics remains off. Provider tests replace fetch with
`test/_vercel_api_fake.mjs`; no test reaches Vercel.

`company.ts` is Vercel part 4 (D1099, #2964): where production runs on Build ›
Company creation. Per chosen project it writes the account and plan as facts
(`vercel_company_facts`, migration 592) and, on the Hobby plan, proposes one
formation step once (`vercel_company_proposals`). Accept and Dismiss are the
founder's; Accept adds the step and changes nothing on Vercel. Part 1's sync
calls `syncVercelCompany`, and its disconnect `deleteVercelCompanyOf`.
