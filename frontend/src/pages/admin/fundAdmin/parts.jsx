/**
 * D714 (#1779), the canvas PR — the console's drawing parts, taken from the
 * August canvas "Fund Administration" (`design/canvases/integrated/`), whose
 * visual system S1's brief for "Fund Administration · Admin" (2026-10-18)
 * names. Each part is that canvas's own markup in the app's tokens:
 *
 *   Section   a tab's heading: 19px / 800, and its one-line sub.
 *   Panel     a surface card (16px radius, hairline border) with a sunken
 *             header carrying the 9.5px uppercase label (`.fa-th`).
 *   Line      a `.fa-row`: a name and a mono meta line on the left, a mono
 *             figure, a chip and an action on the right. It wraps on a phone.
 *   Tiles     the tracking strip: four stat tiles (two on a phone), each a
 *             label, a mono figure and a note.
 *   Table     the collection table: a sunken header of uppercase labels and
 *             grid rows. Below `sm` the header goes and each row stacks, its
 *             cells labelled, so nothing scrolls sideways at 390px.
 *
 * No new CSS: Tailwind utilities on the theme's tokens only. Figures are
 * `font-mono tabular-nums`, as the canvas's `.fa-num` is.
 */

export const NUM = 'font-mono tabular-nums';
const SURFACE = 'rounded-axal-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SUNKEN = 'border-b border-axal-hairline bg-[#faf9fc] dark:border-gray-800 dark:bg-gray-950/40';
export const TH = 'text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-muted dark:text-gray-400';

export function Section({ title, sub, aside = null, children, testId }) {
  return (
    <section className="mx-4 mt-5 sm:mx-6" data-testid={testId}>
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[19px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{title}</h2>
          {sub && <p className="mt-1 max-w-[620px] text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">{sub}</p>}
        </div>
        {aside}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Panel({ label, sub = null, aside = null, children, testId }) {
  return (
    <div className={`${SURFACE} overflow-hidden`} data-testid={testId}>
      <div className={`${SUNKEN} flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 sm:px-5`}>
        <div className="min-w-0">
          <div className={TH}>{label}</div>
          {sub && <div className={`mt-0.5 text-[12px] font-bold text-zinc-700 dark:text-gray-200 ${NUM}`}>{sub}</div>}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** One `.fa-row`. `a` is the name, `b` the meta line, `figure` a mono amount. */
export function Line({ a, b = null, figure = null, chip = null, action = null, tone = null, testId }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-axal-hairline px-4 py-3 last:border-b-0 hover:bg-[#faf9fc] sm:px-5 dark:border-gray-800 dark:hover:bg-gray-950/40" data-testid={testId}>
      <div className="min-w-0 flex-1 basis-56">
        <div className={`text-[12px] font-bold ${tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-zinc-700 dark:text-gray-200'}`}>{a}</div>
        {b != null && b !== '' && <div className="mt-0.5 text-[11px] leading-relaxed text-axal-muted dark:text-gray-400">{b}</div>}
      </div>
      {figure != null && <div className={`text-right text-[12px] font-bold text-axal-ink dark:text-gray-100 ${NUM}`}>{figure}</div>}
      {chip}
      {action && <div className="flex flex-wrap justify-end gap-2">{action}</div>}
    </div>
  );
}

export function Tiles({ items, testId }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid={testId}>
      {items.map((t) => (
        <div key={t.k} className={`${SURFACE} px-4 py-3.5`} data-testid={t.testId}>
          <div className={TH}>{t.k}</div>
          <div className={`mt-1.5 text-[20px] font-bold tracking-[-.024em] ${t.tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : t.tone === 'ok' ? 'text-axal-positive dark:text-emerald-300' : 'text-axal-ink dark:text-gray-100'} ${NUM}`}>{t.v}</div>
          {t.note && <div className="mt-0.5 text-[10.5px] text-axal-muted dark:text-gray-400">{t.note}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * The collection table. `cols` is `[{ key, label, align, cell(row) }]`; the
 * grid template comes from `template` (desktop only). `wide` lets a table of
 * many columns scroll inside its card between `sm` and a wide screen, as the
 * canvas's `.fa-wide` does; a phone still stacks.
 */
export function Table({ cols, rows, rowKey, template, foot = null, testId, rowTestId, wide = false }) {
  return (
    <div className={wide ? 'sm:overflow-x-auto' : undefined} data-testid={testId}>
      <div className={wide ? 'sm:min-w-[960px]' : undefined}>
      <div className={`${SUNKEN} hidden sm:grid`} style={{ gridTemplateColumns: template }}>
        {cols.map((c, i) => (
          <div key={c.key} className={`${TH} py-2.5 ${i === 0 ? 'pl-5 pr-2.5' : i === cols.length - 1 ? 'pl-2.5 pr-5' : 'px-2.5'} ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={rowKey(r)} className="grid grid-cols-1 border-b border-axal-hairline last:border-b-0 hover:bg-[#faf9fc] sm:items-center dark:border-gray-800 dark:hover:bg-gray-950/40 sm:[grid-template-columns:var(--fa-cols)]"
          style={{ '--fa-cols': template }} data-testid={rowTestId ? rowTestId(r) : undefined}>
          {cols.map((c, i) => (
            <div key={c.key} className={`flex items-baseline justify-between gap-3 px-4 py-1 first:pt-3 last:pb-3 sm:block sm:py-2.5 ${i === 0 ? 'sm:pl-5 sm:pr-2.5' : i === cols.length - 1 ? 'sm:pl-2.5 sm:pr-5' : 'sm:px-2.5'} ${c.align === 'right' ? 'sm:text-right' : ''}`}>
              {i > 0 && <span className={`${TH} sm:hidden`}>{c.label}</span>}
              <div className={`min-w-0 text-[11.5px] ${c.mono ? `${NUM} font-semibold text-zinc-700 dark:text-gray-200` : 'text-zinc-700 dark:text-gray-200'} ${i === 0 ? 'font-semibold' : ''}`}>{c.cell(r)}</div>
            </div>
          ))}
        </div>
      ))}
      {foot}
      </div>
    </div>
  );
}

/** An empty or explanatory body line inside a Panel. */
export function Note({ children, testId }) {
  return <div className="px-4 py-3 text-[12px] leading-relaxed text-axal-muted sm:px-5 dark:text-gray-400" data-testid={testId}>{children}</div>;
}
