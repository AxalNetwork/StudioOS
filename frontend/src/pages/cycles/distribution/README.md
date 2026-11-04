# Distribution Ask (#4488)

Campaign drafting uses the shared Ask panel and D780 proposals. The campaign wizard
owns its manual fields and Save action; these components return accepted proposals
without saving campaign fields, sending messages or starting ads.

| File | Purpose |
| --- | --- |
| `DistributionAskIntent.jsx` | Sources, quote before run, proposal preview and local form acceptance. |
| `WaitingForYou.jsx` | Venture-scoped header count, loading/empty/error states and individual or safe bulk decisions. |
| `distributionAskModel.js` | Labels, actual listed counts, exact safe kinds and recorded hold/charge copy. |
