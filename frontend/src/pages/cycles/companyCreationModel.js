/**
 * D6038 (#6038, Build v2 BD11, BD25, BD26, BD29, BD30) — Company creation's
 * company-first page, as words: the entity summary band and its order line,
 * the one nearest-deadline filing, the 83(b) tracker, the documents list and
 * where each kind of filing is changed. Pure, so desktop and phone draw the
 * same words (`CompanyCreationHome.jsx`).
 *
 * Every value the read did not carry reads "Not recorded" with its reason, and
 * a block whose read failed reads "Could not be read", never a zero (BD29).
 */
import { buildFacts } from './BuildFacts.jsx';
import { isFounderPreview } from './previewUploadModel.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "2026-10-09" → "9 Oct 2026"; anything else → null. */
export function dateWords(iso) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "8 days left", "Due today", "3 days overdue"; null without a count. */
export function daysWords(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n === 0) return 'Due today';
  const abs = Math.abs(n);
  return `${abs} ${abs === 1 ? 'day' : 'days'} ${n < 0 ? 'overdue' : 'left'}`;
}

/** The venture travels on every link (`?project_id=`), as the module's other doors carry it. */
export function ventureQuery(projectId) {
  return /^[1-9]\d*$/.test(String(projectId ?? '')) ? `?project_id=${projectId}` : '';
}

const cell = (label, f, fallbackReason) => (f?.value
  ? { label, value: f.value, note: f.source || null, recorded: true }
  : { label, value: null, note: f?.reason || fallbackReason, recorded: false });

/**
 * BD25's summary band, BD26 B's after-payment band and BD29's states.
 * `state`: 'loading' | 'unreadable' | 'ok'.
 */
export function summaryView(facts, status = 'ready') {
  if (status === 'loading') return { state: 'loading' };
  const e = facts?.entity;
  if (!e || e.state !== 'ok') return { state: 'unreadable', reason: e?.reason || 'The company summary could not be read. That is not the same as no company.' };
  const formed = e.formed_on?.value ? { ...e.formed_on, value: dateWords(e.formed_on.value) || e.formed_on.value } : e.formed_on;
  const ein = e.ein || {};
  const cells = [
    cell('Company name', e.name, 'No company name is recorded.'),
    cell('Jurisdiction', e.jurisdiction, 'No jurisdiction is recorded.'),
    cell('Formation date', formed, 'No formation date is recorded.'),
    cell('Registered agent', e.registered_agent, 'No registered agent is recorded.'),
    ein.state === 'not_recorded' || !ein.label
      ? { label: 'EIN', value: null, note: ein.reason || 'No EIN filing is recorded.', recorded: false }
      : { label: 'EIN', value: ein.label, note: ein.number_reason || 'The EIN number is not stored.', recorded: true, state: ein.state === 'issued' ? 'Issued' : 'Pending' },
  ];
  const order = e.order ? {
    label: e.order.status_label || 'Status not recorded',
    track: e.order.track,
    steps: (Array.isArray(e.order.steps) ? e.order.steps : []).map((s) => ({ label: s.label, date: dateWords(s.date), done: !!s.date })),
  } : null;
  // The recorded incorporation workspace snapshot (projects.incorporation_meta), drawn as it always was (D6040).
  const snapshot = buildFacts('company-creation', facts).find((f) => f.label === 'Incorporation');
  return { state: 'ok', cells, order, snapshot: snapshot ? { value: snapshot.value, source: snapshot.source } : null };
}

/**
 * BD11 and BD25: the one primary action, the nearest-deadline filing
 * (`facts.next_filing`, the card's own next filing, D5066/D6027). With none
 * open, there is no deadline to press and the page says so.
 */
export function dominantView(facts, rowHref = () => null) {
  const n = facts?.next_filing;
  if (!n || !text(n.title)) return null;
  const due = dateWords(n.due);
  const word = text(n.text);
  return {
    title: `Complete ${n.title}${word ? `, ${word.toLowerCase()}` : ''}`,
    sub: [due ? `Due ${due}` : 'No due date recorded', n.state === 'overdue' ? 'overdue' : null].filter(Boolean).join(' · '),
    tone: n.state === 'overdue' ? 'bad' : n.state === 'due_soon' ? 'warn' : 'plain',
    action: `Open ${n.title} →`,
    href: n.id != null ? rowHref({ id: n.id }) : null,
  };
}

const PROOF_NOTE = { Stored: 'Proof stored', Missing: 'Proof missing', Unreadable: 'Proof unreadable', 'Not expected yet': 'Proof not expected yet' };

/** BD25's 83(b) tracker: one row per founder (Q1 A), and its count line. */
export function electionView(facts, status = 'ready') {
  if (status === 'loading') return { state: 'loading', rows: [] };
  const el = facts?.elections;
  if (!el || el.state !== 'ok') return { state: 'unreadable', rows: [], reason: el?.reason || '83(b) trackers could not be read. Filings still read.' };
  const rows = (Array.isArray(el.rows) ? el.rows : []).map((r) => ({
    key: String(r.holder_id),
    name: text(r.name) || 'Founder name not recorded',
    who: r.you ? 'You' : 'Co-founder',
    grant: dateWords(r.grant_date),
    deadline: dateWords(r.deadline),
    left: r.status === 'missed' ? null : daysWords(r.days_left),
    mailed: r.mailed_on ? `Mailed ${dateWords(r.mailed_on)}` : r.tracker ? 'Not mailed yet' : null,
    status: r.status === 'not_recorded' ? 'Not recorded' : r.status_label || 'Not recorded',
    proof: r.proof || null,
    proofNote: r.proof ? PROOF_NOTE[r.proof] || r.proof : null,
    reason: r.reason || null,
    filingId: r.filing_id || null,
  }));
  const total = typeof el.total === 'number' ? el.total : rows.length;
  return {
    state: rows.length ? 'ok' : 'empty', rows,
    line: rows.length ? `${el.done ?? 0} of ${total} founders’ 83(b) ${total === 1 ? 'election' : 'elections'} mailed, confirmed or filed` : 'No founder is recorded on the cap table yet.',
  };
}

/**
 * BD25's documents: the company's four papers (Stored or Missing) and each
 * founder's 83(b) proof, read from the 83(b) rows, so a proof is never read twice.
 */
export function documentsView(facts, status = 'ready', projectId = null) {
  if (status === 'loading') return { state: 'loading', papers: [], proofs: [] };
  const p = facts?.papers;
  const q = ventureQuery(projectId);
  const companyHref = p?.company_uid ? `/account/portfolio/${encodeURIComponent(p.company_uid)}` : null;
  const papers = p?.state === 'ok' ? (Array.isArray(p.rows) ? p.rows : []).map((r) => ({
    key: r.kind, label: r.label, state: r.state,
    note: r.state === 'Stored' ? ['Uploaded', dateWords(r.at), r.by].filter(Boolean).join(' · ') : r.state === 'Missing' ? 'Nothing uploaded' : 'The record holds no readable file',
    action: companyHref ? { text: r.state === 'Stored' ? 'Open' : 'Upload', href: companyHref } : null,
  })) : [];
  const el = facts?.elections;
  const proofs = el?.state === 'ok' ? (Array.isArray(el.rows) ? el.rows : []).filter((r) => r.proof).map((r) => ({
    key: `83b-${r.holder_id}`, label: `83(b) proof · ${text(r.name) || 'founder'}`, state: r.proof,
    note: r.proof === 'Stored' ? 'Stored with the 83(b)' : r.proof === 'Missing' ? `Nothing uploaded${r.deadline ? ` · filing due ${dateWords(r.deadline)}` : ''}` : r.proof,
    action: r.filing_id ? { text: r.proof === 'Stored' ? 'Open' : 'Upload', filingId: r.filing_id } : null,
  })) : [];
  const stored = papers.filter((x) => x.state === 'Stored').length;
  const proofStored = proofs.filter((x) => x.state === 'Stored').length;
  const line = [p?.state === 'ok' ? `${stored} of ${papers.length} company papers stored` : null,
    proofs.length ? `${proofStored} of ${proofs.length} 83(b) proofs stored` : null].filter(Boolean).join(' · ');
  return {
    state: p?.state || 'unreadable', reason: p?.reason || 'Documents could not be read. Nothing here means a paper is missing.',
    papers, proofs, line, companyHref, linkHref: `/account/portfolio${q}`,
  };
}

/**
 * BD27 B/C, BD11: where each filing is changed. A row id names its source
 * (`routes/cycle_build.ts`): `lab-` an incorporation order step, `obligation-`
 * a filing Axal set on the company's calendar, `step-` the venture's own.
 */
export function filingSource(id) {
  const s = String(id ?? '');
  if (s.startsWith('lab-')) return { key: 'lab', note: 'Lab step · changed from your incorporation order' };
  if (s.startsWith('obligation-')) return { key: 'obligation', note: 'Set by Axal · only Axal changes it' };
  if (s.startsWith('step-')) return { key: 'step', note: 'Build filing · yours to edit' };
  return null;
}

/** The filings read with each row's source under its name, so the table says who changes it. */
export function filingRows(records) {
  if (!records || !Array.isArray(records.rows)) return records;
  return {
    ...records,
    rows: records.rows.map((r) => {
      const src = filingSource(r.id);
      const name = r.cells?.filing;
      if (!src || name == null || typeof name === 'object') return r;
      return { ...r, cells: { ...r.cells, filing: { text: String(name), note: src.note } } };
    }),
  };
}

/** Which sources the rows hold, for the "where it is changed" line under the table. */
export function sourcesIn(records) {
  const keys = new Set((Array.isArray(records?.rows) ? records.rows : []).map((r) => filingSource(r.id)?.key).filter(Boolean));
  return { lab: keys.has('lab'), obligation: keys.has('obligation') };
}

/**
 * BD25's "After formation" IP step, from the Lab's copied IP record (facts.ip, D6040).
 *
 * D9101 (#9101): with no record, the step may offer BD25's Record IP assignment, which copies the IP answers of the
 * viewer's accepted Spin-Out application (`POST /cycles/build/project/ip-copy`). `lab` is the viewer's Lab state as
 * the page read it, `{ status: 'loading' | 'unreadable' | 'ready', application }`, or null when it was not read.
 * `mode` is `useViewMode()`'s value, passed in so this stays pure. `action` is 'copy' or null; `check` is the Lab
 * read's own state on this step only ('loading' | 'unreadable' | null); `note` is a line under the reason.
 */
export function ipStep(facts, lab = null, mode = null) {
  const ip = buildFacts('company-creation', facts).find((f) => f.label === 'IP');
  if (ip?.value) return { value: ip.value, source: ip.source, recorded: true, action: null, check: null, note: null };
  const base = {
    value: null, source: 'From the Lab’s IP record', recorded: false, action: null, check: null, note: null,
    reason: 'No Lab IP record: this venture did not come through the Lab, or its IP is not recorded.',
  };
  // The copy reads the caller's own application, so a Super Admin previewing a founder would get a 404 (D9101).
  if (isFounderPreview(mode)) return { ...base, note: 'Only the founder can copy their own Spin-Out application.' };
  if (lab?.status === 'loading') return { ...base, check: 'loading' };
  if (lab?.status === 'unreadable') return { ...base, check: 'unreadable', note: 'Could not check your Spin-Out application.' };
  const app = lab?.status === 'ready' ? lab.application : null;
  if (app?.status === 'accepted' && /^[1-9]\d*$/.test(String(app.id ?? ''))) {
    return { ...base, action: 'copy', applicationId: Number(app.id), note: 'Your Spin-Out application was accepted. Its IP answers can be copied onto this venture.' };
  }
  return base;
}

/** D9101: what a failed copy says on the IP step, by the Worker's answer (`cycle_build.ts`), never a bare code. */
export function ipCopyErrorWords(err) {
  const s = err?.status;
  if (s === 404) return 'No accepted Spin-Out application of yours was found, so nothing was copied.';
  if (s === 503) return 'Your application’s answers could not be read, so nothing was copied.';
  if (typeof s === 'number' && s >= 400) return `${text(err?.message) || 'The IP details could not be copied.'} Nothing was copied.`;
  return 'The IP details could not be copied: the request did not reach Axal. Nothing was copied.';
}

/**
 * D9101: press Record IP assignment. Copies through `copyIp(projectId, applicationId)` and, once it lands, calls
 * `reload()` so the step reads the record from `facts.ip`; the copy's own answer is not drawn. Resolves to the
 * error words on the step, or '' when it was copied; nothing is sent outside the copy state.
 */
export async function runIpCopy(ip, projectId, copyIp, reload) {
  if (ip?.action !== 'copy') return '';
  try { await copyIp(projectId, ip.applicationId); }
  catch (e) { return ipCopyErrorWords(e); }
  reload?.();
  return '';
}

/** Whole days from `today` (YYYY-MM-DD, UTC) to an ISO day, or null. */
function daysFrom(iso, today) {
  const d = typeof iso === 'string' ? /^\d{4}-\d{2}-\d{2}$/.exec(iso) : null;
  const t = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  return d ? Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 86400000) : null;
}

/**
 * D8259 (#8259, BD28): the suggested filings block. `state`: 'loading' | 'unreadable' | 'no_pack' | 'ok' | 'none'
 * ('none': every suggestion is added or hidden, so the block is not drawn). Each row says its due date and days left,
 * or why there is no date, and how often it recurs.
 */
export function suggestionsView(facts, status = 'ready', today = null) {
  if (status === 'loading') return { state: 'loading' };
  const s = facts?.suggestions;
  if (!s || typeof s !== 'object') return { state: 'none' };
  if (s.state === 'unreadable') return { state: 'unreadable', reason: text(s.reason) || 'Suggested filings could not be read.' };
  if (s.state === 'no_pack') {
    const where = text(s.jurisdiction);
    return { state: 'no_pack', title: where ? `Suggested for ${where}` : 'Suggested filings',
      heading: where ? `No suggested filings for ${where} yet` : 'No suggested filings yet',
      reason: text(s.reason) || 'Axal has filing packs for US Delaware LLCs and C-Corps only.' };
  }
  const rows = (Array.isArray(s.rows) ? s.rows : []).filter((r) => typeof r?.key === 'string' && text(r.title)).map((r) => {
    const due = dateWords(r.due);
    const left = due ? daysWords(daysFrom(r.due, today)) : null;
    return { key: r.key, title: r.title.trim(), kind: r.kind || 'other', jurisdiction: r.jurisdiction === 'Federal' ? 'Federal' : null,
      due: due ? r.due : null, line: [due ? `Due ${due}${left ? ` · ${left}` : ''}` : (text(r.due_reason) || 'No due date is recorded.'), text(r.cadence)].filter(Boolean).join(' · ') };
  });
  if (!rows.length) return { state: 'none' };
  const label = text(s.pack_label) || 'filing';
  return { state: 'ok', title: `Suggested for your ${label}`, line: `${rows.length} ${rows.length === 1 ? 'suggestion' : 'suggestions'} · from Axal’s ${label} pack`, rows };
}

/**
 * "Add to my filings": the Add filing form's own address with `form=suggested` and the suggestion's values
 * (`forms.js` `suggestedFilingValues` reads them), keeping the venture and the page to return to. Null without an Add.
 */
export function suggestionHref(addHref, row) {
  if (typeof addHref !== 'string' || !addHref.startsWith('/') || !row) return null;
  const [path, query = ''] = addHref.split('?');
  const q = new URLSearchParams(query);
  q.set('form', 'suggested');
  q.set('title', row.title);
  q.set('kind', row.kind);
  if (row.jurisdiction) q.set('jurisdiction', row.jurisdiction);
  if (row.due) q.set('due_date', row.due);
  return `${path}?${q}`;
}
