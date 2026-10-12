import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { ButtonLink } from '../../components/site/SiteBlocks';
import {
  METHOD_STAGES, METHOD_DIMENSIONS, METHOD_LOOP, METHOD_LINKS, METHOD_DISCIPLINES,
  METHOD_FIGURES, DISCIPLINE_FIGURES, LAB_WEEKS, METHOD_RECORD, METHOD_USERS, METHOD_ROLES,
} from '../../lib/siteMethod';
import './method.css';

/**
 * `/methodology` (D678, #1552): the METHODOLOGY view of the owner's website
 * canvas, `design/canvases/integrated/Axal VC Website.dc.html`, in its order:
 *
 *   1. the blueprint hero, Fig. 01 and the four stages;
 *   2. the three dimensions, with the drawn Axal symbol;
 *   3. the operating loop, Figs. 02–06;
 *   4. the four stages and their decision points;
 *   5. the Lab in motion, Fig. 07 and its four weeks;
 *   6. the shared record;
 *   7. the partner roles;
 *   8. the closing.
 *
 * The page states a method, so it reads nothing live: every word is the
 * owner's (`lib/siteMethod.js`). Each blueprint keeps the canvas's alt text
 * and, under 900px, scrolls sideways inside its own frame (`.ax-m-bp-scroll`)
 * so the page itself never does.
 */

const img = (name) => `/site/${name}.webp`;

/**
 * One blueprint in its frame. The scroll box is focusable so a keyboard can
 * pan a figure that is wider than a phone.
 */
function Blueprint({ fig, eager = false, hint = false, large = false }) {
  return (
    <figure className={`ax-m-bp${large ? ' is-large' : ''}`}>
      <div className="ax-m-bp-frame">
        <div className="ax-m-bp-scroll" tabIndex={0} role="region" aria-label={fig.caption}>
          <img
            className="ax-m-bp-img"
            src={img(fig.img)}
            alt={fig.alt}
            width={fig.w}
            height={fig.h}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
        </div>
      </div>
      <figcaption className="ax-m-cap">
        <span>{fig.caption}</span>
        {hint && <span className="ax-m-only">Scroll sideways to read the blueprint</span>}
      </figcaption>
    </figure>
  );
}

function Hero() {
  return (
    <section className="ax-m-hero" aria-labelledby="m-hero-h">
      <div className="ax-m-glow ax-m-glow-hero" aria-hidden="true" />
      <div className="ax-m-wrap ax-m-hero-body">
        <div className="ax-m-eyebrow is-light">The Axal VC Venture Creation System</div>
        <h1 id="m-hero-h" className="ax-m-h1">Validate. Build. Raise. Grow.</h1>
        <p className="ax-m-hero-lede">
          Axal VC gives ventures the system, network, and operating discipline to move from an uncertain opportunity
          to a validated, built, funded, and growing company.
        </p>
        <p className="ax-m-hero-sub">We work with partners globally to build the rails for the next generation of ventures.</p>
        <div className="ax-m-ctas">
          <ButtonLink to="/spinout-lab" variant="primary">Explore the Spin-Out Lab</ButtonLink>
          <ButtonLink to="/register" variant="ghost">Join Axal VC</ButtonLink>
          <Link to="/contact" className="ax-m-textlink">Work with us →</Link>
        </div>
      </div>
      <div className="ax-m-wrap ax-m-wrap-wide ax-m-hero-fig">
        <Blueprint fig={METHOD_FIGURES.system} eager hint large />
      </div>
      <div className="ax-m-wrap ax-m-hero-stages">
        <div className="ax-m-4 ax-m-strip" role="list" aria-label="The four venture stages">
          {METHOD_STAGES.map((s) => (
            <div key={s.n} role="listitem" className="ax-m-strip-item">
              <div className="ax-m-tick" aria-hidden="true" />
              <div className="ax-m-k is-light">{s.n}</div>
              <div className="ax-display ax-m-strip-t">{s.t}</div>
              <p className="ax-m-strip-d">{s.s}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The canvas's drawn Axal symbol, as it draws it: three hatched ellipses on
 * drafting paper with the XYZ axes between them. Copied from the canvas with
 * its attributes in React's spelling; the hover wash on each ellipse is
 * `.ax-m-sym-hit` in `method.css`.
 */
function AxalSymbol() {
  const ink = '#2a2533';
  const violet = '#6d28d9';
  const ellipses = [
    { cx: 225, cy: 290, rx: 150, ry: 300, rx2: 159, ry2: 309, rot: 'rotate(34 225 290)' },
    { cx: 735, cy: 290, rx: 150, ry: 300, rx2: 159, ry2: 309, rot: 'rotate(-34 735 290)' },
    { cx: 482, cy: 740, rx: 297, ry: 153, rx2: 306, ry2: 162, rot: undefined },
  ];
  const ticks = [
    'M417.0 481.3 L424.4 493.1', 'M355.0 514.2 L367.8 534.6', 'M298.4 555.7 L305.8 567.5', 'M236.4 588.7 L249.2 609.0',
    'M535.6 493.1 L543.0 481.3', 'M592.2 534.6 L605.0 514.2', 'M654.2 567.5 L661.6 555.7', 'M710.8 609.0 L723.6 588.7',
    'M486.5 380.0 L472.5 380.0', 'M491.0 309.9 L467.0 310.1', 'M485.6 240.0 L471.6 240.1', 'M490.1 169.9 L466.1 170.1',
  ];
  return (
    <div className="ax-m-sheet">
      <svg
        role="img"
        aria-label="Hand-drawn sketch of the Axal symbol on drafting paper: three ellipses labelled Reach, Momentum, and Depth arranged around a shared centre."
        viewBox="0 0 520 520"
        className="ax-m-sym"
      >
        <defs>
          <pattern id="axGrid" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M26 0H0V26" fill="none" stroke={violet} strokeOpacity=".09" strokeWidth="1" />
          </pattern>
          <pattern id="axHatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="9" stroke={ink} strokeOpacity=".55" strokeWidth="1.6" />
          </pattern>
          <filter id="axSketchF" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <rect x="0" y="0" width="520" height="520" fill="url(#axGrid)" />
        <rect x="18" y="18" width="484" height="484" fill="none" stroke={violet} strokeOpacity=".28" strokeWidth="1" />
        <g transform="translate(87,86) scale(0.36)" filter="url(#axSketchF)">
          <circle cx="480" cy="450" r="298" fill="none" stroke={violet} strokeOpacity=".4" strokeWidth="2.5" strokeDasharray="8 12" />
          <path d="M480 420 V480 M450 450 H510" stroke={violet} strokeOpacity=".7" strokeWidth="2.5" />
          <path d="M225 290 L735 290 L482 740 Z" fill="none" stroke={violet} strokeOpacity=".3" strokeWidth="2.5" />
          {ellipses.map((e) => (
            <g key={`${e.cx}-${e.cy}`}>
              <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} transform={e.rot} fill="url(#axHatch)" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
              <ellipse cx={e.cx} cy={e.cy} rx={e.rx2} ry={e.ry2} transform={e.rot} fill="none" stroke={ink} strokeOpacity=".28" strokeWidth="2.5" strokeDasharray="14 10" />
              <ellipse className="ax-m-sym-hit" cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} transform={e.rot} fill={violet} />
            </g>
          ))}
          <g fill={violet}>
            <circle cx="225" cy="290" r="6" /><circle cx="735" cy="290" r="6" /><circle cx="482" cy="740" r="6" />
          </g>
          <g fill="none" stroke={violet} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M480 450 L158.1 652.0" />
            <path d="M173.2 627.1 L158.1 652.0 L187.0 649.2" />
            <path d="M480 450 L801.9 652.0" />
            <path d="M773.0 649.2 L801.9 652.0 L786.8 627.1" />
            <path d="M480 450 L477.4 70.0" />
            <path d="M490.6 95.9 L477.4 70.0 L464.6 96.1" />
            {ticks.map((d) => <path key={d} d={d} strokeWidth="2" strokeOpacity=".7" />)}
            <circle cx="480" cy="450" r="9" fill="#fff" strokeWidth="3" />
          </g>
          <g fontFamily="inherit" fontSize="40" fontWeight="700" fill={violet}>
            <text x="122.5" y="688.3" textAnchor="middle">X</text>
            <text x="837.5" y="688.3" textAnchor="middle">Y</text>
            <text x="477.1" y="42.0" textAnchor="middle">Z</text>
          </g>
        </g>
        <g fontFamily="inherit" fontSize="11" fontWeight="700" letterSpacing="2.2" fill={ink}>
          <text x="62" y="66">REACH</text>
          <text x="458" y="66" textAnchor="end">MOMENTUM</text>
          <text x="260" y="486" textAnchor="middle">DEPTH</text>
        </g>
        <g stroke={violet} strokeOpacity=".6" strokeWidth="1">
          <path d="M96 72 V110" /><path d="M424 72 V110" /><path d="M260 470 V446" />
        </g>
        <g fontFamily="inherit" fontSize="8.5" fontWeight="700" letterSpacing="1.6" fill="#6b6577">
          <text x="30" y="500">AXAL VC · SYMBOL</text>
          <text x="490" y="500" textAnchor="end">THREE DIMENSIONS · FIG. 1A</text>
          <text x="30" y="38" fill={violet}>XYZ · AXES BETWEEN THE DIMENSIONS</text>
        </g>
      </svg>
    </div>
  );
}

function Dimensions() {
  return (
    <section className="ax-m-paper" aria-labelledby="m-dims-h">
      <div className="ax-m-wrap ax-m-sec">
        <div className="ax-m-eyebrow">Three dimensions</div>
        <h2 id="m-dims-h" className="ax-m-h2">Reach, Depth, Momentum.</h2>
        <div className="ax-m-2 ax-m-dims">
          <AxalSymbol />
          <div className="ax-m-dimlist">
            {METHOD_DIMENSIONS.map((d) => (
              <div key={d.t} className="ax-m-2 ax-m-dim">
                <h3 className="ax-m-dim-t">{d.t}</h3>
                <p className="ax-m-dim-d">{d.d}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="ax-m-2 ax-m-map" aria-label="Reach, Depth, and Momentum support Validate, Build, Raise, and Grow">
          <div className="ax-m-k">Dimensions</div>
          <div className="ax-display ax-m-map-row">
            <span>Reach</span><span aria-hidden="true" className="ax-m-op">+</span>
            <span>Depth</span><span aria-hidden="true" className="ax-m-op">+</span>
            <span>Momentum</span>
          </div>
          <div className="ax-m-k">Support</div>
          <div className="ax-display ax-m-map-row is-violet">
            <span>Validate</span><span aria-hidden="true" className="ax-m-op">→</span>
            <span>Build</span><span aria-hidden="true" className="ax-m-op">→</span>
            <span>Raise</span><span aria-hidden="true" className="ax-m-op">→</span>
            <span>Grow</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Loop() {
  return (
    <section className="ax-m-night" aria-labelledby="m-loop-h">
      <div className="ax-m-glow ax-m-glow-loop" aria-hidden="true" />
      <div className="ax-m-wrap ax-m-sec ax-m-sec-tall">
        <div className="ax-m-eyebrow is-light">The central operating loop</div>
        <h2 id="m-loop-h" className="ax-m-h2">A faster path to a better decision.</h2>
        <p className="ax-m-lede is-light">Evidence-gated venture sprints for moving from idea to organization.</p>
        <div className="ax-m-h-only ax-m-return" aria-hidden="true">
          <svg viewBox="0 0 1000 70" preserveAspectRatio="none" className="ax-m-return-svg">
            <path className="ax-m-dash" d="M994 70 V30 Q994 14 978 14 H23 Q7 14 7 30 V60" fill="none" stroke="#c4b5fd" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="6 8" />
            <path d="M1 52 L7 62 L13 52" fill="none" stroke="#c4b5fd" strokeWidth="1.5" />
          </svg>
          <div className="ax-m-return-k">Evidence informs the next decision</div>
        </div>
        <div className="ax-m-loopwrap">
          <div className="ax-m-loop-rail" aria-hidden="true" />
          <div className="ax-m-loop" role="list" aria-label="The operating loop: Hypothesis, Sprint, Evidence, Decision, Next Commitment, then back to Hypothesis">
            {METHOD_LOOP.map((s) => (
              <div key={s.n} className="ax-m-loop-step" role="listitem">
                <div className="ax-m-loop-dot" aria-hidden="true" />
                <div className="ax-m-loop-n">{s.n}</div>
                <h3 className="ax-m-loop-t">{s.t}</h3>
                <p className="ax-m-loop-d">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="ax-display ax-m-pull">A sprint does not automatically lead to another sprint. It produces evidence that informs a decision.</p>
        <div className="ax-m-block">
          <Blueprint fig={METHOD_FIGURES.loop} />
        </div>
        <div className="ax-m-4 ax-m-links" role="list" aria-label="How the four stages feed each other">
          {METHOD_LINKS.map((l) => (
            <div key={l.f} role="listitem" className="ax-m-link">
              <div className="ax-m-k is-light ax-m-link-k">
                <span>{l.f}</span><span aria-hidden="true" className="ax-m-op">→</span><span>{l.to}</span>
              </div>
              <p className="ax-m-link-d">{l.d}</p>
            </div>
          ))}
        </div>
        <div className="ax-m-disc">
          <div className="ax-m-k is-light">Five disciplines. One operating system.</div>
          <div className="ax-m-5">
            {METHOD_DISCIPLINES.map((d) => (
              <div key={d.t}>
                <div className="ax-m-disc-t">{d.t}</div>
                <div className="ax-m-disc-r">{d.r}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="ax-m-2 ax-m-figs">
          {DISCIPLINE_FIGURES.map((k) => <Blueprint key={k} fig={METHOD_FIGURES[k]} />)}
        </div>
        <div className="ax-m-mottos">
          <span>Sprint fast</span><span>Learn visibly</span><span>Build with others</span><span>Commit when the record is ready</span>
        </div>
      </div>
    </section>
  );
}

function Stages() {
  return (
    <section className="ax-m-white" aria-labelledby="m-stages-h">
      <div className="ax-m-wrap ax-m-sec">
        <div className="ax-m-2 ax-m-head2">
          <div>
            <div className="ax-m-eyebrow">Four stages</div>
            <h2 id="m-stages-h" className="ax-m-h2">From opportunity to enduring company.</h2>
          </div>
          <p className="ax-m-side">
            Each stage ends at a decision point. The record is reviewed as a whole: evidence, assets, and readiness.
            The decision may be to continue, adapt, pause, or commit further time, capital, and participation.
          </p>
        </div>
        <div className="ax-m-4 ax-m-stages">
          {METHOD_STAGES.map((s) => (
            <div key={s.n} className="ax-m-stage">
              <div className="ax-m-k is-violet">{s.n}</div>
              <h3 className="ax-m-stage-t">{s.t}</h3>
              <p className="ax-m-stage-s">{s.s}</p>
              <ul className="ax-m-bullets">
                {s.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
              {s.note && <p className="ax-m-stage-note">{s.note}</p>}
              <div className="ax-m-gate">
                <div className="ax-m-k is-violet ax-m-gate-k"><span className="ax-m-diamond" aria-hidden="true" /><span>Decision point</span></div>
                <p className="ax-display ax-m-gate-q">{s.q}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LabInMotion() {
  return (
    <section className="ax-m-night ax-m-night-lab" aria-labelledby="m-lab-h">
      <div className="ax-m-glow ax-m-glow-lab" aria-hidden="true" />
      <div className="ax-m-wrap ax-m-sec ax-m-sec-tall">
        <div className="ax-m-2 ax-m-head2 is-end">
          <div>
            <div className="ax-m-eyebrow is-light">The 28-day Spin-Out Lab</div>
            <h2 id="m-lab-h" className="ax-m-h2">The methodology in motion.</h2>
            <p className="ax-m-lab-sub">A 28-day venture sprint through all four stages.</p>
          </div>
          <p className="ax-m-lede is-light ax-m-flat">
            The Spin-Out Lab is the concentrated expression of the Axal method. It gives founders a defined period, a
            shared operating system, and a clear set of decisions. Each week maps to one stage.
          </p>
        </div>
        <div className="ax-m-block">
          <Blueprint fig={METHOD_FIGURES.lab} />
        </div>
        <div className="ax-m-k is-light ax-m-days"><span>Day 1</span><span>Day 28</span></div>
        <ol className="ax-m-4 ax-m-weeks">
          {LAB_WEEKS.map((w) => (
            <li key={w.n} className="ax-m-week">
              <div className="ax-m-week-bar" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ background: w.tone }} />)}
              </div>
              <div className="ax-m-k is-light ax-m-week-n">{w.n}</div>
              <h3 className="ax-m-week-t">{w.t}</h3>
              <ul className="ax-m-bullets is-light">
                {w.items.map((i) => <li key={i} style={{ '--ax-m-dot': w.tone }}>{i}</li>)}
              </ul>
            </li>
          ))}
        </ol>
        <div className="ax-m-endrow">
          <p className="ax-display ax-m-big">The result is not simply a pitch. It is a company with a record behind it.</p>
          <ButtonLink to="/spinout-lab" variant="quiet">Explore the Spin-Out Lab</ButtonLink>
        </div>
      </div>
    </section>
  );
}

function SharedRecord() {
  return (
    <section className="ax-m-white" aria-labelledby="m-record-h">
      <div className="ax-m-wrap ax-m-sec">
        <div className="ax-m-2 ax-m-head2">
          <div>
            <div className="ax-m-eyebrow">One shared venture record</div>
            <h2 id="m-record-h" className="ax-m-h2">The record is part of the work.</h2>
          </div>
          <p className="ax-m-side is-lg">
            Discovery, scoring, market intelligence, team decisions, cap table changes, incorporation documents,
            investor materials, and capital activity should connect to the same venture record.
          </p>
        </div>
        <div className="ax-m-4 ax-m-record" role="list" aria-label="What the record connects: evidence, assets, decisions, capital readiness">
          {METHOD_RECORD.map((r, i) => (
            <div key={r.t} role="listitem" className="ax-m-rec">
              <h3 className="ax-m-rec-t">{r.t}</h3>
              <p className="ax-m-rec-q">{r.q}</p>
              <div className="ax-m-k">{r.from}</div>
              {i < METHOD_RECORD.length - 1 && <div className="ax-m-h-only ax-m-rec-arrow" aria-hidden="true">→</div>}
            </div>
          ))}
        </div>
        <p className="ax-m-body">Information is captured once, then made useful across the system.</p>
        <p className="ax-display ax-m-every">
          Every sprint must produce <span>evidence</span>, <span>an asset</span>, or <span>a decision</span>.
        </p>
        <div className="ax-m-users">
          <div className="ax-m-tab">One venture record</div>
          <div className="ax-m-4 ax-m-users-row">
            {METHOD_USERS.map((u) => (
              <div key={u.t} className="ax-m-user">
                <div className="ax-m-tick is-violet" aria-hidden="true" />
                <h3 className="ax-m-user-t">{u.t}</h3>
                <p className="ax-m-user-d">{u.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The canvas's four small marks, one per role. */
function RoleIcon({ kind }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className="ax-m-role-icon" fill="none" stroke="#6d28d9" strokeWidth="1.5">
      {kind === 'seed' && (
        <g><circle cx="20" cy="20" r="4" fill="#6d28d9" stroke="none" /><circle cx="20" cy="20" r="13" /><circle cx="20" cy="20" r="19" strokeDasharray="2 5" /></g>
      )}
      {kind === 'horizon' && (
        <g><path d="M4 22 H36" /><path d="M10 28 H30" /><circle cx="31" cy="15" r="3.5" fill="#6d28d9" stroke="none" /></g>
      )}
      {kind === 'bridge' && (
        <g><path d="M8 32 V14" /><path d="M32 32 V14" /><path d="M8 16 Q20 4 32 16" /><path d="M4 32 H36" /></g>
      )}
      {kind === 'grid' && (
        <g>
          <circle cx="10" cy="10" r="3.5" /><circle cx="30" cy="10" r="3.5" /><circle cx="10" cy="30" r="3.5" /><circle cx="30" cy="30" r="3.5" />
          <path d="M13.5 10 H26.5 M10 13.5 V26.5 M30 13.5 V26.5 M13.5 30 H26.5" />
        </g>
      )}
    </svg>
  );
}

function Partners() {
  return (
    <section className="ax-m-paper" aria-labelledby="m-partners-h">
      <div className="ax-m-wrap ax-m-sec">
        <div className="ax-m-eyebrow">The partner network</div>
        <h2 id="m-partners-h" className="ax-m-h2">Built with partners globally.</h2>
        <p className="ax-m-side is-lg ax-m-partners-lede">
          No venture is built in isolation. Axal works with founders, investors, advisors, operators, studios, labs,
          and other partners across borders.
        </p>
        <div className="ax-m-4 ax-m-roles">
          {METHOD_ROLES.map((r) => (
            <div key={r.t} className="ax-m-role">
              <RoleIcon kind={r.icon} />
              <div>
                <h3 className="ax-m-role-t">{r.t}</h3>
                <p className="ax-m-role-d">{r.d}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="ax-m-endrow">
          <p className="ax-display ax-m-mid">Every participant has an entry point, a contribution, and an outcome.</p>
          <ButtonLink to="/contact" variant="quiet">Work with Axal</ButtonLink>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="ax-m-close" aria-labelledby="m-close-h">
      <div className="ax-m-glow ax-m-glow-close" aria-hidden="true" />
      <div className="ax-m-wrap ax-m-close-body">
        <div className="ax-m-eyebrow is-light">Axal VC</div>
        <h2 id="m-close-h" className="ax-m-h2 ax-m-close-h">Build with clarity. Move with evidence.</h2>
        <p className="ax-m-lede is-light ax-m-close-p">
          We do not believe speed and rigor are opposites. Speed matters because uncertainty compounds. Rigor matters
          because capital, attention, and trust are limited. The answer is not to slow down until everything is known.
          It is to move quickly toward the information that changes what should happen next.
        </p>
        <p className="ax-display ax-m-big ax-m-close-rails">
          Axal VC works with partners globally to build the rails for the next generation of ventures.
        </p>
        <div className="ax-m-ctas">
          <ButtonLink to="/register" variant="quiet">Join Axal VC</ButtonLink>
          <ButtonLink to="/spinout-lab" variant="ghost">Explore the Spin-Out Lab</ButtonLink>
        </div>
      </div>
    </section>
  );
}

export default function MethodologyPage() {
  return (
    <SitePage title="Methodology" className="ax-m">
      <Hero />
      <Dimensions />
      <Loop />
      <Stages />
      <LabInMotion />
      <SharedRecord />
      <Partners />
      <Closing />
    </SitePage>
  );
}
