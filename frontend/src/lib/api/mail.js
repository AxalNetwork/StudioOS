import { request } from '../api.js';

// Email (#3547) on /api/mail.
// D1340 (#3548, part 1) — the member's own mailboxes and the send, on
// cloudflare-worker/src/routes/mail_accounts.ts (migration 647).
//   accounts()                     GET    /mail/accounts → { accounts, providers }
//   connect(provider, read?)       POST   /mail/accounts/start/:provider { read? } → { authorize_url }
//   connectImap(body)              POST   /mail/accounts/imap { address, display_name?, username, password, smtp_*, imap_* } → 201 { account }
//   connectMcp(body)               POST   /mail/accounts/mcp { connection_uid, address, display_name? } → 201 { account } (D1343:
//                                  a member's own MCP mail server; its send tool is approved on the custom connector first)
//   verifyAccount(uid)             POST   /mail/accounts/:uid/verify → { account }
//   disconnect(uid)                DELETE /mail/accounts/:uid → { ok }
//   confirmSend(accountUid)        POST   /mail/send/confirm { account_uid } → { nonce, expires_at }
//   send(body)                     POST   /mail/send { account_uid, to, subject, body, draft_uid?, nonce } → 201 { sent }
// A send needs the nonce from the composer's pressed Send; a credential never comes back.
// D1341 (#3549, part 2) — Eadwyn's email drafts, on
// cloudflare-worker/src/routes/mail_drafts.ts (migration 648).
//   context(person, project?)      GET    /mail/context?person=<kind:id>&project= → { person, intents, items }
//   block(body)                    POST   /mail/blocks { kind, ref?, project? } → { block | null }
//   estimate(body)                 POST   /mail/drafts { …, estimate: true } → { estimate: { hold_microusd, model }, sources, blocks }
//   draft(body)                    POST   /mail/drafts { person, intent, tone, length, refs, blocks, project? } → 201 { draft }
//   revise(uid, body)              POST   /mail/drafts/:uid/revise { instruction, project?, estimate? } → 201 { draft }
//   drafts(person?)                GET    /mail/drafts?person= → { drafts }
//   get(uid)                       GET    /mail/drafts/:uid → { draft }
//   remove(uid)                    DELETE /mail/drafts/:uid → { ok }
// A draft costs AI tokens; the estimate runs nothing. A ref the member cannot read is 404.
// D1342 (#3550, part 3) — Network members' address shares, on
// cloudflare-worker/src/routes/mail_shares.ts (migration 649).
//   shares()                       GET    /mail/shares → { items: [{ uid, person, name, role, mine, theirs, ready, address, line, matched_at }] }
//   share(uid, yes)                POST   /mail/shares/:uid { share: true|false } → { share }; 409 not_matched
//   unshare(uid)                   DELETE /mail/shares/:uid → { share }; 409 not_shared
// `address` is the other member's, and only while both have shared; a match's person is `member:<uid>`.
// D1344 (#3552, part 5) — the sent log, on cloudflare-worker/src/routes/mail_accounts.ts.
//   sent(page?, person?)           GET    /mail/sent?page=&person= → { page, per_page, total, items: [{ uid, to, subject, sent_at, status, error, draft_uid, person, quoted }] }
const id = (v) => encodeURIComponent(String(v));
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const mailApi = {
  accounts: () => request('/mail/accounts'),
  connect: (provider, read = false) => post(`/mail/accounts/start/${id(provider)}`, { read }),
  connectImap: (body) => post('/mail/accounts/imap', body),
  connectMcp: (body) => post('/mail/accounts/mcp', body),
  verifyAccount: (uid) => post(`/mail/accounts/${id(uid)}/verify`),
  disconnect: (uid) => request(`/mail/accounts/${id(uid)}`, { method: 'DELETE' }),
  confirmSend: (accountUid) => post('/mail/send/confirm', { account_uid: accountUid }),
  send: (body) => post('/mail/send', body),
  context: (person, project) => request(`/mail/context?person=${id(person)}${project ? `&project=${id(project)}` : ''}`),
  block: (body) => post('/mail/blocks', body),
  estimate: (body) => post('/mail/drafts', { ...body, estimate: true }),
  draft: (body) => post('/mail/drafts', body),
  revise: (uid, body) => post(`/mail/drafts/${id(uid)}/revise`, body),
  drafts: (person) => request(`/mail/drafts${person ? `?person=${id(person)}` : ''}`),
  get: (uid) => request(`/mail/drafts/${id(uid)}`),
  remove: (uid) => request(`/mail/drafts/${id(uid)}`, { method: 'DELETE' }),
  shares: () => request('/mail/shares'),
  share: (uid, yes) => post(`/mail/shares/${id(uid)}`, { share: yes === true }),
  unshare: (uid) => request(`/mail/shares/${id(uid)}`, { method: 'DELETE' }),
  sent: (page = 1, person = null) => request(`/mail/sent?page=${id(page)}${person ? `&person=${id(person)}` : ''}`),
};
