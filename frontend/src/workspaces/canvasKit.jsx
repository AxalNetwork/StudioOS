import React from 'react';
import { Card, Pill } from '../ui';

/**
 * The anatomy every Partner Research and Network artboard is built from.
 *
 * WHY THIS FILE EXISTS. `design/incoming/Pages · Partner Research.dc.html` and
 * `… Network.dc.html` render seven pages out of ONE template: the same
 * `sc-for` over `PAGES`, the same four-up `adds` strip, the same `instTitle` /
 * `instMeta` / `head` / `rows` / `instNote` card, the same `legend`, the same
 * `pair` note, the same closing AI band. What differs between the seven is
 * data. Building that anatomy seven times is how this repo ended up with three
 * copies of one CSV escaper that disagree with each other, and with three
 * copies of `NoStoreYet` that all asked for a tint no `@theme` block declares.
 *
 * WHAT IS HERE AND WHAT IS NOT. Structure and marks are here. Copy is not:
 * every heading, note and label is the artboard's own and belongs on the page
 * that draws it, where a reader comparing the two can see them side by side.
 *
 * THE UNDECLARED-TOKEN TRAP, AVOIDED DELIBERATELY. `axal-ink-2`, `axal-ink-3`,
 * `axal-surface-2` and `axal-border-soft` are used 399 times across
 * `frontend/src` and are declared in NO `@theme` block — `index.css` declares
 * `axal-ink`, `-ground`, `-hairline`, `-faint`, `-muted`, the violets, the
 * lavender and the ambers, and nothing else. Tailwind v4 emits nothing for the
 * rest, so those elements render at inherited colour and always have.
 * `NoStoreYet` records the same finding for its own three. Nothing new here
 * reaches for one; the greys below are the ones that actually paint.
 */

/** The uppercase micro-label the artboards put above a figure. */
export function Eyebrow({ children, className = '' }) {
  return (
    <div className={`text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300 ${className}`}>
      {children}
    </div>
  );
}

/**
 * `Not recorded`, as a chip rather than a sentence.
 *
 * THE ARTBOARDS DRAW THIS AND D56 REFUSED TO. Both are right about different
 * things, and the distinction is who the absence belongs to. A tile reading
 * "Not recorded" because THE PRODUCT never built the store is design
 * commentary on a customer's screen — that is the `Sectors covered` /
 * `Net revenue retention` case D56 reversed, and those tiles are still not
 * drawn. A cell reading "Not recorded" because THE READER'S OWN RECORD has no
 * such fact is a true and useful statement about their data: Client prep's
 * `Their Q4 budget` says the client has never shared one, and Market's
 * `Retainer rate` says the firm has never run that reading. Those are the
 * page's findings, not apologies for the page.
 */
export function NotRecorded({ children = 'Not recorded' }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[4px] border border-gray-200 bg-gray-50 px-[7px] py-0.5 text-[10px] font-bold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
      {children}
    </span>
  );
}

/**
 * The metered banner — a published rate, what the cache does to it, and what
 * this session has spent.
 *
 * THE RATE IS NEVER TYPED HERE. `railModels.js` states the rule and D13/D16 are
 * the decisions behind it: a model's name, id and rate are FACTS and come from
 * `GET /api/ai/pricing`, which reads the router's own tables; only editorial
 * copy is written by hand. The artboard quotes `$0.440 / M in · $0.014 cached`
 * for a model this product does not run — its Research curation is DeepSeek in
 * the design and Llama 3.3 70B in the router — so transcribing those figures
 * would put a competitor's price list on the page under our own model's work.
 * The caller passes what the pricing endpoint returned.
 */
export function MeteredNote({ rate, spent, children }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 dark:border-amber-900 dark:bg-amber-950/25">
      <Eyebrow className="!text-[9px] text-axal-amber-deep dark:text-amber-300">Metered</Eyebrow>
      <span className="min-w-[280px] flex-1 text-[11.5px] leading-relaxed text-gray-700 dark:text-gray-300">{children}</span>
      {rate && <span className="whitespace-nowrap font-mono text-[11.5px] font-extrabold text-axal-amber-deep dark:text-amber-300">{rate}</span>}
      {spent && <span className="whitespace-nowrap font-mono text-[10.5px] text-gray-600 dark:text-gray-400">{spent}</span>}
    </div>
  );
}

/**
 * The `legend` row: cyan is theirs, amber is ours.
 *
 * Rendered only where a table actually carries both marks. A legend over rows
 * that are all one source explains a distinction the reader cannot see, which
 * is the same defect as a filter chip that selects everything.
 */
export function SourceLegend({ theirs = 'Founder-sourced', theirsNote, ours = 'Ours', oursNote }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10.5px] text-gray-600 dark:text-gray-400">
      <span className="inline-flex items-center gap-1.5">
        <Pill tone="seam" className="!text-[9.5px]">{theirs}</Pill>{theirsNote}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Pill tone="warn" className="!text-[9.5px]">{ours}</Pill>{oursNote}
      </span>
    </div>
  );
}

/**
 * One cell of an instrument row.
 *
 * `text` is the value; everything else is a mark ON the value, which is why
 * they compose rather than replacing it — the artboards draw `Verwood — SOW`
 * WITH an `Ours` chip, and `105 d old` WITH a `Blocked from proposals` chip.
 * `sub` is the provenance line the artboards put under a value in small grey:
 * `11 comparables`, `Delivery · deliverables log`.
 *
 * `orph` AND `gate` ARE THE NETWORK CANVAS'S OWN TWO MARKS, and they are named
 * here rather than folded into `pill` because the canvas names them: its
 * `cell()` takes `{ pill, seam, ours, orph, gate, nr, sub }` and gives `.orph`
 * and `.gate` their own square-badge rules beside `.seam` and `.ours`, distinct
 * from the round `pill()` factory. A page that writes `orph:'Orphaned'` reads
 * against the artboard line for line; one that writes `pill:'Orphaned',
 * pillTone:'danger'` says the same thing in a vocabulary the artboard does not
 * use, and the next reader has to work out that they match.
 *
 * `rvk` AND THE BAR ARE THE OFFERS CANVAS'S TWO, on the same grounds. Its
 * `cell()` factory takes `{ pill, seam, rvk, gate, nr, barPct, barColor }` and
 * gives `.rvk` its own red rules — `#b91c1c` on `#fef2f2` inside `#fecaca` —
 * separate from every other badge, because the thing it marks is separate: a
 * grant that an expiry TOOK BACK, on the date it took it. `stale` is the
 * nearest existing mark and is the wrong word for it.
 *
 * THE BAR IS A SECOND ENCODING OF THE CELL'S OWN TEXT, never a figure of its
 * own. `po2` draws it under `4 of 10` at `barPct: 40`, so a reader who cannot
 * judge the ratio from the numbers can see it — and it is drawn only where the
 * caller passes a percentage it computed from that same pair.
 */
/**
 * The Delivery canvas's legend, which is three entries rather than two.
 *
 * `SourceLegend` above is the TWO-ENTRY special case — cyan theirs, amber ours —
 * and it stays because five Research and Network artboards draw exactly that.
 * `Pages · Partner Delivery` draws a third: a violet grant, and the same grant
 * struck through once the founder revokes it. A caller passes the artboard's
 * own list rather than a fixed pair.
 *
 * Rendered only where the table actually carries the marks it explains. A
 * legend over rows that are all one kind explains a distinction the reader
 * cannot see, which is the same defect as a chip that selects everything.
 */
export function Legend({ items }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10.5px] text-gray-600 dark:text-gray-400">
      {items.map((it) => (
        <span key={it.chip} className="inline-flex items-center gap-1.5">
          {it.grant
            ? <GrantMark revoked={it.revoked}>{it.chip}</GrantMark>
            : <Pill tone={it.tone || 'neutral'} className="!text-[9.5px]">{it.chip}</Pill>}
          {it.note}
        </span>
      ))}
    </div>
  );
}

/**
 * The violet grant mark, and its revoked form.
 *
 * NAMED HERE BECAUSE THE CANVAS NAMES IT. `Pages · Partner Delivery`'s `cell()`
 * takes `{ grant, revoked }` and gives `.grant` its own violet rules
 * (`#5b21b6` on `#f7f4ff` inside `#ddd6fe`), with `.grant.rv` re-colouring to
 * grey and striking the text through. It is not a status: it says a founder
 * granted a named, revocable scope to a named operator, which is a different
 * relationship from a file handed over — the artboard's own instNote turns on
 * exactly that. Reaching for `pill` and a tone would say it in a vocabulary the
 * artboard does not use.
 *
 * REVOKED IS STRUCK THROUGH RATHER THAN REMOVED. "A founder closing a seat is a
 * normal event in this bucket, not an error state", and a mark that vanished
 * would leave the row looking like a project.
 */
export function GrantMark({ children, revoked = false }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-[4px] border px-[6px] py-0.5 text-[9.5px] font-bold ${
        revoked
          ? 'border-gray-200 bg-gray-50 text-gray-500 line-through dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
          : 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The `mode` chip — the Offers and Delivery canvases' own square badge for a
 * value that is STRUCTURAL rather than a state: how a service is charged, and
 * whether an engagement is a project or an embedded seat. Both canvases give it
 * `.mode` and a per-value colour, distinct from the round status pill.
 */
const MODE_CLASS = {
  Project: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  Embedded: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300',
};

export function ModeMark({ children }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[4px] border px-[7px] py-0.5 text-[9.5px] font-extrabold tracking-[.04em] ${
        MODE_CLASS[children] || 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }`}
    >
      {children}
    </span>
  );
}

export function Cell({
  text, pill, pillTone = 'neutral', seam, ours, orph, gate, stale, cite, rvk, nr, sub,
  mode, grant, grantRevoked = false, barPct, barColor = '#b45309', node,
}) {
  return (
    <span className="min-w-0 text-[11.5px] text-axal-ink dark:text-gray-200">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {text ? <span className="min-w-0 break-words">{text}</span> : null}
        {pill ? <Pill tone={pillTone} className="!text-[9.5px]">{pill}</Pill> : null}
        {seam ? <Pill tone="seam" className="!text-[9.5px]">{seam}</Pill> : null}
        {ours ? <Pill tone="warn" className="!text-[9.5px]">{ours}</Pill> : null}
        {orph ? <Pill tone="danger" className="!text-[9.5px]">{orph}</Pill> : null}
        {gate ? <Pill tone="neutral" className="!text-[9.5px]">{gate}</Pill> : null}
        {stale ? <Pill tone="danger" className="!text-[9.5px]">{stale}</Pill> : null}
        {cite ? <Pill tone="cite" className="!text-[9.5px]">{cite}</Pill> : null}
        {rvk ? <Pill tone="danger" className="!text-[9.5px]">{rvk}</Pill> : null}
        {mode ? <ModeMark>{mode}</ModeMark> : null}
        {grant ? <GrantMark revoked={grantRevoked}>{grant}</GrantMark> : null}
        {nr ? <NotRecorded /> : null}
      </span>
      {sub ? <span className="mt-0.5 block text-[10px] leading-snug text-gray-500 dark:text-gray-400">{sub}</span> : null}
      {barPct == null ? null : (
        <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <span
            className="block h-full"
            style={{ width: `${Math.max(0, Math.min(100, Number(barPct) || 0))}%`, background: barColor }}
          />
        </span>
      )}
      {/* WHERE A ROW'S CONTROLS GO, AND WHY THEY ARE NOT A SIXTH COLUMN. The
          artboards draw five columns and no actions column, and adding one
          would put every table half a column out from the composition it is
          meant to match. But a table that lists a file and offers no way to
          open it has lost a capability to a layout — so the controls ride
          inside the cell whose subject they act on. */}
      {node ? <span className="mt-1 flex flex-wrap items-center gap-3">{node}</span> : null}
    </span>
  );
}

/**
 * The instrument card — the artboards' central table, with its title, its
 * one-line rule on the right, and the note underneath that says what the rows
 * mean.
 *
 * `note` IS NOT OPTIONAL DECORATION. Every artboard has one and every one of
 * them carries the finding: "the brand refresh reading is 105 days old and
 * blocked from attachment", "every row knows exactly one person, which is the
 * roll-up's real finding rather than a display artefact". A table without it
 * is the same data with the point removed.
 *
 * THE GRID SCROLLS RATHER THAN THE PAGE. `cols` is the artboard's own
 * `grid-template-columns` string, and five fr-columns do not fit a phone; the
 * wrapper takes the overflow so the body never scrolls sideways.
 */
export function Instrument({ title, meta, cols, head, rows, note, testid }) {
  return (
    <Card padding="lg" data-testid={testid}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</h3>
        {meta ? <span className="text-[11px] text-gray-600 dark:text-gray-400">{meta}</span> : null}
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[640px]">
          <div className="grid gap-3 border-b border-axal-hairline pb-2 dark:border-gray-700" style={{ gridTemplateColumns: cols }}>
            {head.map((h) => (
              <span key={h} className="text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">{h}</span>
            ))}
          </div>
          {rows.map((r, i) => (
            <div
              key={r.key ?? i}
              className={`grid items-center gap-3 border-b border-axal-hairline py-2.5 last:border-0 dark:border-gray-800 ${r.rowClass || ''}`}
              style={{ gridTemplateColumns: cols }}
            >
              {r.cells.map((cell, j) => <Cell key={j} {...cell} />)}
            </div>
          ))}
        </div>
      </div>
      {note ? (
        <p className="mt-3 border-t border-axal-hairline pt-3 text-[11px] leading-relaxed text-gray-600 dark:border-gray-700 dark:text-gray-400">
          {note}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The amber `pair` note — a card that states a relationship between two zones
 * rather than reporting a row. Library's says Library and Ask are one system;
 * it is the only one in the Research set, and it earns its place because the
 * `In Ask` column is meaningless without it.
 */
export function PairNote({ heading, meta, children }) {
  return (
    <Card padding="lg" className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/25">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-extrabold tracking-tight text-axal-amber-deep dark:text-amber-300">{heading}</h3>
        {meta ? <span className="text-[11px] text-axal-amber-deep dark:text-amber-300">{meta}</span> : null}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-gray-700 dark:text-gray-300">{children}</p>
    </Card>
  );
}
