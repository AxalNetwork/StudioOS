import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';

/**
 * The two write paths the hypothesis board has always had and never offered.
 *
 * `api.createHypothesis` and `api.linkHypothesisPain` have been in
 * `frontend/src/lib/api.js` since migration 211, and their worker routes are
 * live in `cloudflare-worker/src/routes/founder_validate.ts` — but **nothing in
 * `frontend/src` called either one.** The board rendered lanes, counts and a
 * distance-to-bar note over records no screen could create, and its empty state
 * sent the reader to the pain map. This is the wiring, not a new feature.
 *
 * WHAT THE SERVER OWNS, so these forms do not offer it:
 *   · The code. `H1`, `H2` … is allocated from the highest ever used, not from
 *     the current count, so retiring H2 cannot hand "H2" to a later claim
 *     (`founder_validate.ts:194-198`). A code field here could only disagree.
 *   · The lane. A claim sits where its interviews put it — lanes are computed
 *     from evidence, never dragged — so there is nothing to pick.
 *   · Which interviews count. That follows from the pain links below.
 *
 * WHY THE LINK FORM TAKES A DIRECTION AND NOT A WEIGHT. The route accepts
 * exactly `supports` or `contradicts` (`founder_validate.ts:254`), and the pain
 * group must belong to the same project — without that check a link could pull
 * another venture's interviews into this venture's evidence count. Both are the
 * server's rules; this form just cannot express anything else.
 */

function Shell({ title, onClose, onSubmit, submitting, error, submitLabel, canSubmit, testid, children }) {
  useEscapeClose(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
      data-testid={testid}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-gray-900 dark:text-gray-50">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            data-testid={`${testid}-close`}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {children}

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-bold text-gray-700 dark:border-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            data-testid={`${testid}-submit`}
            className="rounded-lg bg-axal-violet-deep px-3 py-1.5 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

const FIELD =
  'mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 ' +
  'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'text-[11px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';

export function NewHypothesisDialog({ open, onClose, onSave }) {
  const [claim, setClaim] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setClaim(''); setError(null); setSaving(false); } }, [open]);
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await onSave({ claim: claim.trim() });
    } catch (err) {
      setError(err?.message || 'The hypothesis could not be saved.');
      setSaving(false);
    }
  };

  return (
    <Shell
      title="New hypothesis"
      testid="modal-new-hypothesis"
      onClose={onClose}
      onSubmit={submit}
      submitting={saving}
      error={error}
      submitLabel="Add hypothesis"
      canSubmit={Boolean(claim.trim())}
    >
      <label className="block">
        <span className={LABEL}>The claim</span>
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          rows={3}
          autoFocus
          data-testid="input-hypothesis-claim"
          placeholder="Ops leads at Series-A logistics firms will pay to stop reconciling spreadsheets by hand."
          className={FIELD}
        />
      </label>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        The code (H1, H2 …) is allocated by the server from the highest ever used, so a retired claim
        never hands its number to a new one. The lane is computed from the interviews behind it — link
        this claim to a pain theme and the evidence starts counting on its own.
      </p>
    </Shell>
  );
}

export function LinkPainDialog({ open, hypotheses = [], painGroups = [], onClose, onSave }) {
  const [hypothesisId, setHypothesisId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [direction, setDirection] = useState('supports');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setHypothesisId(hypotheses[0] ? String(hypotheses[0].id) : '');
    setGroupId(painGroups[0] ? String(painGroups[0].id) : '');
    setDirection('supports');
    setError(null);
    setSaving(false);
  }, [open, hypotheses, painGroups]);
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await onSave(Number(hypothesisId), { pain_group_id: Number(groupId), direction });
    } catch (err) {
      setError(err?.message || 'The link could not be saved.');
      setSaving(false);
    }
  };

  // Both lists come from the board response the page already holds, so this
  // dialog adds no fetch — and it can only offer pain groups from THIS venture,
  // which is the same rule the route enforces server-side.
  const nothingToLink = !hypotheses.length || !painGroups.length;

  return (
    <Shell
      title="Link to a pain"
      testid="modal-link-pain"
      onClose={onClose}
      onSubmit={submit}
      submitting={saving}
      error={error}
      submitLabel="Link"
      canSubmit={Boolean(hypothesisId && groupId) && !nothingToLink}
    >
      {nothingToLink ? (
        <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
          {hypotheses.length
            ? 'This venture has no pain themes yet. Group the logged pains on the pain map first — a link needs a theme on the other end of it.'
            : 'This venture has no hypotheses yet. Add one first, then link it to a pain theme.'}
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className={LABEL}>Hypothesis</span>
            <select value={hypothesisId} onChange={(e) => setHypothesisId(e.target.value)} data-testid="select-link-hypothesis" className={FIELD}>
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>{h.code} · {h.claim}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={LABEL}>Pain theme</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} data-testid="select-link-pain-group" className={FIELD}>
              {painGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.title} · {g.count} interview{g.count === 1 ? '' : 's'}</option>
              ))}
            </select>
          </label>

          <fieldset>
            <span className={LABEL}>This theme</span>
            <div className="mt-1.5 flex gap-4">
              {[['supports', 'supports the claim'], ['contradicts', 'contradicts it']].map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-[12.5px] text-gray-700 dark:text-gray-200">
                  <input
                    type="radio"
                    name="direction"
                    value={value}
                    checked={direction === value}
                    onChange={() => setDirection(value)}
                    data-testid={`radio-direction-${value}`}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            Linking does not decide anything. The interviews already grouped under this theme start
            counting toward the claim, and the lane follows from that count against the bar.
          </p>
        </div>
      )}
    </Shell>
  );
}
