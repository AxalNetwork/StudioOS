## Company classification maintenance (D7821)

`research_company_mapping.ts` self-mounts at `/api/admin/research-company-mapping`. Admin-only POST `/recompute` pages every physical company row and returns state/method/scheme counts and a resume cursor. POST `/overrides` records a reason and authenticated author in an atomic audit transaction, then requires recompute. There is no screen in this issue. Directory/profile integration is #7830 and market readers follow in #7834. Operator steps are in D7821 and the PR.
