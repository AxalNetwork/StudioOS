/**
 * D3701 (Research v2, #3701) part 2 — the RS-01 Overview cards below the
 * question: Continue where you left off, Recent research projects, Saved
 * briefs, Recently added evidence and Tracking.
 *
 * Each card reads on its own and fails on its own: one unreadable read greys
 * that card with "Could not be read" and a Retry for it alone, and never
 * reads as an empty list. What no store holds (briefs) says Not recorded
 * with the reason. Recent research projects reads the Research Project store
 * (D5157). The readings live in `researchHome.js`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Pill } from '../../ui';
import { api } from '../../lib/api';
import { researchProjectsApi } from '../../lib/api/researchProjects.js';
import {
  briefsCard, continueCard, evidenceCard, projectsCard, shortDate, trackingCard,
} from './researchHome.js';

/** One read with its own status and its own retry. */
function useRead(fetcher) {
  const [read, setRead] = useState({ status: 'loading', value: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', value: null });
    fetcher().then(
      (value) => { if (live) setRead({ status: 'ok', value }); },
      () => { if (live) setRead({ status: 'failed', value: null }); },
    );
    return () => { live = false; };
    // `fetcher` is a stable module-level function; `attempt` is the retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [read, retry];
}

const readAsks = () => api.research.askSessions('all');
const readLibrary = () => api.research.documents();
const readFunds = () => api.research.funds();
const readProjects = () => researchProjectsApi.list('active');

const mark = (s) => <><span aria-hidden="true">{s.glyph}</span> {s.label}</>;

function Card({ title, action, testid, children }) {
  return (
    <section className="a7-card rh-card" data-testid={testid}>
      <div className="a7-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

/** The shared non-ok bodies: loading, unreadable with Retry, Not recorded with its reason. */
function Fallback({ card, what, onRetry, testid }) {
  if (card.state === 'loading') return <p className="rh-muted" data-testid={`${testid}-loading`}>Reading…</p>;
  if (card.state === 'unreadable') {
    return (
      <div className="rh-unreadable" role="status" data-testid={`${testid}-unreadable`}>
        <strong>Could not be read</strong>
        <p>{what} could not be read just now. That is not the same as having none.</p>
        <button type="button" onClick={onRetry} data-testid={`${testid}-retry`}>Retry</button>
      </div>
    );
  }
  if (card.state === 'not_recorded') {
    return (
      <div className="rh-nr" data-testid={`${testid}-not-recorded`}>
        <strong>Not recorded</strong>
        <p>{card.reason}</p>
      </div>
    );
  }
  return null;
}

export default function ResearchHome() {
  const [asks, retryAsks] = useRead(readAsks);
  const [library, retryLibrary] = useRead(readLibrary);
  const [funds, retryFunds] = useRead(readFunds);
  const [projectsRead, retryProjects] = useRead(readProjects);

  const cont = continueCard(asks);
  const evidence = evidenceCard(library);
  const tracking = trackingCard(funds);
  const projects = projectsCard(projectsRead);
  const briefs = briefsCard();

  return (
    <div className="rh" data-testid="research-home">
      <section className="a7-card rh-continue" data-testid="rh-continue">
        <span className="rh-eyebrow">Continue where you left off</span>
        {cont.state === 'ok' && cont.last ? (
          <div className="rh-continue-row">
            <div>
              <strong data-testid="rh-continue-question">{cont.last.question}</strong>
              <p className="rh-muted">Last: you asked this in Ask · {shortDate(cont.last.at)}{cont.last.answered ? '' : ' · not answered'}</p>
            </div>
            <Link className="rh-primary" to="/research/ask" data-testid="rh-continue-link">Continue</Link>
          </div>
        ) : cont.state === 'ok' ? (
          <p className="rh-muted" data-testid="rh-continue-empty">Nothing to continue yet. Your questions in Ask appear here.</p>
        ) : <Fallback card={cont} what="Your Ask history" onRetry={retryAsks} testid="rh-continue" />}
      </section>

      <Card title="Recent research projects" testid="rh-projects"
        action={<Link className="a7-link" to="/research/projects" data-testid="rh-projects-link">My Research <ArrowUpRight size={13} /></Link>}>
        {projects.state === 'ok' ? (
          projects.cards.length ? (
            <ul className="rh-list">
              {projects.cards.map((p) => (
                <li key={p.uid} data-testid={`rh-project-${p.uid}`}>
                  <div>
                    <strong>{p.title}</strong>
                    <span className="rh-muted">{p.evidence} · Updated {shortDate(p.updated)}</span>
                  </div>
                  <span className="rh-pills">
                    <Pill tone={p.status.tone} className="!text-[10px]">{p.status.label}</Pill>
                    <Link className="a7-link" to={p.to}>Continue</Link>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="rh-muted" data-testid="rh-projects-empty">No research yet. Start with a question; a project keeps your evidence and findings together.</p>
        ) : <Fallback card={projects} what="Your research projects" onRetry={retryProjects} testid="rh-projects" />}
      </Card>

      <div className="rh-pair">
        <Card title="Saved briefs" testid="rh-briefs">
          <Fallback card={briefs} testid="rh-briefs" />
          <Link className="a7-link" to="/research/ask">Saved answers in Ask <ArrowUpRight size={13} /></Link>
        </Card>
        <Card title="Recently added evidence" testid="rh-evidence"
          action={<Link className="a7-link" to="/research/library">Library <ArrowUpRight size={13} /></Link>}>
          {evidence.state === 'ok' ? (
            evidence.rows.length ? (
              <ul className="rh-list">
                {evidence.rows.map((r) => (
                  <li key={r.uid} data-testid={`rh-evidence-${r.uid}`}>
                    <div>
                      <strong>{r.title}</strong>
                      <span className="rh-muted">Added {shortDate(r.at)}</span>
                    </div>
                    <span className="rh-pills">
                      <Pill tone={r.index.tone} className="!text-[10px]">{mark(r.index)}</Pill>
                      <Pill tone={r.answer.tone} className="!text-[10px]">{mark(r.answer)}</Pill>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="rh-muted" data-testid="rh-evidence-empty">Your evidence library is empty. Add a document and Ask can cite it.</p>
          ) : <Fallback card={evidence} what="Your library" onRetry={retryLibrary} testid="rh-evidence" />}
        </Card>
      </div>

      <Card title="Tracking" testid="rh-tracking" action={<span>Saved by you</span>}>
        {tracking.state === 'ok' ? (
          <>
            {tracking.chips.length ? (
              <div className="rh-chips">
                {tracking.chips.map((c) => <Link key={c.key} to={c.to} className="rh-chip">{c.label}</Link>)}
              </div>
            ) : <p className="rh-muted" data-testid="rh-tracking-empty">No fund is on your list yet.</p>}
            <p className="rh-muted rh-note">{tracking.other}</p>
          </>
        ) : <Fallback card={tracking} what="Your fund list" onRetry={retryFunds} testid="rh-tracking" />}
      </Card>
    </div>
  );
}
