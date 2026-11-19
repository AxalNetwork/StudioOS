import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { Unreadable } from '../../ui/Honesty';
import { usePageMeta } from '../../lib/seo';
import { ProgramPanel, ProgramPresentation } from '../../programs/kit';
import { loadContent, programFor } from '../../programs/registry';
import '../../programs/programs.css';

/**
 * `/programs/:key` — a program's shareable address (D6966, #6966; PGS08D). Signed out.
 *
 *   - A key in the presentation map whose canonical page is elsewhere (Spin-Out Lab's
 *     `/spinout-lab/brief`) resolves there, keeping the query and the hash.
 *   - A key whose canonical page is this address draws its presentation from
 *     `programs/content/<key>.js`, with the fixed availability panel the content declares.
 *   - Any other key gets the missing-programme page: no list of unpublished keys, no admin
 *     link, and `noindex`. The SPA answers 200 for it; a Worker 404 is #6965's optional rule.
 */

export const MISSING_TITLE = 'Programme not found';

export function ProgramMissing() {
  usePageMeta({ title: MISSING_TITLE, robots: 'noindex' });
  return (
    <SitePage title={MISSING_TITLE} signup={false} className="pgs-page">
      <div className="ax-wrap pgs-miss-in" data-testid="programs-missing">
        <div className="ax-lbl-q">Programs</div>
        <h1 className="pgs-idx-h">We could not find that programme.</h1>
        <p className="pgs-lead">The link may be out of date, or the programme’s presentation is not published.</p>
        <div className="pgs-miss-act">
          <Link to="/programs" className="ax-btn ax-btn-md ax-btn-primary" data-testid="programs-missing-index">See all programs →</Link>
          <Link to="/events" className="ax-link">Programs &amp; Events</Link>
        </div>
      </div>
    </SitePage>
  );
}

/** A program's fixed availability panel (no live read): one statement, and at most one action. */
export function FixedPanel({ program, panel }) {
  const action = panel?.action
    ? <Link to={panel.action.to} className="ax-btn ax-btn-lg ax-btn-bright" data-testid={`program-panel-action-${panel.action.id || 'primary'}`}>{panel.action.label}</Link>
    : null;
  return (
    <ProgramPanel program={program} action={action}>
      {panel?.text ? <p className="pgs-coh-msg">{panel.text}</p> : null}
      {panel?.note ? <p className="pgs-panel-fine pgs-panel-note">{panel.note}</p> : null}
    </ProgramPanel>
  );
}

function Presentation({ program }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadContent(program.key)
      .then((content) => { if (alive) setRead(content ? { status: 'ok', content } : { status: 'error' }); })
      .catch(() => { if (alive) setRead({ status: 'error' }); });
    return () => { alive = false; };
  }, [program.key, attempt]);
  if (read.status === 'ok') {
    return <ProgramPresentation program={program} content={read.content} panel={<FixedPanel program={program} panel={read.content.panel} />} />;
  }
  return (
    <SitePage title={program.og.title} description={program.og.description} signup={false} className="pgs-page">
      <div className="ax-wrap pgs-miss-in" aria-busy={read.status === 'loading'}>
        <h1 className="pgs-idx-h">{program.name}</h1>
        {read.status === 'error'
          ? <Unreadable what="This presentation" claim="The programme is not withdrawn." onRetry={() => { setRead({ status: 'loading' }); setAttempt((a) => a + 1); }} size="block" />
          : <p className="pgs-lead">Loading the presentation…</p>}
      </div>
    </SitePage>
  );
}

/** What `/programs/<key>` does: `missing`, `redirect` to the canonical page (query and hash kept), or `page`. Pure, for the tests. */
export function resolveKey(key, search = '', hash = '') {
  const program = programFor(key);
  if (!program) return { kind: 'missing' };
  if (program.canonical !== program.alias) return { kind: 'redirect', to: `${program.canonical}${search}${hash}`, program };
  return { kind: 'page', program };
}

export default function ProgramKeyPage() {
  const { key } = useParams();
  const loc = useLocation();
  const r = resolveKey(key, loc.search, loc.hash);
  if (r.kind === 'missing') return <ProgramMissing />;
  if (r.kind === 'redirect') return <Navigate to={r.to} replace />;
  return <Presentation program={r.program} />;
}
