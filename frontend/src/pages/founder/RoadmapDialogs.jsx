import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * `/build/roadmap`'s two forms — the dependency editor and the scenario editor.
 * Task #176, FB3.
 *
 * THE CYCLE REFUSAL IS RENDERED, NOT SWALLOWED. The server answers 409 with
 * `cycle: true` when a link would make two objectives block each other, and that
 * is a different problem from "already recorded" — one means pick a different
 * pair, the other means you already did it. Collapsing both into "something went
 * wrong" would leave the founder guessing which.
 */

function Shell({ title, sub, onClose, children, testid }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fb-roadmap-modal" role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
      <div className="fb-roadmap-modal-card">
        <header>
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Record and remove "this objective blocks that one". */
export function DependenciesDialog({ items, dependencies, onClose, onAdd, onRemove }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameOf = useMemo(
    () => Object.fromEntries((items || []).map((i) => [String(i.id), i.objective])),
    [items],
  );

  const add = async () => {
    if (!from || !to) { setError('Choose the objective that blocks, and the one it blocks.'); return; }
    if (from === to) { setError('An objective cannot block itself.'); return; }
    setBusy(true); setError('');
    try {
      await onAdd({ okr_id: Number(from), blocks_okr_id: Number(to), note: note.trim() || null });
      setFrom(''); setTo(''); setNote('');
    } catch (cause) {
      // THE 409'S OWN FIELD, not its message: `cycle` is what distinguishes
      // "these two would trap each other" from "you already recorded this".
      // It arrives on `cause.data`, where request() puts the body; nothing sets
      // `cause.body` (D258).
      const detail = cause?.data || null;
      if (detail?.cycle) {
        setError('Those two would block each other, and neither could ever be cleared. Remove the existing link first.');
      } else {
        setError(cause?.message || 'The link could not be recorded.');
      }
    }
    setBusy(false);
  };

  const remove = async (id) => {
    setBusy(true); setError('');
    try { await onRemove(id); } catch (cause) { setError(cause?.message || 'The link could not be removed.'); }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-dependencies"
      title="Dependency links"
      sub="A link says one objective has to finish before another can. The blocked one shows as Blocked until its blocker is Done."
      onClose={onClose}
    >
      <div className="fb-roadmap-form">
        {(items || []).length < 2 && (
          <p className="fb-roadmap-form-hint" data-testid="dependencies-too-few">
            A link needs two objectives, and this roadmap has {(items || []).length}. Add
            another in the roadmap editor first.
          </p>
        )}
        {(dependencies || []).length === 0 ? (
          <p className="fb-roadmap-form-hint" data-testid="dependencies-empty">
            No link is recorded. Nothing is inferred from the order objectives were
            written in or from what their titles have in common.
          </p>
        ) : (
          <ul className="fb-roadmap-deps" data-testid="dependencies-list">
            {dependencies.map((d) => (
              <li key={d.id} className={d.resolved ? 'is-resolved' : ''}>
                <div>
                  <strong>{nameOf[String(d.okr_id)] || d.from_objective || 'Removed objective'}</strong>
                  <span> blocks </span>
                  <strong>{nameOf[String(d.blocks_okr_id)] || d.to_objective || 'Removed objective'}</strong>
                  <small>{d.resolved ? 'Cleared — the blocker is done' : 'Unresolved'}{d.note ? ` · ${d.note}` : ''}</small>
                </div>
                <button type="button" data-testid={`button-dependency-remove-${d.id}`} onClick={() => remove(d.id)} disabled={busy}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        <div className="fb-roadmap-form-row">
          <label><span>This objective</span>
            <select data-testid="select-dependency-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose…</option>
              {(items || []).map((i) => <option key={i.id} value={i.id}>{i.objective}</option>)}
            </select>
          </label>
          <label><span>blocks</span>
            <select data-testid="select-dependency-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {(items || []).map((i) => <option key={i.id} value={i.id}>{i.objective}</option>)}
            </select>
          </label>
        </div>
        <label className="fb-roadmap-form-full"><span>Why (optional)</span>
          <input data-testid="input-dependency-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Schema has to land before the digest can read it" maxLength={140} />
        </label>
        {error && <p className="fb-roadmap-form-error" role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" data-testid="button-dependency-add" onClick={add} disabled={busy}>
            {busy ? 'Saving…' : 'Record link'}
          </button>
        </footer>
      </div>
    </Shell>
  );
}

/**
 * A named what-if: where each objective would land instead.
 *
 * IT DOES NOT APPLY, AND THE DIALOG SAYS SO. The artboard offers `New scenario`,
 * `Export` and `Configure` and no "apply" anywhere, so a scenario is something a
 * founder saves and compares against the live roadmap. Writing it back would be
 * a bulk edit of every quarter on the board from a control nobody drew.
 */
export function ScenarioDialog({ items, scenario, onClose, onSave, onDelete }) {
  const [name, setName] = useState(scenario?.name || '');
  const [note, setNote] = useState(scenario?.note || '');
  const [quarters, setQuarters] = useState(() => {
    const seed = {};
    for (const move of scenario?.moves || []) seed[String(move.okr_id)] = move.to || '';
    return seed;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changed = useMemo(() => (items || []).filter((i) => {
    const next = (quarters[String(i.id)] ?? '').trim();
    return next && next !== (i.quarter || '');
  }), [items, quarters]);

  const save = async () => {
    if (!name.trim()) { setError('A scenario needs a name.'); return; }
    setBusy(true); setError('');
    try {
      await onSave({
        id: scenario?.id,
        name: name.trim(),
        note: note.trim() || null,
        // Only the objectives this scenario actually says something about. An
        // item left blank is absent from the story, not moved to nowhere.
        items: Object.entries(quarters)
          .filter(([, q]) => String(q ?? '').trim())
          .map(([okrId, q]) => ({ okr_id: Number(okrId), quarter: String(q).trim() })),
      });
    } catch (cause) {
      setError(cause?.message || 'The scenario could not be saved.');
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-scenario"
      title={scenario?.id ? 'Edit scenario' : 'New scenario'}
      sub="Saved beside the roadmap and compared against it. Saving a scenario does not move anything on the live board."
      onClose={onClose}
    >
      <div className="fb-roadmap-form">
        <div className="fb-roadmap-form-row">
          <label><span>Name</span>
            <input data-testid="input-scenario-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="raise slips 6wk" maxLength={80} />
          </label>
          <label><span>Note (optional)</span>
            <input data-testid="input-scenario-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="if the round closes late" maxLength={140} />
          </label>
        </div>

        {(items || []).length === 0 ? (
          <p className="fb-roadmap-form-hint">There is no objective to move yet.</p>
        ) : (
          <ul className="fb-roadmap-scenario-rows" data-testid="scenario-rows">
            {items.map((i) => (
              <li key={i.id}>
                <div><strong>{i.objective}</strong><small>Now: {i.quarter || 'no quarter recorded'}</small></div>
                <input
                  data-testid={`input-scenario-quarter-${i.id}`}
                  value={quarters[String(i.id)] ?? ''}
                  onChange={(e) => setQuarters((old) => ({ ...old, [String(i.id)]: e.target.value }))}
                  placeholder="Leave blank to keep it where it is"
                  maxLength={20}
                />
              </li>
            ))}
          </ul>
        )}

        <p className="fb-roadmap-form-hint" data-testid="scenario-summary">
          {changed.length === 0
            ? 'This scenario moves nothing yet — give at least one objective a different quarter.'
            : `Moves ${changed.length} objective${changed.length === 1 ? '' : 's'}.`}
        </p>
        {error && <p className="fb-roadmap-form-error" role="alert">{error}</p>}

        <footer>
          {scenario?.id && (
            <button type="button" className="is-quiet" data-testid="button-scenario-delete" onClick={() => onDelete(scenario.id)} disabled={busy}>
              Delete scenario
            </button>
          )}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" data-testid="button-scenario-save" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save scenario'}
          </button>
        </footer>
      </div>
    </Shell>
  );
}

/** What the artboard asked for and the store cannot answer. */
export function RiskUnavailable() {
  return (
    <section className="fb-roadmap-card fb-roadmap-unavailable-card" data-testid="card-risk-unavailable">
      <div className="fb-roadmap-card-head"><div><AlertTriangle size={16} /><h2>At risk</h2></div><span>Not derivable</span></div>
      <strong>Risk is not a fact this roadmap stores</strong>
      <p>
        Nothing records why an objective is stuck or when it became stuck, so the only
        thing the dependency graph can say is <em>Blocked</em> — and every objective a
        blocked one blocks is itself blocked, so a separate “at risk” would either
        repeat that or invent a rule. The blocked count above is the honest version of
        this number.
      </p>
    </section>
  );
}
