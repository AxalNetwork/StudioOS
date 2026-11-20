# services/typeform

D5828 (#5828, track #5825): Typeform's incremental response importer. A
founder's selected form (one `typeform_form_syncs` row per connection,
venture and form) is polled over the Responses API; completed responses are
counted once and the founder-mapped answers that qualify are kept as minimal
source records for Validate's review (#5829). No webhook.

- `api.ts` — the two frozen GET reads (`forms.get`, `responses.list`), the
  origin chosen by the connection's validated region (`us` or `eu`, never a
  guess), the query keys allowed, and the five keys read from a response.
  `responsesLink` is the form's responses page in Typeform for that region.
- `mappings.ts` — what may be mapped (choice, yes/no, number and text fields;
  never an identity-bearing type) and whether one mapped answer qualifies,
  with the only text kept from it.
- `importer.ts` — the run: lease, oldest-first paging, one D1 batch per
  response with its ledger rows, the checkpoint after each whole page, the
  24 hour overlap, 429/401/404 handling, provider-deletion reconciliation,
  backfill, withdrawal, mapping replacement and the form's counts.
- `signature.ts` — stable semantic mapping identity, independent of titles and choice order.
- `reviewCleanup.ts` — retract derived evidence in the source removal's batch, retaining tombstones.
- `review.ts` — versioned same-venture targets, private proposals, explicit review and separate counts (D5829).

The rules for adding to this folder:

- **No respondent identity.** `hidden`, `metadata`, `variables`,
  `calculated`, unmapped answers, attachments and identity-bearing answer
  types are never read, stored or logged. Logs carry error names and codes.
- **Every read is in `api.ts`,** GET only, to `TYPEFORM_API_ORIGINS` and the
  two path shapes. A new read adds its shape there and its test.
- **Once, and withdrawn stays withdrawn.** Every landed answer has a
  `connector_fed_items` row in the same batch; a ledger row whose `local_id`
  is NULL is never landed again, by a resync or a backfill.
- **Absence is not deletion.** Only `reconcileTypeformDeletions`, by two
  explicit id lookups an hour or more apart, marks a response
  `provider_deleted`.
- **The checkpoint moves only after a whole page is written,** forward only,
  and only by the run that holds the lease.
