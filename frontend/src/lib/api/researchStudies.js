// Read and write a Research Project's market study and its customer segments, and create a project with its study from Markets (D7719).
import { request } from '../api.js';

const base = '/research/projects';
const studyPath = (uid) => `${base}/${encodeURIComponent(uid)}/study`;
const segmentPath = (uid, segmentUid) => `${studyPath(uid)}/segments/${encodeURIComponent(segmentUid)}`;
const send = (method, body) => ({ method, body: JSON.stringify(body) });

export const researchStudiesApi = {
  read: (uid) => request(studyPath(uid)),
  save: (uid, body) => request(studyPath(uid), send('PUT', body)),
  createWithStudy: (body) => request(`${base}/with-study`, send('POST', body)),
  addSegment: (uid, body) => request(`${studyPath(uid)}/segments`, send('POST', body)),
  readSegment: (uid, segmentUid) => request(segmentPath(uid, segmentUid)),
  saveSegment: (uid, segmentUid, body) => request(segmentPath(uid, segmentUid), send('PUT', body)),
  archiveSegment: (uid, segmentUid) => request(`${segmentPath(uid, segmentUid)}/archive`, { method: 'POST' }),
  restoreSegment: (uid, segmentUid) => request(`${segmentPath(uid, segmentUid)}/restore`, { method: 'POST' }),
  reorderSegments: (uid, uids) => request(`${studyPath(uid)}/segments/reorder`, send('POST', { uids })),
};
