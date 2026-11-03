// D4289 P2 (#4291) — the public read behind `axal.vc/@handle`. Worker:
// routes/public_handle.ts. No sign-in.
//   GET /api/public/handle/:handle[/:channel]   (X-Axal-Visitor: the browser's visit id)
//       → { state: 'live', handle, channel, name, photo, line, tier, tier_label, offer, disclosure, ref }
//         { state: 'moved', handle, redirect } · { state: 'unavailable' } · 404 { state: 'unknown' }
import { request } from '../api.js';

const enc = encodeURIComponent;

export const publicHandlesApi = {
  read: (handle, channel = null, visitor = null) => request(
    `/public/handle/${enc(handle)}${channel ? `/${enc(channel)}` : ''}`,
    { headers: visitor ? { 'X-Axal-Visitor': visitor } : {} },
  ),
};
