import LabBackLink from './LabBackLink';
import LabPageIcon from './LabPageIcon';
import { labChip, labBtn, LAB_ICON_SIZE } from './labStyles';

/**
 * LabPageHeader — the ONE canonical Spin-Out Lab tool-page header.
 *
 * WHY THIS EXISTS
 * ===============
 * All 20 Lab pages render the same header idea — back control, tool icon,
 * title, status chip, week chip, right-hand actions, description — and, before
 * this component, 20 of them implemented it privately. An audit of the exact
 * markup found the header had forked along every axis at once:
 *
 *   back control   5 shapes: <button>+navigate(), plain text <Link>, bordered
 *                  <Link>, bordered <button>, and <LabBackLink /> (5 pages).
 *                  3 of them stacked it ABOVE the title instead of inline.
 *                  3 different data-testids for the same control.
 *   tool icon      4 shapes: bare lucide glyph (7 pages), tinted 28px tile,
 *                  solid violet 28px tile, tinted 34px tile, <LabPageIcon />
 *                  (5 pages) — plus 3 pages with no icon at all.
 *   title          text-[17px] / text-lg / text-xl / text-[22px], and two
 *                  pages where the header "title" is not an <h1> at all.
 *   description    text-[12.5px] / text-[13px] / text-sm, and three different
 *                  ways of attaching it to the row above (-mt-2 on a sibling,
 *                  mt-0.5 inside the block, flex-1 beside the actions).
 *   top rule       violet above the header, teal above, teal below, absent.
 *
 * That is roughly 900 lines of near-duplicate JSX whose only real function was
 * to look identical. It did not: the negative-margin variants alone (-mt-2,
 * -mt-1, -mt-3) meant the gap between title and description differed by up to
 * 10px page to page, which is exactly the kind of difference a founder reads
 * as "this part of the product is unfinished".
 *
 * This component composes the two primitives that already existed and were
 * already correct — LabBackLink and LabPageIcon — into the whole header, so
 * the 21st page cannot fork it again.
 *
 * DESIGN MEASUREMENTS ENCODED HERE
 * ================================
 * Straight from the Claude Design handoff in attached_assets (the exports that
 * LabBackLink and LabPageIcon were already built against):
 *
 *   top spacing   19px clear space above the header (the former brand rule's
 *                 3px height plus its 16px bottom gap)
 *   back control  34px tall · padding 0 12px 0 9px · radius 9px
 *                 1px #e4e4e7 border · #fff bg · 13px/600
 *                 → owned by LabBackLink, not restated here
 *   tool icon     34px square · radius 9px · bg #f4f0ff · glyph #7c3aed @18px
 *                 → owned by LabPageIcon, not restated here
 *   title         22px / 800 / letter-spacing -.02em
 *   description   13px · #71717a · 2px below the title row (mt-0.5)
 *   left cluster  12px gap between back / icon / title block
 *   title row     10px gap between title and its chips (gap-2.5)
 *   right cluster status + week chips and action buttons, 8px gap
 *
 * Two of those are a deliberate, visible change from the majority of pages:
 * the title moves to 22px (most pages were 17px or 20px) and the description
 * to 13px (most were 12.5px or 14px). Both are what the handoff specifies, and
 * both of the already-shipped primitives follow the handoff rather than the
 * majority, so the handoff wins the tie.
 *
 * WHAT THIS COMPONENT DOES NOT OWN
 * ================================
 * The page's outer wrapper (max-width, padding, space-y) stays on the page —
 * widths legitimately differ per tool (1200px workbenches vs 7xl reading
 * pages), and hoisting them here would force a fake choice. Pass `className`
 * for the header's own bottom margin instead.
 *
 * @param {object}   props
 * @param {Function} props.icon        lucide component, e.g. `Compass`. Omit for no tile.
 * @param {node}     props.title       page title. Rendered as the page's <h1>.
 * @param {node}     props.subtitle    one-line description under the title row.
 * @param {node}     props.status      status chip. A string is wrapped in a chip;
 *                                     a node is rendered as-is (for pages whose
 *                                     status is a real component, e.g. StatusPill).
 * @param {string}   props.statusTone  'active' | 'unlocked' | 'admin' | 'muted'
 *                                     (also 'warn' | 'danger'). Default 'active'.
 * @param {node}     props.titleExtra  extra chips that belong beside the title —
 *                                     a second status chip, a readiness pill and
 *                                     its popover anchor, a project-name chip.
 * @param {node}     props.weekChip    e.g. "Unlocked · Wk 4". String → chip.
 * @param {string}   props.weekTone    tone for the week chip. Default 'unlocked'.
 * @param {node}     props.actions     right-hand action cluster. Build the buttons
 *                                     with labBtn(); do not hand-roll classes.
 * @param {string}   props.backTo      back target. Default '/spinout-lab'.
 * @param {string}   props.backLabel   back label. Default 'Back to Workspace'.
 * @param {boolean}  props.topRule     legacy opt-in for the brand rule. Default false.
 * @param {string}   props.ruleClassName  escape hatch for the rule's colour. Only
 *                                     Office Hours and Scoring ship a teal rule;
 *                                     if that stays, it passes the teal here
 *                                     rather than re-inlining the whole header.
 * @param {string}   props.className   classes for the header wrapper. Pass 'mb-5'
 *                                     when the page root has no space-y-*.
 * @param {string}   props.testId      wrapper data-testid. Default 'lab-page-header'.
 * @param {node}     props.children    optional full-width row directly beneath the
 *                                     header: quick-action rows, state bands,
 *                                     notices. NOT nested inside the title column.
 */
export default function LabPageHeader({
  icon,
  title,
  subtitle,
  status,
  statusTone = 'active',
  titleExtra,
  weekChip,
  weekTone = 'unlocked',
  actions,
  backTo = '/spinout-lab',
  backLabel = 'Back to Workspace',
  topRule = false,
  ruleClassName = 'bg-violet-600 dark:bg-violet-500',
  className = '',
  testId = 'lab-page-header',
  children,
}) {
  // A string becomes a chip; anything else is a caller-supplied node that
  // already knows how it wants to look (StatusPill, a popover anchor, …).
  const statusNode =
    typeof status === 'string' && status
      ? <span className={labChip(statusTone)}>{status}</span>
      : status;

  const weekNode =
    typeof weekChip === 'string' && weekChip
      ? <span className={labChip(weekTone)}>{weekChip}</span>
      : weekChip;

  const hasRight = Boolean(weekNode || actions);

  return (
    <div className={`${!topRule ? 'pt-[19px] ' : ''}${className}`} data-testid={testId}>
      {topRule && (
        <div
          className={`h-[3px] rounded-b-[3px] mb-4 ${ruleClassName}`}
          aria-hidden="true"
        />
      )}

      {/* items-start so a wrapped, two-line title does not drag the action
          cluster down the page with it. flex-wrap drops the right cluster onto
          its own line before anything overlaps. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Two things keep the back control off the title:
            - the back link and the icon tile are flex-none (set inside their
              own components), so all shrink pressure lands on the title block,
              which carries min-w-0 and is therefore allowed to wrap;
            - basis-[360px] (NOT flex-1, whose 0% basis never triggers a wrap)
              makes the row overflow — and so wrap the right cluster onto its
              own line — before the title is squeezed to nothing. */}
        <div className="flex min-w-0 grow basis-[360px] items-center gap-3">
          <LabBackLink to={backTo} label={backLabel} />
          <LabPageIcon icon={icon} />

          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-gray-900 dark:text-gray-50">
                {title}
              </h1>
              {statusNode}
              {titleExtra}
            </div>
            {subtitle && (
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {hasRight && (
          <div
            className="flex items-center gap-2 flex-wrap shrink-0"
            data-testid="lab-page-header-actions"
          >
            {weekNode}
            {actions}
          </div>
        )}
      </div>

      {children && (
        <div className="mt-3" data-testid="lab-page-header-extra">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Convenience chip element, so a page that only needs a chip does not have to
 * import the helper and remember the <span>.
 *
 *   <LabChip tone="unlocked">Unlocked · Wk {week}</LabChip>
 */
export function LabChip({ tone = 'muted', className = '', children, ...rest }) {
  return (
    <span className={labChip(tone, className)} {...rest}>
      {children}
    </span>
  );
}

// Re-exported so a migrating page needs one import line, not three.
// labStyles.js remains the source of truth — add tones/variants there.
export { labChip, labBtn, LAB_ICON_SIZE };
