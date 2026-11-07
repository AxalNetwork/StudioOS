# Email (#3547, D1344)

The Email page, `/email` and `/email/settings`, in every profile's shell. It is drawn to the owner's "Email" canvas (`design/incoming/Email Page.dc.html`, EM1–EM10) and D1347 §3's two changes: there is no "Save to Gmail drafts", and the first Network card reads "You're matched". The Worker is `cloudflare-worker/src/routes/mail_*.ts`, and the client is `../../lib/api/mail.js`.

| File | Purpose |
| --- | --- |
| `emailModel.js` | The pure rules. It decides which records have a person (so the Email action shows only there), where a draft goes (the record's own address, or a Network match's only from `GET /api/mail/shares` once both have shared), the estimate line shown before every draft, EM1's provider cards, EM5's Network cards, EM8's states and the founder's People pane. It has no React. |
| `emailParts.jsx` | Shared classes with their dark pairs, the one `EmailAction` button (EM4), the chip row and the state card. |
| `EmailPage.jsx` | The page (EM2): the mailbox chip or the connect cards, People, the conversation (what was sent, with what each quoted, and the drafts), "What Eadwyn knows" with a switch per record, and the composer. `/email/settings` draws `EmailSettings`. |
| `ComposeSheet.jsx` | "Draft an email" (EM3; #4046 renamed it from "Compose with Eadwyn") in the one right Sheet: intent, tone, length and live blocks; the estimate before Draft; versions, Regenerate and Shorter; Send behind a confirmation. |
| `RecordEmailSheet.jsx` | #4017 (IV-D3): a record's Email opens `RecordCompose` in the right Sheet over the record. It reads what `/email` reads for one person (mailboxes, shares, the pack); the address is `recipientFor`'s, and a member who has not shared one gets a line, not a composer. A reader (`readOnly`) sees the form with no Send. `emailParts.jsx`'s `EmailAction` takes `onOpen` for it; the link stays `/email?person=…&compose=1` for a new tab. A failed shares read is `Unreadable`, same as a failed accounts or context read (#4740 fix: it no longer falls back to an empty list, which told a member who had shared that they had not). #4660: it takes the record's person ref string (`kind:id`, `personOfRecord`'s, the same value `EmailAction` and `emailHref` take) plus the record's title as `label`; a value that is not a ref (`isPersonRef`) reads `Unreadable` and asks the Worker nothing. |
| `RecordCompose.jsx` | #4017 (D1454 §1 Q2): the record's Email as a form: To, From, Subject, Body. A blank Body carries Ask's field trigger (`FillTrigger`); Accept places the draft with the "Not saved" pill; Send, behind a confirmation, sends with the accepted draft's uid. |
| `EmailDraftIntent.jsx` | #4017: the draft as a form intent in the Ask panel (`AskIntent`, D1443): intent, tone, length and blocks; "Holds up to $X · you pay what it uses" before Draft; the Preview with versions, Regenerate and Shorter; Accept or Discard. It sends nothing. |
| `ConnectPanel.jsx` | Connect your mailbox (EM1), the consent sheet before Google or Microsoft, the IMAP and SMTP form, and the OAuth outcome (`?mail=`). |
| `EmailSettings.jsx` | Email › Settings (EM7): each mailbox (check again, or disconnect behind a confirmation) and the sent log, 20 a page. |
| `MessagesRedirect.jsx` | D1345 / EM10: `/messages` moves to `/email`; the notice is acknowledged once per account and browser, and both actions enter Email. |

A new person kind goes in `RECORD_PEOPLE` in `emailModel.js` and in the Worker's `contextPack.ts`. A write (send, share, disconnect) always opens a confirmation first.
