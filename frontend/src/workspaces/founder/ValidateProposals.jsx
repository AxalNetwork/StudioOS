import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCost } from '../../ui/assistCost';

/**
 * What Eadwyn suggested, and the two decisions a founder makes about each one.
 *
 * WHY IT IS A BAND ON THE PAGE AND NOT A BLOCK IN THE RAIL. The canvas puts it
 * here — `Pages · Founder Validate` draws a "Proposal · drafted from recurring
 * pains" band above the board with `Add to {lane}` / `Edit the claim` /
 * `Discard` — and the reason holds up: a proposal is about the records on this
 * page, so it belongs beside them. The rail holds the switch and the meter;
 * the page holds the work.
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

const COPY = {
  pain_tag: {
    run: 'Tag ungrouped phrases',
    heading: 'Proposal · phrases sorted into your themes',
    empty: 'Nothing proposed yet. Eadwyn will sort logged phrases into themes you have already named — it never names one.',
  },
  hypothesis: {
    run: 'Draft from the pain map',
    heading: 'Proposal · claims drafted from recurring pains',
    empty: 'Nothing proposed yet. Eadwyn will read the pain map and draft claims you can test.',
  },
};

export default function ValidateProposals({ projectId, kind, enabled, onApplied }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  const copy = COPY[kind];

  const load = useCallback(async () => {
    if (!projectId || !enabled) { setItems([]); return; }
    try {
      const r = await api.listValidateProposals(projectId);
      setItems((r?.proposals || []).filter((p) => p.kind === kind));
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
      setNote(e?.body?.message || e?.message || 'That could not be run. Nothing was charged.');
    } finally {
      setBusy('');
    }
  };

  const decide = async (id, how) => {
    setBusy(`${how}-${id}`); setNote('');
    try {
      if (how === 'accept') await api.acceptValidateProposal(id);
      else await api.discardValidateProposal(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
      if (how === 'accept') onApplied?.();
    } catch (e) {
      setNote(e?.body?.detail || e?.message || 'That could not be applied.');
      await load();
    } finally {
      setBusy('');
    }
  };

  if (!enabled || !copy) return null;

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
        {items.map((p) => (
          <li
            key={p.id}
            className="rounded-[9px] border border-violet-200 bg-white p-2.5 dark:border-violet-900 dark:bg-gray-900"
            data-testid={`proposal-${p.id}`}
          >
            <p className="text-[12px] leading-relaxed text-gray-900 dark:text-gray-100">
              {kind === 'pain_tag'
                ? <>&ldquo;{p.payload?.phrase}&rdquo; <span className="text-gray-500 dark:text-gray-400">→ {p.payload?.group_title}</span></>
                : p.payload?.claim}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className={ACCENT}
                onClick={() => decide(p.id, 'accept')}
                disabled={busy === `accept-${p.id}`}
                data-testid={`action-accept-${p.id}`}
              >
                {kind === 'pain_tag' ? 'Add to the theme' : 'Add to the board'}
              </button>
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
        ))}
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
