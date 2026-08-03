// Log / edit a discovery interview — the design's "Log Interview" modal
// (spin-out-lab-pipeline/project/Customer Discovery.dc.html), bound to the
// real interview store.
//
// Before this existed the Customer Discovery page had no create path at all:
// its "Log interview" button navigated away to /build/discovery, even though
// api.createInterview / updateInterview / deleteInterview and their worker
// routes had been in place the whole time.
//
// Field mapping — every control writes a column the API actually accepts:
//   Name                 → interviewee_name (required)
//   Role + Company       → interviewee_role, joined as "Role · Company",
//                          which is exactly how the log row renders it
//   Interview date       → interview_date
//   ICP fit              → icp_fit ('strong' | 'partial' | 'none'), D1 161.
//                          Left unset it stays null = "not yet assessed",
//                          which the summary counts separately and never
//                          folds into "not ICP".
//   Pain points          → pains[]
//   Notable quote        → first line of notes, wrapped in quotes (see
//                          composeNotes/parseNotes — a deterministic
//                          convention, so an edit round-trips losslessly)
//   Insights             → the rest of notes
//   Deck-eligible        → featured
//   Solution-fit rating  → validation_rating (0-5) + validation_comment
//
// Design controls deliberately NOT rendered, because nothing stores them and
// a control that silently discards input is worse than no control:
//   Format (Call/In person), Source (Warm intro/…), Willingness to pay,
//   Must-have / blocker, Follow-up action, and per-pain severity
//   (need/good/nice — the API normalises pains to plain strings).
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';

export const ICP_FIT_OPTIONS = [
  { value: 'strong', label: 'Strong fit' },
  { value: 'partial', label: 'Partial fit' },
  { value: 'none', label: 'Not ICP' },
];

// notes  ←→  { quote, insights }. A leading line that is entirely wrapped in
// double quotes is the notable quote; everything after it is the insight
// body. Anything else round-trips as pure insight text.
export function composeNotes({ quote, insights }) {
  const q = String(quote || '').trim();
  const body = String(insights || '').trim();
  if (!q) return body;
  return body ? `"${q}"\n\n${body}` : `"${q}"`;
}
export function parseNotes(notes) {
  const raw = String(notes || '');
  // Greedy `.+` so the closing quote is the LAST one on the first line, not
  // the first: a pasted quote containing quotation marks ('He said "maybe"')
  // would otherwise split in the wrong place and mangle both fields on edit.
  // `.` excludes newlines, so the match can never run past the first line.
  const m = raw.match(/^"(.+)"(?:\n\n?)?([\s\S]*)$/);
  if (m) return { quote: m[1], insights: m[2].trim() };
  return { quote: '', insights: raw.trim() };
}

const FIELD =
  'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-50 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40';
const LBL = 'block text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {object|null} interview  existing row to edit, or null to create
 * @param {(payload:object)=>Promise<any>} onSave  resolves on success
 */
export default function LogInterviewModal({ open, interview, onClose, onSave }) {
  const editing = Boolean(interview?.id);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [date, setDate] = useState(todayIso());
  const [icpFit, setIcpFit] = useState('');
  const [pains, setPains] = useState([]);
  const [painDraft, setPainDraft] = useState('');
  const [quote, setQuote] = useState('');
  const [insights, setInsights] = useState('');
  const [featured, setFeatured] = useState(false);
  const [rating, setRating] = useState('');
  const [ratingComment, setRatingComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reload the form whenever the target row changes (including null → create).
  useEffect(() => {
    if (!open) return;
    const iv = interview || null;
    // interviewee_role is stored as "Role · Company"; split on the first
    // separator only, so a company containing "·" survives the round-trip.
    const rawRole = String(iv?.interviewee_role || '');
    const sep = rawRole.indexOf(' · ');
    setName(iv?.interviewee_name || '');
    setRole(sep === -1 ? rawRole : rawRole.slice(0, sep));
    setCompany(sep === -1 ? '' : rawRole.slice(sep + 3));
    setDate((iv?.interview_date || todayIso()).slice(0, 10));
    setIcpFit(iv?.icp_fit || '');
    setPains(Array.isArray(iv?.pains) ? iv.pains.filter(Boolean).map(String) : []);
    setPainDraft('');
    const parsed = parseNotes(iv?.notes);
    setQuote(parsed.quote);
    setInsights(parsed.insights);
    setFeatured(Boolean(iv?.featured));
    setRating(iv?.validation_rating == null ? '' : String(iv.validation_rating));
    setRatingComment(iv?.validation_comment || '');
    setError(null);
  }, [open, interview]);

  const canSave = useMemo(() => name.trim().length > 0 && !saving, [name, saving]);

  function addPain() {
    const p = painDraft.trim();
    if (!p) return;
    // Case-insensitive dedupe keeps the aggregate pain counts meaningful.
    if (!pains.some((x) => x.toLowerCase() === p.toLowerCase())) setPains([...pains, p]);
    setPainDraft('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        interviewee_name: name.trim(),
        interviewee_role: [role.trim(), company.trim()].filter(Boolean).join(' · ') || null,
        interview_date: date || undefined,
        notes: composeNotes({ quote, insights }),
        pains,
        // Hypotheses are curated elsewhere on the page; sending the existing
        // array unchanged keeps this modal from wiping them on an edit.
        hypotheses: Array.isArray(interview?.hypotheses) ? interview.hypotheses : [],
        icp_fit: icpFit || null,
        featured,
        validation_rating: rating === '' ? null : Number(rating),
        validation_comment: ratingComment.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save the interview.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
      data-testid="modal-log-interview"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl my-auto rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 shadow-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-extrabold text-gray-900 dark:text-gray-50">
            {editing ? 'Edit interview' : 'Log Interview'}
          </h3>
          <button type="button" onClick={onClose} data-testid="button-close-log" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="sm:col-span-2">
            <label className={LBL} htmlFor="iv-name">Name</label>
            <input id="iv-name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Ellis" data-testid="input-interviewee-name" required />
          </div>
          <div>
            <label className={LBL} htmlFor="iv-role">Role / title</label>
            <input id="iv-role" className={FIELD} value={role} onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. VP Ops" data-testid="input-interviewee-role" />
          </div>
          <div>
            <label className={LBL} htmlFor="iv-company">Company / segment</label>
            <input id="iv-company" className={FIELD} value={company} onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Distributed SaaS" data-testid="input-interviewee-company" />
          </div>
          <div>
            <label className={LBL} htmlFor="iv-date">Interview date</label>
            <input id="iv-date" type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)}
              data-testid="input-interview-date" />
          </div>
          <div>
            <span className={LBL}>ICP fit</span>
            <div className="flex flex-wrap gap-1.5">
              {ICP_FIT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setIcpFit(icpFit === o.value ? '' : o.value)}
                  data-testid={`chip-icp-${o.value}`}
                  aria-pressed={icpFit === o.value}
                  className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-full border ${
                    icpFit === o.value
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1">Leave unset if you haven't judged fit yet.</p>
          </div>

          <div className="sm:col-span-2">
            <label className={LBL} htmlFor="iv-pain">Pain points</label>
            <div className="flex gap-2">
              <input
                id="iv-pain"
                className={FIELD}
                value={painDraft}
                onChange={(e) => setPainDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPain(); } }}
                placeholder="Type a pain point and press Enter"
                data-testid="input-pain"
              />
              <button type="button" onClick={addPain} data-testid="button-add-pain"
                className="flex-none rounded-lg border border-gray-200 dark:border-gray-700 px-3 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                <Plus size={15} />
              </button>
            </div>
            {pains.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {pains.map((p) => (
                  <span key={p} data-testid={`pain-chip-${p}`}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full pl-2.5 pr-1.5 py-1">
                    {p}
                    <button type="button" onClick={() => setPains(pains.filter((x) => x !== p))} aria-label={`Remove ${p}`}
                      className="text-violet-400 hover:text-violet-700 dark:hover:text-violet-200">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className={LBL} htmlFor="iv-quote">Notable quote</label>
            <input id="iv-quote" className={FIELD} value={quote} onChange={(e) => setQuote(e.target.value)}
              placeholder="Paste or type a direct quote…" data-testid="input-quote" />
          </div>
          <div className="sm:col-span-2">
            <label className={LBL} htmlFor="iv-insights">Insights</label>
            <textarea id="iv-insights" rows={4} className={FIELD} value={insights} onChange={(e) => setInsights(e.target.value)}
              placeholder="Open-ended summary (3–5 sentences)" data-testid="input-insights" />
          </div>

          <div>
            <label className={LBL} htmlFor="iv-rating">Solution-fit rating</label>
            <select id="iv-rating" className={FIELD} value={rating} onChange={(e) => setRating(e.target.value)} data-testid="select-rating">
              <option value="">Not rated</option>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
            </select>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1">How well your solution addresses their problem — separate from ICP fit.</p>
          </div>
          <div>
            <label className={LBL} htmlFor="iv-rating-note">Rating comment</label>
            <input id="iv-rating-note" className={FIELD} value={ratingComment} onChange={(e) => setRatingComment(e.target.value)}
              placeholder="Optional" data-testid="input-rating-comment" />
          </div>

          <label className="sm:col-span-2 flex items-center gap-2 text-[12.5px] text-gray-700 dark:text-gray-200 cursor-pointer">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)}
              data-testid="checkbox-featured" className="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
            Deck-eligible — allow this quote on the Problem slide
          </label>
        </div>

        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-400 mt-3" data-testid="text-log-error">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-600 dark:text-gray-300">
            Cancel
          </button>
          <button type="submit" disabled={!canSave} data-testid="button-save-interview"
            className="h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[13px] font-bold inline-flex items-center gap-1.5">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editing ? 'Save changes' : 'Log interview'}
          </button>
        </div>
      </form>
    </div>
  );
}
