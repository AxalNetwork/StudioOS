/**
 * D6966 (#6966) — the program presentation kit (PGS00), defined by the Spin-Out Lab pilot and
 * reused by every program of #6965: the availability label in words, the four actions that
 * never look alike (Download PDF in ink, Print, the one violet participation action, and the
 * quieter sign-in and enquiry), the page frame with its fixed section order, the journey, and
 * the dark availability panel.
 *
 * A program describes itself as data (`catalog/<key>.js` and `content/<key>.js`) and this file
 * draws it: no program-specific markup lives here. The page sits in today's public-site frame
 * (`SitePage`: the shared nav, footer and light palette), so the frame #6977 redraws applies here
 * with no edit. The site is light only (`useForcedLightTheme`), so the kit's colours are its
 * stylesheet's, not `dark:` utilities.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import SitePage from '../../components/site/SitePage';
import { AVAILABILITY, SECTION_IDS, SECTION_TITLES } from './collect.js';
import './programs.css';

/** The availability label: a glyph and words, never colour alone. */
export function AvailabilityLabel({ avail, text, dark = false, large = false }) {
  const a = AVAILABILITY[avail] || AVAILABILITY.closed;
  return (
    <span className={`pgs-av is-${avail}${dark ? ' is-dk' : ''}${large ? ' is-lg' : ''}`} data-testid="program-availability">
      <i aria-hidden="true">{a.glyph}</i>{text || a.label}
    </span>
  );
}

/**
 * Download PDF: a plain same-origin link to the committed file, with `download`. Never violet,
 * never a button that makes a file in the browser.
 */
export function DownloadPdf({ program, full = false, dark = false, testId = 'program-download-pdf' }) {
  return (
    <a
      href={program.pdf}
      download={program.file}
      type="application/pdf"
      className={`pgs-dl${full ? ' is-full' : ''}${dark ? ' is-dk' : ''}`}
      data-testid={testId}
    >
      <FileDown aria-hidden="true" />
      <span className="pgs-dl-t">
        <b>Download PDF</b>
        <small>{`${program.slides} slides · 16:9 · ${program.edition}`}</small>
      </span>
    </a>
  );
}

/** Print this page: optional, quieter, always apart from Download PDF. */
export function PrintButton() {
  return (
    <button type="button" className="pgs-print" onClick={() => window.print()} data-testid="program-print">
      <Printer aria-hidden="true" />Print this page
    </button>
  );
}

/** The dark availability panel: a program-specific body and, at most, one participation action. */
export function ProgramPanel({ program, children, action = null }) {
  return (
    <section className="pgs-panel" aria-labelledby="pgs-panel-h" data-testid="program-panel">
      <div className="pgs-panel-h">
        <p className="pgs-panel-k" id="pgs-panel-h">Availability</p>
        <AvailabilityLabel avail={program.avail} text={program.availText} dark />
      </div>
      {children}
      {action ? <div className="pgs-panel-act">{action}</div> : null}
    </section>
  );
}

/** The hero: the crumb, the availability label, the name as the one h1, the purpose, the audience, then Download PDF and Print. */
function Hero({ program, panel }) {
  return (
    <section className="pgs-hero" aria-labelledby="pgs-h1">
      <div className="ax-wrap pgs-hero-in">
        <div>
          <Link to="/programs" className="pgs-crumb" data-testid="program-crumb">‹ All programs</Link>
          <div className="pgs-hero-av">
            <AvailabilityLabel avail={program.avail} text={program.availText} large />
            {program.eyebrow ? <span className="pgs-hero-eb">{program.eyebrow}</span> : null}
          </div>
          <h1 className="pgs-h1" id="pgs-h1">{program.name}</h1>
          <p className="pgs-purpose">{program.purpose}</p>
          <p className="pgs-aud"><b>Who it is for</b>{program.audience}</p>
          <div className="pgs-hero-dl">
            <DownloadPdf program={program} />
            <PrintButton />
          </div>
        </div>
        {panel ? <div className="pgs-hero-panel">{panel}</div> : null}
      </div>
    </section>
  );
}

/** "On this page": the five sections, numbered, in their fixed order. */
function SectionNav() {
  return (
    <nav className="pgs-toc" aria-label="On this page">
      <div className="ax-wrap">
        <ol>
          <li className="pgs-toc-k" aria-hidden="true">On this page</li>
          {SECTION_TITLES.map((t, i) => (
            <li key={t}><a href={`#${SECTION_IDS[i]}`}><b>{i + 1}</b>{t}</a></li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

function Section({ n, title, lead, band, children }) {
  return (
    <section id={SECTION_IDS[n - 1]} className={`pgs-sec${band ? ' is-band' : ''}`} aria-labelledby={`pgs-s${n}`} data-testid={`program-section-${n}`}>
      <div className="ax-wrap pgs-sec-in">
        <div className="pgs-sec-k"><span className="pgs-sec-n" aria-hidden="true">{n}</span>{SECTION_TITLES[n - 1]}</div>
        <h2 className="pgs-sec-h" id={`pgs-s${n}`}>{title}</h2>
        {lead ? <p className="pgs-lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

/** The signature journey: horizontal on a wide screen, stacked below 1060px. Its accessible name is its text alternative. */
export function Journey({ steps, span, along, label }) {
  return (
    <>
      <ol className="pgs-tl" aria-label={label || 'Steps'} data-testid="program-journey">
        {steps.map((s) => (
          <li key={s.t}>
            <span className="pgs-tl-node" aria-hidden="true" />
            <span className="pgs-tl-k">{s.k}</span>
            <h3>{s.t}</h3>
            <ul>{s.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </li>
        ))}
      </ol>
      {span ? <p className="pgs-tl-span"><b>{span.label}</b><span>{span.note}</span></p> : null}
      {along ? <p className="pgs-tl-along">{along}</p> : null}
    </>
  );
}

/** One content block, by its `type` (the vocabulary `content/<key>.js` writes in). */
export function Block({ block }) {
  switch (block.type) {
    case 'cards':
      return (
        <div className="pgs-cols is-3">
          {block.items.map(([t, x], i) => (
            <div className="pgs-card" key={t}>
              {block.numbered ? <span className="pgs-card-n">{String(i + 1).padStart(2, '0')}</span> : null}
              <h3>{t}</h3><p>{x}</p>
            </div>
          ))}
        </div>
      );
    case 'aside':
      return (
        <p className="pgs-aside"><b>{block.label}</b><span>{block.text} {block.link ? <a href={block.link.href} className="pgs-tl-link">{block.link.label}</a> : null}{block.link ? '.' : null}</span></p>
      );
    case 'timeline':
      return <Journey steps={block.steps} span={block.span} along={block.along} label={block.label} />;
    case 'cols':
      return (
        <div className="pgs-cols">
          {block.items.map((c) => <div className="pgs-card" key={c.title}><h3>{c.title}</h3><Block block={c.block} /></div>)}
        </div>
      );
    case 'card':
      return <div className="pgs-card is-gap"><h3>{block.title}</h3>{block.text ? <p>{block.text}</p> : null}{block.block ? <Block block={block.block} /> : null}</div>;
    case 'stages':
      return <ol className="pgs-stg">{block.items.map((t, i) => <li key={t}><span className="pgs-stg-n" aria-hidden="true">{i + 1}</span><span>{t}</span></li>)}</ol>;
    case 'list':
      return <ul className="pgs-list">{block.items.map(([b, t]) => <li key={b}><b>{b}</b><span>{t}</span></li>)}</ul>;
    case 'terms':
      return <dl className="pgs-terms">{block.items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
    case 'limits':
      return <div className="pgs-limits"><h3>{block.title}</h3><p>{block.text}</p></div>;
    default:
      throw new Error(`program content: unknown block type "${block.type}"`);
  }
}

/** One action of the Next step band, in its own look: the one violet primary, a text link, or a quiet button. */
function NextAction({ a, label }) {
  const text = label || a.label;
  if (a.kind === 'primary') return <Link to={a.to} className="ax-btn ax-btn-md ax-btn-bright pgs-act-btn" data-testid={`program-action-${a.id}`}>{text}</Link>;
  if (a.kind === 'link') return <Link to={a.to} className="pgs-act-link" data-testid={`program-action-${a.id}`}>{text}</Link>;
  return <Link to={a.to} className="ax-btn ax-btn-md ax-btn-ghost pgs-act-btn" data-testid={`program-action-${a.id}`}>{text}</Link>;
}

/** Section 5's band: up to three actions for different people, one primary at most, and the PDF apart. */
function NextBand({ program, next, labels }) {
  return (
    <div className="pgs-next">
      <h3 className="pgs-next-h">{next.band}</h3>
      <div className="pgs-acts">
        {next.actions.map((a) => (
          <div className="pgs-act" key={a.id}>
            <span className="pgs-act-who">{a.who}</span>
            <NextAction a={a} label={labels?.[a.id]} />
            {a.note ? <p>{a.note}</p> : null}
          </div>
        ))}
      </div>
      <div className="pgs-take">
        <span>{`Take it with you: the same story as a ${program.slides}-slide PDF, for a meeting or to send on.`}</span>
        <DownloadPdf program={program} dark testId="program-download-pdf-take" />
      </div>
    </div>
  );
}

/**
 * One program's presentation page: the site frame, the hero (with the program's availability
 * panel), the section nav, sections 1 to 4 from the content, and section 5's Next step band.
 * `labels` overrides an action's words by its id (the Lab's Apply names the cohort it read).
 */
export function ProgramPresentation({ program, content, panel = null, labels = null, testId = 'program-presentation' }) {
  if (content.sections.length !== 4) throw new Error(`${program.key}: content.sections holds sections 1 to 4; section 5 is content.next`);
  return (
    <SitePage title={program.og.title} description={program.og.description} signup={false} className="pgs-page">
      <div data-testid={testId} data-program={program.key}>
        <Hero program={program} panel={panel} />
        <SectionNav />
        {content.sections.map((s, i) => (
          <Section key={s.title} n={i + 1} title={s.title} lead={s.lead} band={s.band}>
            {s.blocks.map((b, j) => <Block key={j} block={b} />)}
          </Section>
        ))}
        <Section n={5} title={content.next.title}>
          <NextBand program={program} next={content.next} labels={labels} />
        </Section>
      </div>
    </SitePage>
  );
}
