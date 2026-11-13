import { request } from '../api.js';

const base = '/research/projects';
const briefPath = (uid) => `${base}/${encodeURIComponent(uid)}/brief`;

export const researchProjectBriefsApi = {
  list: () => request(`${base}/briefs/saved`),
  read: (uid) => request(briefPath(uid)),
  save: (uid, body) => request(briefPath(uid), { method: 'PUT', body: JSON.stringify(body) }),
};
