import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

/**
 * D637 — one co-marketing pitch (Ops canvas `sp-comarketing`), at
 * `/comarketing/:pitch`.
 *
 * - **Proposed:** the pitch form, prefilled, saved through
 *   `PATCH /comarketing/me/pitches/:uid`.
 * - **Approved, published, rejected or withdrawn:** the same fields, locked,
 *   with a note saying why and what to do instead. The Worker refuses the edit
 *   too (`pitch_locked`), so the lock is not only on this page.
 * - **Results:** visits, sign-ups, leads and conversions. A kind with nothing
 *   recorded reads "Not recorded", never 0: a count of 0 here only ever means
 *   no event was stored. Visits are recorded from the Published feed's View
 *   link; nothing records sign-ups, leads or conversions yet.
 */

export const ASSET_TYPES = [
  ['webinar', 'Webinar'], ['blog', 'Blog post'], ['podcast', 'Podcast'],
  ['event', 'Event'], ['newsletter', 'Newsletter'], ['other', 'Other'],
];

export const RESULT_KINDS = [
  ['visit', 'Visits'], ['signup', 'Sign-ups'], ['lead', 'Leads'], ['conversion', 'Conversions'],
];

const STATUS_LABEL = { proposed: 'Proposed', approved: 'Approved', published: 'Published', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const STATUS_TONE = {
  proposed: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  withdrawn: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

const day = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** Why the form is locked, from the pitch's status and dates. Null while Proposed. */
export function lockNote(p) {
  if (!p || p.status === 'proposed') return null;
  const when = day(p.reviewed_at || p.published_at || p.updated_at);
  const on = when ? ` on ${when}` : '';
  if (p.status === 'approved') return `Approved${on}. The form is locked; to change the pitch, withdraw it and propose again.`;
  if (p.status === 'published') return `Published${p.published_at ? ` on ${day(p.published_at)}` : on}. The form is locked.`;
  if (p.status === 'rejected') return `Rejected${on}. The form is locked; propose a new pitch instead.`;
  if (p.status === 'withdrawn') return `Withdrawn${on}. The form is locked; propose a new pitch instead.`;
  return 'The form is locked.';
}

/** Each result as a number, or null for "Not recorded". */
export function resultsOf(attribution) {
  const a = attribution || {};
  return RESULT_KINDS.map(([k, label]) => ({ k, label, n: Number(a[k]) > 0 ? Number(a[k]) : null }));
}

export function draftOf(p) {
  return {
    asset_type: p?.asset_type || 'webinar',
    title: p?.title || '',
    angle: p?.angle || '',
    target_audience: p?.target_audience || '',
    what_you_bring: p?.what_you_bring || '',
    summary: p?.summary || '',
  };
}

const INPUT = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400';

/** The page from a finished read. Pure, so each state renders in a test. */
export function CoMarketingPitchView({ read, draft, setDraft, onSave, onRetry, saving = false, saveError = '', saved = false }) {
  const back = (
    <Link to="/comarketing" className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 underline dark:text-violet-300">
      <ArrowLeft size={13} aria-hidden="true" /> Co-marketing
    </Link>
  );
  if (read.kind === 'loading') {
    return <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">{back}<p className="text-sm text-gray-500 dark:text-gray-400" data-testid="pitch-loading">Loading the pitch…</p></div>;
  }
  if (read.kind === 'unreadable') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        {back}
        <div data-testid="pitch-unreadable" className="rounded-xl border border-dashed border-rose-300 p-4 dark:border-rose-800">
          <p className="text-sm text-rose-700 dark:text-rose-300">This pitch could not be read just now.</p>
          {read.message ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{read.message}</p> : null}
          <button type="button" onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
            <RefreshCw size={12} aria-hidden="true" /> Try again
          </button>
        </div>
      </div>
    );
  }
  if (read.kind === 'missing') {
    return <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">{back}<p className="text-sm text-gray-600 dark:text-gray-400" data-testid="pitch-missing">{read.message}</p></div>;
  }
  const p = read.pitch;
  const locked = lockNote(p);
  const results = resultsOf(p.attribution);
  const nothing = results.every((r) => r.n == null);
  const field = (key, label, el) => (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      {el}
    </label>
  );
  const bind = (key) => ({ value: draft[key], disabled: !!locked, onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })) });
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6" data-testid="comarketing-pitch">
      {back}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{p.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[p.status] || STATUS_TONE.withdrawn}`}>{STATUS_LABEL[p.status] || p.status}</span>
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Edit while the pitch is Proposed. Locked once approved, rejected or withdrawn.</p>
      </div>

      {locked ? (
        <div data-testid="pitch-locked" className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
          <Lock size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> <span>{locked}</span>
        </div>
      ) : null}

      <form className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="pitch-form"
        onSubmit={(e) => { e.preventDefault(); if (!locked) onSave?.(); }}>
        {field('asset_type', 'Type', (
          <select className={INPUT} {...bind('asset_type')}>
            {ASSET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        {field('title', 'Title', <input className={INPUT} maxLength={200} {...bind('title')} />)}
        {field('angle', 'Angle', <input className={INPUT} maxLength={500} placeholder="One line, for the audience you name" {...bind('angle')} />)}
        {field('target_audience', 'Audience', <input className={INPUT} {...bind('target_audience')} />)}
        {field('what_you_bring', 'What you bring', <textarea className={INPUT} rows={2} maxLength={1000} placeholder="Audience size, distribution" {...bind('what_you_bring')} />)}
        {field('summary', 'Summary', <textarea className={INPUT} rows={4} {...bind('summary')} />)}
        {saveError ? <p className="text-sm text-rose-700 dark:text-rose-300" data-testid="pitch-save-error">{saveError}</p> : null}
        {!locked ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500 sm:w-auto">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {saved ? <span className="text-xs text-emerald-700 dark:text-emerald-300" data-testid="pitch-saved">Saved. The pitch is still Proposed.</span> : null}
          </div>
        ) : null}
      </form>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="pitch-results">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Results</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {results.map((r) => (
            <div key={r.k} data-testid={`result-${r.k}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{r.label}</div>
              {r.n != null
                ? <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{r.n}</div>
                : <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">Not recorded</div>}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {nothing
            ? 'Nothing is recorded for this pitch yet. Visits are counted from the Published feed once the piece is live.'
            : 'Not recorded: no event of that kind has been stored for this pitch. Visits come from the Published feed; nothing records sign-ups, leads or conversions yet.'}
        </p>
      </section>
    </div>
  );
}

export default function CoMarketingPitchPage({ client = api }) {
  const { pitch: uid } = useParams();
  const [read, setRead] = useState({ kind: 'loading' });
  const [draft, setDraft] = useState(draftOf(null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setRead({ kind: 'loading' });
    try {
      const p = await client.getCoMarketingPitch(uid);
      setRead({ kind: 'ready', pitch: p });
      setDraft(draftOf(p));
    } catch (e) {
      if (e?.status === 404 || e?.status === 403) setRead({ kind: 'missing', message: e?.message || 'This pitch does not exist, or it is not yours.' });
      else setRead({ kind: 'unreadable', message: e?.message || '' });
    }
  }, [client, uid]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setSaveError(''); setSaved(false);
    try {
      const fresh = await client.editCoMarketingPitch(uid, draft);
      setRead({ kind: 'ready', pitch: fresh });
      setDraft(draftOf(fresh));
      setSaved(true);
    } catch (e) {
      setSaveError(e?.message || 'The pitch could not be saved.');
      // A pitch approved since this page opened is locked now: read it again.
      if (e?.status === 409) load();
    } finally { setSaving(false); }
  };

  return (
    <CoMarketingPitchView read={read} draft={draft} setDraft={(f) => { setSaved(false); setDraft(f); }}
      onSave={save} onRetry={load} saving={saving} saveError={saveError} saved={saved} />
  );
}
