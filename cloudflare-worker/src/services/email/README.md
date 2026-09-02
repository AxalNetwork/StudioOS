# services/email — transactional mail

Outbound email for the worker: Gmail OAuth delivery, the Emails canvas chrome,
persona invitations, and the unified `send()` pipeline used by the template
registry.

| File | What it does |
| --- | --- |
| `send.ts` | Single entry point for registry templates — render, enqueue, mirror to the bell, deliver. |
| `gmail.ts` | Gmail OAuth MIME send (`sendRawEmail`). |
| `inviteChrome.ts` | M0 shared chrome from the Emails canvas — 600px shell, postal footer, unsubscribe rule. |
| `canvasEmailParts.ts` | Reusable HTML fragments (CTA, tint tables, inviter block, digest cards). |
| `canvasTransactional.ts` | Canvas templates M1–M5 renderers (workspace invite, signature, capital call, digest, spin-out decision). |
| `personaInvites.ts` | Set A/B copy for the four persona invitations — content only, no HTML. |
| `personaInviteRender.ts` | Renders broadcast or GP personal persona invites through `inviteChrome`. |
| `personaInviteSend.ts` | `sendPersonaInvite()` — wires `renderInvite` to Gmail delivery. |

Registry layout and the 42+ named templates live in `cloudflare-worker/src/templates/email/`.
Legacy inline senders remain in `cloudflare-worker/src/services/email.ts` at the
parent level; new mail should use this folder or the registry, not another copy
of the header/footer.

## Rules

- One chrome (`inviteChrome.ts`). Do not add another wordmark or footer inline.
- The unsubscribe rule is three-way: broadcast ✓, transactional ✗, personal ✗.
  `footerFor` enforces it; callers do not pass a custom footer.
- No load-bearing images in the header — the canvas wordmark is text.
