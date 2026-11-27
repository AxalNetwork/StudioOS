### Axal VC Mail link (D811, #2257)

Service-only router `routes/mail_link.ts`, mounted before browser CORS, session and
CSRF middleware at `/api/mail-link`. No admin or browser token authorizes it.
Unset `MAIL_LINK_SECRET` means 404 for every method/path, before any store read.
Configured routes use the fail-closed `mail_link` bucket (120/minute/IP).

Mail sends `X-Axal-Link-Timestamp` (Unix seconds) and
`X-Axal-Link-Signature` (lowercase hex HMAC-SHA256). The exact signed string is
`METHOD\nPATH_AND_QUERY\nTIMESTAMP\nSHA256_HEX_RAW_UTF8_BODY` (empty body hashes too).
The query is included byte-for-byte, including its order and escaping. Requests
more than five minutes old or ahead are 401; reused signatures are 409. KV stores
the nonce for 600 seconds; a D1 unique claim also prevents concurrent reuse and
KV propagation races. On a retry, sign again with a new timestamp. Replay-store
failures are 503. Bodies are bounded at 256 KiB.

| Route | Authorization | Contract |
| --- | --- | --- |
| `GET /api/mail-link/health` | Mail HMAC | `{ ok: true, version: "1" }`. |
| `GET /api/mail-link/audiences` | Mail HMAC | `{ items: [{ key, label, count }] }`. Live counts after opt-in and suppression. Keys: `topic:<topic>`, `members:<role>:<topic>`, `investors_lps`, `event:<event id>`, `testers:<programme uid>`. Roles never bypass topic consent; Partner Letter also requires current investor/LP role. Event registrations need a confirmed `events` opt-in, not merely registration. Picked testers need only D812 programme consent (owner option A), never newsletter subscription; their programme opt-out and global suppression are respected. |
| `GET /api/mail-link/audiences/:key/recipients?cursor=` | Mail HMAC | `{ recipients: [{ email, first_name, last_name, company, unsubscribe_url, preferences_url, one_click_url }], next_cursor }`; 500 recipients, stable subscriber-ID keyset cursor bound to the audience. Unknown merge fields are null. D810 tokens and topic-scoped one-click URLs. Confirmed, consented, enabled topics only; all suppressions excluded; inactive/mismatched linked accounts excluded. Each audience count and recipient-page read records audience/count/time in `mail_link_reads`, never addresses. Unknown key/cursor is 400, unreadable store or missing newsletter key 503. Tester pages use application-ID cursors and programme-specific signed links. |
| `POST /api/mail-link/events` | Mail HMAC | Array of 1–500 `{ type: 'unsubscribe'|'bounce'|'complaint', email, audience?, at, message_id? }`, returning `{ ok: true, accepted }` (new receipts). Idempotent on type, normalized email, message ID (absent ID is empty). One-topic or programme unsubscribe leaves other topics/programmes on; absent audience unsubscribes all and suppresses. The legacy insights toggle mirrors opt-out. Bounces and complaints add D810 suppression. All writes, receipts and address-free service-actor audit are one atomic batch. Invalid batch is 400; no partial writes. |
| `GET /api/mail-link/testing/programmes` | Mail HMAC | D812 part 2b (#2258): `{ items }`, every programme, with `owner_name` (Axal VC, or the partner firm), status, places, places left, picked and applicant counts, and its four dates. No address. Logged in `mail_link_reads` as `testing:programmes`. |
| `GET /api/mail-link/testing/programmes/:uid/applicants` | Mail HMAC | D812 part 2b: `{ programme, items }`; each applicant's name, role, `first_answer`, `applied_on`, status, `consented` and `email`. `email` is set only for someone `testers:<uid>` sends to (the `testerRecipients` rule); everyone else's is null. Withdrawn applications are left out. An unknown or malformed uid is 404 `not_found`. Logged as `testing:applicants:<uid>` with the count, never addresses. |

D811 public programme links use `/api/testing/mail`, a separate signed-token
surface before browser/session/CSRF handling, with `testing_mail_public`
(30/minute/IP, fails closed). Token-authorized POST/PUT unsubscribe writes bypass IP limits so mailbox bursts and KV outages cannot prevent opt-out. Production needs `NEWSLETTER_TOKEN_KEY`; missing
key is 503. Invalid/retired/forged token is 403. Token authority is bound to the
application, programme, version and current account email, with a separate HMAC
domain from newsletter tokens. Responses are no-store/no-referrer; no email
address is returned. These links remain usable when `MAIL_LINK_SECRET` is unset.

| Route | Authorization | Contract |
| --- | --- | --- |
| `GET /api/testing/mail/preferences?token=` | programme token holder | `{ programme: { uid, name }, email_enabled, delivery_blocked, preferences_url, unsubscribe_url, one_click_url }`; with `Accept: text/html`, the existing lightweight signed-link form pattern, escaping the product name. |
| `PUT /api/testing/mail/preferences?token=` | programme token holder | `{ enabled: boolean }` saves one programme preference, returning `{ ok, email_enabled, delivery_blocked, ...links }`. HTML form POST is also supported. Re-opt-in requires a picked, consented application and retires older tokens. Changed eligibility/account or concurrent revocation refuses the write; a concurrent change is 409. Writes and address-free signed-link actor/testing audits are atomic. |
| `GET /api/testing/mail/unsubscribe?token=` | programme token holder | Read-only confirmation; GET never changes consent. |
| `POST /api/testing/mail/unsubscribe?token=` | programme token holder or RFC 8058 mailbox provider | Turns off only this programme; no newsletter account is created and no global suppression is added. JSON and HTML confirmations supported. PUT also accepts the same one-programme opt-out. |

