### Distribution sequences (D4493, #4493; part of #3722)

`/grow/distribution/prospects` draws the sequence builder under the pipeline
(DS7 right, MK7b). Worker: `routes/grow_sequences.ts`, self-mounted.

| Route | What it does |
| --- | --- |
| `GET/POST /api/grow/sequences` | The venture's sequences; a new one is a draft. |
| `GET/PATCH/DELETE /api/grow/sequences/:uid` | Steps, enrolments with their state and the consent-by-step read; name, state, campaign. |
| `POST /api/grow/sequences/:uid/steps`, `PATCH/DELETE …/steps/:position` | Email or voice-note steps only; LinkedIn, WhatsApp, Telegram and SMS are refused with their fixed sentences. |
| `PUT/GET …/steps/:position/recording` | The founder's own recording in R2 (`grow-voice/<project>/`) and its preview. No TTS. |
| `POST /api/grow/sequences/:uid/enrol` | The venture's own customer contacts, with their time zone. |
| `GET /api/grow/sequences/due` | `dueSteps`: consent, suppression, reply or opt-out stop, channel, wait and quiet hours. |
| `POST /api/grow/sequences/due/:enrolmentId/draft` | A `mail_drafts` row with the opt-out line; never the mail adapter. |
| `GET /api/grow/optout/:token` | Public. HMAC-signed per contact; records an `opted_out` suppression; reveals nothing; a forged token is 404. |

The send stays `POST /api/mail/send/confirm` then `POST /api/mail/send`
(D1340), which for a sequence draft re-checks that the step is due, goes to the
prospect's recorded address and keeps the opt-out line, attaches the voice
note, and moves the enrolment to its next step. Overview shows the Needs-you
SEQUENCE row and This week's STEP items from the same due read.
