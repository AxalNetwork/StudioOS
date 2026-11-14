import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { useTurnstile } from '../../components/site/NewsletterSignup';
import { request } from '../../lib/api';
import { trustPublicApi, securityReportsApi } from '../../lib/api/trustContent';
import { overallStatus } from '../../lib/statusOverall';
import { DAY_WORDS } from '../../lib/statusHistory';
import { openCookiePreferences } from '../../lib/cookieConsent';
import { useAuth } from '../../hooks/useAuthSync';
import { Lightbox, usePhoneWidth } from '../../ui';
import { TERMS_UPDATED } from '../TermsPage';
import { PRIVACY_UPDATED } from '../PrivacyPage';
import { RISK_UPDATED } from '../RiskDisclosuresPage';
import {
  LINE, MATRIX_FOOT, NOT_RECORDED, NO_CHANGES, NO_CHANGES_SUB, PART_UNREADABLE, REPORT_DIALOG, REPORT_WAYS, RESPONSE_TIMES,
  SAFE_HARBOUR, TABS, TITLE, TRY_AGAIN, UNREADABLE, YOUR_TRUST,
  blockOf, certificationsTile, changesOf, checkedLine, documentTable, lastReviewed, matrixOf, statusLine, statusStrip,
  subprocessorsOf, subprocessorsTile, tabOf,
} from './trustCenterModel';

/**
 * D1072 (#2425) — the public trust center at `/trust` and its tabs, for
 * anyone. Signed out it sits in the public site frame (TRU1); signed in it is
 * routed inside the app shell, in the member's own colours, light or dark
 * (TRU20, `inShell`), and "Your trust" opens `/trust/me`.
 *
 * D1077 (#2969, part 5): every block reads the published store
 * (`GET /api/public/trust`, D1075), each fact with its Checked date. A block
 * HQ has never published keeps the page's own lines (`trustCenterModel.js`);
 * a part that could not be read says Unreadable with Try again, and the rest
 * of the page still draws (TRU17a). The overview adds the Status strip from
 * D1076's history, "What we check, and for whom" from `/matrix`, and the
 * change log; Subprocessors lists the store's companies with a subscribe step
 * (TRU4), or counsel's line while none is listed (TRU4v); Disclosure's third
 * way is the signed-in report dialog (TRU6d). No browser pop-up anywhere.
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-[#ececf1] bg-white px-[18px] py-4 dark:border-gray-700 dark:bg-gray-900';
const H2 = 'm-0 text-[16px] font-extrabold tracking-[-.015em] text-[#141118] dark:text-gray-100';
const MUTED = 'm-0 text-[13px] text-[#6b6577] dark:text-gray-400';
const EYE = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577] dark:text-gray-400';
const VALUE = 'm-0 text-[15px] font-bold text-[#141118] dark:text-gray-100';
const PILL = 'w-fit rounded-full border border-dashed border-gray-400 px-2 py-0.5 text-[10.5px] font-bold text-[#6b6577] dark:border-gray-500 dark:text-gray-400';
const LINK = 'font-semibold text-[#6d28d9] hover:text-[#5b21b6] dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'inline-flex min-h-[36px] w-fit items-center justify-center rounded-[9px] border border-[#ececf1] bg-white px-3.5 text-[13px] font-bold text-[#141118] hover:border-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const BTN_PRIMARY = 'inline-flex min-h-[36px] w-fit items-center justify-center rounded-[9px] bg-[#6d28d9] px-3.5 text-[13px] font-bold text-white hover:bg-[#5b21b6] disabled:cursor-not-allowed disabled:opacity-60';
const INPUT = 'min-h-[40px] w-full rounded-[9px] border border-[#ececf1] bg-white px-3 text-[13.5px] text-[#141118] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const TH = 'py-2 pr-3 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577] dark:text-gray-400';
const ROW = 'border-t border-[#ececf1] dark:border-gray-700';

/** One read, with its state and Try again. */
function useRead(fn) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', data: null });
    fn().then((data) => { if (alive) setRead({ status: 'ready', data }); }, () => { if (alive) setRead({ status: 'error', data: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return { read, reload: useCallback(() => setN((x) => x + 1), []) };
}

/** Each read once per page: the store, the status, the matrix. */
function useTrustReads() {
  const trust = useRead(() => trustPublicApi.read());
  const status = useRead(() => request('/public/status'));
  const matrix = useRead(() => trustPublicApi.matrix());
  return { trust, status, matrix };
}

function Unread({ what, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid={testId}>
      <span>{what ? `${what}: ${PART_UNREADABLE}` : PART_UNREADABLE}</span>
      {onRetry ? <button type="button" className={BTN} onClick={onRetry}>{TRY_AGAIN}</button> : null}
    </div>
  );
}

function Reading({ lines = 3, testId }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" data-testid={testId}>
      <span className="sr-only">Reading…</span>
      {Array.from({ length: lines }, (_, i) => <span key={i} className="h-3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

/** One line: a fact with its Checked date, or a gap with Not recorded and why. */
function Fact({ f }) {
  return f.recorded
    ? (
      <li className="flex gap-2 border-t border-[#ececf1] py-2 first:border-t-0 dark:border-gray-700" data-testid="trust-fact">
        <span aria-hidden="true" className="text-emerald-600 dark:text-emerald-400">✓</span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[13px] text-[#4a4553] dark:text-gray-200">{f.text}</span>
          <span className="font-mono text-[11px] text-[#6b6577] dark:text-gray-400" data-testid="trust-fact-checked">{checkedLine(f.checked_at)}</span>
        </span>
      </li>
    )
    : (
      <li className="flex gap-2 border-t border-[#ececf1] py-2 first:border-t-0 dark:border-gray-700" data-testid="trust-gap">
        <span aria-hidden="true" className="text-[#6b6577]">○</span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[#4a4553] dark:text-gray-200">{f.text} <span className={PILL}>{NOT_RECORDED}</span></span>
          {f.why ? <span className="text-[12px] text-[#6b6577] dark:text-gray-400">{f.why}</span> : null}
        </span>
      </li>
    );
}

function Lines({ lines }) {
  return <ul className="m-0 flex list-none flex-col p-0">{lines.map((f) => <Fact key={f.text} f={f} />)}</ul>;
}

/** A block's groups as cards, in its state. */
function BlockCards({ block, what, onRetry, testId, cols = 'lg:grid-cols-3', more = null }) {
  if (block.state === 'loading') return <div className={`grid grid-cols-1 gap-[14px] ${cols}`}>{[0, 1, 2].map((i) => <section key={i} className={CARD}><Reading testId={i === 0 ? `${testId}-loading` : undefined} /></section>)}</div>;
  if (block.state === 'unreadable') return <section className={CARD}><Unread what={what} onRetry={onRetry} testId={`${testId}-unreadable`} /></section>;
  return (
    <div className={`grid grid-cols-1 gap-[14px] ${cols}`} data-testid={testId} data-source={block.state}>
      {block.intro ? <p className={`${MUTED} lg:col-span-3`}>{block.intro}</p> : null}
      {block.groups.map((g, i) => (
        <section key={`${g.title || ''}-${i}`} className={CARD}>
          {g.title ? <h3 className={H2}>{g.title}</h3> : null}
          <Lines lines={g.lines} />
          {more && more(g)}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview (TRU1, TRU1s, TRU15c, TRU16, TRU17a, TRU19a, TRU20)
 * ------------------------------------------------------------------ */

function Tile({ eye, children, testId }) {
  return <section className={CARD} data-testid={testId}><span className={EYE}>{eye}</span>{children}</section>;
}

function StatusTile({ read }) {
  const overall = read.status === 'ready' ? overallStatus(read.data?.services) : null;
  return (
    <Tile eye="Status" testId="trust-status">
      <p className={VALUE} data-testid="trust-status-line">
        {read.status === 'loading' ? 'Reading…' : read.status === 'error' ? 'Status could not be read.' : statusLine(overall)}
      </p>
      {read.status === 'error' ? <p className={MUTED}>The rest of the page reads as usual.</p> : null}
      <Link to="/status" className={LINK}>Status page ›</Link>
    </Tile>
  );
}

function Tiles({ reads }) {
  const certs = certificationsTile(reads.trust.read);
  const subs = subprocessorsTile(reads.trust.read);
  return (
    <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-5" data-testid="trust-tiles">
      <StatusTile read={reads.status.read} />
      <Tile eye="Certifications" testId="trust-certifications">
        {certs.state === 'loading' ? <p className={VALUE}>Reading…</p> : null}
        {certs.state === 'unreadable' ? <p className={VALUE} data-testid="trust-certifications-unreadable">{UNREADABLE}</p> : null}
        {certs.state === 'ready' ? <><p className={VALUE} data-testid="trust-certifications-value">{certs.value}</p><p className={MUTED}>{certs.sub}</p></> : null}
      </Tile>
      <Tile eye="Security contact">
        <p className="m-0 break-all font-mono text-[14px] text-[#141118] dark:text-gray-100">security@axal.vc</p>
        <p className={MUTED}>Critical reports acknowledged within 4 business hours.</p>
      </Tile>
      <Tile eye="Subprocessors" testId="trust-subprocessors-tile">
        {subs.state === 'loading' ? <p className={VALUE}>Reading…</p> : null}
        {subs.state === 'unreadable' ? <p className={VALUE}>{UNREADABLE}</p> : null}
        {subs.state === 'review' ? <><span className={PILL}>{NOT_RECORDED}</span><p className={MUTED}>{subs.sub}</p></> : null}
        {subs.state === 'ready' ? <><p className={VALUE} data-testid="trust-subprocessors-value">{subs.value}</p><p className={MUTED}>{subs.sub}</p></> : null}
      </Tile>
      <Tile eye="Your data">
        <p className={VALUE}>Download or delete it any time</p>
        <p className={MUTED}>From your account.</p>
      </Tile>
    </div>
  );
}

const STRIP_CELL = {
  no_incident: 'bg-emerald-500', degraded: 'bg-amber-400', down: 'bg-red-500',
  not_recorded: 'border border-dashed border-gray-400 bg-transparent dark:border-gray-500',
};

function StatusStrip({ read, onRetry }) {
  const s = statusStrip(read);
  return (
    <section className={CARD} data-testid="trust-status-strip">
      <h3 className={H2}>{s.state === 'ready' ? s.title : 'Status'}</h3>
      {s.state === 'loading' ? <Reading lines={2} /> : null}
      {s.state === 'unreadable' ? <Unread what="The status history" onRetry={onRetry} testId="trust-status-strip-unreadable" /> : null}
      {s.state === 'none' ? <p className={MUTED}>No monitored service keeps a history yet.</p> : null}
      {s.state === 'ready' ? (
        <>
          <div className="flex items-end gap-[2px]" role="img" aria-label={s.alt} data-testid="trust-status-cells">
            {s.cells.map((c) => <span key={c.day} data-day={c.status} title={`${c.day}: ${DAY_WORDS[c.status]}`} className={`inline-block h-6 w-[3px] flex-none rounded-sm ${STRIP_CELL[c.status]}`} />)}
          </div>
          <p className="m-0 font-mono text-[12.5px] font-bold text-[#141118] dark:text-gray-100" data-testid="trust-status-count">{s.line}</p>
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-[11.5px] text-[#6b6577] dark:text-gray-400">
            {[['no_incident', 'No incident reported'], ['degraded', 'Incident reported'], ['down', 'Outage reported'], ['not_recorded', NOT_RECORDED]].map(([k, t]) => (
              <li key={k} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${STRIP_CELL[k]}`} />{t}</li>
            ))}
          </ul>
        </>
      ) : null}
      <Link to="/status" className={LINK}>Status page ›</Link>
    </section>
  );
}

/** Where each "How we protect you" card's Read more goes. */
const MORE = { Security: '/trust/security', 'Data and privacy': '/trust/data', Subprocessors: '/trust/subprocessors', Disclosure: '/trust/disclosure', Documents: '/trust/documents' };

function Protect({ reads }) {
  const glance = blockOf(reads.trust.read, 'glance');
  return (
    <section className="flex flex-col gap-[14px]" data-testid="trust-protect">
      <h2 className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-[#141118] dark:text-gray-100">How we protect you</h2>
      <BlockCards block={glance} what="How we protect you" onRetry={reads.trust.reload} testId="trust-glance" cols="lg:grid-cols-2"
        more={(g) => (g.to || MORE[g.title] ? <Link to={g.to || MORE[g.title]} className={LINK}>Read more ›</Link> : null)} />
      <StatusStrip read={reads.status.read} onRetry={reads.status.reload} />
    </section>
  );
}

function Matrix({ read, onRetry }) {
  const m = matrixOf(read);
  return (
    <section className={CARD} data-testid="trust-matrix">
      <h2 className={H2}>What we check, and for whom</h2>
      {m.state === 'loading' ? <Reading lines={4} /> : null}
      {m.state === 'unreadable' ? <Unread what="What we check" onRetry={onRetry} testId="trust-matrix-unreadable" /> : null}
      {m.state === 'ready' ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px] text-[#141118] dark:text-gray-100">
              <thead><tr><th className={TH}>Requirement</th>{m.profiles.map((p) => <th key={p.key} className={TH}>{p.label}</th>)}</tr></thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.key} className={ROW} data-testid={`trust-matrix-${r.key}`}>
                    <td className="py-2 pr-3 font-bold">{r.label}</td>
                    {r.cells.map((c, i) => <td key={m.profiles[i].key} className={`py-2 pr-3 ${c.asked ? 'font-semibold' : 'text-[#6b6577] dark:text-gray-400'}`} title={c.tip || undefined}>{c.text}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={MUTED}>{MATRIX_FOOT}</p>
        </>
      ) : null}
    </section>
  );
}

function Changes({ reads }) {
  const [all, setAll] = useState(null);
  const first = changesOf(reads.trust.read.data?.changes, reads.trust.read);
  const c = all ? changesOf(all.status === 'ready' ? all.data : null) : first;
  const more = async () => {
    setAll({ status: 'loading' });
    try { setAll({ status: 'ready', data: await trustPublicApi.changes(200) }); } catch { setAll({ status: 'error' }); }
  };
  return (
    <section className={CARD} data-testid="trust-changes">
      <h2 className={H2}>Changes to this page</h2>
      {first.state === 'loading' || all?.status === 'loading' ? <Reading lines={3} /> : null}
      {c.state === 'unreadable' && first.state !== 'loading' && all?.status !== 'loading'
        ? <Unread what="The change log" onRetry={all ? more : reads.trust.reload} testId="trust-changes-unreadable" /> : null}
      {c.state === 'empty' ? <div data-testid="trust-changes-empty"><p className="m-0 text-[13.5px] font-bold text-[#141118] dark:text-gray-100">{NO_CHANGES}</p><p className={MUTED}>{NO_CHANGES_SUB}</p></div> : null}
      {c.state === 'ready' && all?.status !== 'loading' ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {c.items.map((x) => (
            <li key={x.uid} className="flex items-center gap-3 border-t border-[#ececf1] py-2.5 first:border-t-0 dark:border-gray-700" data-testid="trust-change">
              {x.date ? (
                <span className="flex w-11 flex-none flex-col items-center rounded-lg border border-[#ececf1] py-1 font-mono leading-tight dark:border-gray-700" aria-label={x.day}>
                  <span className="text-[9.5px] font-bold text-[#6b6577] dark:text-gray-400">{x.date.m}</span>
                  <span className="text-[15px] font-extrabold text-[#141118] dark:text-gray-100">{x.date.d}</span>
                  <span className="text-[9.5px] text-[#6b6577] dark:text-gray-400">{x.date.y}</span>
                </span>
              ) : <span className={PILL}>{NOT_RECORDED}</span>}
              <span className="text-[13px] text-[#4a4553] dark:text-gray-200">{x.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.state === 'ready' && !all && !c.complete ? <button type="button" className={`${BTN} self-start`} onClick={more} data-testid="trust-changes-all">All changes ›</button> : null}
    </section>
  );
}

function Overview({ reads }) {
  const phone = usePhoneWidth();
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-overview">
      <Tiles reads={reads} />
      <Protect reads={reads} />
      {phone ? null : <Matrix read={reads.matrix.read} onRetry={reads.matrix.reload} />}
      <Changes reads={reads} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Security (TRU2), Data and privacy (TRU3)
 * ------------------------------------------------------------------ */

function Security({ reads }) {
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-security">
      <BlockCards block={blockOf(reads.trust.read, 'security')} what="Security" onRetry={reads.trust.reload} testId="trust-security-blocks" />
      <p className={MUTED}>These are the controls the platform runs today. Nothing here is a certification.</p>
    </div>
  );
}

function CopyButton({ text, label = 'Copy address', testId }) {
  const [state, setState] = useState(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState('Copied'); } catch { setState(`Copy ${text} by hand`); }
  };
  return (
    <span className="flex items-center gap-2">
      <button type="button" className={BTN} onClick={copy} data-testid={testId}>{label}</button>
      {state ? <span role="status" className="text-[12px] text-[#6b6577] dark:text-gray-400">{state}</span> : null}
    </span>
  );
}

function Data({ reads, signedIn }) {
  const rights = [
    ['Download your data', 'Your profile, companies, agreements and activity.'],
    ['Delete your account', 'We keep only what the law makes us keep.'],
  ];
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-data">
      <BlockCards block={blockOf(reads.trust.read, 'data')} what="Data and privacy" onRetry={reads.trust.reload} testId="trust-data-blocks" cols="lg:grid-cols-2" />
      <section className={CARD} data-testid="trust-rights">
        <h2 className={H2}>Your rights</h2>
        <p className={MUTED}>We answer within 30 days.</p>
        <ul className="m-0 flex list-none flex-col p-0">
          {rights.map(([t, s]) => (
            <li key={t} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ececf1] py-2.5 first:border-t-0 dark:border-gray-700">
              <span className="flex flex-col"><span className="text-[13.5px] font-bold text-[#141118] dark:text-gray-100">{t}</span><span className={MUTED}>{s}</span></span>
              <Link to={signedIn ? '/account' : '/login?next=%2Faccount'} className={BTN}>{signedIn ? 'Open your account' : 'Sign in to do this'}</Link>
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ececf1] py-2.5 dark:border-gray-700">
            <span className="flex flex-col"><span className="text-[13.5px] font-bold text-[#141118] dark:text-gray-100">Ask a question</span><span className={MUTED}>Write to privacy@axal.vc.</span></span>
            <CopyButton text="privacy@axal.vc" testId="trust-copy-privacy" />
          </li>
        </ul>
        <p className={MUTED}>What we collect and how long we keep it is in the <Link to="/privacy" className={LINK}>Privacy Policy</Link>.</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subprocessors (TRU4, TRU4v)
 * ------------------------------------------------------------------ */

function Subscribe() {
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const turnstile = useTurnstile(true);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (!turnstile.required || turnstile.token);
  const go = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setRefusal(null);
    try {
      await trustPublicApi.subscribe({ email: email.trim(), turnstileToken: turnstile.token, hp });
      setDone(true);
    } catch (err) {
      setRefusal(err?.message || 'The subscription could not be sent. Try again.');
      turnstile.reset();
    } finally { setBusy(false); }
  };
  return (
    <section id="subscribe" className={CARD} data-testid="trust-subscribe">
      <h2 className={H2}>Subscribe to changes</h2>
      {done ? (
        <div role="status" className="flex flex-col gap-1 rounded-lg border border-[#ddd0fb] bg-[#f4f0fe] px-3.5 py-2.5 dark:border-violet-800 dark:bg-violet-950/40" data-testid="trust-subscribe-done">
          <span className={EYE}>After you subscribe</span>
          <span className="text-[13.5px] font-bold text-[#141118] dark:text-gray-100">Check your inbox to confirm.</span>
          <span className={MUTED}>You are subscribed once you open the link we sent.</span>
        </div>
      ) : (
        <form onSubmit={go} className="flex flex-col gap-2" data-testid="trust-subscribe-form">
          <label className={EYE} htmlFor="trust-subscribe-email">Email</label>
          <input id="trust-subscribe-email" type="email" autoComplete="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="trust-subscribe-email" />
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={hp} onChange={(e) => setHp(e.target.value)} />
          <div ref={turnstile.ref} />
          <button type="submit" className={BTN_PRIMARY} disabled={!ok || busy} data-testid="trust-subscribe-go">{busy ? 'Sending…' : 'Subscribe'}</button>
          {refusal ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="trust-subscribe-refusal">{refusal}</p> : null}
        </form>
      )}
      <p className={MUTED}>We email you 10 days before a new subprocessor starts.</p>
    </section>
  );
}

function Subprocessors({ reads }) {
  const s = subprocessorsOf(reads.trust.read);
  const intro = blockOf(reads.trust.read, 'subprocessors');
  return (
    <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3" data-testid="trust-subprocessors">
      <div className="flex min-w-0 flex-col gap-[14px] lg:col-span-2">
        <p className={MUTED}>{intro.state === 'ready' && intro.intro ? intro.intro : 'Companies that process personal data for us, to run StudioOS. Connectors you switch on yourself are listed apart.'}</p>
        {s.state === 'loading' ? <section className={CARD}><Reading lines={5} /></section> : null}
        {s.state === 'unreadable' ? <section className={CARD}><Unread what="The subprocessors" onRetry={reads.trust.reload} testId="trust-subprocessors-unreadable" /></section> : null}
        {s.state === 'review' ? (
          <section className="flex flex-col gap-2 rounded-xl border border-[#ddd0fb] bg-[#f4f0fe] px-[18px] py-4 dark:border-violet-800 dark:bg-violet-950/40" data-testid="trust-subprocessors-review">
            <h2 className={H2}>Subprocessors</h2>
            <p className="m-0 text-[13.5px] font-semibold text-[#141118] dark:text-gray-100">{s.line}</p>
          </section>
        ) : null}
        {s.state === 'ready' ? (
          <section className={CARD} data-testid="trust-subprocessors-list">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] text-[#141118] dark:text-gray-100">
                <thead><tr>{['Company', 'What they do for us', 'Data they see', 'Where', 'Since'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {s.items.map((x) => (
                    <tr key={x.uid} className={ROW} data-testid="trust-subprocessor">
                      <td className="py-2 pr-3 font-bold">{x.name}</td>
                      <td className="py-2 pr-3">{x.purpose}</td>
                      <td className="py-2 pr-3">{x.data}</td>
                      <td className="py-2 pr-3">{x.location}</td>
                      <td className="py-2 pr-3 font-mono">{x.since || <span className={PILL}>{NOT_RECORDED}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={MUTED}>{s.items.length} listed{s.lastChange ? ` · last change ${s.lastChange}` : ''}.</p>
          </section>
        ) : null}
        <section className={CARD}>
          <h2 className={H2}>Connectors you choose</h2>
          <p className={MUTED}>When you connect a tool (a calendar, a CRM, a bank), that company receives what you send it. See Account › Connectors.</p>
        </section>
      </div>
      <Subscribe />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Documents (TRU5)
 * ------------------------------------------------------------------ */

function Documents({ reads }) {
  const rows = documentTable({ terms: TERMS_UPDATED, privacy: PRIVACY_UPDATED, risk: RISK_UPDATED });
  const notes = blockOf(reads.trust.read, 'documents');
  return (
    <div className="flex flex-col gap-[14px]">
      <section className={CARD} data-testid="trust-documents">
        <h2 className={H2}>Documents</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px] text-[#141118] dark:text-gray-100">
            <thead><tr>{['Document', 'Version', 'Last updated', 'Applies to', ''].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className={ROW} data-testid="trust-document-row">
                  <td className="py-2 pr-3 font-bold">{r.name}{!r.to && r.kind === 'page' ? <span className="block text-[12px] font-normal text-[#6b6577] dark:text-gray-400">Being reviewed by counsel.</span> : null}</td>
                  <td className="py-2 pr-3">{r.version ? (r.version === '—' ? '—' : <span className={PILL}>{r.version}</span>) : <span className={PILL}>{NOT_RECORDED}</span>}</td>
                  <td className="py-2 pr-3 font-mono">{r.updated || <span className={PILL}>{NOT_RECORDED}</span>}</td>
                  <td className="py-2 pr-3">{r.appliesTo}</td>
                  <td className="py-2 pr-3">
                    {r.kind === 'page' && r.to ? <Link to={r.to} className={LINK}>Read</Link> : null}
                    {r.kind === 'cookies' ? <button type="button" className={LINK} onClick={openCookiePreferences}>Open</button> : null}
                    {r.kind === 'file' ? <a href={r.to} className={LINK}>Open</a> : null}
                    {r.kind === 'page' && !r.to ? '—' : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={MUTED}>Read opens the legal page. Cookie preferences opens the cookie dialog. A version nobody recorded says so.</p>
      </section>
      {notes.state === 'ready' && notes.groups.length ? <BlockCards block={notes} what="Documents" testId="trust-documents-notes" cols="lg:grid-cols-2" /> : null}
      {notes.state === 'unreadable' ? <section className={CARD}><Unread what="The documents notes" onRetry={reads.trust.reload} testId="trust-documents-unreadable" /></section> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Disclosure (TRU6, TRU6d)
 * ------------------------------------------------------------------ */

function ReportDialog({ onClose }) {
  const [affected, setAffected] = useState('');
  const [what, setWhat] = useState('');
  const [how, setHow] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const L = REPORT_DIALOG.limits;
  const ok = Boolean(affected.trim() && affected.trim().length <= L.affected && what.trim() && what.length <= L.what && how.length <= L.how);
  const send = async () => {
    if (!ok || busy) return;
    setBusy(true); setRefusal(null);
    try {
      await securityReportsApi.send({ affected: affected.trim(), what_happened: what.trim(), ...(how.trim() ? { how_to_reproduce: how.trim() } : {}) });
      setDone(true);
    } catch (err) {
      setRefusal(err?.message || 'The report could not be sent. Try again, or use the advisory or email.');
    } finally { setBusy(false); }
  };
  return (
    <Lightbox label={REPORT_DIALOG.title} title={REPORT_DIALOG.title} sub={REPORT_DIALOG.line} onClose={onClose} width={560} testId="trust-report-dialog"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {done ? null : <button type="button" className={BTN_PRIMARY} onClick={send} disabled={!ok || busy} data-testid="trust-report-send">{busy ? 'Sending…' : 'Send privately'}</button>}
        </div>
      )}>
      {done ? <p role="status" className="m-0 text-[13.5px] font-semibold" data-testid="trust-report-done">{REPORT_DIALOG.done}</p> : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1"><span className={EYE}>What is affected</span>
            <input className={INPUT} value={affected} maxLength={L.affected} onChange={(e) => setAffected(e.target.value)} placeholder="A page or a feature" data-testid="trust-report-affected" /></label>
          <label className="flex flex-col gap-1"><span className={EYE}>What happened</span>
            <textarea className={`${INPUT} min-h-[90px] py-2`} value={what} maxLength={L.what} onChange={(e) => setWhat(e.target.value)} placeholder="Describe it…" data-testid="trust-report-what" /></label>
          <label className="flex flex-col gap-1"><span className={EYE}>How to reproduce (optional)</span>
            <textarea className={`${INPUT} min-h-[90px] py-2`} value={how} maxLength={L.how} onChange={(e) => setHow(e.target.value)} placeholder="The steps, in order…" data-testid="trust-report-how" /></label>
          {refusal ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="trust-report-refusal">{refusal}</p> : null}
        </div>
      )}
    </Lightbox>
  );
}

function Disclosure({ reads, signedIn }) {
  const [dialog, setDialog] = useState(false);
  const gaps = blockOf(reads.trust.read, 'disclosure');
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-disclosure">
      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3">
        {REPORT_WAYS.map((w) => (
          <section key={w.key} className={CARD} data-testid={`trust-report-${w.key}`}>
            <span className={EYE}>{w.eye}</span>
            <h2 className={H2}>{w.title}</h2>
            <p className={MUTED}>{w.note}</p>
            {w.href ? <a href={w.href} target="_blank" rel="noopener noreferrer" className={BTN}>{w.action}</a> : null}
            {w.copy ? <CopyButton text={w.copy} testId="trust-copy-security" /> : null}
            {w.key === 'app' ? (signedIn
              ? <button type="button" className={BTN} onClick={() => setDialog(true)} data-testid="trust-report-open">{w.action}</button>
              : <Link to="/login?next=%2Ftrust%2Fdisclosure" className={BTN} data-testid="trust-report-signin">Sign in to report</Link>) : null}
          </section>
        ))}
      </div>
      <section className={CARD}>
        <h2 className={H2}>How fast we answer</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px] text-[#141118] dark:text-gray-100">
            <thead><tr>{['Severity', 'We acknowledge', 'Updates', 'Fix target'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
            <tbody>{RESPONSE_TIMES.map((r) => <tr key={r[0]} className={ROW}>{r.map((c, i) => <td key={c} className={`py-2 pr-3 ${i === 0 ? 'font-bold' : ''}`}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <section className={CARD}>
          <h2 className={H2}>Safe harbour</h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-[#4a4553] dark:text-gray-200">{SAFE_HARBOUR.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section className={CARD}>
          <h2 className={H2}>Coordinated disclosure</h2>
          <p className={MUTED}>90 days from our acknowledgement.</p>
        </section>
      </div>
      <BlockCards block={gaps} what="Disclosure" onRetry={reads.trust.reload} testId="trust-disclosure-blocks" cols="lg:grid-cols-2" />
      {dialog ? <ReportDialog onClose={() => setDialog(false)} /> : null}
    </div>
  );
}

const BODIES = { overview: Overview, security: Security, data: Data, subprocessors: Subprocessors, documents: Documents, disclosure: Disclosure };

function Frame({ inShell, children }) {
  if (inShell) return <div className="min-h-full bg-[#f8f7fb] dark:bg-gray-950">{children}</div>;
  return (
    <SitePage title="Trust center" description="How Axal VC protects your data and your money: facts we can show, and what we cannot show yet." signup={false}>
      {children}
    </SitePage>
  );
}

export default function TrustCenter({ inShell = false }) {
  const { pathname } = useLocation();
  const { user } = useAuth() || {};
  const phone = usePhoneWidth();
  const tab = tabOf(pathname);
  const Body = BODIES[tab];
  const reads = useTrustReads();
  const reviewed = lastReviewed(reads.trust.read);
  return (
    <Frame inShell={inShell}>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-[30px]" data-testid="trust-center" data-frame={inShell ? 'shell' : 'site'}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={EYE}>Trust center</span>
            <h1 className={`m-0 font-extrabold tracking-[-.02em] text-[#141118] dark:text-gray-100 ${phone ? 'text-[22px]' : 'text-[28px]'}`}>{TITLE}</h1>
            <p className={MUTED}>{LINE}</p>
          </div>
          {phone ? null : (
            <div className="flex flex-wrap items-center gap-2.5">
              {reviewed ? <span className="font-mono text-[12px] text-[#6b6577] dark:text-gray-400" data-testid="trust-reviewed">{reviewed}</span> : null}
              <Link to="/trust/subprocessors#subscribe" className={BTN} data-testid="trust-subscribe-link">Subscribe to changes</Link>
            </div>
          )}
        </header>
        <nav aria-label="Trust center" className="flex gap-1 overflow-x-auto border-b border-[#ececf1] dark:border-gray-700" data-testid="trust-tabs">
          {TABS.map((t) => (
            <Link key={t.id} to={t.path} aria-current={t.id === tab ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] ${t.id === tab ? 'border-[#6d28d9] font-extrabold text-[#141118] dark:text-gray-100' : 'border-transparent font-semibold text-[#6b6577] hover:text-[#141118] dark:text-gray-400 dark:hover:text-gray-100'}`}
              data-testid={`trust-tab-${t.id}`}>
              {t.label}
            </Link>
          ))}
          {user && (
            <Link to={YOUR_TRUST.path} className="ml-auto whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] font-semibold text-[#6d28d9] hover:text-[#5b21b6] dark:text-violet-300" data-testid="trust-tab-me">
              {YOUR_TRUST.label}
            </Link>
          )}
        </nav>
        <Body reads={reads} signedIn={Boolean(user)} />
      </div>
    </Frame>
  );
}
