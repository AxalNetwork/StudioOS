import { request } from '../api.js';

// D1340 (#3548, part 1 of #3547) — the member's own mailboxes and the send, on
// cloudflare-worker/src/routes/mail_accounts.ts at /api/mail (migration 647).
//   accounts()                     GET    /mail/accounts → { accounts, providers }
//   connect(provider, read?)       POST   /mail/accounts/start/:provider { read? } → { authorize_url }
//   connectImap(body)              POST   /mail/accounts/imap { address, display_name?, username, password, smtp_*, imap_* } → 201 { account }
//   verifyAccount(uid)             POST   /mail/accounts/:uid/verify → { account }
//   disconnect(uid)                DELETE /mail/accounts/:uid → { ok }
//   confirmSend(accountUid)        POST   /mail/send/confirm { account_uid } → { nonce, expires_at }
//   send(body)                     POST   /mail/send { account_uid, to, subject, body, draft_uid?, nonce } → 201 { sent }
// A send needs the nonce from the composer's pressed Send; a credential never comes back.
const id = (v) => encodeURIComponent(String(v));
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const mailApi = {
  accounts: () => request('/mail/accounts'),
  connect: (provider, read = false) => post(`/mail/accounts/start/${id(provider)}`, { read }),
  connectImap: (body) => post('/mail/accounts/imap', body),
  verifyAccount: (uid) => post(`/mail/accounts/${id(uid)}/verify`),
  disconnect: (uid) => request(`/mail/accounts/${id(uid)}`, { method: 'DELETE' }),
  confirmSend: (accountUid) => post('/mail/send/confirm', { account_uid: accountUid }),
  send: (body) => post('/mail/send', body),
};
