## Live defects found during the audit

These are pre-existing and were not introduced here. Each is a page calling a
path with no worker handler, already recorded in `scripts/api-drift-baseline.json`
(58 `missing_route` entries), which is why CI stays green.

| Surface | Broken calls | Effect |
| --- | --- | --- |
| Network workspace (`/advisor/network/*`) | `/api/network-introductions/*`, `/api/organizations*` | The Network surface every role's sidebar links to. A second, working Network lives at `/network`. |
| Trust Center (`/trust`) | 9 routes: `/trust/kyb/status`, `/kyb/submit`, `/accreditation/*` (5), `/nda/status`, `/nda/:p/preview`, `/nda/sign` | The editable KYB / Accreditation / NDA cards. Trust Center v2 converts exactly these to read-only, so v2 is the fix, not merely a redesign. |
| Marketplace (`/marketplace`) | all 11 `api.marketplace*` calls | The whole page. Implemented only in the dev-only FastAPI. |
| Legal (`/legal`) | none since D758 (#1862) | The page reads `GET /legal/templates` and `GET /legal/templates/:key` from the template store (admins and founders) and has no generate call: `generateDocument` and `POST /legal/templates/:key/generate` are deleted. |

Separately, **two code comments block a feature on a premise that is no longer
true**: `SpinoutLabCofounderAgreementPage.jsx:35` and
`components/cofounder/ExecutionConsole.jsx:9` both disable "Send for signature"
because *"api.js has no method to sign a documents row"*. `api.js:1384` has
`esignSend` and `legal.ts:912` has `PUT /documents/:id/sign`.

