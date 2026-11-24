/**
 * #8261 (Build v2 BD29 B, with BD22's preview banner) — a Super Admin who
 * previews a founder's Company creation confirms before a paper is uploaded.
 *
 * Founder preview is the Preview shell, not impersonation: the Super Admin
 * browses the founder shell (`viewMode` founder, no support session), and
 * whatever they save is written as themselves into the venture's records.
 * An upload is the one write in Company creation that stores a file in the
 * company's history, so it asks first and says whose company it lands in and
 * whose name it carries. Cancel sends nothing.
 *
 * The preview write policy is unchanged: the Worker decides what a Super Admin
 * may write; this only puts a question in front of the upload. Outside preview
 * (a founder, a plain admin view, a support session) there is no question.
 */

export const PREVIEW_UPLOAD_MODULE = Object.freeze({ cycle: 'build', slug: 'company-creation' });

/** The words Cancel leaves on the form: nothing went to the Worker. */
export const PREVIEW_UPLOAD_CANCELLED = 'Nothing was uploaded. The upload was cancelled before anything was sent.';

/** A Super Admin browsing the founder shell, not in a support session (`ViewModeContext`'s value). */
export function isFounderPreview(mode) {
  return mode?.superAdmin === true && mode?.isImpersonating !== true && mode?.viewMode === 'founder';
}

const isFile = (value) => !!value && typeof value === 'object' && typeof value.name === 'string' && typeof value.size === 'number';

/** The files a form's submitted values carry (a file field, or a multiple one). */
export function uploadedFiles(values) {
  return Object.values(values || {}).flatMap((value) => (Array.isArray(value) ? value : [value])).filter(isFile);
}

/** True when this submit is a Company creation upload made in founder preview. */
export function needsPreviewUploadConfirm({ cycle, slug, mode, values }) {
  return String(cycle ?? '').toLowerCase() === PREVIEW_UPLOAD_MODULE.cycle && slug === PREVIEW_UPLOAD_MODULE.slug
    && isFounderPreview(mode) && uploadedFiles(values).length > 0;
}

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * BD29 B's confirm. `admin` is the Super Admin's own name, `company` the
 * venture's; either can be unknown, and the sentence then says so plainly
 * rather than naming no one.
 */
export function previewUploadCopy({ admin = null, company = null, files = [] } = {}) {
  const who = clean(admin) ? `${clean(admin)}, Super Admin` : 'you, Super Admin';
  const where = clean(company) || 'this venture';
  const list = (Array.isArray(files) ? files : []).filter(isFile);
  const what = list.length === 1 ? list[0].name : list.length > 1 ? `${list.length} files` : 'This file';
  // A name that already ends in a full stop ("Example Inc.") takes no second one.
  const stop = /[.!?]$/.test(where) ? '' : '.';
  return {
    title: 'Upload as Super Admin?',
    body: `You are previewing a founder’s view of ${where}${stop} ${what} will be stored in ${where}’s company records and recorded under your name (${who}), not a founder’s. ${where} will see it in its history.`,
    cta: 'Upload as Super Admin',
    cancel: 'Cancel',
  };
}
