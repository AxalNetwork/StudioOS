import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { RITUAL_KINDS, RITUAL_FREQUENCIES, WEEKDAYS } from '../../lib/cadence';

/**
 * The three forms behind `/build/cadence`'s ops, and the one behind its feed.
 *
 * WHY THEY LIVE HERE AND NOT IN THE PAGE. `FounderBuildCadence` already owns the
 * load, the filter predicate, the export payload and four stat computations; a
 * fourth concern would put three forms' worth of local state in the same
 * component as the view that re-renders on every chip press. `ValidateDialogs`
 * made the same split for the same reason and it is the pattern here.
 *
 * EVERY FORM REPORTS ITS OWN ERROR AND CLEARS ITS OWN BUSY FLAG. A dialog that
 * closes on a failed write is a dialog that loses what the founder typed, and
 * the write it lost was a review nobody will retype. So: the dialog stays open,
 * the message appears in it, and the caller's `onSaved` runs only after the
 * server said yes.
 */

function Shell({ title, sub, onClose, children, testid }) {
  // Escape closes. A modal you cannot dismiss with the keyboard is a modal that
  // traps a reader who opened it by accident, and the close button is the only
  // other way out of a full-screen overlay.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fb-cadence-modal" role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
      <div className="fb-cadence-modal-card">
        <header>
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** New or edited ritual — the standing intention, not an occurrence of it. */
export function RitualDialog({ ritual, templates, onClose, onSave }) {
  const editing = Boolean(ritual?.id);
  const [name, setName] = useState(ritual?.name || '');
  const [kind, setKind] = useState(ritual?.kind || 'other');
  const [frequency, setFrequency] = useState(ritual?.frequency || 'weekly');
  const [weekday, setWeekday] = useState(ritual?.weekday == null ? '' : String(ritual.weekday));
  const [target, setTarget] = useState(ritual?.target_minutes == null ? '' : String(ritual.target_minutes));
  const [templateId, setTemplateId] = useState(ritual?.template_id == null ? '' : String(ritual.template_id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) { setError('A ritual needs a name.'); return; }
    setBusy(true); setError('');
    try {
      await onSave({
        name: name.trim(),
        kind,
        frequency,
        // '' rather than 0 for "no weekday": the server checks emptiness before
        // `Number()` because `Number('')` is 0 and finite, which would pin every
        // undated ritual to Sunday.
        weekday: weekday === '' ? null : Number(weekday),
        target_minutes: target === '' ? null : Number(target),
        template_id: templateId === '' ? null : Number(templateId),
      });
    } catch (cause) {
      setError(cause?.message || 'The ritual could not be saved.');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-ritual"
      title={editing ? 'Edit ritual' : 'New ritual'}
      sub="A standing intention. Logging what happened on a given date is a separate record, so changing the schedule never rewrites the archive."
      onClose={onClose}
    >
      <form onSubmit={submit} className="fb-cadence-form">
        <label><span>Name</span>
          <input data-testid="input-ritual-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday retro" maxLength={120} />
        </label>
        <div className="fb-cadence-form-row">
          <label><span>Kind</span>
            <select data-testid="select-ritual-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {RITUAL_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label><span>Frequency</span>
            <select data-testid="select-ritual-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {RITUAL_FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="fb-cadence-form-row">
          <label><span>Day</span>
            <select data-testid="select-ritual-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              <option value="">Not fixed</option>
              {WEEKDAYS.map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
            </select>
          </label>
          <label><span>Target length (min)</span>
            <input data-testid="input-ritual-target" type="number" min="1" max="600" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="30" />
          </label>
        </div>
        <label><span>Template</span>
          <select data-testid="select-ritual-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">None</option>
            {(templates || []).map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </select>
        </label>
        {error && <p className="fb-cadence-form-error" role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" data-testid="button-ritual-save" disabled={busy}>{busy ? 'Saving…' : 'Save ritual'}</button>
        </footer>
      </form>
    </Shell>
  );
}

/** Log what happened on one date — including that it did not happen. */
export function RunDialog({ run, rituals, onClose, onSave }) {
  const editing = Boolean(run?.id);
  const activeRituals = useMemo(
    () => (rituals || []).filter((r) => editing || Number(r.active ?? 1) === 1),
    [rituals, editing],
  );
  const [ritualId, setRitualId] = useState(
    run?.ritual_id == null ? String(activeRituals[0]?.id || '') : String(run.ritual_id),
  );
  const [runDate, setRunDate] = useState(run?.run_date || '');
  const [state, setState] = useState(run?.state || 'done');
  const [outcome, setOutcome] = useState(run?.outcome || '');
  const [duration, setDuration] = useState(run?.duration_minutes == null ? '' : String(run.duration_minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!ritualId) { setError('Choose the ritual this run belongs to.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) { setError('Pick the date it ran.'); return; }
    setBusy(true); setError('');
    try {
      await onSave({
        ritual_id: Number(ritualId),
        run_date: runDate,
        state,
        outcome: outcome.trim() || null,
        duration_minutes: duration === '' ? null : Number(duration),
      });
    } catch (cause) {
      setError(cause?.message || 'The run could not be filed.');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-run"
      title={editing ? 'Edit review' : 'File a review'}
      sub="One row per ritual per date. Filing the same date again updates it rather than adding a second, so a double-submit cannot inflate the archive."
      onClose={onClose}
    >
      <form onSubmit={submit} className="fb-cadence-form">
        <div className="fb-cadence-form-row">
          <label><span>Ritual</span>
            <select data-testid="select-run-ritual" value={ritualId} onChange={(e) => setRitualId(e.target.value)}>
              <option value="">Choose…</option>
              {activeRituals.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
            </select>
          </label>
          <label><span>Date</span>
            <input data-testid="input-run-date" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </label>
        </div>
        <div className="fb-cadence-form-row">
          <label><span>State</span>
            <select data-testid="select-run-state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="done">Done</option>
              <option value="missed">Missed</option>
            </select>
          </label>
          <label><span>Length (min)</span>
            <input data-testid="input-run-duration" type="number" min="1" max="600" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Leave blank if untimed" />
          </label>
        </div>
        <label><span>What came out of it</span>
          <textarea data-testid="input-run-outcome" rows={4} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Decided to split the digest card. Not yet done." />
        </label>
        {/* A missed run with nothing written is a legitimate record — the canvas's
            own Aug 14 row is "Skipped — travel. No note left." — so the outcome
            is never required and a blank one is stored as NULL rather than ''. */}
        {error && <p className="fb-cadence-form-error" role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" data-testid="button-run-save" disabled={busy}>{busy ? 'Filing…' : 'File review'}</button>
        </footer>
      </form>
    </Shell>
  );
}

/**
 * The template editor — the `Edit templates` op.
 *
 * A LIST AND ONE OPEN EDITOR, not a modal per template. The op is plural and the
 * count beside it ("Templates · 3 · 1 customised") is what the founder pressed
 * it to act on, so the dialog has to show all of them; opening one at a time
 * from a separate list would make the count unreachable from the control that
 * reports it.
 */
export function TemplatesDialog({ templates, starters, onClose, onCreate, onUpdate, onDelete }) {
  const [openId, setOpenId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftKind, setDraftKind] = useState('other');
  const [basedOn, setBasedOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = (t) => {
    setOpenId(t.id); setDraftName(t.name); setDraftBody(t.body);
    setDraftKind(t.kind || 'other'); setBasedOn(''); setError('');
  };
  const startNew = (slug) => {
    const starter = (starters || []).find((s) => s.slug === slug);
    setOpenId('new');
    setDraftName(starter?.name || '');
    setDraftBody(starter?.body || '');
    setDraftKind(starter?.kind || 'other');
    setBasedOn(starter?.slug || '');
    setError('');
  };

  const save = async () => {
    if (!draftName.trim() || !draftBody.trim()) { setError('A template needs a name and a body.'); return; }
    setBusy(true); setError('');
    try {
      if (openId === 'new') {
        await onCreate({ name: draftName.trim(), kind: draftKind, body: draftBody.trim(), based_on: basedOn || null });
      } else {
        await onUpdate(openId, { name: draftName.trim(), kind: draftKind, body: draftBody.trim() });
      }
      setOpenId(null);
    } catch (cause) {
      setError(cause?.message || 'The template could not be saved.');
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-templates"
      title="Templates"
      sub="The prompt a ritual is conducted from. Saving a change stamps it as customised, which is where the count beside this op comes from."
      onClose={onClose}
    >
      <div className="fb-cadence-templates">
        {(templates || []).length === 0 && openId === null && (
          <p className="fb-cadence-templates-empty">No template is stored yet. Start from one of the three below, or write your own.</p>
        )}
        <ul>
          {(templates || []).map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>{t.edited_at ? 'Customised' : t.based_on ? `From the ${t.based_on} starting point` : 'Written here'}</small>
              </div>
              <div className="fb-cadence-templates-ops">
                <button type="button" data-testid={`button-template-open-${t.id}`} onClick={() => open(t)}>Edit</button>
                <button type="button" data-testid={`button-template-delete-${t.id}`} onClick={() => onDelete(t.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>

        {openId === null && (
          <div className="fb-cadence-templates-starters">
            <span>Start from</span>
            {(starters || []).map((s) => (
              <button key={s.slug} type="button" data-testid={`button-starter-${s.slug}`} onClick={() => startNew(s.slug)}>{s.name}</button>
            ))}
            <button type="button" data-testid="button-starter-blank" onClick={() => startNew('')}>Blank</button>
          </div>
        )}

        {openId !== null && (
          <div className="fb-cadence-form">
            <label><span>Name</span>
              <input data-testid="input-template-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={120} />
            </label>
            <label><span>Kind</span>
              <select data-testid="select-template-kind" value={draftKind} onChange={(e) => setDraftKind(e.target.value)}>
                {RITUAL_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label><span>Body</span>
              <textarea data-testid="input-template-body" rows={7} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
            </label>
            {error && <p className="fb-cadence-form-error" role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={() => { setOpenId(null); setError(''); }}>Back</button>
              <button type="button" data-testid="button-template-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button>
            </footer>
          </div>
        )}
      </div>
    </Shell>
  );
}
