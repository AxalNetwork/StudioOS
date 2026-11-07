## Expertise › Proof attestation (D4670, #4670)

The Worker side is `routes/advisors.ts` and `services/advisorProofAttestation.ts`, on migration 202611062216. The screens are Expertise › Proof (`pages/advisor/expertise/ProofZone.jsx`) and the attester's page `/attest/:token` (`pages/AttestConsentPage.jsx`).

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/advisors/me` (changed) | an Advisor (primary or additional licence) or an admin; anyone else is 403 `advisor_licence_required` | Creates or changes the caller's advisor profile. |
| `GET /api/advisors/me` (changed) | as above | The profile, or `null` when an Advisor has none yet. |
| `POST /api/advisors/me/proof/:id/consent-request` (changed) | the claim's advisor | Takes `attester_name` and `attester_email`, both required (400). The address cannot be the advisor's own (422 `attester_is_requester`). Pins the claim and answers the consent with `invite_token`. |
| `GET /api/advisors/me/proof` (changed) | the advisor | Each consent has `state`: `pending`, `confirmed`, `declined`, `withdrawn` or `needs_reconfirmation`. A pending ask also has `invite_token`. `attested` counts `confirmed` only. |
| `GET /api/advisors/proof-consents/:token/claim` | anyone with the link | The pinned claim, who asked, the masked address, the state, `claim_changed` and the answer history, `no-store`. 404 `consent_not_found`. |
| `POST /api/advisors/proof-consents/:token/code` | anyone with the link | Emails a six-digit code to the named address. Five an hour (429 `code_rate_limited`); 503 `code_unsent` when mail fails. |
| `POST /api/advisors/proof-consents/:token/respond` (changed) | the holder of the emailed code | `{ code, consent_text, statement?, claim_sha256? }` confirms, or `{ code, consent_given: false }` declines or withdraws. Refusals:<br>- 400 `code_required`;<br>- 401 `code_wrong` or `code_expired`;<br>- 409 `claim_changed`;<br>- 403 `requester_cannot_attest`, for the advisor signed in. |
