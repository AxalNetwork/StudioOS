// D716 (#1860) — the LP's own notices: the list, one notice's frozen and
// masked figures, and the kept PDF. Every route answers only notices
// addressed to the caller's own `limited_partners` rows. Nothing here returns
// a full account number: the full number stays behind #1773's line route.
import { request, refusalError } from '../api.js';

// D1165: existing HQ admin reads, separate from the LP's own notices.
export const fundNoticesApi = {
  list: (params = {}) => request(`/fund-notices?${new URLSearchParams(params)}`),
  read: (uid) => request(`/fund-notices/${encodeURIComponent(uid)}`),
  pdfBlob: (uid) => noticePdf(`/api/fund-notices/${encodeURIComponent(uid)}/pdf`, uid),
  mine: () => request('/fund-notices/mine'),
  mineOne: (uid) => request(`/fund-notices/mine/${encodeURIComponent(uid)}`),
  // The kept PDF (binary endpoint, not typed drift), read only when the LP taps
  // PDF. It returns the blob and its filename and creates no object URL: the
  // caller saves it.
  minePdfBlob: async (uid) => {
    return noticePdf(`/api/fund-notices/mine/${encodeURIComponent(uid)}/pdf`, uid);
  },
};

async function noticePdf(path, uid) {
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
