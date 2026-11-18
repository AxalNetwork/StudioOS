| Emails | shared | — (email template layer) | — | {backend} | UPGRADE | The M0 half is live: single `send()` entry, shared chrome with registered address + preferences link, RFC 8058 one-click List-Unsubscribe honouring `users.marketing_unsubscribed_at`, `email_send_log` + queue + DLQ. New: 4 persona **broadcast invitations** (Set A) and 4 **GP personal letters** (Set B — lavender greeting band, `[First Name]` merge field, no unsubscribe, typed sign-off). Registry has none of these 8. |

backend:
- `notifications.ts`
- `routes/email.ts`
- `services/email/send.ts`
- `templates/email/layout.ts`
- `templates/email/registry.ts` (49 templates)
