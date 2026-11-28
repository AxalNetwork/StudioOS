// D652 (#1464) — the Worker AI rail's conversations and the connectors in
// them. Worker: routes/eadwyn.ts, mounted at /api/eadwyn. Every call is the
// caller's own; a conversation belongs to the one company or one project it
// started in (D9277), and never moves.
import { request } from '../api.js';
import { railBody } from '../railPages.js';

const enc = encodeURIComponent;
const body = (b) => JSON.stringify(b ?? {});
const isSpace = (v) => !!v && typeof v === 'object' && (v.scope === 'company' || v.scope === 'project');

export const eadwynApi = {
  // The "Connectors ›" list: each connection with the reason it cannot be used.
  connectors: () => request('/eadwyn/connectors'),
  // D9277 (#9277): a conversation belongs to one company or one project. Pass the space,
  // `{ scope: 'company' | 'project', id }`; a bare workspace string is the older call, which
  // lists by workspace and starts in the active company. Each conversation carries
  // `space: { scope, id, name }` for the chat header.
  conversations: (where) => request(isSpace(where)
    ? `/eadwyn/conversations?scope=${enc(where.scope)}&id=${enc(where.id)}`
    : `/eadwyn/conversations?workspace=${enc(where)}`),
  // D701 (#1663): every conversation the caller has, both stores, for the
  // Conversations list on Studio's phone page. Takes no id and no parameter.
  conversationsMine: () => request('/eadwyn/conversations/mine'),
  // `{ scope, id, workspace? }`, or a workspace string (the older call).
  start: (where) => request('/eadwyn/conversations', {
    method: 'POST',
    body: body(isSpace(where) ? { scope: where.scope, id: where.id, workspace: where.workspace } : { workspace: where }),
  }),
  conversation: (uid) => request(`/eadwyn/conversations/${enc(uid)}`),
  remove: (uid) => request(`/eadwyn/conversations/${enc(uid)}`, { method: 'DELETE' }),
  // The whole set of switches, every time: the Worker keeps exactly this list.
  setConnectors: (uid, keys) => request(`/eadwyn/conversations/${enc(uid)}/connectors`, {
    method: 'PUT', body: body({ keys }),
  }),
  // D1442 (#3991): what one ask would hold, before Send. Runs nothing, holds nothing:
  // { ai: true, hold_microusd, model, model_label } or { ai: false, reason, message }.
  quote: (uid, { question, model, page, file } = {}) => request(`/eadwyn/conversations/${enc(uid)}/quote`, {
    method: 'POST', body: body({ question, model, page, file, ...railBody() }),
  }),
  // A model call, so the longer timeout `aiWorkspaceExplain` carries too.
  ask: (uid, { question, model, page, file }) => request(`/eadwyn/conversations/${enc(uid)}/ask`, {
    // D768: the run carries `rail: { page, option, record }` (D765).
    method: 'POST', timeoutMs: 60_000, body: body({ question, model, page, file, ...railBody() }),
  }),
  // No body, on purpose: confirm sends what the Worker stored and showed.
  confirmAction: (uid) => request(`/eadwyn/actions/${enc(uid)}/confirm`, { method: 'POST' }),
  cancelAction: (uid) => request(`/eadwyn/actions/${enc(uid)}/cancel`, { method: 'POST' }),
};
