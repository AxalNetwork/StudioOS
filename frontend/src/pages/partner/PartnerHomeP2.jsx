import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unrecorded, Unreadable } from '../../ui';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { TILE } from '../studio/studioLayoutModel';
import { NO_PARTNER_PROFILE } from './PartnerFirmProfileCard';

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

const CLOSED = ['delivered', 'reviewed', 'invoiced', 'cancelled'];
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

/** The feed: at most six lines, each with its receipt and where to act on it. */
export function homeFeed({ board, retainers, capacity }) {
  const out = [];
  const live = (board?.items || []).filter((i) => !i.seat_revoked_at && !CLOSED.includes(i.status));
  for (const i of live.filter((x) => x.health === 'at_risk' || x.health === 'blocked')) {
    out.push({
      key: `risk-${i.engagement_id}`, tone: 'bad',
      title: `${i.client || 'Client not recorded'} · ${i.health === 'blocked' ? 'blocked' : 'at risk'}`,
      body: Array.isArray(i.health_reasons) && i.health_reasons.length ? i.health_reasons.join('; ') : null,
      receipt: 'Read from milestones, blockers and deliverables',
      action: 'Open Delivery · Health', to: '/delivery/health',
    });
  }
  for (const i of live.filter((x) => x.milestones_due_7d > 0)) {
    out.push({
      key: `due-${i.engagement_id}`, tone: 'due',
      title: `${i.client || 'Client not recorded'} · ${i.milestones_due_7d} milestone${i.milestones_due_7d === 1 ? '' : 's'} due this week`,
      body: i.scope || null,
      receipt: 'Milestone due dates, as the firm entered them',
      action: 'Open the board', to: '/delivery/board',
    });
  }
  for (const p of (capacity?.people || []).filter((x) => x.over_committed === true)) {
    out.push({
      key: `cap-${p.user_id ?? p.name}`, tone: 'due',
      title: `${p.name || 'A team member'} is over the stated cap`,
      body: p.total_hours != null && p.cap_hours != null ? `${p.total_hours} h against a cap of ${p.cap_hours} h` : null,
      receipt: p.cap_source === 'person' ? 'Their own cap, stated by the firm' : 'The firm-wide cap, stated by the firm',
      action: 'Open Capacity', to: '/delivery/capacity',
    });
  }
  for (const r of (retainers?.items || []).filter((x) => x.retainer && within(x.retainer.renews_at, 60))) {
    out.push({
      key: `renew-${r.engagement_id ?? r.founder_name}`, tone: 'plain',
      title: `${r.founder_name || 'Client not recorded'} renews ${String(r.retainer.renews_at).slice(0, 10)}`,
      body: null,
      receipt: 'Retainer record',
      action: 'Open Retainers', to: '/pipeline/retainers',
    });
  }
  for (const i of live.filter((x) => x.mode === 'embedded' && x.grant)) {
    out.push({
      key: `seat-${i.engagement_id}`, tone: 'plain',
      title: `${i.client || 'Client not recorded'} · embedded`,
      grant: `Scope recorded by the firm: ${i.grant}`,
      body: i.grant_holder ? `Seat held by ${i.grant_holder}` : null,
      receipt: 'Seat record, entered by this firm',
      action: 'Open Capacity', to: '/delivery/capacity',
    });
  }
  return out.slice(0, 6);
}

const TONE = {
  bad: 'border-l-red-500', due: 'border-l-amber-500', plain: 'border-l-gray-300',
};

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

/** The feed: each line with its receipt and where to act on it. */
export function FirmFeed({ reads }) {
  const feed = homeFeed(reads);
  return (
    <section data-testid="partner-home-feed">
      <p className="mb-2 text-[11px] text-axal-faint">Every line carries its receipt</p>
      {feed.length === 0 ? (
        <p className="text-[12.5px] text-axal-muted">Nothing is at risk, due this week, over a stated cap or renewing soon.</p>
      ) : (
        <ul className="space-y-2">
          {feed.map((f) => (
            <li key={f.key} className={`flex items-start justify-between gap-4 rounded-r-[10px] border border-l-[3px] border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900 ${TONE[f.tone] || TONE.plain}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold">{f.title}</span>
                  {f.grant && (
                    <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[10px] text-axal-muted" data-testid="home-grant-chip">{f.grant}</span>
                  )}
                </div>
                {f.body && <div className="mt-1 text-[11.5px] text-axal-muted">{f.body}</div>}
                <div className="mt-1 text-[10.5px] text-axal-faint">{f.receipt}</div>
              </div>
              <Link to={f.to} className="shrink-0 text-[12px] font-semibold text-amber-700 underline dark:text-amber-300">{f.action}</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="partner-home-limits">
        Not on this page: messages from a client (no inbound record feeds it) and whether a proposal was
        opened (the client&apos;s to record, and nothing records it).
      </p>
    </section>
  );
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
    firm_feed: none ? { state: TILE.UNREADABLE, onRetry } : { state: TILE.READY, href: '/delivery/health', openLabel: 'Open the feed', body: <FirmFeed reads={reads} /> },
  };
}

/** The firm's three reads, once, for the tiles and the feed. No request in a preview. */
export function usePartnerHome(previewing = false) {
  const [state, setState] = useState({ status: 'loading' });

  const load = useCallback(async () => {
    if (previewing) {
      // WITHHELD IS NOT UNREADABLE. Nothing failed; the admin preview simply
      // does not read another firm's record, and the page says that instead of
      // drawing five failed tiles.
      setState({ status: 'preview' });
      return;
    }
    setState({ status: 'loading' });
    try {
      await api.partnerPortal.getProfile();
    } catch (e) {
      if (e?.code === NO_PARTNER_PROFILE) { setState({ status: 'unlinked' }); return; }
    }
    const settle = (p) => p.then((v) => v).catch(() => null);
    const [board, retainers, capacity] = await Promise.all([
      settle(api.getPartnerDeliveryBoard()),
      settle(api.listPartnerRetainers()),
      settle(api.getPartnerCapacity()),
    ]);
    setState({ status: 'ready', reads: { board, retainers, capacity } });
  }, [previewing]);
  useEffect(() => { load(); }, [load]);

  return { state, load };
}
