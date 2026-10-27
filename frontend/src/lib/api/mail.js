import { request } from '../api.js';

// D1341 (#3549, part 2 of #3547) — Eadwyn's email drafts, on
// cloudflare-worker/src/routes/mail_drafts.ts at /api/mail (migration 648).
//   context(person, project?)      GET    /mail/context?person=<kind:id>&project= → { person, intents, items }
//   block(body)                    POST   /mail/blocks { kind, ref?, project? } → { block | null }
//   estimate(body)                 POST   /mail/drafts { …, estimate: true } → { estimate: { hold_microusd, model }, sources, blocks }
//   draft(body)                    POST   /mail/drafts { person, intent, tone, length, refs, blocks, project? } → 201 { draft }
//   revise(uid, body)              POST   /mail/drafts/:uid/revise { instruction, project?, estimate? } → 201 { draft }
//   drafts(person?)                GET    /mail/drafts?person= → { drafts }
//   get(uid)                       GET    /mail/drafts/:uid → { draft }
//   remove(uid)                    DELETE /mail/drafts/:uid → { ok }
// A draft costs AI tokens; the estimate runs nothing. A ref the member cannot read is 404.
const id = (v) => encodeURIComponent(String(v));
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
export const mailApi = {
  context: (person, project) => request(`/mail/context?person=${id(person)}${project ? `&project=${id(project)}` : ''}`),
  block: (body) => post('/mail/blocks', body),
  estimate: (body) => post('/mail/drafts', { ...body, estimate: true }),
  draft: (body) => post('/mail/drafts', body),
  revise: (uid, body) => post(`/mail/drafts/${id(uid)}/revise`, body),
  drafts: (person) => request(`/mail/drafts${person ? `?person=${id(person)}` : ''}`),
  get: (uid) => request(`/mail/drafts/${id(uid)}`),
  remove: (uid) => request(`/mail/drafts/${id(uid)}`, { method: 'DELETE' }),
};
