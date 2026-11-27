# Wellness storage review — how check-ins and reflections are held at rest (D7118 part 4)

#7118 asks for "a controlled internal review of historical storage and
recovery" before Wellness collects more. This is how to run it, what it shows
and what to do with each answer. It reads; it changes nothing.

## What it reads

Three stores hold a member's Wellness answers:

| Store | Written by | How it is held |
| --- | --- | --- |
| `wellbeing_reflections` | `PUT /api/wellbeing/reflections/:cadence/:period` (D7118) | Ciphertext only. No plaintext columns; an unavailable cipher refuses the save. |
| `wellbeing_daily_pulses` | `POST /api/wellbeing/checkins` and `/daily` (Task #33, D574) | Ciphertext, but `encryptOrFallback` writes the `*_plain` column when encryption throws. The member sees these as "Earlier check-ins". |
| `wellbeing_checkins` | Nothing since Task #33 | The weekly check-ins from before Task #33, with `*_plain` columns from migration 059. No member screen reads, exports or deletes them. |

## Run it

1. Sign in as a Super Admin at HQ (a branch is refused; a plain admin is refused).
2. `GET /api/wellbeing/storage-review` with that session. Nothing in the
   request names a member.
3. Keep the JSON with the review's notes. Each run is in the admin audit as
   `wellbeing_storage_review`.

The answer has, per store, `present` (false when the table does not exist,
never zero rows), `rows`, `checked` (rows tested, newest first, up to
`decrypt_cap`, 5,000), `earliest` and `latest`, and `held`:

- `encrypted` — every answer is ciphertext that opens with today's key.
- `not_encrypted` — at least one answer is plaintext.
- `partly_unreadable` — at least one answer is ciphertext that no longer opens
  and has no plaintext copy. That answer is lost unless the old key is found.
- `empty` — no answer at all.

It returns no member id, uid, score, word or topic, and no per-member count.
Values are decrypted to test that they open and dropped at once
(`cloudflare-worker/src/services/wellbeing/storageReview.ts`).

## What each answer means

| Answer | Meaning | Next step |
| --- | --- | --- |
| `wellbeing_reflections.held.not_encrypted > 0` | Impossible by the writer: a row was written another way. | Incident (`INCIDENT_RESPONSE.md`). |
| `wellbeing_daily_pulses.held.not_encrypted > 0` | The Task #33 fallback ran. The member now sees "Stored without encryption" on each such earlier check-in and can delete it. | Owner decision: re-encrypt in place, or leave it to the member. Not automated. |
| any `partly_unreadable > 0` | The key that wrote those answers is not the one the Worker holds (`AXAL_ENCRYPTION_SECRET`, else `JWT_SECRET`). | Recovery: find the earlier secret in the credential history (`PRODUCTION_CREDENTIALS.md`). cryptoBox falls back across key-derivation iterations only, never across secrets, so reading those rows again needs a reviewed change that tries the old secret. Never delete the rows to tidy the count. The member sees "Part of this check-in can't be read". |
| `wellbeing_checkins.present` and `rows > 0` | Pre-Task #33 check-ins exist that the member cannot see, export or delete. | Owner decision on #7118: show them as earlier check-ins, or retire them under the retention rule. |
| `checked < rows` | More rows than the cap. | The counts cover the newest `checked` rows only; say so in the notes. |

A failed run answers 503 `storage_review_unavailable` and changes nothing.
