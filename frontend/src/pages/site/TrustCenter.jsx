import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { request } from '../../lib/api';
import { overallStatus } from '../../lib/statusOverall';
import { useAuth } from '../../hooks/useAuthSync';
import { TERMS_UPDATED } from '../TermsPage';
import { PRIVACY_UPDATED } from '../PrivacyPage';
import { RISK_UPDATED } from '../RiskDisclosuresPage';
import {
  CHECKED_WAIT, DATA, DISCLOSURE_GAPS, LINE, NOT_RECORDED, RESPONSE_TIMES, SECURITY, SUBPROCESSORS_WAIT, TABS, TITLE, YOUR_TRUST,
  documentRows, statusLine, tabOf,
} from './trustCenterModel';

/**
 * D1072 (#2425) — the public trust center at `/trust` and its tabs, in the
 * public site frame, for anyone, signed in or not. A signed-in member also
 * sees "Your trust", which is today's member page at `/trust/me`. Every fact
 * is one the code shows; anything else says Not recorded (`trustCenterModel.js`).
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-[#ececf1] bg-white px-[18px] py-4';
const H2 = 'm-0 text-[16px] font-extrabold tracking-[-.015em] text-[#141118]';
const MUTED = 'm-0 text-[13px] text-[#6b6577]';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-[#6b6577]';
const LINK = 'font-semibold text-[#6d28d9] hover:text-[#5b21b6]';

function Fact({ f }) {
  return f.recorded
    ? <li className="text-[13px] text-[#4a4553]">{f.text} <span className="text-[11.5px] text-[#6b6577]">· {CHECKED_WAIT}</span></li>
    : <li className="flex flex-wrap items-center gap-2 text-[13px] text-[#4a4553]">{f.text} <span className={PILL}>{NOT_RECORDED}</span> <span className="text-[12px] text-[#6b6577]">{f.why}</span></li>;
}

function StatusTile() {
  const [state, setState] = useState({ status: 'loading', overall: null });
  useEffect(() => {
    let alive = true;
    request('/public/status')
      .then((res) => { if (alive) setState({ status: 'ready', overall: overallStatus(res?.services) }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', overall: null }); });
    return () => { alive = false; };
  }, []);
  return (
    <section className={CARD} data-testid="trust-status">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577]">Status</span>
      <p className="m-0 text-[15px] font-bold text-[#141118]">
        {state.status === 'loading' ? 'Reading…' : state.status === 'unreadable' ? 'Status could not be read.' : statusLine(state.overall)}
      </p>
      <Link to="/status" className={LINK}>Status page</Link>
    </section>
  );
}

function Overview() {
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-overview">
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile />
        <section className={CARD} data-testid="trust-certifications">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577]">Certifications</span>
          <p className="m-0 text-[15px] font-bold text-[#141118]">None held</p>
          <p className={MUTED}>We list a certification here only after an auditor issues it.</p>
        </section>
        <section className={CARD}>
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577]">Security contact</span>
          <p className="m-0 font-mono text-[14px] text-[#141118]">security@axal.vc</p>
          <p className={MUTED}>Critical reports acknowledged within 4 business hours.</p>
        </section>
        <section className={CARD} data-testid="trust-subprocessors-tile">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577]">Subprocessors</span>
          <span className={PILL}>{NOT_RECORDED}</span>
          <p className={MUTED}>The list is being reviewed by counsel.</p>
        </section>
      </div>
      <section className={CARD} data-testid="trust-matrix">
        <h2 className={H2}>What we check, and for whom</h2>
        <span className={PILL}>{NOT_RECORDED}</span>
        <p className={MUTED}>The checks each profile is asked for are read only by signed-in members today. Publishing them here is part 3.</p>
      </section>
      <section className={CARD} data-testid="trust-changes">
        <h2 className={H2}>Changes to this page</h2>
        <p className={MUTED}>No changes published yet.</p>
      </section>
    </div>
  );
}

function Security() {
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-security">
      {SECURITY.map((s) => (
        <section key={s.title} className={CARD}>
          <h2 className={H2}>{s.title}</h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{s.facts.map((f) => <Fact key={f.text} f={f} />)}</ul>
        </section>
      ))}
      <p className={MUTED}>These are the controls the platform runs today. Nothing here is a certification.</p>
    </div>
  );
}

function Data() {
  return (
    <section className={CARD} data-testid="trust-data">
      <h2 className={H2}>Who holds your data, and what you can do</h2>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{DATA.map((f) => <Fact key={f.text} f={f} />)}</ul>
      <p className={MUTED}>What we collect and how long we keep it, per kind of record, is part 3. Until then read the <Link to="/privacy" className={LINK}>Privacy Policy</Link>.</p>
    </section>
  );
}

function Subprocessors() {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[#ddd0fb] bg-[#f4f0fe] px-[18px] py-4" data-testid="trust-subprocessors">
      <h2 className={H2}>Subprocessors</h2>
      <p className="m-0 text-[13px] text-[#141118]">{SUBPROCESSORS_WAIT}</p>
    </section>
  );
}

function Documents() {
  const rows = documentRows({ terms: TERMS_UPDATED, privacy: PRIVACY_UPDATED, risk: RISK_UPDATED });
  return (
    <section className={CARD} data-testid="trust-documents">
      <h2 className={H2}>Documents</h2>
      <table className="w-full text-left text-[13px]">
        <thead><tr className="text-[10.5px] uppercase tracking-[.07em] text-[#6b6577]"><th className="py-2">Document</th><th>Version</th><th>Last updated</th><th>Applies to</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[#ececf1]" data-testid="trust-document-row">
              <td className="py-2">{r.to ? <Link to={r.to} className={LINK}>{r.name}</Link> : r.name}</td>
              <td><span className={PILL}>{NOT_RECORDED}</span></td>
              <td className="font-mono">{r.updated || NOT_RECORDED}</td>
              <td>{r.appliesTo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Disclosure() {
  return (
    <div className="flex flex-col gap-[14px]" data-testid="trust-disclosure">
      <section className={CARD}>
        <h2 className={H2}>Report a vulnerability</h2>
        <p className={MUTED}>Privately, through a security advisory on our code host, or by email to security@axal.vc.</p>
      </section>
      <section className={CARD}>
        <h2 className={H2}>How fast we answer</h2>
        <table className="w-full text-left text-[13px]">
          <thead><tr className="text-[10.5px] uppercase tracking-[.07em] text-[#6b6577]"><th className="py-2">Severity</th><th>We acknowledge</th><th>Updates</th><th>Fix target</th></tr></thead>
          <tbody>{RESPONSE_TIMES.map((r) => <tr key={r[0]} className="border-t border-[#ececf1]">{r.map((c) => <td key={c} className="py-2">{c}</td>)}</tr>)}</tbody>
        </table>
        <p className={MUTED}>Coordinated disclosure: 90 days from our acknowledgement. We will not take legal action against good-faith research.</p>
      </section>
      <section className={CARD}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{DISCLOSURE_GAPS.map((f) => <Fact key={f.text} f={f} />)}</ul>
      </section>
    </div>
  );
}

const BODIES = { overview: Overview, security: Security, data: Data, subprocessors: Subprocessors, documents: Documents, disclosure: Disclosure };

export default function TrustCenter() {
  const { pathname } = useLocation();
  const { user } = useAuth() || {};
  const tab = tabOf(pathname);
  const Body = BODIES[tab];
  return (
    <SitePage title="Trust center" description="How Axal VC protects your data and your money: facts we can show, and what we cannot show yet." signup={false}>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-[30px]" data-testid="trust-center">
        <header className="flex flex-col gap-1">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#6b6577]">Trust center</span>
          <h1 className="m-0 text-[28px] font-extrabold tracking-[-.02em] text-[#141118]">{TITLE}</h1>
          <p className={MUTED}>{LINE}</p>
        </header>
        <nav aria-label="Trust center" className="flex gap-1 overflow-x-auto border-b border-[#ececf1]" data-testid="trust-tabs">
          {TABS.map((t) => (
            <Link key={t.id} to={t.path} aria-current={t.id === tab ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] ${t.id === tab ? 'border-[#6d28d9] font-extrabold text-[#141118]' : 'border-transparent font-semibold text-[#6b6577] hover:text-[#141118]'}`}
              data-testid={`trust-tab-${t.id}`}>
              {t.label}
            </Link>
          ))}
          {user && (
            <Link to={YOUR_TRUST.path} className="ml-auto whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] font-semibold text-[#6d28d9] hover:text-[#5b21b6]" data-testid="trust-tab-me">
              {YOUR_TRUST.label}
            </Link>
          )}
        </nav>
        <Body />
      </div>
    </SitePage>
  );
}
