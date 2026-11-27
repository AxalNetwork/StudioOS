/** D6705: founder case participants, capital and sharing. */
import { request } from '../api.js';
const path = (uid) => `/formation/case-people/${encodeURIComponent(uid)}`;
const write = (uid, action, body) =>
  request(`${path(uid)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
export const formationCasePeopleApi = {
  get: (uid) => request(`${path(uid)}/people`),
  notice: (uid, id) => request(`${path(uid)}/notice/${encodeURIComponent(id)}`, { method: 'POST' }),
  add: (uid, body) => write(uid, 'add', body),
  edit: (uid, body) => write(uid, 'edit', body),
  remove: (uid, body) => write(uid, 'remove', body),
  capital: (uid, body) => write(uid, 'capital', body),
  consent: (uid, body) => write(uid, 'consent', body),
  withdraw: (uid, body) => write(uid, 'withdraw', body),
};
