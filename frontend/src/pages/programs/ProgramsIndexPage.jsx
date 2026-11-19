import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown } from 'lucide-react';
import SitePage from '../../components/site/SitePage';
import NetworkSubNav from '../../components/site/NetworkSubNav';
import { spinoutLab } from '../../lib/api';
import { reportError } from '../../lib/log';
import { dateInZone } from '../../lib/zoneTime';
import { AvailabilityLabel } from '../../programs/kit';
import { PROGRAMS } from '../../programs/registry';
import '../../programs/programs.css';

/**
 * `/programs` — the public Programs index (D6966, #6966; board PGS08A, PGS08B), reached by
 * "See all programs →" on /events. Signed out. One card per program in the presentation map
 * (`programs/catalog/`): its group, name, availability in words, purpose and audience, and its
 * presentation and PDF. Only a program with a map entry is listed: the canvas's two labelled
 * example cards (an invitation-only and a proposed program) are not published as programs; each
 * appears when its own presentation lands (#6967–#6975).
 *
 * The Spin-Out Lab card adds one live line from the public `GET /api/spinout-lab/brief`, the read
 * its presentation's panel makes; a failed read says Unavailable and never "closed".
 */

export const INDEX_TITLE = 'Programs';
export const INDEX_LEDE = 'What Axal VC runs, who each programme is for and how to take part. Each one opens its own presentation, with a PDF you can download.';
export const INDEX_FOOT = 'A programme appears here once its presentation and PDF are approved. Taking part, grants and pricing do not change with what is shown here.';

/** The Lab card's live line, from the read (pure, for the tests). */
export function labLine(read) {
  if (read.status === 'loading') return { kind: 'loading', text: 'Reading the cohort dates…' };
  if (read.status === 'error') return { kind: 'unavailable', text: 'Unavailable. We could not load the cohort dates.' };
  const d = read.data || {};
  if (d.applications_open !== true) return { kind: 'closed', text: 'Applications are closed. The next cohort date is not set yet.' };
  const by = dateInZone(d.cohort?.close_at, d.zone);
  const name = d.cohort?.name;
  return { kind: 'open', text: ['Applications open', name, by ? `apply by ${by}` : null].filter(Boolean).join(' · ') };
}

function LabLine() {
  const [read, setRead] = useState({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    spinoutLab.brief()
      .then((data) => { if (alive) setRead({ status: 'ok', data }); })
      .catch((e) => { if (alive) setRead({ status: 'error' }); reportError('ProgramsIndexPage:lab', e); });
    return () => { alive = false; };
  }, []);
  const line = labLine(read);
  return <p className="pgs-ic-live" data-testid="programs-index-lab-line" data-state={line.kind}>{line.text}</p>;
}

export function ProgramCard({ p }) {
  return (
    <li>
      <article className="pgs-ic" aria-labelledby={`pgs-ic-${p.key}`} data-testid={`programs-index-card-${p.key}`}>
        <div className="pgs-ic-g"><span>{p.group}</span></div>
        <h2 id={`pgs-ic-${p.key}`}>{p.name}</h2>
        <div><AvailabilityLabel avail={p.avail} text={p.availText} /></div>
        <p>{p.purpose}</p>
        <p className="pgs-ic-who"><b>For</b> {p.card.who}</p>
        {p.key === 'spinout-lab' ? <LabLine /> : (p.card.line ? <p className="pgs-ic-live">{p.card.line}</p> : null)}
        <div className="pgs-ic-a">
          <Link to={p.canonical} className="pgs-ic-view" aria-label={`View presentation: ${p.name}`} data-testid={`programs-index-view-${p.key}`}>View presentation →</Link>
          <a href={p.pdf} download={p.file} className="pgs-ic-pdf" aria-label={`Download PDF: ${p.name}`} data-testid={`programs-index-pdf-${p.key}`}>
            <FileDown aria-hidden="true" />PDF
          </a>
        </div>
      </article>
    </li>
  );
}

export default function ProgramsIndexPage() {
  return (
    <SitePage title={INDEX_TITLE} signup={false} className="pgs-page">
      <NetworkSubNav />
      <section aria-labelledby="pgs-idx-h" data-testid="programs-index">
        <div className="ax-wrap pgs-idx-in">
          <div className="ax-lbl">Network · Programs &amp; Events</div>
          <h1 className="pgs-idx-h" id="pgs-idx-h">{INDEX_TITLE}</h1>
          <p className="pgs-lead">{INDEX_LEDE}</p>
          <ul className="pgs-idx">
            {PROGRAMS.map((p) => <ProgramCard key={p.key} p={p} />)}
          </ul>
          <p className="pgs-idx-foot">{INDEX_FOOT}</p>
        </div>
      </section>
    </SitePage>
  );
}
