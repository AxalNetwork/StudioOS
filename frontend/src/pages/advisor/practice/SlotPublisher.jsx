import React, { useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { Field, SaveNote, ZoneHeading, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import { slotBody } from './practiceTools';

/**
 * #4712 (D4712): publishing availability from the mounted Sessions page.
 *
 * The slot form lived only in the retired Opportunities tab
 * (`advisory/OpportunitiesPage.jsx`); the Sessions empty state sent advisors to
 * `/practice/opportunities`, whose mounted page has no such form, so a new
 * advisor could not publish the hours a founder would book. Same route
 * (`POST /advisors/me/slots`), same four fields. Drawn whatever the grid holds,
 * so an empty calendar is where the first slot is published, not a dead end.
 */
export default function SlotPublisher({ open, onToggle, onPublished }) {
  const [draft, setDraft] = useState({ starts_at: '', ends_at: '', capacity: '1', meeting_url: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const res = slotBody(draft);
    if (res.error) { setNote({ ok: false, text: res.error }); return; }
    setBusy(true); setNote(null);
    try {
      await api.createAdvisorSlot(res.body);
      setDraft({ starts_at: '', ends_at: '', capacity: '1', meeting_url: '' });
      setNote({ ok: true, text: 'Published. Founders can book it now.' });
      await onPublished?.();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That slot was not published. Nothing was saved.' });
    } finally { setBusy(false); }
  };

  return (
    <Card padding="md" data-testid="slot-publisher">
      <ZoneHeading
        title="Publish availability"
        blurb="The hours a founder can book. Each slot you publish appears in the grid below."
        action={<button type="button" className={ghostButtonClass} onClick={onToggle} data-testid="slot-publisher-toggle">
          {open ? 'Close' : 'Publish a slot'}
        </button>}
      />
      {open && (
        <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4" data-testid="slot-publisher-form">
          <Field label="Starts">
            <input type="datetime-local" className={inputClass} value={draft.starts_at} data-testid="slot-starts"
              onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} />
          </Field>
          <Field label="Ends">
            <input type="datetime-local" className={inputClass} value={draft.ends_at} data-testid="slot-ends"
              onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} />
          </Field>
          <Field label="Seats" hint="1 to 20.">
            <input className={inputClass} inputMode="numeric" value={draft.capacity} data-testid="slot-seats"
              onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} />
          </Field>
          <Field label="Meeting link" hint="Optional. https://">
            <input className={inputClass} value={draft.meeting_url} placeholder="https://…" data-testid="slot-link"
              onChange={(e) => setDraft({ ...draft, meeting_url: e.target.value })} />
          </Field>
          <div className="sm:col-span-4">
            <button type="submit" className={buttonClass} disabled={busy} data-testid="slot-publish">
              {busy ? 'Publishing…' : 'Publish slot'}
            </button>
          </div>
        </form>
      )}
      <SaveNote note={note} />
    </Card>
  );
}
