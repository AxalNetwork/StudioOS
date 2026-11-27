import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, ChevronDown, ChevronRight, ChevronUp, Circle, Clock, Gauge, Info, RefreshCw, SquareMinus, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { Unrecorded, Unreadable } from '../../ui';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { TILE } from '../studio/studioLayoutModel';
import { NO_PARTNER_PROFILE } from './PartnerFirmProfileCard';
import {
  CHIP_KINDS, CLOSED, FEED_KINDS, KIND, expandedRows, feedNote, feedSummary, feedView, hiddenSentence, homeFeed,
  kindCounts, kindsLine, partialNote, returnFocus, unreadFeedReads, unreadKinds, unreadSubject,
} from './firmFeedModel';
import { FEED_ANCHOR, readFeedReturn, saveFeedReturn, studioReturnHref } from './feedReturn';

/**
 * Partner Studio's body — "Where does the firm stand today?" (D394).
 *
 * MOUNTED (D564, #1168). The owner signed P2 off on #981 (A): `/studio`'s
 * partner branch renders `PartnerStudioHome`, whose frame (masthead, Eadwyn,
 * the profile band) now carries this as its body. There is no separate home,
 * so nothing on this page is called Home.
 *
 * EVERY TILE READS A STORE THAT ALREADY EXISTS, over routes the Delivery and
 * Pipeline zones already call — no new route, no new `api.js` method:
 *   · Active engagements, embedded / project — `GET /partner/delivery/board`
 *     (`mode` is embedded when a live seat exists).
 *   · Due this week — the same read's `due_next_7_days` (D394 added the count:
 *     open milestones due today or in the next six days).
 *   · At risk — its `needs_attention` (rated at risk or blocked).
 *   · Recurring — `GET /partner/pipeline/retainers`: `mrr_cents` (cents, never
 *     dollars) and the retainers renewing within sixty days.
 *   · Over capacity — `GET /partner/delivery/capacity`: `over_committed_count`,
 *     which is null until the firm states a cap, and then reads Not recorded
 *     with the worker's own `cap_note` rather than "0 over".
 *
 * THE OPERATING BRIEF is the `home/brief` draft surface (research.ts), run on a
 * click and never on mount. It states what the record shows; it does not tell
 * the firm what to do, and nothing on this page calls it a recommendation.
 *
 * THE FEED IS BUILT FROM THE SAME READS, and every line names its receipt.
 * A seat's scope is shown as the firm recorded it — "Scope recorded by the
 * firm: Board, KPIs" — never "Granted by <founder>": `engagement_seats` is
 * written by the partner, so a chip in the founder's voice would be false.
 *
 * D8733 (#8733): the feed keeps every alert, each naming its client and opening that item; the module shows six
 * with one reserved per kind, discloses the rest by kind and expands in place (`firmFeedModel.js`).
 *
 * NOT DRAWN, AND SAID SO: an inbound seam ("From Halverton · 2h ago") — no
 * message store feeds this page; "proposal opened 3×" — `opened_at` is the
 * client's to set and nothing sets it.
 *
 * D1419 (#3698) — THE THREE MODULES. The tiles, the operating brief (kept,
 * owner answer J) and the feed are the partner Studio's modules `firm_tiles`,
 * `operating_brief` and `firm_feed`, drawn in the member's layout by
 * `PartnerStudioHome` (`partnerTiles`). The question heading and the
 * WorkerRail are gone: Studio has no AIRail (owner answer G), and the AIRail
 * holds only models and consumption, so nothing here says asking lives there.
 *
 * PREVIEW AND UNLINKED. An admin previewing the partner role sees every read
 * withheld (the same rule `PartnerStudioHome` follows). A sign-in with no firm
 * attached is `no_partner_profile` on the profile read (D390) and draws the
 * card that says so, not five zero tiles.
 */

const usd = (cents) => (cents === null || cents === undefined || !Number.isFinite(Number(cents))
  ? null
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(cents) / 100));

const within = (iso, days) => {
  if (!iso) return false;
  const d = String(iso).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return d >= today && d <= end;
};

/** The five tiles, from the three reads. A read that failed is `null` here. */
export function homeTiles({ board, retainers, capacity }) {
  const live = board ? (board.items || []).filter((i) => !i.seat_revoked_at && !CLOSED.includes(i.status)) : null;
  const embedded = live ? live.filter((i) => i.mode === 'embedded').length : null;
  const renewing = retainers
    ? (retainers.items || []).filter((r) => r.retainer && within(r.retainer.renews_at, 60)).length
    : null;
  return [
    {
      key: 'active', label: 'Active engagements',
      value: live ? live.length : null,
      note: live ? `${embedded} embedded, ${live.length - embedded} project` : null,
      unreadable: !board,
    },
    {
      key: 'due', label: 'Due this week',
      value: board ? board.due_next_7_days ?? null : null,
      note: 'open milestones due in the next seven days',
      unreadable: !board,
    },
    {
      key: 'risk', label: 'At risk',
      value: board ? board.needs_attention ?? null : null,
      note: board && board.unrated_count ? `${board.unrated_count} unrated, not counted as fine` : 'rated at risk or blocked',
      unreadable: !board,
    },
    {
      key: 'recurring', label: 'Recurring',
      value: retainers ? usd(retainers.mrr_cents) : null,
      note: retainers ? `${renewing} renewing in 60 days` : null,
      reason: retainers && retainers.mrr_cents == null ? (retainers.mrr_note || 'No retainer states a monthly amount.') : null,
      unreadable: !retainers,
    },
    {
      key: 'capacity', label: 'Over capacity',
      value: capacity ? capacity.over_committed_count ?? null : null,
      note: capacity && capacity.over_committed_count != null ? 'over a cap the firm stated' : null,
      reason: capacity && capacity.over_committed_count == null ? capacity.cap_note : null,
      unreadable: !capacity,
    },
  ];
}

function Tile({ tile, onRetry }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`home-tile-${tile.key}`}>
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{tile.label}</div>
      <div className="mt-1.5">
        {tile.unreadable
          ? <Unreadable what={tile.label} claim="This is not a claim that there are none." onRetry={onRetry} />
          : (tile.value === null || tile.value === undefined
            ? <Unrecorded reason={tile.reason || undefined} />
            : <span className="text-[20px] font-extrabold tabular-nums tracking-tight">{tile.value}</span>)}
      </div>
      {!tile.unreadable && (tile.note || tile.reason) && (
        <div className="mt-1 text-[10.5px] leading-snug text-axal-faint">{tile.note || tile.reason}</div>
      )}
    </div>
  );
}

/** The five firm tiles, from the three reads. */
export function FirmTiles({ reads, onRetry }) {
  const tiles = homeTiles(reads);
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5" data-testid="partner-home-tiles">
      {tiles.map((t) => <Tile key={t.key} tile={t} onRetry={onRetry} />)}
    </div>
  );
}

/** The operating brief: the `home/brief` draft surface, composed on a click and never on mount. */
export function OperatingBrief() {
  return (
    <ZoneDraft
      surface="home/brief"
      railOption="draft:operating-brief"
      label="Proposal · operating brief"
      accept="Accept as today's brief"
      run="Compose today's brief"
      empty="Composed on your click from this firm's own record — what falls due, what is at risk and why, who is over a stated cap. Nothing is composed on load."
      nothingToDraft="This firm has no engagement on record yet, so there is nothing to brief on."
    />
  );
}

/*
 * D8733 (#8733) — THE FIRM FEED, canvas `Studio Home Operating Partner` (SOP01 to SOP12). The model is
 * `firmFeedModel.js`; this draws it. Six summary rows with one reserved per kind present (owner answer Q3, A), kind
 * chips that count every alert, a disclosure naming what is hidden, and Show all expanding in place (Q1, A), grouped
 * by kind, with the view kept in `?feed=`. Each row names its client and opens that item with `from=studio`; on
 * return focus goes back to the action used, or to the alert now in its place (SOP07).
 */
export { homeFeed, FEED_READS, unreadFeedReads } from './firmFeedModel';

const TONE = {
  blk: 'border-l-red-500', risk: 'border-l-red-500', due: 'border-l-amber-500', cap: 'border-l-amber-500',
  ren: 'border-l-gray-300', seat: 'border-l-gray-300',
};
// A shape and a word for every kind, never the border colour alone (SOP12).
const GLYPH = { blk: SquareMinus, risk: TriangleAlert, due: Clock, cap: Gauge, ren: RefreshCw, seat: Circle };
const MARK = { blk: 'Blocked', risk: 'At risk', due: 'Due', cap: 'Over cap', ren: 'Renews', seat: 'Embedded' };
const LIST_ID = 'firm-feed-list';

function KindMark({ kind }) {
  const G = GLYPH[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" data-kind={kind}>
      <G size={11} aria-hidden="true" />{MARK[kind]}
    </span>
  );
}

function FeedRow({ alert, onOpen, linkRef }) {
  return (
    <li className={`flex flex-col gap-2 rounded-r-[10px] border border-l-[3px] border-axal-hairline bg-white p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 dark:border-gray-800 dark:bg-gray-900 ${TONE[alert.kind]}`} data-testid={`feed-row-${alert.key}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <KindMark kind={alert.kind} />
          <span className="text-[13px] font-bold">{alert.who}</span>
          {alert.grant && (
            <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[10px] text-axal-muted" data-testid="home-grant-chip">{alert.grant}</span>
          )}
        </div>
        {alert.body && <div className="mt-1 text-[11.5px] text-axal-muted">{alert.body}</div>}
        {alert.when && <div className="mt-0.5 text-[11.5px] font-semibold text-axal-ink dark:text-gray-100">{alert.when}</div>}
        <div className="mt-1 text-[10.5px] text-axal-faint">{alert.receipt}</div>
      </div>
      <Link
        ref={linkRef} to={alert.to} aria-label={alert.label} onClick={(e) => onOpen(e, alert)}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 rounded-lg border border-axal-hairline px-3 text-[12px] font-semibold text-amber-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 sm:min-h-[36px] sm:border-0 sm:px-1 dark:border-gray-700 dark:text-amber-300"
        data-testid={`feed-open-${alert.key}`}
      >
        {alert.action}<ChevronRight size={13} aria-hidden="true" />
      </Link>
    </li>
  );
}

/** The kind chips: toggle buttons that count every alert, an Unavailable chip for a kind not read, and the zeros in words. */
function KindChips({ all, una, pressed, expanded, onPick }) {
  const counts = kindCounts(all);
  const present = FEED_KINDS.filter((k) => counts[k.key] > 0 || (una.includes(k.key) && CHIP_KINDS.includes(k.key)));
  const zero = CHIP_KINDS.filter((k) => counts[k] === 0 && !una.includes(k));
  const chip = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold sm:min-h-[36px]';
  const tone = (on) => (on
    ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200'
    : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100');
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Show alerts by kind" data-testid="feed-kind-chips">
      {expanded && (
        <button type="button" className={`${chip} ${tone(pressed === 'all')}`} aria-pressed={pressed === 'all'} onClick={() => onPick('all')}>
          All <b className="tabular-nums">{all.length}</b>
        </button>
      )}
      {present.map((k) => {
        const G = GLYPH[k.key];
        if (una.includes(k.key)) {
          return (
            <button key={k.key} type="button" className={`${chip} ${tone(false)} text-axal-muted`} aria-disabled="true" title="Could not be read" data-testid={`feed-chip-${k.key}`}>
              <Ban size={12} aria-hidden="true" />{k.chip} · Unavailable
            </button>
          );
        }
        return (
          <button key={k.key} type="button" className={`${chip} ${tone(pressed === k.key)}`} aria-pressed={pressed === k.key} onClick={() => onPick(k.key)} data-testid={`feed-chip-${k.key}`}>
            <G size={12} aria-hidden="true" />{k.chip} <b className="tabular-nums">{counts[k.key]}</b>
          </button>
        );
      })}
      {zero.length > 0 && (
        <span className="text-[11px] text-axal-faint" data-testid="feed-kind-zero">{zero.map((k) => `${KIND[k].chip} 0`).join(' · ')}</span>
      )}
    </div>
  );
}

/** The feed: each line with its receipt and the exact item it opens. */
export function FirmFeed({ reads, onRetry, readAt = null, now }) {
  const all = homeFeed(reads, now);
  const shown = feedSummary(all);
  const hidden = hiddenSentence(all, shown);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = feedView(params.get('feed') || '');
  const expanded = view !== '';
  const { rows, line } = expandedRows(all, view);
  const visible = expanded ? rows : shown;
  const una = unreadKinds(reads);
  // D4620 (#4620): the all-clear is a claim about every read. With one or two unanswered it is not
  // made, and a feed that has lines says which part of the firm's record it could not read.
  const unread = unreadFeedReads(reads);
  const qualifier = unread.length > 0 && (
    <Unreadable what={unreadSubject(reads)} claim="What is listed here comes from the rest, and this is not a claim that nothing else is at risk, due or renewing." onRetry={onRetry} />
  );

  const links = useRef(new Map());
  const toggle = useRef(null);
  const pending = useRef(null);
  const handled = useRef(false);
  const [status, setStatus] = useState('');

  const setView = (next, focus) => {
    setStatus('');
    pending.current = focus || null;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('alert');
      if (next) n.set('feed', next); else n.delete('feed');
      return n;
    }, { replace: true });
  };
  // A chip changes the list and leaves focus where it is; the count line says what is shown (SOP12).
  const pick = (kind) => setView(kind === view && kind !== 'all' ? 'all' : kind);
  const showAll = () => {
    if (expanded) { setView('', 'toggle'); return; }
    const first = all.find((a) => !shown.includes(a));
    setView('all', first ? first.key : 'toggle');
  };

  // Opening an alert keeps the way back: this address with the view and the alert used, then the destination.
  const open = (e, alert) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = studioReturnHref(view, alert.key);
    saveFeedReturn({ href, to: alert.to, key: alert.key, who: alert.who, kind: alert.kind, index: visible.indexOf(alert) });
    navigate(href, { replace: true });
    navigate(alert.to);
  };

  useEffect(() => {
    const key = pending.current;
    if (!key) return;
    pending.current = null;
    (key === 'toggle' ? toggle.current : links.current.get(key))?.focus();
  });

  // SOP07: back from a destination. Focus the action used, or the alert now in its place, and say which once.
  const alertKey = params.get('alert') || '';
  useEffect(() => {
    if (!alertKey || handled.current) return;
    handled.current = true;
    const kept = readFeedReturn();
    const target = returnFocus(visible, kept?.key === alertKey ? kept : { key: alertKey });
    if (!target) return;
    setStatus(target.message);
    if (target.key) links.current.get(target.key)?.focus();
  }, [alertKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const answered = unread.length < 3;
  const row = (a) => (
    <FeedRow key={a.key} alert={a} onOpen={open} linkRef={(el) => { if (el) links.current.set(a.key, el); else links.current.delete(a.key); }} />
  );
  const byKind = FEED_KINDS.map((k) => ({ k, of: rows.filter((a) => a.kind === k.key) })).filter((g) => g.of.length);

  return (
    <section id={FEED_ANCHOR} tabIndex={-1} className="outline-none" data-testid="partner-home-feed">
      <p className="mb-2 text-[11px] text-axal-faint">Every line carries its receipt</p>
      {status && (
        <p role="status" className="mb-2 flex items-center gap-1.5 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="feed-return-status">
          <Info size={13} aria-hidden="true" />{status}
        </p>
      )}
      {all.length === 0 && unread.length === 0 ? (
        <>
          <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">Nothing is at risk, due this week, over a stated cap or renewing soon.</p>
          <p className="mt-1 text-[11px] text-axal-faint" data-testid="feed-empty-counts">
            {readAt ? `All three reads answered at ${readAt.toTimeString().slice(0, 5)} today.` : 'All three reads answered.'}{' '}
            {CHIP_KINDS.map((k) => `${KIND[k].chip} 0`).join(' · ')}.
          </p>
        </>
      ) : (
        <>
          {answered && <KindChips all={all} una={una} pressed={expanded ? view : ''} expanded={expanded} onPick={pick} />}
          {expanded ? (
            <div id={LIST_ID} aria-label="All alerts" className="space-y-3">
              {byKind.map(({ k, of }) => (
                <div key={k.key}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <h4 className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{k.group}</h4>
                    <span className="font-mono text-[11px] text-axal-faint">{of.length}</span>
                  </div>
                  <ul className="space-y-2">{of.map(row)}</ul>
                </div>
              ))}
            </div>
          ) : (
            visible.length > 0 && <ul id={LIST_ID} className="space-y-2">{visible.map(row)}</ul>
          )}
          {!expanded && hidden && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-dashed border-axal-hairline px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700" data-testid="feed-hidden">
              <p className="text-[12px] text-axal-ink dark:text-gray-100"><b>{hidden.lead}</b> · {hidden.detail}</p>
              <button ref={toggle} type="button" onClick={showAll} aria-expanded="false" aria-controls={LIST_ID}
                className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-axal-hairline px-3 text-[12px] font-semibold sm:min-h-[36px] dark:border-gray-700">
                Show all {all.length} alerts<ChevronDown size={13} aria-hidden="true" />
              </button>
            </div>
          )}
          {expanded && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button ref={toggle} type="button" onClick={showAll} aria-expanded="true" aria-controls={LIST_ID}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-axal-hairline px-3 text-[12px] font-semibold sm:min-h-[36px] dark:border-gray-700">
                Show fewer<ChevronUp size={13} aria-hidden="true" />
              </button>
              <span className="text-[11px] text-axal-faint" aria-live="polite" data-testid="feed-count-line">{line}</span>
            </div>
          )}
          {qualifier}
        </>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="partner-home-limits">
        Not on this page: messages from a client (no inbound record feeds it) and whether a proposal was
        opened (the client&apos;s to record, and nothing records it).
      </p>
    </section>
  );
}

/**
 * D8733 (owner answer Q2, A; SOP11A) — on a phone the feed starts about 993 px down, under Eadwyn, the profile band,
 * the tiles and the brief. This link sits under the firm line, counts the feed by kind, and jumps to the module; the
 * module order stays the member's. Hidden from `md` up, where the feed is in view sooner.
 */
export function FeedJumpLink({ reads, now }) {
  const all = homeFeed(reads, now);
  const kinds = kindsLine(all);
  const partial = partialNote(reads);
  const head = all.length ? `Firm feed · ${all.length} alert${all.length === 1 ? '' : 's'}` : 'Firm feed · no alerts';
  const sub = [kinds || (unreadFeedReads(reads).length ? null : 'Nothing is at risk, due, over cap or renewing'), partial].filter(Boolean).join(' · ');
  return (
    <a href={`#${FEED_ANCHOR}`} aria-label={`${head.replace(' · ', ': ')}.${sub ? ` ${sub.replaceAll(' · ', ', ')}.` : ''} Jump to the feed`}
      className="flex min-h-[44px] items-center gap-2 rounded-xl border border-axal-hairline bg-white px-3 py-2 md:hidden dark:border-gray-800 dark:bg-gray-900" data-testid="link-feed-jump">
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-[13.5px]">{head}</b>
        {sub && <span className="text-[11.5px] text-axal-muted">{sub}</span>}
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </a>
  );
}

/** The firm feed module's note: "8 alerts · 6 shown", and "Partial · 2 of 3 reads" when a read failed. */
export function feedSummaryNote(reads) {
  const all = homeFeed(reads);
  return feedNote(all, feedSummary(all), reads);
}

export const UNLINKED_REASON = 'No partner profile is attached to this sign-in, so the firm’s record is not read.';

/**
 * The partner Studio's three module specs from the page's load state. A
 * preview withholds them (SM11); an unlinked sign-in has no firm record, so
 * the two firm modules are Not recorded with that reason, never five zeros.
 */
export function partnerTiles(state, onRetry) {
  if (state.status === 'preview') {
    const w = { state: TILE.WITHHELD };
    return { firm_tiles: w, operating_brief: w, firm_feed: w };
  }
  if (state.status === 'loading') {
    const l = { state: TILE.LOADING };
    return { firm_tiles: l, operating_brief: { state: TILE.READY, body: <OperatingBrief /> }, firm_feed: l };
  }
  if (state.status === 'unlinked') {
    const nr = { state: TILE.NOT_RECORDED, reason: UNLINKED_REASON, href: '/account', openLabel: 'Partner settings' };
    return { firm_tiles: nr, operating_brief: nr, firm_feed: nr };
  }
  const reads = state.reads || {};
  const tiles = homeTiles(reads);
  const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
  const note = [
    by.due.value != null ? `${by.due.value} due this week` : null,
    by.risk.value != null ? `${by.risk.value} at risk` : null,
  ].filter(Boolean).join(' · ') || null;
  const none = !reads.board && !reads.retainers && !reads.capacity;
  return {
    firm_tiles: none ? { state: TILE.UNREADABLE, onRetry } : { state: TILE.READY, note, href: '/delivery/board', openLabel: 'Open Delivery', body: <FirmTiles reads={reads} onRetry={onRetry} /> },
    operating_brief: { state: TILE.READY, body: <OperatingBrief /> },
    // D8733: no "Open the feed" link (it went to Delivery · Health, though the feed also holds capacity and
    // renewals). The feed is this module, and Show all expands it in place; the note counts every alert.
    firm_feed: none ? { state: TILE.UNREADABLE, onRetry } : { state: TILE.READY, note: feedSummaryNote(reads), body: <FirmFeed reads={reads} onRetry={onRetry} readAt={state.readAt || null} /> },
  };
}

const READS = {
  board: () => api.getPartnerDeliveryBoard(),
  retainers: () => api.listPartnerRetainers(),
  capacity: () => api.getPartnerCapacity(),
};

/**
 * The firm's three reads, for the tiles and the feed. No request in a preview.
 *
 * D4620 (#4620): `load` asks again only for the reads that did not answer once
 * the page has the others, and merges the answers, so a retry never throws away
 * what loaded. It asks for all three on the first load, after an unlinked
 * sign-in, and when the preview flips.
 */
export function usePartnerHome(previewing = false) {
  const [state, setState] = useState({ status: 'loading' });
  const kept = useRef(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (previewing) {
      // WITHHELD IS NOT UNREADABLE. Nothing failed; the admin preview simply
      // does not read another firm's record, and the page says that instead of
      // drawing five failed tiles.
      kept.current = null;
      setState({ status: 'preview' });
      return;
    }
    const mine = ++generation.current;
    const have = kept.current;
    const wanted = have ? Object.keys(READS).filter((key) => !have[key]) : Object.keys(READS);
    if (!have || wanted.length === 0) {
      kept.current = null;
      setState({ status: 'loading' });
      try {
        await api.partnerPortal.getProfile();
      } catch (e) {
        if (e?.code === NO_PARTNER_PROFILE) { if (generation.current === mine) setState({ status: 'unlinked' }); return; }
      }
    }
    const settle = (p) => p.then((v) => v).catch(() => null);
    const answers = await Promise.all((have && wanted.length ? wanted : Object.keys(READS)).map((key) => settle(READS[key]())));
    if (generation.current !== mine) return;
    const reads = { ...(have && wanted.length ? have : {}) };
    (have && wanted.length ? wanted : Object.keys(READS)).forEach((key, index) => { reads[key] = answers[index]; });
    kept.current = reads;
    // D8733: when the reads answered, for the empty feed's "All three reads answered at 09:12 today".
    setState({ status: 'ready', readAt: new Date(), reads: { board: reads.board ?? null, retainers: reads.retainers ?? null, capacity: reads.capacity ?? null } });
  }, [previewing]);
  useEffect(() => { kept.current = null; load(); }, [load]);

  return { state, load };
}
