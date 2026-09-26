import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { formatCost } from '../ui/assistCost';

/**
 * What Eadwyn suggested, and the THREE decisions a founder makes about each one.
 *
 * WHY IT IS A BAND ON THE PAGE AND NOT A BLOCK IN THE RAIL. The canvas puts it
 * here — `Pages · Founder Validate` draws a "Proposal · drafted from recurring
 * pains" band above the board with `Add to {lane}` / `Edit the claim` /
 * `Discard` — and the reason holds up: a proposal is about the records on this
 * page, so it belongs beside them. The rail holds the switch and the meter;
 * the page holds the work.
 *
 * `Edit the claim` WAS IN THAT CANVAS FROM THE START AND WAS NEVER BUILT. Accept
 * and discard shipped; the middle control existed only in the comment above this
 * one, describing an artboard. It is here now, and it is not cosmetic: accepting a
 * value a founder would have corrected teaches them to discard and retype, which
 * is the same work with the proposal's provenance thrown away. An accepted edit
 * records BOTH values — what Eadwyn proposed and what they saved — because a
 * corrected fill is a different fact from either alone.
 *
 * NOT EVERY KIND MAY BE EDITED, and the server decides which. A `pain_tag`'s
 * phrase is the PROJECT'S OWN LOGGED STRING — the parser deliberately emits it
 * rather than the model's echo, so a near-miss spelling cannot become a second
 * phrase — and the accept route refuses an edit to it. Drawing the control there
 * would be a button that always fails, so `kinds[kind].editable` gates it.
 *
 * THE COPY COMES FROM THE SERVER'S REGISTRY, on the list response. This file used
 * to hold its own `COPY` map hardcoded to two kinds, which meant a third kind had
 * to be added in two places — the thing `services/fills/registry.ts` exists to
 * stop. One request carries the proposals and the words for them.
 *
 * NOTHING HERE RUNS ON ITS OWN. It renders only when the mode is on, and even
 * then it only READS existing proposals until the founder presses the run
 * button. A component that proposed on mount would spend a founder's budget
 * for visiting a page.
 *
 * NO MODEL IS SENT, and that is deliberate rather than an omission. The rail's
 * menu is scoped to `workspace_explain` — the read-back — and these are two
 * different task classes with their own `alternates`; the 3b the rail offers
 * for a read-back is not offered for drafting a claim at all. Forwarding the
 * read-back's choice would ask the router for a model this task does not
 * offer, and it would rightly refuse. Per-task menus are a real thing to want
 * and are not this change.
 */

const BAND = 'rounded-[10px] border border-violet-200 bg-violet-50/60 p-3 '
  + 'dark:border-violet-900 dark:bg-violet-950/25';
const GHOST = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
  + 'border-gray-200 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-700 '
  + 'transition-colors hover:border-gray-300 focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';
// The ONE filled button, and the canvases are consistent about where it goes:
// every zone-header action is a ghost, and the accent appears once per artboard,
// always on the control that commits an AI proposal.
const ACCENT = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
  + 'border-violet-600 bg-violet-600 px-[11px] py-1.5 text-[11px] font-bold text-white '
  + 'transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const FIELD = 'w-full rounded-[7px] border border-violet-300 bg-white px-2.5 py-2 '
  + 'text-[12px] leading-relaxed text-gray-900 focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-1 dark:border-violet-800 dark:bg-gray-950 dark:text-gray-100';

/** The longest edit the accept route stores. Mirrors its own `slice(0, 4000)`. */
const MAX_EDIT = 4000;

/**
 * One proposal, as a person reads it.
 *
 * The shapes are per kind and this is the one place that knows them. A payload
 * whose kind is unrecognised falls back to the `readable` the server sends, so a
 * kind added to the registry before this map renders as its own sentence rather
 * than as nothing — an empty card with two buttons is worse than plain text.
 */
function readable(kind, payload) {
  if (kind === 'pain_tag') return `${payload?.phrase ?? ''} → ${payload?.group_title ?? ''}`;
  if (kind === 'hypothesis') return String(payload?.claim ?? '');
  if (kind === 'market_input') return String(payload?.value ?? '');
  return String(payload?.readable ?? payload?.value ?? payload?.claim ?? '');
}

/**
 * Where a `sourced` figure came from, with the sentence that supports it.
 *
 * Shown rather than summarised: a citation that names a document and nothing else
 * asks a reader to trust the label, and one that carries the quote lets them judge
 * whether it says what the fill claims. Rendering nothing when there is no
 * citation is correct — a `restatement` has none by design, and the absence is the
 * signal.
 */
function Citation({ citation }) {
  if (!citation) return null;
  const where = citation.kind === 'library'
    ? citation.title || 'a document in your library'
    : citation.source || 'a research answer';
  return (
    <p className="mt-1.5 border-l-2 border-violet-300 pl-2 text-[10.5px] leading-relaxed text-gray-600 dark:border-violet-800 dark:text-gray-400">
      <span className="font-bold">{where}</span>
      {citation.kind === 'library' && Number.isFinite(Number(citation.chunk))
        ? <span className="text-gray-500 dark:text-gray-500"> · passage {Number(citation.chunk) + 1}</span>
        : null}
      {citation.quote ? <>: &ldquo;{citation.quote}&rdquo;</> : null}
    </p>
  );
}

export default function FillProposals({ projectId, kind, enabled, onApplied }) {
  const [items, setItems] = useState([]);
  const [kinds, setKinds] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  // { id, value } while a proposal is being edited. One at a time, because the
  // canvas shows one open editor and two would let a founder lose the other.
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    if (!projectId || !enabled) { setItems([]); return; }
    try {
      const r = await api.listValidateProposals(projectId);
      setItems((r?.proposals || []).filter((p) => p.kind === kind));
      if (r?.kinds) setKinds(r.kinds);
    } catch {
      // A failed read is not "no proposals". Leaving the list alone keeps a
      // transient error from looking like the founder's proposals vanished.
      setNote('Your proposals could not be read just now.');
    }
  }, [projectId, kind, enabled]);

  useEffect(() => { load(); }, [load]);

  const propose = async () => {
    setBusy('run'); setNote(''); setReceipt(null);
    try {
      const r = await api.proposeValidate(projectId, { kind });
      setReceipt(r?.usage || null);
      if (!r?.proposals?.length) {
        setNote('Nothing new to propose from what is logged so far.');
      }
      await load();
    } catch (e) {
      // The worker distinguishes "there is nothing here to work from" from "the
      // model could not be reached", and both are sentences worth showing —
      // one is about the venture's evidence, the other about the platform.
      // D258 — that sentence is `e.message`; nothing sets `e.body`.
      setNote(e?.message || 'That could not be run. Nothing was charged.');
    } finally {
      setBusy('');
    }
  };

  /**
   * Accept, optionally with an edit, or discard.
   *
   * `value` is sent ONLY when the founder actually changed something. Sending the
   * unchanged original would make every accept look corrected in
   * `fill_provenance`, because `edited` is derived there from comparing the two —
   * and a table where everything is marked edited says nothing about anything.
   */
  const decide = async (id, how, value) => {
    setBusy(`${how}-${id}`); setNote('');
    try {
      if (how === 'accept') await api.acceptValidateProposal(id, value ? { value } : undefined);
      else await api.discardValidateProposal(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
      setEditing(null);
      if (how === 'accept') onApplied?.();
    } catch (e) {
      setNote(e?.message || 'That could not be applied.');
      await load();
    } finally {
      setBusy('');
    }
  };

  const saveEdit = (p) => {
    const next = (editing?.value || '').trim();
    if (!next) { setNote('An edited proposal still needs a value.'); return; }
    // Unchanged means unchanged: fall through to a plain accept so provenance
    // records it as the model's own words rather than as a correction.
    decide(p.id, 'accept', next === readable(p.kind, p.payload).trim() ? undefined : next);
  };

  // The registry's own words for this kind. `null` while the first list is in
  // flight and for a kind the server does not offer — in both cases the band
  // renders nothing rather than inventing a heading for a capability that may not
  // exist, which is the same rule `eadwynConfig` follows for the rail.
  const spec = kinds?.[kind] || null;
  if (!enabled || !spec) return null;
  const copy = spec.copy || {};

  return (
    <section className={`${BAND} mb-3`} data-testid={`proposals-${kind}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-violet-800 dark:text-violet-300">
          <Sparkles size={13} aria-hidden="true" />
          {copy.heading}
        </p>
        <button
          type="button"
          className={GHOST}
          onClick={propose}
          disabled={!projectId || busy === 'run'}
          data-testid={`action-propose-${kind}`}
        >
          {busy === 'run' ? 'Reading…' : copy.run}
        </button>
      </div>

      {items.length === 0 && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
          {copy.empty}
        </p>
      )}

      <ul className="mt-2 grid gap-2">
        {items.map((p) => {
          const open = editing?.id === p.id;
          return (
            <li
              key={p.id}
              className="rounded-[9px] border border-violet-200 bg-white p-2.5 dark:border-violet-900 dark:bg-gray-900"
              data-testid={`proposal-${p.id}`}
            >
              {open ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">
                      Your version
                    </span>
                    <textarea
                      className={FIELD}
                      rows={3}
                      maxLength={MAX_EDIT}
                      value={editing.value}
                      onChange={(e) => setEditing({ id: p.id, value: e.target.value })}
                      data-testid={`edit-field-${p.id}`}
                      autoFocus
                    />
                  </label>
                  {/* What it said before, kept on screen while they change it.
                      The provenance row keeps both; so should the moment of
                      deciding. */}
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500 dark:text-gray-400">
                    Eadwyn proposed: &ldquo;{readable(p.kind, p.payload)}&rdquo;
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[12px] leading-relaxed text-gray-900 dark:text-gray-100">
                    {p.kind === 'pain_tag'
                      ? <>&ldquo;{p.payload?.phrase}&rdquo; <span className="text-gray-500 dark:text-gray-400">→ {p.payload?.group_title}</span></>
                      : readable(p.kind, p.payload)}
                  </p>
                  <Citation citation={p.citation} />
                </>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={ACCENT}
                  onClick={() => (open ? saveEdit(p) : decide(p.id, 'accept'))}
                  disabled={busy === `accept-${p.id}`}
                  data-testid={`action-accept-${p.id}`}
                >
                  {open ? 'Save and add' : copy.accept}
                </button>
                {/* Drawn only where the server says the value may be rewritten. */}
                {spec.editable && (
                  <button
                    type="button"
                    className={GHOST}
                    onClick={() => setEditing(open ? null : { id: p.id, value: readable(p.kind, p.payload) })}
                    disabled={busy === `accept-${p.id}`}
                    data-testid={`action-edit-${p.id}`}
                  >
                    {open ? 'Cancel' : 'Edit'}
                  </button>
                )}
                <button
                  type="button"
                  className={GHOST}
                  onClick={() => decide(p.id, 'discard')}
                  disabled={busy === `discard-${p.id}`}
                  data-testid={`action-discard-${p.id}`}
                >
                  Discard
                </button>
                {/* Which model wrote it. Stored per proposal rather than assumed,
                    because the router falls back to a smaller sibling under load
                    and a claim drafted by the small model is not the same
                    artefact as one drafted by the large one. */}
                {p.model && (
                  <span className="ml-auto truncate text-[10px] text-gray-500 dark:text-gray-400">
                    {p.model.split('/').pop()}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {receipt && (
        <p className="mt-2 text-[10.5px] tabular-nums text-gray-500 dark:text-gray-400">
          {receipt.model?.split('/').pop()}
          {typeof receipt.prompt_tokens === 'number' && typeof receipt.completion_tokens === 'number'
            ? ` · ${receipt.prompt_tokens.toLocaleString()} in / ${receipt.completion_tokens.toLocaleString()} out`
            : ''}
          {' · '}{formatCost(receipt.est_cost_usd)}
          {receipt.fallback_used ? ' · the model was busy, a smaller one answered' : ''}
        </p>
      )}
      {note && (
        <p className="mt-2 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid={`proposals-note-${kind}`}>
          {note}
        </p>
      )}
    </section>
  );
}
