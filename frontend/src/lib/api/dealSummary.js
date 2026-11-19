import { rawRequestHeaders, refusalError, request } from '../api.js';

/**
 * #6629 (D6629): the deal summary an investor downloads from the deal page (`routes/deal_summary.ts`).
 *
 * availability(id) -> { available: true, format: 'pdf', stamp: 'for <name>, <firm>' }
 *                  or { available: false, code, reason }: the one sentence for why not (not an investor on this deal
 *                     for the chosen firm, a Free plan, no NDA yet). Read when the menu opens; it decides nothing.
 * pdfBlob(id, { signal }) -> { blob, filename }. The Worker checks access again on this request and records the
 *                     download; a refusal, or a body that came back empty, throws: never an empty file.
 * Both send the chosen firm (`X-Company-Id`) as every deal read does.
 */
const at = (id) => `/deals/${encodeURIComponent(id)}/summary`;

async function pdfBlob(id, { signal } = {}) {
  const res = await fetch(`/api${at(id)}/pdf`, { credentials: 'include', headers: rawRequestHeaders('GET'), signal });
  if (!res.ok) throw await refusalError(res, 'The deal summary could not be downloaded.');
  const blob = await res.blob();
  if (!blob || !blob.size) throw new Error('The deal summary came back empty.');
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `axal-deal-summary-${id}.pdf`;
  return { blob, filename };
}

export const dealSummaryApi = {
  availability: (id) => request(at(id)),
  pdfBlob,
};
