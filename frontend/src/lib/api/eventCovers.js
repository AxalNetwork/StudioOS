/** #5309 (D5309, D3724 §gaps 8 to 11) — the event cover's upload and its four drawn variants per press. */
import { request } from '../api.js';

const enc = encodeURIComponent;

/**
 * `upload` sends the image and its fields as one multipart press: the browser
 * sets the boundary, so no Content-Type is passed here (`request` leaves a
 * FormData body alone). `variantsQuote` prices four draws in one figure, and
 * `variants` draws them on that quote's uid, which is also the Idempotency-Key:
 * the same press retried replays and charges nothing again (D4450, #3846).
 */
export const eventCoversApi = {
  upload: (id, { file, alt, focal, crops }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('alt', alt ?? '');
    if (focal) form.append('focal', JSON.stringify(focal));
    if (crops) form.append('crops', JSON.stringify(crops));
    return request(`/events/${enc(id)}/cover/upload`, { method: 'POST', body: form });
  },
  variantsQuote: (id, prompt) => request(`/events/${enc(id)}/cover/variants/quote`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  variants: (id, prompt, quoteUid) => request(`/events/${enc(id)}/cover/variants`, {
    method: 'POST',
    headers: { 'Idempotency-Key': quoteUid },
    body: JSON.stringify({ prompt, quote_uid: quoteUid }),
  }),
};
