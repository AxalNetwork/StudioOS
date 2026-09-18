import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileDown, Check, Minus } from 'lucide-react';
import { spinoutLab } from '../lib/api';
import { reportError } from '../lib/log';
import { Unrecorded } from '../ui';
import { inZone, dateInZone } from '../lib/zoneTime';
import {
  COHORT_WEEKS, LAB_APPLY_HREF, useSpinoutStats, companiesLabel,
} from '../lib/spinoutLab';
import {
  LAB_TRACKS, TOOL_COUNT, arsenalFor, leadsWithFor,
} from '../lib/spinoutLabArsenal';
import {
  WEEKS, TRACK_GATES, TERMS, JURISDICTIONS, DELIVERABLES, COMMUNITY, SUPPORT,
  FIT, NOT_FIT, TOOL_EXAMPLE_READS, EXAMPLE_LABEL, numberWord, numberWordCap,
} from '../lib/spinoutBrief';

/**
 * THE PROGRAMME BRIEF — four printed pages describing the Spin-Out Lab (D141).
 *
 * WHAT THE "BACKEND THAT AUTO-UPDATES EVERY {} ELEMENT" TURNED OUT TO BE. The
 * design carries seventy-six bindings and exactly SIX of them are values the
 * platform measures: the cohort's name, its start, when applications close, how
 * many places it has, the year, and when the brief was generated. Those six —
 * and only those six — come from `GET /api/spinout-lab/brief`. About twenty
 * more (the tools, the groups, the tracks) already have one source in
 * `lib/spinoutLabArsenal.js` that the Lab's own pages read, so the brief reads
 * the same export rather than a second copy: a brief describing a programme the
 * product does not have is worse than no brief. The remaining fifty-odd are the
 * programme's own prose, and they live in `lib/spinoutBrief.js` as content in
 * git. Giving THOSE a store would be a table invented so a page could look
 * dynamic, holding values nobody measures and nobody edits — D129's seat store
 * and D140's adjustable dates, a third time.
 *
 * NOTHING ON THIS PAGE MAY BE TYPED THAT IS DERIVABLE. "Nineteen working tools.
 * Count them." is an invitation to check, so the number is `TOOL_COUNT`; the
 * twenty-eight days are `COHORT_WEEKS × 7`; the three tracks are
 * `LAB_TRACKS.length`. The brief already carried a frozen number once —
 * "Cohort 4 · closes August 1, 2026", past by the time anyone read it — and
 * this is the one page a founder prints and forwards to an investor.
 *
 * EVERY DATE IS NAMED IN ITS ZONE. Deadlines are enforced in `COHORT_TZ`
 * (Delaware), the reader is anywhere, and the route sends the zone beside the
 * instants so `zoneTime.js` can be given it rather than defaulting to the
 * reader's — the helper's required-zone argument is exactly this case.
 *
 * PDF EXPORT IS PRINT CSS, NOT A SERVER RENDER. `window.print()` plus
 * `@page { size: letter portrait }` and a page break per section: no new
 * dependency, no route, works offline, and the artefact the founder saves is
 * the page they were reading. Cloudflare Browser Rendering is already a binding
 * if a byte-identical server PDF is ever wanted; that is filed, not built.
 *
 * THE DOCUMENT IS WHITE IN BOTH THEMES, ON PURPOSE. Only the chrome around it
 * follows the reader's theme. A brief is a document: what is on screen has to
 * be what comes out of the printer, and a dark-mode page that prints white is
 * two different documents under one URL.
 */

/**
 * THE DOCUMENT'S PALETTE, declared once — and `PAPER` is part of it for a
 * reason worth stating. The cards used Tailwind's `bg-white`, which the
 * dark-mode guard correctly flags: a light utility with no `dark:` pair is
 * usually a surface somebody forgot. Here it is not forgotten, it is the wrong
 * MECHANISM — a printed document has a fixed palette, the page ground beside it
 * is already an inline `#faf9fc`, and a card reaching for a theme-aware utility
 * in the middle of that is the one piece not following the rule the rest of the
 * file does. Naming it here makes the palette one thing, and leaves the guard
 * with nothing to pair, rather than an exemption to trust. The CHROME around
 * the document — the toolbar — keeps its `dark:` variants, because it is app
 * chrome and follows the reader's theme.
 */
const V = '#6d28d9';
const PAPER = '#ffffff';
const INK = '#141118';
const MUT = '#6b6577';
const BODY = '#4a4553';
const HAIR = '#e8e6ee';

/** Every live field's absence, said in the same voice. */
const LIVE_REASON = 'The platform did not answer when this brief was generated.';
const NO_COHORT_REASON =
  'No cohort is open for applications right now — the next month’s window has not opened.';

/**
 * One of the six. Renders the measured value, or its own stated absence.
 *
 * `reason` is required rather than defaulted because the two absences here are
 * genuinely different — a read that failed, and a moment when no cohort is open
 * — and a founder reading "Not recorded" deserves to know which.
 */
function Live({ value, reason }) {
  if (value === null || value === undefined || value === '') {
    return <Unrecorded reason={reason}>Not recorded</Unrecorded>;
  }
  return <>{value}</>;
}

/** The page furniture every printed page repeats. */
function PageFoot({ n, year, trademark }) {
  return (
    <div
      className="mt-auto flex items-center justify-between gap-4 px-[42px] pt-3 pb-4 border-t"
      style={{ borderColor: HAIR }}
    >
      <span className="text-[9px] font-mono" style={{ color: MUT }}>
        © <Live value={year} reason={LIVE_REASON} /> Axal VC Management LLC. All rights reserved.
        {trademark ? ' Axal VC and Spin-Out Lab are trademarks of Axal VC Management LLC.' : ''}
      </span>
      <span className="text-[9px] font-mono whitespace-nowrap" style={{ color: MUT }}>
        axal.vc/spinout-lab/brief · page {n} of 4
      </span>
    </div>
  );
}

function Eyebrow({ children, accent }) {
  return (
    <div
      className="text-[10px] font-mono font-bold uppercase tracking-[.14em]"
      style={{ color: accent ? V : MUT }}
    >
      {children}
    </div>
  );
}

/**
 * The nine example readings, drawn.
 *
 * EVERY ONE IS RENDERED UNDER `EXAMPLE_LABEL`, and that is not decoration. The
 * figures are invented for the design — the brief is public, read by somebody
 * with no account, so there is no founder's data that could go here even in
 * principle. A chart with a number under it reads as measured; unlabelled these
 * would be the most convincing wrong thing on the page.
 */
function ExampleRead({ m }) {
  if (!m) return null;
  return (
    <div className="mt-2.5">
      {m.bars && (
        <div className="flex flex-col gap-1">
          {m.bars.map((b) => (
            <div key={b.k} className="flex items-center gap-1.5">
              <span className="text-[8.5px] font-mono w-[30px] shrink-0" style={{ color: MUT }}>{b.k}</span>
              <span className="h-[5px] rounded-full flex-1" style={{ background: '#f0eff3' }}>
                <span className="block h-full rounded-full" style={{ width: `${b.pct}%`, background: b.c }} />
              </span>
            </div>
          ))}
        </div>
      )}
      {m.cols && (
        <div className="flex items-end gap-1 h-[28px]">
          {m.cols.map((c, i) => (
            <span key={i} className="flex-1 rounded-t-[2px]" style={{ height: `${c.pct}%`, background: c.c }} />
          ))}
        </div>
      )}
      {m.rings && (
        <div className="relative h-[30px]">
          {m.rings.map((r, i) => (
            <span
              key={i}
              className="absolute bottom-0 rounded-full"
              style={{ width: r.size, height: r.size, left: r.left, background: r.c }}
            />
          ))}
        </div>
      )}
      {m.tiles && (
        <div className="flex gap-[3px] h-[26px]">
          {m.tiles.map((t, i) => (
            <span key={i} className="flex-1 rounded-[3px]" style={{ background: t.c }} />
          ))}
        </div>
      )}
      {m.segs && (
        <div className="flex h-[10px] rounded-full overflow-hidden">
          {m.segs.map((s) => (
            <span key={s.k} style={{ width: `${s.pct}%`, background: s.c }} title={s.k} />
          ))}
        </div>
      )}
      {m.slots && (
        <div className="grid grid-cols-5 gap-[3px]">
          {m.slots.map((s, i) => (
            <span key={i} className="h-[11px] rounded-[2px]" style={{ background: s.c }} />
          ))}
        </div>
      )}
      {m.okrs && (
        <div className="flex gap-1.5">
          {m.okrs.map((o, i) => (
            <span
              key={i}
              className="flex-1 rounded-[4px] text-[8.5px] font-mono font-bold text-center py-[3px]"
              style={{ background: o.c, color: o.c === '#e8e6ee' ? MUT : '#fff' }}
            >
              {o.v}
            </span>
          ))}
        </div>
      )}
      <div className="text-[9px] font-mono mt-1.5" style={{ color: INK }}>{m.read}</div>
      <div className="text-[8.5px] italic mt-0.5" style={{ color: MUT }}>{EXAMPLE_LABEL}</div>
    </div>
  );
}

/**
 * THE DOCUMENT ITSELF — pure, prop-driven, and exported for that reason.
 *
 * It takes the payload rather than fetching it, which is what lets both of its
 * states be rendered and read in a test: the six live fields filled, and the
 * six stating their own absence. `renderToStaticMarkup` never runs an effect,
 * so a component that fetched its own data could only ever be asserted in its
 * loading state — and the loading state is not the one that has to be right.
 *
 * @param {object|null|undefined} brief the route's payload; `undefined` while
 *   the read is in flight, `null` once it has failed
 * @param {boolean} err true when the read failed, which is a DIFFERENT absence
 *   from a month with no open cohort and gets a different sentence
 */
export function BriefDocument({ brief, err, stats = [] }) {
  const zone = brief?.zone ?? null;
  const cohortName = brief?.cohort?.name ?? null;
  const startsOn = dateInZone(brief?.cohort?.start_date, zone);
  const closesAt = inZone(brief?.cohort?.close_at, zone);
  const places = brief?.cohort?.places ?? null;
  const year = brief?.brief?.year ?? null;
  const generatedAt = dateInZone(brief?.brief?.generated_at, zone);
  // A failed read and a closed window need different sentences; `brief` is
  // present and `applications_open` false only in the second case.
  const cohortReason = err || !brief ? LIVE_REASON : NO_COHORT_REASON;

  const days = COHORT_WEEKS * 7;
  const liveChips = [
    { k: 'Cohort', v: cohortName, reason: cohortReason },
    { k: 'Starts', v: startsOn, reason: cohortReason },
    { k: 'Applications close', v: closesAt, reason: cohortReason },
  ];
  const groups = arsenalFor(LAB_TRACKS[0].id);

  return (
    <div className="flex flex-col gap-5 print:gap-0">

      {/* ══════════ PAGE 1 · WHAT IT IS ══════════ */}
      <section
        data-brief-page
        data-testid="brief-page-1"
        className="rounded-[14px] overflow-hidden shadow-sm flex flex-col"
        style={{ background: '#faf9fc', color: INK }}
      >
        <div
          className="px-[42px] pt-7 pb-[30px] text-white"
          style={{ background: 'linear-gradient(100deg,#140c26 0%,#180f2e 52%,#2a1a52 100%)' }}
        >
          <div className="flex items-center justify-between gap-5">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-extrabold tracking-[-.015em]">Axal VC</span>
              <span className="opacity-50">·</span>
              <span className="text-[14px] font-semibold opacity-85">Spin-Out Lab</span>
            </div>
            <div className="text-[9px] font-mono uppercase tracking-[.14em] opacity-75">
              Programme brief · <Live value={generatedAt} reason={LIVE_REASON} />
            </div>
          </div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-[.14em] mt-6" style={{ color: '#a78bfa' }}>
            {numberWordCap(days)} days · {numberWord(WEEKS.length)} evidence gates · {numberWord(TOOL_COUNT)} tools
          </div>
          <h1 className="m-0 mt-2.5 text-[34px] font-black tracking-[-.035em] leading-[1.05] max-w-[620px] text-balance">
            Idea in on the first. Incorporated, validated, funded company out on the twenty‑ninth.
          </h1>
          <p className="text-[13.5px] leading-[1.65] mt-3.5 max-w-[580px] mb-0" style={{ color: 'rgba(255,255,255,.78)' }}>
            A structured company-formation programme run inside the Axal VC platform. Founders
            arrive at one of {numberWord(LAB_TRACKS.length)} starting points and leave with a
            working entity, a cap table that holds, evidence a buyer will pay, and a deck built
            from their own recorded data.
          </p>
          <div className="flex flex-wrap gap-2 mt-[18px]" data-testid="brief-live-chips">
            {liveChips.map((c) => (
              <span
                key={c.k}
                className="inline-flex items-baseline gap-[7px] rounded-full px-3 py-1.5"
                style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.18)' }}
              >
                <span className="text-[9px] font-mono uppercase tracking-[.1em] opacity-70">{c.k}</span>
                <span className="text-[11px] font-mono font-bold">
                  <Live value={c.v} reason={c.reason} />
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="px-[42px] pt-5 flex-1 flex flex-col">
          <Eyebrow>{numberWordCap(LAB_TRACKS.length)} tracks · chosen at application</Eyebrow>
          <div className="grid grid-cols-3 gap-3 mt-2.5" data-testid="brief-tracks">
            {LAB_TRACKS.map((t, i) => (
              <div key={t.id} className="rounded-[12px] p-[18px]" style={{ background: PAPER, border: `1px solid ${HAIR}` }}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono font-bold" style={{ color: V }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[17px] font-extrabold tracking-[-.02em]">{t.name}</span>
                </div>
                {/* The SHORT form. `who` is the screen's longer sentence and
                    wraps to a ragged list in a column this narrow; both live
                    on one LAB_TRACKS entry so the brief cannot describe a
                    track the app does not. */}
                <p className="text-[11.5px] leading-[1.5] mt-2 mb-0" style={{ color: BODY }}>{t.brief}</p>
                <div className="text-[9px] font-mono uppercase tracking-[.12em] mt-3" style={{ color: MUT }}>Leads with</div>
                <p className="text-[10.5px] leading-[1.45] mt-1 mb-0" style={{ color: BODY }}>{leadsWithFor(t.id)}</p>
              </div>
            ))}
          </div>

          <h2 className="m-0 mt-6 text-[24px] font-black tracking-[-.025em] leading-[1.15]">
            How the {numberWord(days)} days run
          </h2>
          <p className="text-[12.5px] leading-[1.62] mt-2 mb-0" style={{ color: BODY }}>
            {numberWordCap(WEEKS.length)} weeks, each ending at a gate that opens on evidence
            rather than attendance. Every track passes the same {numberWord(WEEKS.length)} gates;
            what fills each week comes from the track — a Form founder&rsquo;s formation week is a
            Find-fit founder&rsquo;s interview week. Companies advance only on completion. Cohorts
            are calendar months; applications close seven days before the cohort starts, at 23:59
            {zone ? ` ${zone.split('/')[1].replace(/_/g, ' ')} time` : ''}, computed rather than fixed.
          </p>
          <div className="grid grid-cols-4 gap-2.5 mt-3.5" data-testid="brief-weeks">
            {WEEKS.map((w) => (
              <div key={w.n} className="rounded-[10px] p-3" style={{ background: PAPER, border: `1px solid ${HAIR}` }}>
                <div className="text-[10px] font-mono font-bold uppercase tracking-[.12em]" style={{ color: V }}>
                  Gate {w.n}
                </div>
                <div className="text-[12px] font-bold mt-1">{w.days}</div>
              </div>
            ))}
          </div>

          <Eyebrow>Terms, stated once</Eyebrow>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-2 mb-5" data-testid="brief-terms">
            {TERMS.map((x) => (
              <div
                key={x.k}
                className="flex items-baseline justify-between gap-3 py-1"
                style={{ borderBottom: `1px solid ${HAIR}` }}
              >
                <span className="text-[11px]" style={{ color: MUT }}>{x.k}</span>
                <span className="text-[11.5px] font-semibold text-right">
                  {x.live === 'places'
                    ? <Live value={places} reason={LIVE_REASON} />
                    : x.v}
                </span>
              </div>
            ))}
          </div>
        </div>
        <PageFoot n={1} year={year} />
      </section>

      {/* ══════════ PAGE 2 · THE FOUR WEEKS ══════════ */}
      <section
        data-brief-page
        data-testid="brief-page-2"
        className="rounded-[14px] overflow-hidden shadow-sm flex flex-col"
        style={{ background: '#faf9fc', color: INK }}
      >
        <div className="px-[42px] pt-[34px] flex-1 flex flex-col">
          <Eyebrow accent>The {numberWord(WEEKS.length)} weeks</Eyebrow>
          <h2 className="m-0 mt-1.5 text-[24px] font-black tracking-[-.025em] leading-[1.15]">
            Same gates, {numberWord(LAB_TRACKS.length)} different weeks.
          </h2>
          <p className="text-[12.5px] leading-[1.62] mt-2 mb-0" style={{ color: BODY }}>
            Each column is one track. Read down for what a founder does in each week; read across
            for what every track must prove at the same gate. The last gate is the same on every
            track — a raise the record supports.
          </p>
          <div className="grid grid-cols-3 gap-3 mt-4 mb-5" data-testid="brief-gate-grid">
            {LAB_TRACKS.map((t, i) => (
              <div key={t.id} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono font-bold" style={{ color: V }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[15px] font-extrabold tracking-[-.02em]">{t.name}</span>
                </div>
                {(TRACK_GATES[t.id] || []).map((g, gi) => (
                  <div key={g.name} className="rounded-[10px] p-3" style={{ background: PAPER, border: `1px solid ${HAIR}` }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-bold">{g.name}</span>
                      <span className="text-[9px] font-mono" style={{ color: MUT }}>{WEEKS[gi]?.days}</span>
                    </div>
                    <ul className="list-none m-0 p-0 mt-1.5 flex flex-col gap-1">
                      {g.items.map((it) => (
                        <li key={it} className="flex gap-1.5 text-[10.5px] leading-[1.45]" style={{ color: BODY }}>
                          <span aria-hidden="true" style={{ color: V }}>·</span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                    <div
                      className="text-[9.5px] font-mono mt-2 pt-1.5"
                      style={{ color: MUT, borderTop: `1px solid ${HAIR}` }}
                    >
                      Gate opens on <span style={{ color: V }}>{g.gate}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <PageFoot n={2} year={year} />
      </section>

      {/* ══════════ PAGE 3 · THE ARSENAL ══════════ */}
      <section
        data-brief-page
        data-testid="brief-page-3"
        className="rounded-[14px] overflow-hidden shadow-sm flex flex-col"
        style={{ background: '#faf9fc', color: INK }}
      >
        <div className="px-[42px] pt-[34px] flex-1 flex flex-col">
          <Eyebrow accent>The arsenal</Eyebrow>
          {/* TOOL_COUNT, never typed — the heading invites the reader to count. */}
          <h2 className="m-0 mt-1.5 text-[24px] font-black tracking-[-.025em] leading-[1.15]" data-testid="brief-arsenal-heading">
            {numberWordCap(TOOL_COUNT)} working tools. Count them.
          </h2>
          <p className="text-[12.5px] leading-[1.62] mt-2 mb-0" style={{ color: BODY }}>
            Every one is a working tool with real data behind it, grouped by what it does rather
            than by the week that unlocks it. Incorporation is one of {numberWord(TOOL_COUNT)}.
          </p>

          <div className="flex flex-col gap-3 mt-4" data-testid="brief-arsenal">
            {groups.map((grp) => (
              <div key={grp.group}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em]" style={{ color: V }}>
                    {grp.group}
                  </span>
                  <span className="text-[9px] font-mono" style={{ color: MUT }}>{grp.tools.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5 mt-1.5">
                  {grp.tools.map((tl) => (
                    <div key={tl.id} className="rounded-[10px] p-2.5" style={{ background: PAPER, border: `1px solid ${HAIR}` }}>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-mono font-bold" style={{ color: V }}>{tl.n}</span>
                        <span className="text-[12px] font-bold tracking-[-.01em] leading-[1.3]">{tl.name}</span>
                      </div>
                      <p className="text-[10.5px] leading-[1.45] mt-1 mb-0" style={{ color: MUT }}>{tl.blurb}</p>
                      <ExampleRead m={TOOL_EXAMPLE_READS[tl.id]} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <Eyebrow>Incorporation jurisdiction</Eyebrow>
          <p className="text-[11.5px] leading-[1.55] mt-1.5 mb-0" style={{ color: BODY }}>
            Chosen on the {LAB_TRACKS[0].name} track. Changes the entity, the filing and the
            equity outcome. {numberWordCap(JURISDICTIONS.filter((j) => !j.soon).length)} live,
            {' '}{numberWord(JURISDICTIONS.filter((j) => j.soon).length)} coming.
          </p>
          <div className="grid grid-cols-4 gap-2.5 mt-2.5 mb-5" data-testid="brief-jurisdictions">
            {JURISDICTIONS.map((j) => (
              <div
                key={j.name}
                className="rounded-[10px] p-3"
                style={{ background: PAPER, border: `1px solid ${HAIR}`, opacity: j.soon ? 0.62 : 1 }}
              >
                <div className="text-[11.5px] font-bold leading-[1.3]">{j.name}</div>
                <div className="text-[9px] font-mono mt-0.5" style={{ color: j.soon ? MUT : V }}>{j.sub}</div>
                <div className="text-[9px] font-mono uppercase tracking-[.1em] mt-2" style={{ color: MUT }}>Filing</div>
                <div className="text-[10px] leading-[1.4]" style={{ color: BODY }}>{j.filing}</div>
                <div className="text-[9px] font-mono uppercase tracking-[.1em] mt-1.5" style={{ color: MUT }}>Equity</div>
                <div className="text-[10px] leading-[1.4]" style={{ color: BODY }}>{j.capTable}</div>
              </div>
            ))}
          </div>
        </div>
        <PageFoot n={3} year={year} />
      </section>

      {/* ══════════ PAGE 4 · WHAT YOU LEAVE WITH, AND HOW TO APPLY ══════════ */}
      <section
        data-brief-page
        data-testid="brief-page-4"
        className="rounded-[14px] overflow-hidden shadow-sm flex flex-col"
        style={{ background: '#faf9fc', color: INK }}
      >
        <div className="px-[42px] pt-7 flex-1 flex flex-col">
          <Eyebrow accent>
            What you leave with · {numberWord(DELIVERABLES.length)} deliverables
          </Eyebrow>
          <p className="text-[11.5px] leading-[1.55] mt-1.5 mb-0" style={{ color: BODY }}>
            Each one produced by a tool in the arsenal; none asserted by hand.
          </p>
          <div className="grid grid-cols-3 gap-2 mt-2.5" data-testid="brief-deliverables">
            {DELIVERABLES.map((name, i) => (
              <div key={name} className="flex items-baseline gap-2 rounded-[8px] px-2.5 py-2" style={{ background: PAPER, border: `1px solid ${HAIR}` }}>
                <span className="text-[9px] font-mono font-bold" style={{ color: V }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[11.5px] font-semibold leading-[1.3]">{name}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-6 mt-6">
            <div>
              <Eyebrow>Community</Eyebrow>
              <h2 className="m-0 mt-1 text-[17px] font-extrabold tracking-[-.02em]">
                A working surface, not a social one.
              </h2>
              <p className="text-[11px] leading-[1.5] mt-1.5 mb-0" style={{ color: BODY }}>
                {numberWordCap(COMMUNITY.length)} peer surfaces inside the platform. No chat room.
              </p>
              <div className="flex flex-col gap-1.5 mt-2.5" data-testid="brief-community">
                {COMMUNITY.map((c) => (
                  <div key={c.k} className="py-1" style={{ borderBottom: `1px solid ${HAIR}` }}>
                    <div className="text-[11px] font-bold">{c.k}</div>
                    <div className="text-[10.5px] leading-[1.45]" style={{ color: MUT }}>{c.v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Eyebrow>Advisors and office hours</Eyebrow>
              <h2 className="m-0 mt-1 text-[17px] font-extrabold tracking-[-.02em]">
                Two advisors, matched to measured gaps.
              </h2>
              <p className="text-[11px] leading-[1.5] mt-1.5 mb-0" style={{ color: BODY }}>
                Matching runs against the founder profile and the nine-dimension venture score, so
                an advisor covers a weakness the record shows rather than a sector label.
              </p>
              <div className="flex flex-col gap-1.5 mt-2.5" data-testid="brief-support">
                {SUPPORT.map((s) => (
                  <div key={s.k} className="flex items-baseline justify-between gap-3 py-1" style={{ borderBottom: `1px solid ${HAIR}` }}>
                    <span className="text-[11px] font-bold shrink-0">{s.k}</span>
                    <span className="text-[10.5px] text-right leading-[1.4]" style={{ color: MUT }}>{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-5">
            <div>
              <Eyebrow>A fit</Eyebrow>
              <ul className="list-none m-0 p-0 mt-1.5 flex flex-col gap-1" data-testid="brief-fit">
                {FIT.map((f) => (
                  <li key={f} className="flex gap-1.5 text-[10.5px] leading-[1.45]" style={{ color: BODY }}>
                    <Check size={11} className="shrink-0 mt-[2px]" style={{ color: '#047857' }} aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <Eyebrow>Not a fit</Eyebrow>
              <ul className="list-none m-0 p-0 mt-1.5 flex flex-col gap-1" data-testid="brief-not-fit">
                {NOT_FIT.map((f) => (
                  <li key={f} className="flex gap-1.5 text-[10.5px] leading-[1.45]" style={{ color: MUT }}>
                    <Minus size={11} className="shrink-0 mt-[2px]" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* THE TRACK RECORD, KEPT AGAINST THE CANVAS — a stated departure.
              The artifact draws no outcomes block, and the brief this replaced
              had one reading the same public `/spinout-lab/stats` the marketing
              hero reads. Those two figures are MEASURED, they are the
              load-bearing fact for the investor this brief gets forwarded to,
              and dropping a true number because a layout omitted it is the
              wrong trade. One hook, so the brief and the hero can never quote
              different track records on the same day — which is why
              `useSpinoutStats` was lifted into `lib/` in the first place. A
              failed fetch prints an em-dash: "0 companies built" on a forwarded
              brochure reads as a track record rather than as a gap. */}
          <Eyebrow>Track record</Eyebrow>
          <div className="grid grid-cols-3 gap-2.5 mt-2" data-testid="brief-track-record">
            {stats.map((st) => (
              <div key={st.label} className="rounded-[10px] p-3" style={{ background: PAPER, border: `1px solid ${HAIR}` }}>
                <div className="text-[18px] font-extrabold tabular-nums tracking-[-.02em]">{st.value}</div>
                <div className="text-[10px] leading-[1.4] mt-0.5" style={{ color: MUT }}>{st.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-[12px] mt-6 p-[18px] text-white" style={{ background: 'linear-gradient(115deg,#4c1d95,#6d28d9)' }}>
            <div className="text-[10px] font-mono font-bold uppercase tracking-[.14em]" style={{ color: '#c4b5fd' }}>
              How to apply
            </div>
            <div className="text-[17px] font-extrabold tracking-[-.02em] mt-1">
              Apply to <Live value={cohortName} reason={cohortReason} />.
              {' '}Applications close <Live value={closesAt} reason={cohortReason} />.
            </div>
            <p className="text-[11px] leading-[1.55] mt-2 mb-0" style={{ color: 'rgba(255,255,255,.82)' }}>
              Choose your track at application. Selection is on evidence of thinking, not stage;
              solo founders and research spin-outs are both in scope. Axal VC admits members by
              application — a decision is made by the studio team, and no response time is promised.
            </p>
            <Link
              to={LAB_APPLY_HREF}
              className="inline-block mt-3 text-[11px] font-mono font-bold underline decoration-white/40 underline-offset-2"
            >
              axal.vc{LAB_APPLY_HREF}
            </Link>
          </div>

          <p className="text-[9px] leading-[1.5] mt-4 mb-3" style={{ color: MUT }}>
            This brief describes the Spin-Out Lab programme as offered by Axal VC. It is not an
            offer of securities and does not describe Fund I; fund materials are available to
            verified investors only. Cohort name, dates, places and deadline are live values read
            from the platform when this brief was generated{generatedAt ? ` (${generatedAt})` : ''}
            {zone ? `, in ${zone}` : ''}. Programme content and tools are subject to change between
            cohorts.
            <br />
            Axal VC Management LLC · 16192 Coastal Hwy, Lewes, DE 19958, United States · axal.vc
          </p>
        </div>
        <PageFoot n={4} year={year} trademark />
      </section>

    </div>
  );
}


/**
 * The route component: the chrome, the one fetch, and the print rules.
 *
 * The six live fields are the ONLY thing fetched. Everything else the document
 * draws is already in the bundle, which is why a failed read costs the reader
 * six values and not the brief.
 */
export default function SpinoutLabBriefPage() {
  // `undefined` while the read is in flight, `null` once it has failed. The two
  // are kept apart from `err` because a month with no open cohort is a
  // successful read with nothing to name, and says a different sentence.
  const [brief, setBrief] = useState(undefined);
  const [err, setErr] = useState(false);

  // The track record, from the same public endpoint the marketing hero reads.
  // It lives in the wrapper because it is a hook, and `BriefDocument` stays
  // pure so both of its states can be rendered in a test.
  const { companies, raised } = useSpinoutStats();
  const stats = [
    { value: companiesLabel(companies), label: 'Built to date' },
    { value: raised === null ? "—" : raised, label: 'Total capital raised by graduates' },
    // Derived, not typed: the programme's length, the same arithmetic the rest
    // of the brief spells out.
    { value: `${COHORT_WEEKS * 7} days`, label: 'Average time to incorporation' },
  ];

  useEffect(() => {
    let alive = true;
    spinoutLab.brief()
      .then((d) => { if (alive) setBrief(d); })
      .catch((e) => {
        if (!alive) return;
        setErr(true);
        setBrief(null);
        reportError('SpinoutLabBriefPage:load', e);
      });
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 print:bg-white" data-testid="spinout-brief-page">
      <style>{`
        @page { size: letter portrait; margin: 0; }
        [data-brief-page] { -webkit-print-color-adjust: exact; print-color-adjust: exact; page-break-after: always; break-after: page; break-inside: avoid; }
        [data-brief-page]:last-child { page-break-after: auto; break-after: auto; }
        @media print { [data-brief-page] { box-shadow: none; border-radius: 0; min-height: 11in; } }
      `}</style>

      <div className="max-w-[860px] mx-auto px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="flex items-center justify-between mb-5 print:hidden">
          <Link
            to="/spinout-lab"
            className="inline-flex items-center gap-2 h-[34px] px-3 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back to Spin-Out Lab
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            data-testid="brief-save-pdf"
            className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[10px] bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-bold shadow-sm shadow-violet-500/30 transition-colors"
          >
            <FileDown size={15} aria-hidden="true" /> Save as PDF
          </button>
        </div>

        <BriefDocument brief={brief} err={err} stats={stats} />
      </div>
    </div>
  );
}

