import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import {
  WELLNESS_PRESENTATION, AVAILABILITY, PROGRAMS_INDEX, EYEBROW, PURPOSE, AUDIENCE,
  panelCopy, PANEL_FINE, downloadState, SECTIONS, WHO, WHO_ALT, FLOW, PLAN, FLOW_ALT,
  BOUNDARY, STAGES, NOW, LATER, LATER_FOOT, CHOICE, TERMS, LIMITS, HEADINGS, NEXT,
} from './wellnessPresentation';
import './wellnessPresentation.css';

/**
 * `/programs/wellness` — the public Wellness presentation (D7121, #7121;
 * D7121 part 1), built to boards PGW01 (1440), PGW02A/B (the panel's two
 * states) and PGW03 (390) of `design/incoming/Program Wellness Presentation
 * Page.dc.html`. Signed out, in the public site's frame (`SitePage`, light
 * only). It reads nothing live: every word is in `wellnessPresentation.js`.
 * The private workspace stays at `/wellbeing`, reached only through sign-in.
 *
 * `entry` is the map entry; a test passes another to draw the other panel
 * state or a published PDF.
 */

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" />
  </svg>
);
const PrintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
  </svg>
);

/** The drawn dawn line: static, decorative. */
function Dawn({ width, className = '' }) {
  return (
    <svg className={`pgw-dawn ${className}`.trim()} viewBox="0 0 200 84" width={width} height={Math.round(width * 0.42)} fill="none" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M8 70h184" stroke="currentColor" strokeWidth="1.4" />
      <path d="M68 70a32 32 0 0 1 64 0" stroke="currentColor" strokeWidth="1.6" />
      <path d="M100 26v-12M70 38l-8-8M130 38l8-8M52 58H40M148 58h12" stroke="currentColor" strokeWidth="1.2" opacity=".7" />
      <path d="M36 78h36M128 78h36" stroke="currentColor" strokeWidth="1" opacity=".5" />
    </svg>
  );
}

function Availability({ k, large = false }) {
  const a = AVAILABILITY[k] || AVAILABILITY.proposed;
  return (
    <span className={`pgs-av is-${k}${large ? ' is-lg' : ''}`} data-testid="wellness-availability">
      <i aria-hidden="true">{a.glyph}</i>{a.label}
    </span>
  );
}

/** Download PDF: ink, never violet; a link only to a committed file. */
function DownloadPdf({ entry, dark = false }) {
  const d = downloadState(entry);
  const cls = `pgs-dl${dark ? ' is-dk' : ''}`;
  if (!d.published) {
    return (
      <span className={`${cls} is-off`} aria-disabled="true" data-testid="wellness-pdf-off">
        <FileIcon />
        <span className="pgs-dl-t"><b>{d.label}</b><small>{d.note}</small></span>
      </span>
    );
  }
  return (
    <a className={cls} href={d.href} download={d.filename} type="application/pdf" data-testid="wellness-pdf">
      <FileIcon />
      <span className="pgs-dl-t"><b>{d.label}</b><small>{d.note}</small></span>
    </a>
  );
}

function Panel({ entry }) {
  const copy = panelCopy(entry.availability);
  return (
    <div className="pgs-panel" role="region" aria-label="Availability" data-testid="wellness-panel" data-state={entry.availability}>
      <div className="pgs-panel-h"><span className="pgs-panel-k">Availability</span><Availability k={entry.availability} /></div>
      <div className="pgw-pan">
        <Dawn width={150} className="is-pan" />
        <p className="pgw-pan-lead"><b>{copy.lead}</b></p>
        <ul className="pgw-pan-l">{copy.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
      <div className="pgs-panel-act">
        <a className="pgw-open" href={entry.openHref} data-testid="wellness-open">Open Wellbeing →</a>
        <p className="pgs-panel-fine">{PANEL_FINE}</p>
      </div>
    </div>
  );
}

function Section({ n, band = false, children }) {
  const s = SECTIONS[n - 1];
  const [title, lead] = HEADINGS[s.id];
  return (
    <section id={s.id} className={`pgs-sec${band ? ' is-band' : ''}`} aria-labelledby={`pgw-s${n}`}>
      <div className="pgw-wrap pgs-sec-in">
        <div className="pgs-sec-k"><span className="pgs-sec-n" aria-hidden="true">{n}</span>{s.title}</div>
        <h2 className="pgs-sec-h" id={`pgw-s${n}`}>{title}</h2>
        {lead && <p className="pgs-lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

export default function WellnessPresentationPage({ entry = WELLNESS_PRESENTATION }) {
  const print = () => { if (typeof window !== 'undefined' && window.print) window.print(); };
  return (
    <SitePage title="Wellness · Programs" description={PURPOSE} signup={false} className="pgw-page">
      <section className="pgs-hero" aria-labelledby="pgw-h1">
        <div className="pgw-wrap pgs-hero-in">
          <div>
            <Link to={PROGRAMS_INDEX.to} className="pgs-crumb">‹ {PROGRAMS_INDEX.label}</Link>
            <div className="pgs-hero-av"><Availability k={entry.availability} large /><span className="pgs-hero-eb">{EYEBROW}</span></div>
            <h1 className="pgs-h1" id="pgw-h1">{entry.name}</h1>
            <p className="pgs-purpose">{PURPOSE}</p>
            <p className="pgs-aud"><b>Who it is for</b>{AUDIENCE}</p>
            <div className="pgs-hero-dl">
              <DownloadPdf entry={entry} />
              <button type="button" className="pgs-print" onClick={print}><PrintIcon />Print this page</button>
            </div>
          </div>
          <div><Panel entry={entry} /></div>
        </div>
      </section>

      <nav className="pgs-toc" aria-label="On this page">
        <div className="pgw-wrap">
          <ol>
            <li className="pgs-toc-k">On this page</li>
            {SECTIONS.map((s, i) => <li key={s.id}><a href={`#${s.id}`}><b>{i + 1}</b>{s.title}</a></li>)}
          </ol>
        </div>
      </nav>

      <Section n={1}>
        <div className="pgs-cols" role="list" aria-label={WHO_ALT}>
          {WHO.map(([h, p], i) => (
            <div className="pgs-card" role="listitem" key={h}><span className="pgs-card-n">0{i + 1}</span><h3>{h}</h3><p>{p}</p></div>
          ))}
        </div>
      </Section>

      <Section n={2} band>
        <figure className="pgw-flow" role="group" aria-label={FLOW_ALT}>
          <div className="pgw-priv" aria-hidden="true"><span>Private to you</span></div>
          <ol className="pgw-fl">
            {FLOW.map((s) => (
              <li className={`pgw-fn is-${s.n}`} key={s.n}>
                <div className="pgw-fn-top"><span className="pgw-fn-g" aria-hidden="true">{s.g}</span><span className="pgw-fn-n">{s.n} · {s.k}</span></div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
                <p className="pgw-fn-who"><b>Who sees it</b>{s.who}</p>
              </li>
            ))}
          </ol>
          <div className="pgw-plan">
            <span className="pgw-plan-k"><i aria-hidden="true">◌</i>Planned · not available yet</span>
            <ul>{PLAN.map((p) => <li className={`at-${p.at}`} key={p.t}><b>{p.t}</b><span>{p.d}</span></li>)}</ul>
          </div>
          <p className="pgw-bound"><b>The private boundary</b><span>{BOUNDARY}</span></p>
        </figure>
      </Section>

      <Section n={3}>
        <ol className="pgs-stg">
          {STAGES.map((t, i) => <li key={t}><span className="pgs-stg-n" aria-hidden="true">{i + 1}</span><span>{t}</span></li>)}
        </ol>
        <h3 className="pgw-fh">What is available now, and what is planned</h3>
        <div className="pgw-scope">
          <div className="pgw-sc is-now">
            <h3><i aria-hidden="true">✓</i>Available now</h3>
            <ul>{NOW.map(([b, s]) => <li key={b}><b>{b}</b><span>{s}</span></li>)}</ul>
          </div>
          <div className="pgw-sc is-later">
            <h3><i aria-hidden="true">◌</i>Planned · not available yet</h3>
            <ul>{LATER.map(([b, s]) => <li key={b}><b>{b}</b><span>{s}</span></li>)}</ul>
            <p className="pgw-sc-f">{LATER_FOOT}</p>
          </div>
        </div>
        <div className="pgw-choice">
          <Dawn width={120} />
          <div><h3>{CHOICE.title}</h3><p>{CHOICE.body}</p></div>
        </div>
      </Section>

      <Section n={4} band>
        <dl className="pgs-terms">
          {TERMS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
        </dl>
        <div className="pgs-limits"><h3>{LIMITS.title}</h3><p>{LIMITS.body}</p></div>
      </Section>

      <Section n={5}>
        <div className="pgs-next">
          <h2>{NEXT.title}</h2>
          <div className="pgs-acts">
            {NEXT.acts.map((a) => (
              <div className="pgs-act" key={a.who}>
                <span className="pgs-act-who">{a.who}</span>
                {a.kind === 'open'
                  ? <a className="pgs-act-link" href={entry.openHref}>{a.label}</a>
                  : <Link className="pgs-act-btn" to={PROGRAMS_INDEX.to}>{a.label}</Link>}
                <p>{a.note}</p>
              </div>
            ))}
          </div>
          <div className="pgs-take">
            <span>{NEXT.take(entry.slides)}</span>
            <DownloadPdf entry={entry} dark />
          </div>
        </div>
      </Section>
    </SitePage>
  );
}
