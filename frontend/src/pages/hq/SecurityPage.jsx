import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, CircleAlert, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail } from '../../ui';
import { Unrecorded } from '../advisor/expertise/kit';

/**
 * HQ · Security (Support Security · Super canvas, Y2; the row Governance
 * became under decision A4).
 *
 * Eight zones in the canvas's order, over `GET /api/admin/security/overview`.
 * Four are real — sessions and access (with the platform-wide force re-auth),
 * data subject requests, KYC, the admin action audit — and four are named as
 * not recorded in the zone the canvas draws for them: security events, AI
 * safety, sanctions, backup and DR. The canvas calls the `security_events`
 * ledger "the one real backend build"; it is not built, and this page says
 * so where the feed would be rather than rendering the canvas's sample rows.
 *
 * ABSENT IS NOT ZERO. `num` returns null for a missing figure, a failed
 * request is unreadable rather than a quiet platform, and each `available:
 * false` block carries its reason onto the screen.
 */
const UNAVAILABLE = Symbol('unavailable');

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
// A number, formatted — or null when there is no number. Never a default.
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

function Zone({ title, sub, children, tone = '' }) {
  return (
    <Card className={tone}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-ink-3">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

function Absent({ block, fallback }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
      <Unrecorded /> — {block?.reason || fallback}
    </p>
  );
}

function Stat({ label, value, note, tone = 'text-axal-ink' }) {
  return (
    <div className="rounded-xl border border-axal-line bg-axal-surface-2 p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-ink-3">{note}</div>}
    </div>
  );
}

function Unreadable({ what, onRetry }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-red-700 dark:text-red-300" role="alert">
      <CircleAlert size={13} /> {what} could not be read. This is not a claim that nothing happened.
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 inline-flex items-center gap-1 underline">
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </p>
  );
}

function ForceReauth({ onDone }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.hqSecurityForceReauth(reason.trim());
      setDone(res);
      onDone?.();
    } catch (err) {
      const msg = String(err?.message || err || 'Request failed');
      setError(msg === 'TOTP required'
        ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
        : msg);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        {done.message} {num(done.affected) !== null ? `${num(done.affected)} accounts affected.` : ''}{' '}
        <a href="/login" className="underline">Sign in again →</a>
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2" data-testid="hq-force-reauth">
      <label className="block text-[11px] font-semibold text-axal-ink-2">
        Reason · required, stored with the action
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. credential stuffing observed against three admin accounts"
          className="mt-1 w-full rounded-md border border-axal-line bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-axal-ink dark:bg-gray-900"
        />
      </label>
      <label className="flex items-start gap-2 text-[11.5px] text-axal-ink-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>I understand this signs out every active account on every tenant, including my own session.</span>
      </label>
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={busy || !ack || reason.trim().length < 8}
        className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-red-700 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Force re-auth · all tenants
      </button>
    </form>
  );
}

export default function HqSecurityPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqSecurityOverview().then(setData, (e) => { reportError('hq-security', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const audit = ready ? data.audit?.rows || [] : [];
  const imp = ready ? data.impersonations : null;
  const sessions = ready ? data.sessions : null;
  const mfa = ready ? data.mfa : null;
  const kyc = ready ? data.kyc || {} : {};
  const dsr = ready ? data.dsr?.rows || [] : [];
  const dsrDue = dsr.filter((d) => d.days_left !== null && d.days_left <= 14).length;
  const withoutMfa = mfa ? mfa.admins_total - mfa.admins_with_mfa : null;

  const rail = (
    <WorkerRail
      workspace="Security"
      role="super_admin"
      stance="Read-only, except force re-auth"
      note="Audit, sessions, KYC and deletion clocks are read from their stores. The one action here signs everyone out and is recorded."
      coverage={ready ? [
        `${num(data.audit?.total) ?? 'an unrecorded number of'} admin actions on record`,
        imp?.available ? `${num(imp.active)} impersonation${imp.active === 1 ? '' : 's'} live` : 'Impersonations: unreadable',
        `${num(dsr.length)} deletion request${dsr.length === 1 ? '' : 's'} open`,
      ] : []}
      coverageNote={ready ? undefined : (data === UNAVAILABLE ? 'The security overview could not be read.' : 'Loading…')}
      unavailable={[
        // [title, detail] pairs: WorkerRail destructures each entry, so a bare
        // string would render as its first two characters.
        ['Security events', 'No security_events ledger exists yet.'],
        ['AI safety counters', 'Nothing aggregates guardrail verdicts.'],
        ['Sanctions screening', 'Not run on the platform.'],
        ['Backup and restore-drill status', 'Not recorded where the platform can read it.'],
        ['Per-tenant anything', 'No account names its licence yet (U1).'],
      ]}
      data-testid="hq-security-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-security-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="text-[11px] opacity-80 tabular-nums">
            {ready ? `${num(dsrDue)} deletion request${dsrDue === 1 ? '' : 's'} inside deadline pressure` : '…'}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            <ShieldCheck size={13} /> HQ · Security
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Security</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
            Was Governance, which described the audit log and nothing else. Eight zones: four read their stores,
            four say what is not recorded and why. Nothing here is scoped per subsidiary yet.
          </p>
        </header>

        {data === UNAVAILABLE && <div className="mt-4"><Unreadable what="The security overview" onRetry={load} /></div>}

        <div className="mt-4 space-y-4">
          <Zone title="Security events and auth anomalies" sub="the canvas's one real backend build" tone="border-red-200 dark:border-red-900/50">
            <Absent block={ready ? data.security_events : null} fallback="no security_events ledger exists." />
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Sessions and access" sub="Revoke is recorded">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Active sessions" value={sessions?.available ? num(sessions.active) : null} note={sessions?.available ? `seen in ${sessions.window_days} days, not revoked` : (sessions?.reason || 'unreadable')} />
                <Stat label="Impersonations live" value={imp?.available ? num(imp.active) : null} note={imp?.available ? 'no ended_at yet' : (imp?.reason || 'unreadable')} tone={imp?.available && imp.active ? 'text-red-700 dark:text-red-300' : 'text-axal-ink'} />
                <Stat label="Admins with MFA" value={mfa ? `${num(mfa.admins_with_mfa)} of ${num(mfa.admins_total)}` : null} note={withoutMfa === null ? 'unreadable' : withoutMfa > 0 ? `${num(withoutMfa)} without` : 'every admin enrolled'} tone={withoutMfa ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink'} />
                <Stat label="Failed sign-ins" value={null} note="not recorded — no security_events" />
              </div>
              {imp?.available && imp.recent.length > 0 && (
                <ul className="mt-3 space-y-1.5" data-testid="hq-impersonations">
                  {imp.recent.slice(0, 5).map((s) => (
                    <li key={s.id} className={`rounded-lg border px-3 py-2 text-[11.5px] ${s.ended_at ? 'border-axal-line bg-axal-surface-2' : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'}`}>
                      <b>{s.admin_name || s.admin_email}</b> as <b>{s.target_name || s.target_email}</b>
                      <span className="ml-2 font-mono text-[10px] text-axal-ink-3">{day(s.started_at)}{s.ended_at ? ` → ${day(s.ended_at)}` : ' · live'}</span>
                      {s.context && <span className="ml-2 text-axal-ink-3">· {s.context}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <ForceReauth onDone={load} />
              <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
                An impersonation is a session like any other, which is why it sits here. Per-device revocation stays
                with each account under Settings; the platform-wide action above bumps every account&apos;s token floor.
              </p>
            </Zone>

            <Zone title="AI safety" sub="guardrails">
              <Absent block={ready ? data.ai_safety : null} fallback="no safety counter is stored." />
            </Zone>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Data subject requests" sub={`${ready ? data.dsr?.clock_days : 30}-day clock from receipt`} tone="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
              {ready && dsr.length === 0 && <p className="text-[12px] text-axal-ink-3">No deletion request is open.</p>}
              {ready && dsr.length > 0 && (
                <ul className="space-y-1.5" data-testid="hq-dsr">
                  {dsr.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
                      <span className="min-w-0 truncate"><b>{d.name || d.email}</b> <span className="text-axal-ink-3">· {titleCase(d.role)} · erasure</span></span>
                      <span className={`shrink-0 font-bold tabular-nums ${d.days_left === null ? 'text-axal-ink-3' : d.days_left < 0 ? 'text-red-700 dark:text-red-300' : d.days_left <= 14 ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink'}`}>
                        {d.days_left === null ? <Unrecorded>clock unknown</Unrecorded> : d.days_left < 0 ? `${num(-d.days_left)}d overdue` : `${num(d.days_left)}d left`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-ink-3">Loading…</p>}
              <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
                The clock is statutory — one month from receipt, not from triage. Requests come from each account&apos;s own
                Settings; erasure itself is still a manual act.
              </p>
            </Zone>

            <div className="space-y-4">
              <Zone title="Sanctions and KYC" sub="the review queue">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="KYC pending" value={ready ? num(kyc.pending) ?? '0' : null} note="documents submitted, unverified" tone={kyc.pending ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink'} />
                  <Stat label="KYC approved" value={ready ? num(kyc.approved) ?? '0' : null} note="active accounts" />
                  <Stat label="KYC rejected" value={ready ? num(kyc.rejected) ?? '0' : null} note="active accounts" />
                  <Stat label="Sanctions review" value={null} note={ready ? (data.sanctions?.reason || 'not recorded') : 'unreadable'} />
                </div>
              </Zone>
              <Zone title="Backup and DR" sub="drill status, not just backup status">
                <Absent block={ready ? data.backup_dr : null} fallback="no drill record is kept." />
              </Zone>
            </div>
          </div>

          <Zone title="Admin action audit" sub={ready ? `admin_audit_log · ${num(data.audit?.total) ?? '—'} rows · one zone of eight` : 'admin_audit_log'}>
            {ready && audit.length === 0 && <p className="text-[12px] text-axal-ink-3">No admin action is recorded yet.</p>}
            {ready && audit.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]" data-testid="hq-audit">
                  <thead>
                    <tr className="text-left text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">
                      <th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Actor</th><th className="py-1 pr-3">Action</th><th className="py-1">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id} className="border-t border-axal-line align-top">
                        <td className="py-1.5 pr-3 font-mono text-[10.5px] text-axal-ink-3">{day(a.exported_at)}</td>
                        <td className="py-1.5 pr-3 font-semibold">{a.admin_name || a.admin_email || `user ${a.admin_user_id}`}</td>
                        <td className="py-1.5 pr-3 font-bold">{a.action}</td>
                        <td className="py-1.5 text-axal-ink-2">{[a.report_type, a.format, a.filters_json].filter(Boolean).join(' · ') || <Unrecorded>no detail</Unrecorded>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-ink-3">Loading…</p>}
            <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
              Newest first, every action, no summary tile above it: a count of suspensions is a dashboard, the
              suspensions themselves are the record. Unchanged from Governance — it was the whole page and is now one
              zone of eight, which is the honest description of how much of security an audit log covers.
            </p>
          </Zone>
        </div>
      </div>

      <div className="mt-6 lg:mt-0">{rail}</div>
    </div>
  );
}
