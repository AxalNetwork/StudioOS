import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * `/build/board`'s two ops — `Configure lanes` and `Bulk move`. Task #176, FB2.
 *
 * Both were `unbuilt`, and `Configure lanes`'s reason named its own fix: "the six
 * lanes are written into the code twice and no per-project stage list is stored, so
 * there is nothing for an editor to change". Migration 253 stores the list; this is
 * the editor.
 *
 * THE WIP LIMIT'S REFUSAL IS RENDERED, NOT SWALLOWED. The server answers 409 with
 * the lane, its limit and what the total would be. Showing "something went wrong"
 * there would hide the one piece of information the founder needs to decide what to
 * do — which is why the bulk dialog reads the 409's fields rather than only its
 * message.
 */

function Shell({ title, sub, onClose, children, testid }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fb-board-modal" role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
      <div className="fb-board-modal-card">
        <header>
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** The lane list, with each lane's WIP limit and its current load. */
export function LanesDialog({ lanes, unassigned, orphans, onClose, onSave, onDelete }) {
  const [name, setName] = useState('');
  const [wip, setWip] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = (lane) => {
    setEditing(lane.id);
    setName(lane.name);
    setWip(lane.wip_limit == null ? '' : String(lane.wip_limit));
    setError('');
  };
  const reset = () => { setEditing(null); setName(''); setWip(''); setError(''); };

  const save = async () => {
    if (!name.trim()) { setError('A lane needs a name.'); return; }
    setBusy(true); setError('');
    try {
      // `wip_limit: null` for a blank, NOT 0 — zero is a real limit, meaning a lane
      // closed to new work, which is how a founder pauses a workstream without
      // deleting its cards.
      await onSave({ id: editing, name: name.trim(), wip_limit: wip === '' ? null : Number(wip) });
      reset();
    } catch (cause) {
      setError(cause?.message || 'The lane could not be saved.');
    }
    setBusy(false);
  };

  const remove = async (lane) => {
    setBusy(true); setError('');
    try { await onDelete(lane.id); if (editing === lane.id) reset(); } catch (cause) {
      setError(cause?.message || 'The lane could not be removed.');
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-lanes"
      title="Configure lanes"
      sub="A lane is whose work a card is; the status is where it has got to. A WIP limit counts the cards in flight in one lane — leave it blank for no limit."
      onClose={onClose}
    >
      <div className="fb-board-form">
        {(lanes || []).length === 0 && (
          <p className="fb-board-form-hint" data-testid="lanes-empty">
            No lane is configured. Cards stay unassigned until one is, and the board
            draws them as a single group — nothing is invented for a venture that has
            not asked for lanes.
          </p>
        )}
        {(lanes || []).length > 0 && (
          <ul className="fb-board-lanes" data-testid="lanes-list">
            {lanes.map((l) => (
              <li key={l.id} className={l.over_limit ? 'is-over' : ''}>
                <div>
                  <strong>{l.name}</strong>
                  <small>
                    {l.in_flight} in flight
                    {l.wip_limit == null ? ' · no limit' : ` of ${l.wip_limit}`}
                    {l.cards !== l.in_flight ? ` · ${l.cards} cards total` : ''}
                    {l.over_limit ? ' · over the limit' : ''}
                  </small>
                </div>
                <div className="fb-board-lanes-ops">
                  <button type="button" data-testid={`button-lane-edit-${l.id}`} onClick={() => open(l)}>Edit</button>
                  <button type="button" data-testid={`button-lane-delete-${l.id}`} onClick={() => remove(l)} disabled={busy}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Cards outside the configured lanes are counted, not hidden. A card
            nobody can see is worse than a lane nobody configured. */}
        {(unassigned > 0 || (orphans || []).length > 0) && (
          <p className="fb-board-form-hint" data-testid="lanes-unassigned">
            {unassigned > 0 && `${unassigned} card${unassigned === 1 ? '' : 's'} in no lane. `}
            {(orphans || []).length > 0 && `Cards still name removed lanes: ${orphans.join(', ')}. They keep showing on the board.`}
          </p>
        )}

        <div className="fb-board-form-row">
          <label><span>{editing ? 'Rename to' : 'New lane'}</span>
            <input data-testid="input-lane-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" maxLength={60} />
          </label>
          <label><span>WIP limit</span>
            <input data-testid="input-lane-wip" type="number" min="0" max="99" value={wip} onChange={(e) => setWip(e.target.value)} placeholder="No limit" />
          </label>
        </div>
        {error && <p className="fb-board-form-error" role="alert">{error}</p>}
        <footer>
          {editing && <button type="button" className="is-quiet" onClick={reset}>Cancel edit</button>}
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" data-testid="button-lane-save" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save lane' : 'Add lane'}
          </button>
        </footer>
      </div>
    </Shell>
  );
}

const BULK_STATUSES = [
  ['', 'Leave the status alone'],
  ['todo', 'Backlog'],
  ['in_progress', 'In progress'],
  ['review', 'Review'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
];

/**
 * Move the selected cards into a lane, a status, or both.
 *
 * ALL-OR-NOTHING, and the dialog says so. The server refuses the whole move if it
 * would put a lane over its WIP limit; a partial move that reported an error would
 * leave the founder to work out which cards landed.
 */
export function BulkMoveDialog({ count, lanes, onClose, onMove }) {
  const [lane, setLane] = useState('__keep');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState(null);

  const run = async () => {
    if (lane === '__keep' && !status) { setError('Choose a lane, a status, or both.'); return; }
    setBusy(true); setError(''); setRefusal(null);
    const body = {};
    // `__keep` means "do not touch the lane"; `''` means "clear it". Two different
    // instructions, which is why the sentinel is not the empty string — `if (lane)`
    // would make "move these back to no lane" impossible to express.
    if (lane !== '__keep') body.lane = lane === '' ? null : lane;
    if (status) body.status = status;
    try {
      await onMove(body);
    } catch (cause) {
      // THE 409'S FIELDS, NOT ITS MESSAGE. `would_be` and `wip_limit` are what let
      // the founder decide whether to raise the limit or move fewer cards. They
      // arrive on `cause.data`, where request() puts the body; nothing sets
      // `cause.body`, so the read that used to come first found nothing (D258).
      const detail = cause?.data || null;
      if (detail?.wip_limit != null) setRefusal(detail);
      else setError(cause?.message || 'The move could not be applied.');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-bulk-move"
      title={`Move ${count} card${count === 1 ? '' : 's'}`}
      sub="Applied together: if one card would break a lane's WIP limit, none of them move."
      onClose={onClose}
    >
      <div className="fb-board-form">
        <div className="fb-board-form-row">
          <label><span>Lane</span>
            <select data-testid="select-bulk-lane" value={lane} onChange={(e) => setLane(e.target.value)}>
              <option value="__keep">Leave the lane alone</option>
              <option value="">No lane</option>
              {(lanes || []).map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}{l.wip_limit == null ? '' : ` (${l.in_flight}/${l.wip_limit})`}
                </option>
              ))}
            </select>
          </label>
          <label><span>Status</span>
            <select data-testid="select-bulk-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {BULK_STATUSES.map(([v, l]) => <option key={v || 'keep'} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        {refusal && (
          <div className="fb-board-refusal" role="alert" data-testid="bulk-refusal">
            <AlertTriangle size={15} />
            <div>
              <strong>{refusal.lane} would hold {refusal.would_be} in flight, over its limit of {refusal.wip_limit}.</strong>
              <p>Nothing was moved. Raise the limit in Configure lanes, move fewer cards, or send them to Backlog — backlog does not count against a WIP limit.</p>
            </div>
          </div>
        )}
        {error && <p className="fb-board-form-error" role="alert">{error}</p>}

        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" data-testid="button-bulk-move" onClick={run} disabled={busy}>
            {busy ? 'Moving…' : `Move ${count}`}
          </button>
        </footer>
      </div>
    </Shell>
  );
}
