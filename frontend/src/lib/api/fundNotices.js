// D716 (#1860) — the LP's own notices: the list, one notice's frozen and
// masked figures, and the kept PDF. Every route answers only notices
// addressed to the caller's own `limited_partners` rows. Nothing here returns
// a full account number: the full number stays behind #1773's line route.
//
// D1162 — an Admin's reads on HQ (routes/fund_notices.ts): the notices of a
// fund or one LP, one notice's figures, and its kept PDF.
import { request, refusalError } from '../api.js';

// A kept PDF (binary endpoint, not typed drift), read only when the viewer
// taps PDF. It returns the blob and its filename and creates no object URL:
// the caller saves it.
async function pdfBlob(path, uid) {
  const token = localStorage.getItem('token');
  const res = await fetch(path, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await refusalError(res, 'The notice PDF could not be downloaded.');
  const blob = await res.blob();
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `notice-${uid}.pdf`;
  return { blob, filename };
}

const query = (params) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const fundNoticesApi = {
  mine: () => request('/fund-notices/mine'),
  mineOne: (uid) => request(`/fund-notices/mine/${encodeURIComponent(uid)}`),
  minePdfBlob: (uid) => pdfBlob(`/api/fund-notices/mine/${encodeURIComponent(uid)}/pdf`, uid),
  /** D1162: an Admin's list, of one fund and/or one LP (`{ fundId, lpId }`). */
  list: ({ fundId, lpId } = {}) => request(`/fund-notices${query({ fund_id: fundId, lp_id: lpId })}`),
  one: (uid) => request(`/fund-notices/${encodeURIComponent(uid)}`),
  pdfBlob: (uid) => pdfBlob(`/api/fund-notices/${encodeURIComponent(uid)}/pdf`, uid),
};
