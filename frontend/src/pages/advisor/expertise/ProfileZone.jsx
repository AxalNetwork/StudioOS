import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, SaveNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, inputClass,
} from './kit';

/**
 * Expertise · Profile — what the market finds when it finds you.
 *
 * WHAT CHANGED UNDER THIS PAGE. Migration 202 gave `advisors` seven columns it
 * did not have: headline, stages, languages, country, timezone, an
 * availability note and a headshot. Before that this zone rendered the same
 * undifferentiated component as the other four, and the canvas's profile facts
 * had nowhere to go.
 *
 * THE SAVE MERGES, and that is not an implementation detail. `/office-hours`
 * posts `headline` and `timezone` to the same endpoint and knows nothing about
 * the other five. The worker only writes the keys the body actually carries,
 * so the two surfaces cannot blank each other. This page sends the whole set
 * it owns, which is why every field below is loaded before it is editable —
 * sending a form that had not finished loading would post empty strings over
 * stored values.
 *
 * `/office-hours` IS NOT TOUCHED. It renders `AdvisorExpertiseWorkspace`, which
 * this file does not import, modify or replace. This is a second surface over
 * the same store, not a rewrite of the frozen one.
 */

const LIST_HINT = 'Comma separated. Leave blank to leave unrecorded.';

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const joinList = (v) => (Array.isArray(v) ? v.join(', ') : '');

export default function ProfileZone() {
  const [state, setState] = useState({ loading: true, error: '', profile: null });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const profile = await api.getMyAdvisor();
      setState({ loading: false, error: '', profile: profile || null });
      // `null` from the API means "you have no advisor row yet", which is a
      // real state an advisor account can be in — the row is created by the
      // first save. An empty draft is correct here; an error would not be.
      setDraft({
        display_name: profile?.display_name || '',
        headline: profile?.headline || '',
        bio: profile?.bio || '',
        // An unanswered list comes back as null and an answered-empty one as
        // []. Both render as an empty box; only a SAVE tells them apart, and
        // the save reports whichever the advisor actually left behind.
        expertise: joinList(profile?.expertise),
        sectors: joinList(profile?.sectors),
        stages: joinList(profile?.stages),
        languages: joinList(profile?.languages),
        country: profile?.country || '',
        timezone: profile?.timezone || '',
        availability_note: profile?.availability_note || '',
        headshot_url: profile?.headshot_url || '',
        linkedin_url: profile?.linkedin_url || '',
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The profile could not be read.', profile: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const saved = await api.upsertMyAdvisor({
        display_name: draft.display_name.trim(),
        headline: draft.headline.trim() || null,
        bio: draft.bio.trim() || null,
        expertise: splitList(draft.expertise),
        sectors: splitList(draft.sectors),
        // An empty box clears the answer rather than recording an empty list —
        // "I have not said" is the honest reading of a field nobody filled in.
        stages: draft.stages.trim() ? splitList(draft.stages) : null,
        languages: draft.languages.trim() ? splitList(draft.languages) : null,
        country: draft.country.trim() || null,
        timezone: draft.timezone.trim() || null,
        availability_note: draft.availability_note.trim() || null,
        headshot_url: draft.headshot_url.trim() || null,
        linkedin_url: draft.linkedin_url.trim() || null,
      });
      setState((c) => ({ ...c, profile: saved }));
      setNote({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      // Named, not swallowed. The reported defect on the old surface was a
      // save that reported success while the worker discarded nine fields.
      setNote({ ok: false, text: err?.message || 'The profile could not be saved. Nothing was changed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ZoneBody loading={state.loading || !draft} error={state.error} onRetry={load} isEmpty={false}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card padding="lg">
          <ZoneHeading
            title="Your profile"
            blurb="What a founder reads before deciding whether to book you. Every field is yours to state; nothing here is inferred, scored or written for you."
          />
          <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} value={draft.display_name} onChange={set('display_name')} />
            </Field>
            <Field label="Headline" hint="One line. e.g. “ex-Stripe payments PM”.">
              <input className={inputClass} value={draft.headline} onChange={set('headline')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Bio">
                <textarea rows={4} className={inputClass} value={draft.bio} onChange={set('bio')} />
              </Field>
            </div>
            <Field label="Expertise" hint={LIST_HINT}>
              <input className={inputClass} value={draft.expertise} onChange={set('expertise')} />
            </Field>
            <Field label="Sectors" hint={LIST_HINT}>
              <input className={inputClass} value={draft.sectors} onChange={set('sectors')} />
            </Field>
            <Field label="Stages" hint={LIST_HINT}>
              <input className={inputClass} value={draft.stages} onChange={set('stages')} placeholder="pre-seed, seed" />
            </Field>
            <Field label="Languages" hint={LIST_HINT}>
              <input className={inputClass} value={draft.languages} onChange={set('languages')} placeholder="English, French" />
            </Field>
            <Field label="Country">
              <input className={inputClass} value={draft.country} onChange={set('country')} />
            </Field>
            <Field label="Time zone" hint="IANA name, e.g. America/Toronto.">
              <input className={inputClass} value={draft.timezone} onChange={set('timezone')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Availability" hint="In your own words. This is a note, not a calendar — your bookable slots live under Practice.">
                <input className={inputClass} value={draft.availability_note} onChange={set('availability_note')}
                  placeholder="Two mornings a week, usually Tuesday and Thursday" />
              </Field>
            </div>
            <Field label="Headshot URL">
              <input className={inputClass} value={draft.headshot_url} onChange={set('headshot_url')} />
            </Field>
            <Field label="LinkedIn">
              <input className={inputClass} value={draft.linkedin_url} onChange={set('linkedin_url')} />
            </Field>
            <div className="sm:col-span-2">
              <button type="submit" className={buttonClass} disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              <SaveNote note={note} />
            </div>
          </form>
        </Card>

        <Card variant="sunken" padding="lg">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            As a founder sees it
          </div>
          <div className="mt-3 flex items-start gap-3">
            {state.profile?.headshot_url
              ? <img src={state.profile.headshot_url} alt="" className="h-12 w-12 rounded-full object-cover" />
              : <div className="grid h-12 w-12 place-items-center rounded-full bg-axal-ground text-[10px] text-axal-ink-3 dark:bg-gray-800">No photo</div>}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-extrabold">
                {state.profile?.display_name || <Unrecorded>Unnamed</Unrecorded>}
              </div>
              <div className="text-[11.5px] text-axal-ink-2">
                {state.profile?.headline || <Unrecorded />}
              </div>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-[11.5px]">
            {[
              ['Stages', state.profile?.stages],
              ['Sectors', state.profile?.sectors],
              ['Languages', state.profile?.languages],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="w-20 shrink-0 text-axal-ink-3">{label}</dt>
                <dd className="min-w-0">
                  {/* null is "never answered"; [] is "answered, and none". The
                      preview says which, because the difference is the whole
                      reason 202 stores them as nullable. */}
                  {value == null ? <Unrecorded />
                    : value.length === 0 ? <Unrecorded>None recorded</Unrecorded>
                    : value.join(', ')}
                </dd>
              </div>
            ))}
            {[
              ['Based in', state.profile?.country],
              ['Time zone', state.profile?.timezone],
              ['Availability', state.profile?.availability_note],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="w-20 shrink-0 text-axal-ink-3">{label}</dt>
                <dd className="min-w-0">{value || <Unrecorded />}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11px] leading-relaxed text-axal-ink-3">
            This preview reads the saved record, not the form. What you see here is what a founder
            would see now.
          </p>
        </Card>
      </div>
    </ZoneBody>
  );
}
