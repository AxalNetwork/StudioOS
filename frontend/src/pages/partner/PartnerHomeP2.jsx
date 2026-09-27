import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unrecorded, Unreadable, WorkerRail } from '../../ui';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { NO_PARTNER_PROFILE, NoFirmAttached } from './PartnerFirmProfileCard';

/**
 * Partner Home P2 — "Where does the firm stand today?" (D394).
 *
 * BUILT, TESTED, AND NOT MOUNTED. `/studio` renders `PartnerStudioHome` and
 * stays exactly as it is until the owner signs P2 off (the gap map's
 * do-not-touch; ROUTE_MAP's `/studio` row). THE MISSING DECISION IS THAT
 * SIGN-OFF. If it comes, Session 3 mounts this default export in place of the
 * partner branch of `/studio`; nothing in this file needs to change for it.
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
 * client's to set and nothing sets it; the ask bar — asking Eadwyn lives in the
 * rail, and this page carries no second ask box.
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

/** The page as it draws, from load states — no requests except the brief band's own. */
export function PartnerHomeP2View({ state, onRetry }) {
  if (state.status === 'unlinked') return <NoFirmAttached />;
  if (state.status === 'preview') {
    return (
      <p className="text-sm text-axal-muted" data-testid="partner-home-preview">
        The firm&apos;s record is withheld in role preview: nothing on this Home is read while you preview it.
      </p>
    );
  }
  if (state.status === 'loading') return <p className="text-sm text-axal-muted">Reading the firm&apos;s record…</p>;
  const reads = state.reads || {};
  const tiles = homeTiles(reads);
  const feed = homeFeed(reads);
  const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
  const sub = [
    by.due.value != null ? `${by.due.value} milestone${by.due.value === 1 ? '' : 's'} due this week` : null,
    by.risk.value != null ? `${by.risk.value} at risk` : null,
    by.capacity.value != null ? `${by.capacity.value} over capacity` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="partner-home-p2">
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight">Where does the firm stand today?</h1>
          <p className="mt-1 text-[13px] text-axal-muted">{sub || 'Nothing is counted yet: the reads below say why.'}</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
          {tiles.map((t) => <Tile key={t.key} tile={t} onRetry={onRetry} />)}
        </div>

        <ZoneDraft
          surface="home/brief"
          label="Proposal · operating brief"
          accept="Accept as today's brief"
          run="Compose today's brief"
          empty="Composed on your click from this firm's own record — what falls due, what is at risk and why, who is over a stated cap. Nothing is composed on load."
          nothingToDraft="This firm has no engagement on record yet, so there is nothing to brief on."
        />

        <section data-testid="partner-home-feed">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-extrabold tracking-tight">Today</span>
            <span className="text-[11px] text-axal-faint">Every line carries its receipt</span>
          </div>
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
                  <Link to={f.to} className="shrink-0 text-[12px] font-semibold text-amber-700 underline">{f.action}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11px] leading-relaxed text-axal-faint" data-testid="partner-home-limits">
          Not on this page: messages from a client (no inbound record feeds it), whether a proposal was
          opened (the client&apos;s to record, and nothing records it), and an ask box — asking Eadwyn lives
          in the rail.
        </p>
      </div>

      <WorkerRail
        workspace="Home"
        role="partner"
        stance="Read across the firm's record"
        note="Every tile and line reads the Delivery and Pipeline records. The brief is composed only on your click, states what the record shows, and moves nothing."
        coverage={[
          'Engagements, at risk and due this week — Delivery · Board',
          'Recurring and renewals — Pipeline · Retainers',
          'Over capacity — Delivery · Capacity, against a cap the firm stated',
        ]}
        unavailable={[
          ['Client messages', 'No inbound message record feeds this page.'],
          ['Proposal opens', 'Opening is the client’s to record, and nothing records it.'],
        ]}
      />
    </div>
  );
}

export default function PartnerHomeP2({ previewing = false }) {
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

  return <PartnerHomeP2View state={state} onRetry={load} />;
}
