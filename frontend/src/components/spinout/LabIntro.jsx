import React from 'react';
import { Link } from 'react-router-dom';
import {
  LAB_BTN_GHOST_ON_DARK, LAB_BTN_ON_DARK, LAB_CARD, LAB_CARD_SUNKEN,
  LAB_CHOICE, LAB_CHOICE_ON, LAB_CHOICE_SOON, LAB_EYEBROW, LAB_EYEBROW_ON_DARK,
  LAB_H2, LAB_HAIRLINE, LAB_LEDE, LAB_ON_DARK_FIGURE, LAB_ON_DARK_MUTED,
  LAB_PANEL_HEX, LAB_SURFACE, LAB_TAG_LEAD, LAB_TAG_SOON, LAB_TOOL, LAB_TOOL_LEAD,
} from './labIntroStyles';
import {
  LAB_JURISDICTIONS, PIPELINE_PHASES, labJurisdiction, pipelineItemsFor,
} from '../../lib/spinoutLab';
import {
  LAB_TRACKS, TOOL_COUNT, arsenalFor, labTrack, leadsWithFor,
} from '../../lib/spinoutLabArsenal';

/**
 * The Spin-Out Lab introduction — one design, two surfaces.
 *
 * DESIGN HANDOFF: `design/canvases/integrated/Spin-Out Lab · Intro.dc.html`,
 * which draws both surfaces from a single `surfaces` list for exactly the
 * reason this component exists: `/spinout-lab` logged out and `/spinout-lab`
 * signed-in-but-not-applied were two hand-maintained copies of the same page
 * (header, hero, pipeline, deliverables — five duplicated blocks between
 * `SpinoutLabMarketingPage.jsx` and `Dashboard`), and they had already drifted.
 *
 * WHAT THE REPOSITIONING IS. The page used to lead with a 76px "28 days" and
 * "From idea to incorporated", which undersold the product — incorporation is
 * one of nineteen working tools — and quietly excluded the founders it should
 * attract, since anyone with a company read "idea → incorporated" and left.
 * The exclusion was never real: `users.is_incorporated` is set only by
 * finishing or quitting the Lab, never by arriving with an entity. So the page
 * now leads with speed, the arsenal and the cohort, and names three starting
 * points instead of one.
 *
 * WHAT THE CANVAS ASKED FOR THAT IS NOT HERE, AND WHY:
 *
 *   · PER-TRACK GATES. It draws each track its own four gates ("Structure",
 *     "Size", "Scope"…). The product enforces ONE gate set — `MILESTONES` in
 *     the worker's spinoutLabCatalog — identically for everyone. Four invented
 *     gate sets would tell a founder that week 2 asks something it does not.
 *     The gates render from `PIPELINE_PHASES` and the page says out loud that
 *     they are the same whichever track you pick.
 *
 *   · A "YOURS" TAG on tools the member supposedly already has. Nothing
 *     answers that question. `state.unlocked_features` describes the week a
 *     founder has reached INSIDE the Lab, which is a different question, and
 *     this surface's whole audience has not started. Dropped rather than
 *     guessed.
 *
 *   · FOUNDER-TO-FOUNDER ASKS, drawn with three sample questions. No table
 *     holds a founder-to-founder request, and `/cohort` deliberately never
 *     returns founder identity, so there would be nobody to address one to.
 *     The Community section says that instead of drawing it.
 *
 *   · ITS SAMPLE COHORT — Halyard Security, Verity Health, LoopSense, Kelp
 *     Bio, and a feed of what they shipped. Those companies do not exist. The
 *     directory reads the live `/cohort` endpoint and the feed reads
 *     `/shipped`; when either is empty it says so.
 *
 *   · A SEAT COUNT ("8 spots available"). Nothing stores one.
 *
 * WHY THE ARSENAL CARDS ARE NOT LINKS: see `lib/spinoutLabArsenal.js`. Every
 * `/spinout-lab/<tool>` route is guarded on `spinout_lab_active === 1`, and
 * this surface is by construction the not-yet-active branch, so every card
 * would bounce. They render inert, and the page says why.
 *
 * SURFACE DIFFERENCES are deliberately tiny — three things, listed at
 * `LabIntro` below. Everything else is byte-identical between the two, which
 * is the point.
 */

/* ── Hero ─────────────────────────────────────────────────────────────── */

/**
 * Full-bleed. On the public surface it runs the whole viewport width; signed
 * in it runs from the sidebar's right border to the viewport edge, which is
 * why `/spinout-lab` is in `SHARED_FULL_BLEED` (frontend/src/sidebarConfig.js)
 * — the shell's own `p-4 md:p-6` is what used to stop it.
 */
export function LabHero({ surface, cohort, applyHref, briefHref }) {
  const rows = [
    ['Cohort', cohort ? `Cohort ${cohort.cohortNum}` : null],
    ['Starts', cohort?.startLabel ?? null],
    ['Ends', cohort?.endLabel ?? null],
    ['Applications close', cohort?.deadlineLabel ?? null],
  ];
  return (
    <section
      className="relative overflow-hidden text-white"
      style={{ backgroundColor: LAB_PANEL_HEX }}
    >
      <img
        src="/axal-vc-future.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-[72%_58%]"
      />
      {/* The scrim is built from the one panel constant rather than a second
          set of hex literals, so the hero can never drift from the apply band
          that closes the page. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            `linear-gradient(94deg, ${LAB_PANEL_HEX}f2 0%, ${LAB_PANEL_HEX}e0 46%,`
            + ` ${LAB_PANEL_HEX}85 70%, ${LAB_PANEL_HEX}38 100%)`,
        }}
      />
      <div
        className={`relative mx-auto grid max-w-[1240px] gap-10 px-6 pb-12 sm:px-10
          lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.85fr)] lg:items-end
          ${surface === 'public' ? 'pt-32' : 'pt-12'}`}
      >
        <div>
          <div className={LAB_EYEBROW_ON_DARK}>
            Spin-Out Lab · 28 days · {TOOL_COUNT} tools · one cohort a month
          </div>
          <h1 className="mt-4 max-w-[760px] text-[32px] font-black leading-[1.06] tracking-[-.035em] text-balance sm:text-[46px]">
            Four weeks of execution, with the whole arsenal and a cohort beside you.
          </h1>
          <p className={`mt-5 max-w-[600px] text-[15px] leading-relaxed ${LAB_ON_DARK_MUTED}`}>
            {TOOL_COUNT} working tools, four gates that open on evidence, matched advisors,
            and the founders building alongside you this month. Incorporation is one of the
            {' '}{TOOL_COUNT} — leading for those who need it, quiet for those who already
            have an entity.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link className={LAB_BTN_ON_DARK} to={applyHref}>
              {cohort ? `Apply to Cohort ${cohort.cohortNum}` : 'Apply to the next cohort'} →
            </Link>
            <Link className={LAB_BTN_GHOST_ON_DARK} to={briefHref}>
              Download the programme brief
            </Link>
          </div>
        </div>

        <div className="rounded-axal-xl border border-white/20 bg-black/25 p-5 backdrop-blur-sm">
          <div className={LAB_EYEBROW_ON_DARK}>Next cohort</div>
          <dl className="mt-3 grid gap-3">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-2.5"
              >
                <dt className={`text-[12px] ${LAB_ON_DARK_MUTED}`}>{label}</dt>
                {/* Absent renders as absent. The cohort calendar is computed,
                    so a null here means the computation threw — which is a
                    different thing from a date, and must not read as one. */}
                <dd className={value ? LAB_ON_DARK_FIGURE : 'text-[12px] italic text-white/45'}>
                  {value ?? 'Not recorded'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11px] leading-relaxed text-white/50">
            Read from the cohort calendar. The deadline is computed as seven days before the
            start, 23:59 Delaware time — never typed.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Tracks ───────────────────────────────────────────────────────────── */

export function LabTracks({ value, onChange }) {
  return (
    <section className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-5">
        <div>
          <div className={LAB_EYEBROW}>Three starting points</div>
          <h2 className={`mt-1.5 ${LAB_H2}`}>Where is the company today?</h2>
        </div>
        <p className={`max-w-[380px] ${LAB_LEDE}`}>
          Chosen at application. The track changes which tools lead — it does not change
          the gates.
        </p>
      </div>

      <div role="radiogroup" aria-label="Track" className="mt-5 grid gap-2.5 sm:grid-cols-3">
        {LAB_TRACKS.map((t, i) => {
          const on = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(t.id)}
              className={on ? LAB_CHOICE_ON : LAB_CHOICE}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
                  {t.name}
                </span>
                <span className="font-mono text-[9.5px] text-axal-muted dark:text-gray-400">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </span>
              <span className="mt-1.5 block text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                {t.who}
              </span>
              <span className="mt-2 block text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-500">
                Leads with {leadsWithFor(t.id)}.
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── Gates ────────────────────────────────────────────────────────────── */

/**
 * Four weeks, from `PIPELINE_PHASES` — the same list the signed-in workspace
 * and the printable brief render, and the one already reconciled against the
 * worker's `MILESTONES`. It takes NO track prop, which is what makes "the
 * gates do not vary by track" a structural fact rather than a convention
 * someone has to remember.
 */
export function LabGates({ jurisdiction }) {
  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-5">
        <div>
          <div className={LAB_EYEBROW}>The rhythm</div>
          <h2 className={`mt-1.5 ${LAB_H2}`}>
            Four weeks. Each ends at a gate that opens on evidence.
          </h2>
        </div>
        <p className={`max-w-[380px] ${LAB_LEDE}`}>
          The four gates are the same for every track today. The track you pick changes
          which tools lead, not what the gates require.
        </p>
      </div>

      <ol className="mt-6 grid gap-3 lg:grid-cols-4">
        {PIPELINE_PHASES.map((phase, i) => (
          <li key={phase.name}>
            <div className="flex items-center gap-2.5 px-1">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-axal-pill bg-axal-violet-deep font-mono text-[10.5px] font-bold text-white">
                {i + 1}
              </span>
              <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">
                {phase.days}
              </span>
            </div>
            <div className={`mt-2.5 p-4 ${LAB_CARD}`}>
              <div className="text-[16px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">
                {phase.name}
              </div>
              <ul className="mt-2.5 grid gap-1.5">
                {pipelineItemsFor(phase, jurisdiction).map((item) => (
                  <li key={item} className="flex gap-2 text-[12px] leading-snug text-gray-600 dark:text-gray-400">
                    <span aria-hidden="true" className="text-axal-violet-deep dark:text-violet-400">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className={`mt-3 border-t pt-2.5 ${LAB_HAIRLINE}`}>
                <div className={LAB_EYEBROW}>Gate opens on</div>
                <p className="mt-1 text-[12px] leading-snug text-gray-600 dark:text-gray-400">
                  {phase.gate}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── Arsenal ──────────────────────────────────────────────────────────── */

export function LabArsenal({ track }) {
  const groups = arsenalFor(track);
  const trackName = labTrack(track).name;
  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-5">
        <div>
          <div className={LAB_EYEBROW}>The arsenal</div>
          <h2 className={`mt-1.5 ${LAB_H2}`}>{TOOL_COUNT} working tools. Count them.</h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11.5px] text-gray-600 dark:text-gray-400">
          <span className="h-3 w-3 rounded-[3px] border border-violet-300 bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40" />
          Leads on {trackName}
        </span>
      </div>

      <div className="mt-5 grid gap-5">
        {groups.map(({ group, tools }) => (
          <div key={group}>
            <div className="mb-2 flex items-baseline gap-2.5">
              <span className={LAB_EYEBROW}>{group}</span>
              <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">
                {tools.length} of {TOOL_COUNT}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {tools.map((t) => (
                /* Not a link. See the file header and lib/spinoutLabArsenal.js:
                   every tool route is gated on an active Lab enrolment, which
                   nobody reading this page has. */
                <div key={t.id} className={t.lead ? LAB_TOOL_LEAD : LAB_TOOL}>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-mono text-[9.5px] text-axal-muted dark:text-gray-500">
                      {t.n}
                    </span>
                    {t.lead && <span className={LAB_TAG_LEAD}>Leads</span>}
                  </div>
                  <div className="mt-1 text-[12.5px] font-extrabold leading-tight tracking-[-.01em] text-axal-ink dark:text-gray-100">
                    {t.name}
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-axal-muted dark:text-gray-500">
                    {t.blurb}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className={`mt-4 text-[12px] leading-relaxed ${LAB_CARD_SUNKEN} p-3.5 text-gray-600 dark:text-gray-400`}>
        All {TOOL_COUNT} open inside the Lab workspace, against one company on one clock.
        None of them is reachable from this page — a cohort has to admit you first — which
        is why nothing above is a link.
      </p>
    </section>
  );
}

/* ── Jurisdiction ─────────────────────────────────────────────────────── */

/**
 * Incorporation, demoted from the hero to one card among the nineteen. Reads
 * `LAB_JURISDICTIONS` — seven entries, two live — rather than the canvas's own
 * four, because a surface that draws only the four it feels like drawing tells
 * a founder the other three do not exist.
 */
export function LabJurisdictionCard({ value, onChange, track }) {
  const j = labJurisdiction(value);
  const leadsHere = labTrack(track).leads.includes('inc');
  const index = arsenalFor(track).flatMap((g) => g.tools).find((t) => t.id === 'inc')?.n;
  return (
    <section className="mt-10">
      <div className={`p-5 ${leadsHere ? 'rounded-axal-xl border border-violet-200 bg-axal-lavender dark:border-violet-900 dark:bg-violet-950/25' : LAB_CARD}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-5">
          <div>
            <div className={LAB_EYEBROW}>Tool {index} · Incorporation</div>
            <div className="mt-1 text-[16px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">
              {leadsHere
                ? 'Leads on the Form track. Pick the jurisdiction.'
                : `Quiet on ${labTrack(track).name} — your entity already exists. Shown for reference.`}
            </div>
          </div>
          <p className={`max-w-[380px] ${LAB_LEDE}`}>
            The entity, the filing and the equity record all follow the selection. Two are
            live; the rest are marked as such rather than left to look available.
          </p>
        </div>

        <div role="radiogroup" aria-label="Incorporation jurisdiction" className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {LAB_JURISDICTIONS.map((row) => {
            const on = !row.soon && row.key === j.key;
            return (
              <button
                key={row.key}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={Boolean(row.soon)}
                onClick={row.soon ? undefined : () => onChange(row.key)}
                className={row.soon ? LAB_CHOICE_SOON : (on ? LAB_CHOICE_ON : LAB_CHOICE)}
              >
                <span className="flex items-center justify-between gap-1.5">
                  <span className={`text-[12.5px] font-extrabold ${row.soon ? 'text-axal-muted dark:text-gray-500' : 'text-axal-ink dark:text-gray-100'}`}>
                    {row.label}
                  </span>
                  {row.soon && <span className={LAB_TAG_SOON}>Soon</span>}
                </span>
                <span className="mt-0.5 block text-[11px] text-axal-muted dark:text-gray-500">
                  {row.entity}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[['Entity', j.entity], ['Equity', 'Vesting cap table'], ['Filing', j.filingName]].map(([k, v]) => (
            <div key={k} className={`p-3 ${LAB_CARD}`}>
              <div className={LAB_EYEBROW}>{k}</div>
              <div className="mt-1 text-[13px] font-bold text-axal-ink dark:text-gray-100">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Community ────────────────────────────────────────────────────────── */

const WEEK_NAME = (week) => PIPELINE_PHASES[Math.max(0, Math.min(3, week - 1))]?.name ?? null;

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '?';
}

/**
 * The cohort, from live reads only.
 *
 * `directory` is `GET /cohort` — public, company working names and the week
 * each is on, never a founder name. `shipped` is `GET /shipped` — signed in
 * only, and gate-level rather than milestone-level, because "cleared Pitch"
 * adds a timestamp to a week that is already public whereas "filed its 83(b)"
 * is a material fact about a private company that nobody consented to publish.
 *
 * The third panel the canvas drew — founder-to-founder asks — is stated, not
 * rendered. Nothing stores one.
 */
export function LabCommunity({ surface, directory, shipped }) {
  const active = (directory?.rows || []).filter((m) => m.status === 'active');
  const events = shipped?.rows || [];
  return (
    <section className="mt-16">
      <div className={LAB_EYEBROW}>The cohort</div>
      <h2 className={`mt-1.5 ${LAB_H2}`}>Who else is building this month.</h2>
      <p className={`mt-2 max-w-[640px] ${LAB_LEDE}`}>
        A working surface, not a social one. Every entry below is a record the product
        already holds — and where it holds none, this says so instead of drawing one.
      </p>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {/* Directory — live, public */}
        <div className={`p-4 ${LAB_CARD}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={LAB_EYEBROW}>In the sprint now</span>
            {/* Only a count we actually read. No count when the read failed. */}
            {!directory?.loading && !directory?.error && (
              <span className="font-mono text-[11px] font-bold text-axal-ink dark:text-gray-200">
                {active.length}
              </span>
            )}
          </div>
          <div className="mt-3">
            {directory?.loading && (
              <p className="text-[12px] text-axal-muted dark:text-gray-500">Reading the cohort…</p>
            )}
            {!directory?.loading && directory?.error && (
              <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
                The cohort could not be read, so this is blank because we do not know — not
                because nobody is in it.
              </p>
            )}
            {!directory?.loading && !directory?.error && active.length === 0 && (
              <p className="text-[12px] leading-relaxed text-axal-muted dark:text-gray-500">
                No company is in the sprint right now. The next cohort starts on the 1st.
              </p>
            )}
            <ul className="grid gap-2">
              {active.map((m) => (
                <li key={`${m.name}-${m.started_at}`} className={`flex items-center gap-2.5 border-t pt-2 ${LAB_HAIRLINE}`}>
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-axal-sm bg-axal-lavender text-[10.5px] font-extrabold text-axal-violet-deep dark:bg-violet-950/40 dark:text-violet-300">
                    {initials(m.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold text-axal-ink dark:text-gray-100">
                      {m.name}
                    </span>
                    <span className="block text-[11px] text-axal-muted dark:text-gray-500">
                      {m.sector || 'Sector not recorded'} · gate {m.week} of 4
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-axal-muted dark:text-gray-500">
            Company names and gate positions only. The cohort read returns no founder names,
            emails or ids, so none can be shown here.
          </p>
        </div>

        {/* Shipped — live, signed in only */}
        <div className={`p-4 ${LAB_CARD}`}>
          <span className={LAB_EYEBROW}>Gates cleared recently</span>
          <div className="mt-3">
            {surface === 'public' ? (
              <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
                Visible inside the Lab. What a cohort company has cleared is reported to the
                cohort, not to the open web.
              </p>
            ) : (
              <>
                {shipped?.loading && (
                  <p className="text-[12px] text-axal-muted dark:text-gray-500">Reading…</p>
                )}
                {!shipped?.loading && shipped?.error && (
                  <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
                    That could not be read just now.
                  </p>
                )}
                {!shipped?.loading && !shipped?.error && events.length === 0 && (
                  <p className="text-[12px] leading-relaxed text-axal-muted dark:text-gray-500">
                    No gate has been cleared in the last three weeks.
                  </p>
                )}
                <ul className="grid gap-2">
                  {events.map((e) => (
                    <li key={`${e.company}-${e.week}-${e.cleared_at}`} className={`border-t pt-2 ${LAB_HAIRLINE}`}>
                      <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{e.company}</span>{' '}
                      <span className="text-[12.5px] text-gray-600 dark:text-gray-400">
                        cleared {WEEK_NAME(e.week) || `gate ${e.week}`}.
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-axal-muted dark:text-gray-500">
                        {String(e.cleared_at || '').slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-axal-muted dark:text-gray-500">
            Gates, not deliverables. Which week turned is already public; what a company
            filed inside it is not ours to publish.
          </p>
        </div>

        {/* Asks — stated, not drawn */}
        <div className={`p-4 ${LAB_CARD_SUNKEN}`}>
          <span className={LAB_EYEBROW}>Founder-to-founder asks</span>
          <p className="mt-3 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
            This does not exist yet. No store holds a question from one founder to another,
            and the cohort read deliberately returns no founder identity — so there would be
            nobody to address one to.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
            Office hours and matched advisors are the routes to an answer today, and both are
            in the arsenal above.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Apply ────────────────────────────────────────────────────────────── */

export function LabApplyBand({ cohort, applyHref, briefHref, track }) {
  return (
    <section className="mt-16 pb-16">
      <div
        className="flex flex-wrap items-center justify-between gap-8 rounded-axal-xl p-8 text-white sm:p-10"
        style={{ backgroundColor: LAB_PANEL_HEX }}
      >
        <div className="max-w-[580px]">
          <div className={LAB_EYEBROW_ON_DARK}>How to apply</div>
          <h2 className="mt-2 text-[24px] font-black tracking-axal-heading">
            Apply on the {labTrack(track).name} track.
          </h2>
          <p className={`mt-2.5 text-[14px] leading-relaxed ${LAB_ON_DARK_MUTED}`}>
            {cohort?.deadlineLabel ? (
              <>
                Applications close{' '}
                <span className={LAB_ON_DARK_FIGURE}>{cohort.deadlineLabel}</span> — seven days
                before the cohort starts, at 23:59 Delaware time.{' '}
              </>
            ) : (
              <>Applications close seven days before the cohort starts, at 23:59 Delaware time. </>
            )}
            Selection is on evidence of thinking. No equity is taken for taking part.
          </p>
          {/* The track is a reading aid, not a record. Saying so here is the
              alternative to carrying a ?track= param the register page would
              drop in silence. */}
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/45">
            The track you picked above is not carried into the form — nothing stores one yet.
            The application asks where the company is, and that answer is what an admission
            decision reads.
          </p>
        </div>
        <div className="flex flex-none flex-col gap-2.5">
          <Link className={LAB_BTN_ON_DARK} to={applyHref}>
            {cohort ? `Apply to Cohort ${cohort.cohortNum}` : 'Apply to the next cohort'} →
          </Link>
          <Link className={LAB_BTN_GHOST_ON_DARK} to={briefHref}>
            Download the programme brief
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Composition ──────────────────────────────────────────────────────── */

/**
 * `surface` changes exactly three things, and nothing else:
 *
 *   1. the hero's top clearance — the public page has a `fixed` PublicNav to
 *      clear, the signed-in one sits under the app header already;
 *   2. whether the Gates section carries the "preselected" note;
 *   3. whether the shipping feed renders or states its limit.
 *
 * Everything else is identical, which is what makes this one design in two
 * places rather than two designs that happen to rhyme.
 */
export default function LabIntro({
  surface,
  cohort,
  applyHref,
  briefHref = '/spinout-lab/brief',
  track,
  onTrack,
  jurisdiction,
  onJurisdiction,
  directory,
  shipped,
  preselectNote = null,
  children = null,
}) {
  return (
    <div className={LAB_SURFACE}>
      <LabHero surface={surface} cohort={cohort} applyHref={applyHref} briefHref={briefHref} />
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10">
        {preselectNote && (
          <p className="mt-8 inline-flex items-center gap-2.5 rounded-axal-sm border border-violet-200 bg-axal-lavender px-3 py-2 text-[12.5px] text-gray-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-gray-300">
            <span className={LAB_TAG_LEAD}>Preselected</span>
            {preselectNote}
          </p>
        )}
        <LabTracks value={track} onChange={onTrack} />
        <LabGates jurisdiction={jurisdiction} />
        <LabArsenal track={track} />
        <LabJurisdictionCard value={jurisdiction} onChange={onJurisdiction} track={track} />
        <LabCommunity surface={surface} directory={directory} shipped={shipped} />
        {children}
        <LabApplyBand cohort={cohort} applyHref={applyHref} briefHref={briefHref} track={track} />
      </div>
    </div>
  );
}
