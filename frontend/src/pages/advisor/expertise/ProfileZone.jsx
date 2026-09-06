import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, SaveNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, inputClass,
} from './kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';

/**
 * Expertise · Profile — what the market finds when it finds you.
 *
 * WHAT CHANGED UNDER THIS PAGE. Migration 202 gave `advisors` seven columns it
 * did not have: headline, stages, languages, country, timezone, an
 * availability note and a headshot. Before that this zone rendered the same
 * undifferentiated component as the other four, and the canvas's profile facts
 * had nowhere to go.
 *
 * THE SAVE MERGES, and that is not an implementation detail. The worker only
 * writes the keys the body actually carries, so a caller that knows about some
 * fields cannot blank the rest — the property that let this page and the old
 * `/office-hours` form coexist over one row, and that still protects any
 * future caller. This page sends the whole set it owns, which is why every
 * field below is loaded before it is editable: posting a form that had not
 * finished loading would write empty strings over stored values.
 *
 * THIS IS NOW THE ONLY PROFILE SURFACE. `/office-hours` carried a second,
 * older form over the same columns and has been retired; that page's save
 * reported success while discarding most of what it sent.
 */

const LIST_HINT = 'Comma separated. Leave blank to leave unrecorded.';

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const joinList = (v) => (Array.isArray(v) ? v.join(', ') : '');

/** Canvas-aligned completeness: which fields a match surface reads, and which are missing. */
function profileCompleteness(profile) {
  if (!profile) return { pct: 0, gaps: [], complete: 0, total: 0 };
  // ONE ROW PER FIELD. `headline` was counted twice — once as "Positioning
  // statement" and again as "Match one-liner", the same value re-tested for
  // length — so a single field was worth 2 of 8, and an advisor with a
  // 79-character headline was told to go and write a "match one-liner" that is
  // the box they had already filled. A meter that names a gap the advisor
  // cannot close is worse than a shorter meter.
  const fields = [
    ['Positioning statement', profile.headline],
    ['Sectors', profile.sectors?.length ? profile.sectors : null],
    ['Stages', profile.stages?.length ? profile.stages : null],
    ['Languages', profile.languages?.length ? profile.languages : null],
    ['Geography', profile.country],
    ['Availability window', profile.availability_note],
    ['Headshot', profile.headshot_url],
  ];
  const complete = fields.filter(([, v]) => v != null && v !== '').length;
  const gaps = fields.filter(([, v]) => v == null || v === '').map(([k]) => k.toLowerCase());
  return { pct: Math.round((complete / fields.length) * 100), gaps, complete, total: fields.length };
}

/**
 * The draft's shape, in one place, so the seed above and the read below cannot
 * drift into a field that exists in one and not the other — a field present at
 * load and absent at seed would reintroduce exactly the deref this fixes.
 */
const EMPTY_DRAFT = {
  display_name: '', headline: '', bio: '',
  expertise: '', sectors: '', stages: '', languages: '',
  country: '', timezone: '', availability_note: '',
  headshot_url: '', linkedin_url: '',
};

export default function ProfileZone() {
  const [state, setState] = useState({ loading: true, error: '', profile: null });
  // SEEDED, NOT NULL, and this is a crash fix rather than a tidy-up.
  //
  // Every field below reads `draft.<key>` directly inside `<ZoneBody>`'s
  // children — `value={draft.display_name}` and eleven siblings. React
  // evaluates a component's children WHEN THE PARENT RENDERS, before
  // `ZoneBody` ever looks at `loading` to decide between a skeleton and them.
  // So a null draft is dereferenced on the very first render, every time,
  // whatever `loading` says: the page threw `Cannot read properties of null
  // (reading 'display_name')` into RouteErrorBoundary and rendered a red
  // error card instead of the profile, for every advisor, on every visit.
  //
  // The `loading` guard below cannot fix that, and #427's docblock has the
  // mechanism backwards where it says "the children below still cannot be
  // rendered against a null draft" — they are not rendered against it, they
  // are CONSTRUCTED against it, which happens first and is what throws. That
  // fix was still right about what it fixed (an unreachable error card); it
  // simply did not touch this.
  //
  // Seeding with the same shape `load` builds makes every read a string at
  // all times. The guard stays as it is: it is no longer load-bearing for the
  // deref, but it still keeps the skeleton up until the first read lands.
  const [draft, setDraft] = useState(EMPTY_DRAFT);
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
        ...EMPTY_DRAFT,
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
    // ZoneBody checks `loading` BEFORE `error`, so a caller that holds
    // loading true past a failure makes its own error card unreachable. The
    // old expression was `state.loading || !draft`, and `!draft` stays true
    // after a FAILED load (the catch sets `error` and never sets `draft`) —
    // so every load error rendered as a spinner forever and the error the
    // page had just captured never appeared.
    //
    // `!state.error` is what makes the draft guard safe to keep: an error
    // always beats the skeleton, and the children below still cannot be
    // rendered against a null draft — every field reads `draft.<key>`
    // unconditionally. Dropping the guard entirely would leave that
    // resting on React batching the two setState calls in `load`, which it
    // does today and need not tomorrow.
    <ZoneBody
      actions={advisorZoneActions('expertise/profile', { view: { header: ['Display name', 'Headline', 'Bio', 'Expertise', 'Sectors', 'Stages', 'Country', 'Timezone', 'Languages', 'LinkedIn', 'Availability'], rows: draft ? [draft] : [], cells: (d) => [d.display_name, d.headline, d.bio, d.expertise, d.sectors, d.stages, d.country, d.timezone, d.languages, d.linkedin_url, d.availability_note] } })}
      loading={state.loading || (!draft && !state.error)}
      error={state.error}
      onRetry={load}
      isEmpty={false}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {/* Canvas completeness meter — computed from the fields, not asserted. */}
          <Card padding="lg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Profile completeness · what every match surface reads
              </span>
              <span className="text-[13px] font-extrabold text-emerald-700 tabular-nums">
                {profileCompleteness(state.profile).pct}%
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-axal-hairline">
              <div
                className="h-full rounded-full bg-emerald-700 transition-all"
                style={{ width: `${profileCompleteness(state.profile).pct}%` }}
              />
            </div>
            {profileCompleteness(state.profile).gaps.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {profileCompleteness(state.profile).gaps.map((g) => (
                  <span key={g} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-800">
                    Missing · {g}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
              The meter counts only fields a match surface actually reads. Availability window is the costly gap: without it, a founder browsing the cohort surface cannot tell whether this practice takes new work this month.
            </p>
          </Card>

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
        </div>

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
