### Licence contract integrity (D4671, #4671)

The contract HQ reviews is the contract that is signed. `licence_contracts.body_md` is sent through the e-sign rendered-body path (D416), so the envelope's `document_body` is that text byte for byte and its `body_sha256` is the hash the contract stored when it was drafted (migration `202611071500`). Nothing is re-rendered from today's ledger or template at send.

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/admin/licences/:uid/contract` | Super Admin | Now also answers `body_sha256`. The supersede of the old current contract and the insert of the new one are one D1 batch, and a partial unique index (`licence_uid` where `superseded_at` is null) leaves exactly one current contract. Every prior row stays. 409 `contract_conflict` when two issues race. |
| `POST /api/admin/licences/:uid/contract/:contractUid/send` | Super Admin, a TOTP session and a recent step-up | 409 `contract_body_changed` when the stored body no longer matches its fingerprint; 409 `contract_incomplete` with `unresolved_fields` when any `{{field}}` (namespaced or not) is still in the body; 409 `envelope_body_mismatch` when the envelope on file for this signer does not carry the stored text (nothing is linked). All three come before any recipient lookup or email, except the last, which is checked once the envelope exists. The envelope carries the stored `template_version`. |
| `PATCH /api/admin/licences/:uid/entity` | Super Admin | `{ legal_entity_name?, brand_name?, registered_address?, signatory_name?, signatory_title? }`. Only the keys sent change; each is trimmed, bounded, free of control characters and `{{ }}`, and cannot be blanked. 400 `invalid_field` names the field, 400 `nothing_to_change`. One `licence_events` `terms_changed` with the before and after; pushes the branch copy. |
| `GET /api/admin/licences/:uid/contract` | Super Admin | Each contract row now carries `body_sha256`. |

`token_split_bps` is the Licensee's share of the price members pay for AI tokens; the Licensors take the rest. Basis points print with every digit they have (3501 is 35.01%), and minor units keep a fraction of a cent.
