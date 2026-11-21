// D4618 part 2 (#4618): Privacy (board AC-4), moved unchanged out of
// `../SettingsPage.jsx` and loaded with its section (`lazySection`). It is
// still drawn under Sign-in and security, below that section's cards, with no
// route of its own (AC-0 marks a separate route "to confirm"). Visibility
// saves through `privacySaver` and the public-profile switches through
// `publicProfileSaver` (`../../lib/settingsSavers.js`, D4615): one request in
// flight, the revision read, another tab's 409 adopted. The page lays the
// cards out beside the investor cards, which stay in their own modules.
import Card from './AccountCard.jsx';
import { useEffect, useRef, useState } from 'react';
import { privacySaver, publicProfileSaver } from '../../lib/settingsSavers';
import { api } from '../../lib/api';
import { Unrecorded } from '../../ui';
import { toUtcInstant } from '../../lib/notices';
import { Field, inputCls } from './SettingsFields';

// Task #55 — per-role public-profile field map. Owner sees toggles
// only for fields that actually render on /u/<handle> for their role,
// so the editor stays focused.
const PUBLIC_PROFILE_FIELDS_COMMON = [
  { key: 'name', label: 'Name' },
  { key: 'bio', label: 'Bio' },
  { key: 'headshot', label: 'Headshot' },
  { key: 'socials', label: 'Social links' },
  { key: 'background', label: 'Background (experience, education, certifications)' },
];

const PUBLIC_PROFILE_FIELDS_BY_ROLE = {
  founder: [
    { key: 'projects', label: 'Startups (names + stage)' },
    { key: 'traction', label: 'Traction summary (users + revenue)' },
  ],
  investor: [
    { key: 'thesis', label: 'Investment thesis (sectors, stages, check size)' },
    { key: 'portfolio_summary', label: 'Portfolio engagements count' },
  ],
  partner: [
    { key: 'services', label: 'Services & categories' },
    { key: 'reviews', label: 'Reviews summary' },
    { key: 'pricing', label: 'Pricing tier & hourly rate' },
  ],
};

// Defaults must mirror backend `_DEFAULTS` in public_profiles.py so the
// owner-side toggles reflect what visitors actually see when no
// override has been saved yet.
// D4615 — the public-profile defaults are the Worker's (`_PROFILE_DEFAULTS` in routes/public.ts), read here as
// `public_profile_effective`; the copy that lived here had drifted from the ones the profile is served with.

export function PrivacySection({ data, patch, flash }) {
  const role = (data.role || 'founder').toLowerCase();
  const fieldList = [
    ...PUBLIC_PROFILE_FIELDS_COMMON,
    ...(PUBLIC_PROFILE_FIELDS_BY_ROLE[role] || []),
  ];
  const [copied, setCopied] = useState(false);
  // D4615 — the switches are drawn from what the public profile actually shows (`public_profile_effective`, the
  // rule /api/public serves with) and saved one switch at a time, with the revision read. Rapid clicks queue
  // behind each other instead of each resending a stale copy of the whole map.
  const [pp, setPp] = useState(() => data.public_profile_effective || {});
  const saver = useRef(null);
  if (!saver.current) saver.current = publicProfileSaver(data, setPp, flash);

  const setVisible = (key, value) => { saver.current.save({ [key]: value }); };

  const publicUrl = data.handle
    ? `${window.location.origin}/u/${data.handle}`
    : null;
  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      flash('Copy failed — select & copy manually', 'error');
    }
  };

  return (
    <>
      <Card title="Public profile" description="Anyone with the link below can view this page. Choose what's visible per field.">
        {publicUrl && (
          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-violet-700">Your public link</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <a href={publicUrl} target="_blank" rel="noreferrer noopener"
                 className="font-mono text-sm text-violet-900 hover:underline break-all">{publicUrl}</a>
              <button onClick={copyPublicUrl} className="ml-auto rounded-md border border-violet-300 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {fieldList.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" checked={pp[key] === true}
                onChange={e => setVisible(key, e.target.checked)}
                className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Email and account details are never published. Inactive or deletion-requested accounts return 404.
        </p>
      </Card>

    </>
  );
}


// D492 (U6) — the advisors a Spin-Out Lab cohort assignment lets read you.
// An assignment shows an advisor the cohort's founders: name, email and weekly
// progress. Each founder is told when that starts and ends, and can hide
// themselves from one advisor here. The card draws nothing for someone in no
// assigned cohort — an empty list is not a setting worth showing.
function accessDay(v) {
  const iso = toUtcInstant(v);
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : String(v ?? '');
}


export function CohortAdvisorAccessCard({ flash }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.myCohortAdvisorAccess()
      .then(r => { if (!cancelled) setItems(r?.items || []); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load advisor access'); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (advisorUserId, visible) => {
    setBusy(advisorUserId);
    try {
      const r = await api.setCohortAdvisorVisibility(advisorUserId, visible);
      setItems(r?.items || []);
      flash(visible ? 'This advisor can see you again' : 'Hidden from this advisor');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally { setBusy(null); }
  };

  if (err) return <Card title="Cohort advisors"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!items || items.length === 0) return null;

  return (
    <Card title="Cohort advisors"
      description="Advisors assigned to your Spin-Out Lab cohort can see your name, email address and weekly progress. You can hide yourself from any one of them.">
      <ul className="divide-y divide-gray-200 dark:divide-gray-700" data-testid="cohort-advisor-access">
        {items.map((it) => {
          const live = !it.ended_at && (it.can_see || it.hidden_at);
          return (
            <li key={`${it.advisor_user_id}-${it.cohort_cycle_id}-${it.assigned_at}`} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{it.advisor_name || <Unrecorded />}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {it.cohort_label} · assigned {accessDay(it.assigned_at)}
                  {it.ended_at ? ` · access ended ${accessDay(it.ended_at)}` : ''}
                </div>
                <div className="text-xs mt-0.5 text-gray-600 dark:text-gray-300">
                  {it.can_see ? 'Can see you' : it.hidden_at ? 'Hidden by you' : 'No longer has access'}
                </div>
              </div>
              {live && (
                <button type="button" disabled={busy === it.advisor_user_id}
                  onClick={() => toggle(it.advisor_user_id, !it.can_see)}
                  className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50">
                  {it.can_see ? 'Hide me' : 'Let them see me'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}


export function PrivacyCoreCard({ flash }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  // D4615 — one save in flight, later edits queued behind it with the revision it returns; a delayed response
  // never replaces a newer choice, and another tab's newer save is adopted and said, never overwritten.
  const saver = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getPrivacySettings()
      .then(r => {
        if (cancelled) return;
        saver.current = privacySaver(r, setRow, flash);
        setRow(saver.current.view);
      })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load privacy settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = (delta) => { saver.current?.save(delta); };
  const busy = false;

  if (err) return <Card title="Visibility"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Visibility"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  return (
    <Card title="Visibility & discovery"
      description="Who can find you across the platform. Public Directory listings honour these toggles in real time.">
      <div className="space-y-3">
        <Field label="Profile visibility">
          <select value={row.visibility || 'network'} onChange={e => save({ visibility: e.target.value })} disabled={busy} className={inputCls}>
            <option value="public">Public — anyone with the address</option>
            <option value="network">Members only — signed-in Axal VC members</option>
            <option value="private">Hidden — only you</option>
          </select>
        </Field>
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={!!row.show_in_directory} disabled={busy}
            onChange={e => save({ show_in_directory: e.target.checked })}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Show me in the Public Directory
        </label>
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={!!row.discoverable} disabled={busy}
            onChange={e => save({ discoverable: e.target.checked })}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Allow advisors and founders to discover me for matching
        </label>
        {/* Task #19 — explicit matching consent, gated on profile completeness. */}
        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
          <label className="flex items-start gap-3 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" checked={!!row.matching_opt_in}
              disabled={busy || (!row.matching_opt_in && !row.matching_eligible)}
              onChange={e => save({ matching_opt_in: e.target.checked })}
              className="mt-0.5 w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500 disabled:opacity-50" />
            <span>
              Include me in matching
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                When on, you can appear as a candidate in investor, partner and co-founder
                match results. Off by default — turning it off removes you from all match lists.
              </span>
              {!row.matching_eligible && !row.matching_opt_in && (
                <span className="block mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Complete at least {row.matching_min_pct ?? 60}% of your profile to enable this
                  {typeof row.profile_completion_pct === 'number'
                    ? ` (currently ${row.profile_completion_pct}%).`
                    : '.'}
                </span>
              )}
            </span>
          </label>
        </div>
      </div>
    </Card>
  );
}


// Task #6 (AT-1) — Market Intelligence contribution opt-out. Lives in
// Privacy alongside the Investor Signals toggle. Default is opt-IN
// (contribute). Flipping the toggle calls the worker which purges the
// user's signals + embeddings within 24h via the nightly reducer
// (or sooner the next time the mi_reduce queue job runs).
export function MarketIntelContributionCard({ flash }) {
  const [optedOut, setOptedOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.miContributionOptoutGet()
      .then(r => { if (!cancelled) setOptedOut(!!r.opted_out); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (contribute) => {
    const next = !contribute; // checkbox = "contribute"; flag stored = "opt_out"
    setBusy(true);
    try {
      const r = await api.miContributionOptoutSet(next);
      setOptedOut(!!r.opted_out);
      flash(next
        ? 'Opted out — your contributions will be purged within 6 hours'
        : 'Now contributing to anonymized Market Intelligence');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally { setBusy(false); }
  };

  if (err) return <Card title="Market Intelligence"><div className="text-sm text-red-600">{err}</div></Card>;
  if (optedOut === null) return <Card title="Market Intelligence"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const contribute = !optedOut;
  return (
    <Card
      title="Anonymized Market Intelligence"
      description="Your advisor answers can power platform-wide sentiment, sector-heat, demand/supply and fit-match dashboards. Cells are only published when at least 5 contributors share the same answer; identifiers are never exposed."
    >
      <div className="space-y-3">
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={contribute} disabled={busy}
            onChange={e => toggle(e.target.checked)}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Contribute my advisor answers to anonymised Market Intelligence (k ≥ 5)
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Opting out removes your contribution within 6 hours — the aggregator runs every 6 hours and purges opted-out contributors before rebuilding cells.
        </p>
      </div>
    </Card>
  );
}
