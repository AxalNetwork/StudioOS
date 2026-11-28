/**
 * D6139 part 1 (#6139): the member's accreditation evidence. Worker:
 * routes/trust_accreditation.ts (/api/trust/accreditation).
 *
 * mine()                     GET  /trust/accreditation/evidence/mine
 *   -> { obligation: { required, status, expires_at } | null, items: [{ id, basis, basis_label, file_name,
 *        uploaded_at, status, reviewed_at, expires_at, review_reason }], retention: { accreditation_months,
 *        investor_record_months } }. No file, key or digest is ever in it.
 * upload({ basis, file })    POST /trust/accreditation/evidence, multipart. `basis` is who wrote the letter:
 *   cpa_letter | attorney_letter | broker_dealer_letter | registered_adviser_letter (owner answer A).
 *   Refusals carry a sentence: 400 bad_basis / letter_required, 413 letter_too_large, 415 letter_type,
 *   403 accreditation_not_asked, 409 letter_open, 503 storage_unavailable.
 */
import { request } from '../api.js';

export const trustAccreditationApi = {
  mine: () => request('/trust/accreditation/evidence/mine'),
  upload: ({ basis, file }) => {
    const fd = new FormData();
    fd.append('basis', String(basis || ''));
    if (file) fd.append('file', file, file.name || 'accreditation-letter');
    return request('/trust/accreditation/evidence', { method: 'POST', body: fd });
  },
};
