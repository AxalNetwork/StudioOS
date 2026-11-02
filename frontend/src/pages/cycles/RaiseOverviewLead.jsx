import { Link } from 'react-router-dom';
import { PageAsk } from '../../ui/AskButton.jsx';
import { nextHref } from './cycleModel';

/**
 * D1466 (#3714, RO03, RO04, RO07) — the lead row of Raise › Overview, between
 * the figures and the module cards: **Next steps** (about 60%) and **From your
 * tools** (about 40%), equal height, stacking below 1280px.
 *
 * Both draw what the overview read hands them and read nothing themselves:
 *   next_steps  { state: 'ok' | 'empty' | 'unreadable', items: [{ item_key,
 *                 label, text, module_slug, href, gain_points: number | null }] }
 *   connectors  [{ key, label, fact, as_of: string | null,
 *                 state: 'connected' | 'not_connected' | 'unreadable' }]
 *               or { state: 'unreadable' } when the list itself failed
 * Until the Worker returns a part (D1610, #3714's Worker task), that card is
 * not drawn: an absent part is not an empty one, and this row never invents
 * a step or a source. With neither part the row draws nothing at all.
 *
 * The rules the canvas states: a gain that is not known is "Not recorded",
 * muted, never "+0"; Team is never a step (a person assesses it); a source's
 * last read that is not recorded is "Not recorded", never a date and never 0;
 * red is only for "could not be read". A read-only (staff) viewer gets no
 * links that write.
 */

const H2 = 'm-0 text-[14.5px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const SUB = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const CARD = 'flex min-w-0 flex-col gap-2.5 rounded-xl border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900';
const ROW = 'border-t border-axal-hairline py-2.5 dark:border-gray-800';
const LINK = 'whitespace-nowrap text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';

/** "+N points" for a known gain; null when the gain is not recorded (never "+0" for an unknown). */
export function gainLabel(g) {
  return Number.isFinite(g) && g > 0 ? `+${Math.round(g)} points` : null;
}

/** The steps the card lists: Team never, at most three, biggest known gain first. */
export function nextStepItems(part) {
  const items = Array.isArray(part?.items) ? part.items.filter((i) => i && i.item_key !== 'team') : [];
  const gain = (i) => (Number.isFinite(i.gain_points) ? i.gain_points : -1);
  return items.map((i, n) => ({ i, n })).sort((a, b) => gain(b.i) - gain(a.i) || a.n - b.n).map((x) => x.i).slice(0, 3);
}

/** A source's last read in plain words; a missing one is "Not recorded", never a date or 0. */
export function lastRead(asOf) {
  return asOf ? `Read ${asOf}` : 'Last read · Not recorded';
}

function PartUnreadable({ text, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-red-700 dark:text-red-300">
      <span className="flex-1">{text}</span>
      {onRetry && <button type="button" onClick={onRetry} className="font-bold hover:underline">Try again</button>}
    </div>
  );
}

export function RaiseNextSteps({ part, cards = [], search = '', readOnly = false, onRetry }) {
  const nameOf = (slug, fallback) => cards.find((c) => c?.slug === slug)?.name || fallback;
  let body;
  if (part?.state === 'unreadable') {
    body = <PartUnreadable text="Next steps could not be read." onRetry={onRetry} />;
  } else {
    const items = part?.state === 'empty' || !nextStepItems(part).length
      ? [{ item_key: 'score', label: 'Score readiness', text: 'No readiness items are scored yet', module_slug: 'fundraising-readiness', href: `/raise/fundraising-readiness`, gain_points: null, first: true }]
      : nextStepItems(part);
    body = (
      <div role="list" aria-label="Next steps">
        {items.map((it) => {
          const href = readOnly ? null : nextHref(it.href, search);
          const gain = gainLabel(it.gain_points);
          return (
            <div role="listitem" key={it.item_key} className={`grid items-center gap-2.5 ${readOnly ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto_auto_auto]'} ${ROW}`} data-testid={`next-step-${it.item_key}`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{it.label}</span>
                <span className={SUB}>{it.text}</span>
              </div>
              <span className="whitespace-nowrap rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-semibold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">{nameOf(it.module_slug, it.label)}</span>
              {gain
                ? <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" data-testid="next-step-gain">{gain}</span>
                : <span className={MUTED} data-testid="next-step-gain-unrecorded">Not recorded</span>}
              {!readOnly && (href ? <Link to={href} className={LINK}>{it.first ? 'Score readiness' : 'Open ›'}</Link> : <span />)}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <section className={CARD} data-testid="raise-next-steps">
      <div className="flex flex-col gap-0.5"><h2 className={H2}>Next steps</h2><span className={SUB}>The steps that raise your readiness most</span></div>
      {body}
      {readOnly && part?.state !== 'unreadable' && <span className={MUTED}>Read only. The founder takes these steps.</span>}
    </section>
  );
}

export function RaiseFromTools({ part, readOnly = false, onRetry }) {
  const rows = Array.isArray(part) ? part.filter(Boolean) : [];
  const failed = !Array.isArray(part) && part?.state === 'unreadable';
  return (
    <section className={CARD} data-testid="raise-from-tools">
      <div className="flex flex-col gap-0.5"><h2 className={H2}>From your tools</h2><span className={SUB}>What your connected tools last told us</span></div>
      {failed ? <PartUnreadable text="Your connected tools could not be read." onRetry={onRetry} /> : (
        <div role="list" aria-label="From your tools">
          {rows.map((r) => (
            <div role="listitem" key={r.key} className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 ${ROW}`} data-testid={`tool-${r.key}`} data-state={r.state}>
              <span className="inline-flex min-h-[24px] items-center gap-1.5 whitespace-nowrap rounded-full border border-axal-hairline bg-[#faf9fc] py-0 pl-[3px] pr-2 text-[12px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                <span aria-hidden="true" className="grid h-[18px] w-[18px] place-items-center rounded-full border border-axal-hairline bg-white text-[10px] font-extrabold text-axal-ink/80 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{(r.label || r.key || '?').slice(0, 1).toUpperCase()}</span>
                {r.label || r.key}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                {r.state === 'unreadable'
                  ? <PartUnreadable text={`${r.label || r.key} could not be read.`} onRetry={onRetry} />
                  : r.state === 'not_connected'
                    ? <span className={SUB}>Not connected{readOnly ? '' : <> · <Link to="/account/integrations" className={LINK}>Connect</Link></>}</span>
                    : <>
                      <span className="text-[13px] text-axal-ink dark:text-gray-100">{r.fact || 'Not recorded'}</span>
                      <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tool-last-read">{lastRead(r.as_of)}</span>
                    </>}
              </div>
            </div>
          ))}
          {!rows.length && <p className={`m-0 ${SUB}`}>No tool is connected yet.</p>}
        </div>
      )}
    </section>
  );
}

/** The lead row: both cards at 3fr / 2fr from 1280px, stacked below; one card alone spans the row. */
export default function RaiseLead({ data, search = '', onRetry }) {
  const hasSteps = data && data.next_steps != null;
  const hasTools = data && data.connectors != null;
  if (!hasSteps && !hasTools) return null;
  const readOnly = data.read_only === true;
  const both = hasSteps && hasTools;
  return (
    <div className={`grid grid-cols-1 items-stretch gap-3 ${both ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`} data-testid="raise-lead">
      {hasSteps && <RaiseNextSteps part={data.next_steps} cards={data.cards} search={search} readOnly={readOnly} onRetry={onRetry} />}
      {hasTools && <RaiseFromTools part={data.connectors} readOnly={readOnly} onRetry={onRetry} />}
    </div>
  );
}

/**
 * D1466 (RO00, RO08): Raise › Overview's header Ask, beside "Build your deck"
 * and secondary to it. The overview has no form, so Ask opens Eadwyn on
 * "Raise · Overview" for typed questions (no chips, no waiting count). It is
 * drawn only while the panel serves the viewer (a founder on their own
 * venture), so a staff reader, a support session or a signed-out view never
 * sees it, and the overview itself uses no AI.
 */
export function RaiseAsk() {
  // D1443 (#3706): Ask opens the Ask panel for every viewer a rail serves.
  return <PageAsk label="Raise · Overview" testId="raise-ask" />;
}
