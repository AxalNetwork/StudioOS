// D716 (#1860) — the LP's own notices: the list, one notice's frozen and
// masked figures, and the kept PDF. Every route answers only notices
// addressed to the caller's own `limited_partners` rows. Nothing here returns
// a full account number: the full number stays behind #1773's line route.
import { request, refusalError } from '../api.js';

export const fundNoticesApi = {
  mine: () => request('/fund-notices/mine'),
  mineOne: (uid) => request(`/fund-notices/mine/${encodeURIComponent(uid)}`),
  // The kept PDF (binary endpoint, not typed drift), read only when the LP taps
  // PDF. It returns the blob and its filename and creates no object URL: the
  // caller saves it.
  minePdfBlob: async (uid) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/fund-notices/mine/${encodeURIComponent(uid)}/pdf`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await refusalError(res, 'The notice PDF could not be downloaded.');
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `notice-${uid}.pdf`;
    return { blob, filename };
  },
};
