import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Card } from '../../ui';
import { DataState, StateChip, UNAVAILABLE_CLAIM, isRefusal } from '../../ui/Honesty.jsx';
import { api } from '../../lib/api';
import { StatedLimit, ZoneHeading } from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import RoomDeals from './RoomDeals';
import { NO_VENTURE_ROOM, chipCounts, dayWord, expiryMark, ndaWord, roomCounts, roomTarget, tiles, ventureRooms, view } from './diligenceZoneRead.js';

/**
 * Research · Diligence — the rooms founders have opened to you, and your own
 * requests for one. Drawn to the Investor Research v2 Rooms canvas (D6268,
 * boards IRV-02, IRV-05 and IRV-06), built in D6269.
 *
 * NO NEW STORE. Every figure is from `GET /api/research/diligence`: the live
 * grants (`items`), the NDA with each founder (`nda`, D6267), the deals on
 * each room's company you may open (`deals`, D6266) and your own open and
 * declined requests (`requests`, D6267). What the page shows is worked out in
 * `diligenceZoneRead.js`, so the tiles, chips, rows and export agree.
 *
 * SCOPE IS WHAT THEY STAGED, NOT WHAT YOU ASKED FOR. Open to you, in the room
 * and behind an NDA are separate numbers, never a ratio: a room that reads
 * 6 of 11 is telling you something is held back, and a percentage hides which
 * rooms are thin. What is behind an NDA is a count, never names.
 *
 * NOTHING HERE ASKS FOR A ROOM. A request is made on its deal (Documents, then
 * Ask for access), where the founder can answer it; this page lists what came
 * of yours. Owner answer A on D6268: rooms stay in Research and in Deals, and
 * there is no Ask over a room.
 *
 * STATES ARE #5129's (D5129): Loading is a skeleton, a failed read says
 * Unavailable with Retry, a refused one says Refused, an empty list says None
 * in a sentence, and a value the store does not hold says Not recorded. Each
 * block fails on its own: a failed request read leaves the rooms on screen.
 *
 * A LINK THAT NAMES A VENTURE (D6162). `/raise/data-room?project_id=N` sends an
 * investor here with its query and hash kept. When one live grant is for that
 * venture the page opens its room; when several are, each is marked; when none
 * is, the page says so in one line above the list. A failed read says nothing
 * about the venture: Unavailable is never "no room".
 */

const CELL_EYE = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-600 dark:text-gray-400 lg:sr-only';
const MONO = 'tabular-nums';
const ROW_GRID = 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.7fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,.9fr)_minmax(0,1fr)_minmax(0,1fr)_auto]';
const COLUMNS = ['Company', 'Files open to you', 'Behind an NDA', 'NDA with founder', 'Deal', 'Granted', 'You last opened', 'Access expires'];
const LINK = 'text-[12px] font-semibold text-indigo-700 underline dark:text-indigo-300';
const NOT_RECORDED = <StateChip kind="not_recorded" />;

function Tile({ eye, children, sub, testid }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={testid}>
      <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-400">{eye}</span>
      {children}
      {sub ? <small className="text-[12px] text-gray-600 dark:text-gray-300">{sub}</small> : null}
    </div>
  );
}

const Figure = ({ children }) => <b className={`text-2xl font-extrabold text-gray-900 dark:text-gray-100 ${MONO}`}>{children}</b>;

function Cell({ label, className = '', children }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${className}`.trim()}>
      <span className={CELL_EYE}>{label}</span>
      <div className="min-w-0 break-words text-[12.5px] text-gray-800 dark:text-gray-200">{children}</div>
    </div>
  );
}

/** The NDA with the founder (IRV-02): signed (with its end date), out for signature, none, or Not recorded. */
export function NdaStatus({ nda }) {
  const w = ndaWord(nda);
  if (w.kind === 'not_recorded') return <span data-testid="room-nda" data-nda="not_recorded">{NOT_RECORDED}</span>;
  const tone = w.kind === 'on_file'
    ? 'border-emerald-700 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300'
    : w.kind === 'out_for_signature'
      ? 'border-dashed border-amber-700 text-amber-800 dark:border-amber-400 dark:text-amber-300'
      : 'border-gray-400 text-gray-700 dark:border-gray-500 dark:text-gray-300';
  const glyph = w.kind === 'on_file' ? '✓' : w.kind === 'out_for_signature' ? '◷' : '⊘';
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="room-nda" data-nda={w.kind}>
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-bold ${tone}`}>
        <span aria-hidden="true">{glyph}</span>{w.word}
      </span>
      {w.until ? <small className={`text-[11px] text-gray-600 dark:text-gray-400 ${MONO}`}>{`until ${w.until}`}</small> : null}
    </span>
  );
}

function RoomRow({ r, now, marked = false }) {
  const c = roomCounts(r);
  const exp = expiryMark(r.expires_at, now);
  const num = (v) => (v == null ? NOT_RECORDED : <b className={MONO}>{v}</b>);
  return (
    <li
      className={`grid grid-cols-2 gap-x-3 gap-y-2 py-3 lg:items-center ${ROW_GRID}`}
      data-testid="room-row"
      data-venture={marked ? 'match' : undefined}
    >
      <Cell label="Company" className="col-span-2 lg:col-span-1">
        <Link
          to={`/research/diligence/${encodeURIComponent(r.grant_uid)}`}
          className="text-[13px] font-bold text-indigo-700 hover:underline dark:text-indigo-300"
        >
          {r.project_name}
        </Link>
        {marked ? <small className="ml-1.5 inline-flex items-center rounded-full border border-indigo-700 bg-indigo-50 px-2 py-px text-[11px] font-bold text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-300" data-testid="room-venture-mark">This venture</small> : null}
      </Cell>
      <Cell label="Files open to you">
        <span data-testid="room-files">{num(c.open)} open of {num(c.total)}</span>
      </Cell>
      <Cell label="Behind an NDA">
        <span data-testid="room-behind">{num(c.behind)}</span>
      </Cell>
      <Cell label="NDA with founder"><NdaStatus nda={r.nda} /></Cell>
      <Cell label="Deal" className="col-span-2 lg:col-span-1">
        {Array.isArray(r.deals)
          ? <RoomDeals deals={r.deals} note={r.deal_stage_note} />
          : <DataState state="unavailable" what="The deals on this company" claim="That is not a claim that there are none." data-testid="room-deal-unavailable" />}
      </Cell>
      <Cell label="Granted">{r.created_at ? <span className={MONO}>{dayWord(r.created_at)}</span> : NOT_RECORDED}</Cell>
      <Cell label="You last opened">
        {r.last_opened_at
          ? <span className={MONO}>{dayWord(r.last_opened_at)}</span>
          : <span className="text-gray-600 dark:text-gray-400">Never opened</span>}
      </Cell>
      <Cell label="Access expires">
        {exp.kind === 'none'
          ? <span className="text-gray-600 dark:text-gray-400">No end date</span>
          : (
            <span className="inline-flex flex-wrap items-baseline gap-1">
              <span className={MONO}>{exp.word}</span>
              {exp.soon ? <small className="font-bold text-amber-800 dark:text-amber-300" data-testid="room-expiring-soon"><span aria-hidden="true">◷ </span>{`Expires ${exp.soon}`}</small> : null}
            </span>
          )}
      </Cell>
      <div className="col-span-2 lg:col-span-1 lg:text-right">
        <Link to={`/research/diligence/${encodeURIComponent(r.grant_uid)}`} className={`inline-flex min-h-[44px] items-center lg:min-h-0 ${LINK}`}>Open the room →</Link>
      </div>
    </li>
  );
}

function RequestState({ state }) {
  return state === 'declined'
    ? <span className="inline-flex items-center gap-1 rounded-full border border-gray-900 px-2 py-px text-[11px] font-bold text-gray-900 dark:border-gray-100 dark:text-gray-100"><span aria-hidden="true">⊘</span>Declined</span>
    : <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-indigo-700 px-2 py-px text-[11px] font-bold text-indigo-800 dark:border-indigo-400 dark:text-indigo-300"><span aria-hidden="true">◷</span>Open · waiting</span>;
}

/** What an empty room list says, per chip: none granted at all, or none partly staged. */
export const NO_ROOMS = Object.freeze({
  all: 'No founder has opened a room to you yet. A founder shares a room by name, and it appears here.',
  partial: 'No room of yours has files behind an NDA.',
});

export const NO_REQUESTS = Object.freeze({
  all: 'You have no open or declined request for a room. Ask from a deal’s Documents tab.',
  requested: 'No request of yours is waiting on a founder.',
  declined: 'No request of yours has been declined.',
});

function RequestsBlock({ requests, filter, onRetry }) {
  return (
    <Card padding="lg" data-testid="requests-block">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold tracking-tight">Requests</h3>
        <span className="text-[11px] text-gray-600 dark:text-gray-300">Your requests no room answers yet, open or declined</span>
      </div>
      {requests == null ? (
        <DataState state="unavailable" size="block" what="Your requests" claim={UNAVAILABLE_CLAIM} onRetry={onRetry} data-testid="requests-unavailable" />
      ) : !requests.length ? (
        <DataState state="none" size="block" data-testid="requests-none">{NO_REQUESTS[filter] || NO_REQUESTS.all}</DataState>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800" aria-label="Your requests">
          {requests.map((q) => (
            <li key={q.uid} className="grid grid-cols-2 gap-x-3 gap-y-2 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.9fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,2fr)] lg:items-center" data-testid="request-row" data-state={q.state}>
              <Cell label="Company" className="col-span-2 lg:col-span-1">
                {q.project_name
                  ? <b className="text-[13px] text-gray-900 dark:text-gray-100">{q.project_name}</b>
                  : <span className="text-gray-600 dark:text-gray-400">Company not named here: it is named only where you could already see it</span>}
              </Cell>
              <Cell label="State"><RequestState state={q.state} /></Cell>
              <Cell label="Sent">{q.created_at ? <span className={MONO}>{dayWord(q.created_at)}</span> : NOT_RECORDED}</Cell>
              <Cell label="Decided">
                {q.state === 'open'
                  ? <span className="text-gray-600 dark:text-gray-400">Not decided</span>
                  : q.decided_at ? <span className={MONO} data-testid="request-decided">{dayWord(q.decided_at)}</span> : NOT_RECORDED}
              </Cell>
              <Cell label="Founder’s reason" className="col-span-2 lg:col-span-1">
                {q.state !== 'declined'
                  ? null
                  : q.decline_reason
                    ? <q className="text-gray-800 dark:text-gray-200" data-testid="request-reason">{q.decline_reason}</q>
                    : <DataState state="not_recorded" reason="The founder gave no reason." />}
              </Cell>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * D6162: the one line a venture-naming address gets above the list. Nothing
 * for an unnamed venture or one the rooms cannot be compared on.
 */
function VentureLine({ venture }) {
  const cls = 'rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100';
  if (venture?.state === 'none') {
    return (
      <p role="status" className={cls} data-testid="venture-no-room">
        <b>{NO_VENTURE_ROOM}</b> Only its founder can open one; you can ask from the deal’s Documents tab.
      </p>
    );
  }
  if (venture?.state === 'many') {
    return <p role="status" className={cls} data-testid="venture-rooms">{`${venture.rooms.length} rooms are open to you for this venture. Each is marked below.`}</p>;
  }
  if (venture?.state === 'one') {
    return <p role="status" className={cls} data-testid="venture-opening">{`Opening the room for ${venture.rooms[0].project_name || 'this venture'}…`}</p>;
  }
  return null;
}

/**
 * The page below the toolbar for one read: loading, refused, unavailable, or
 * the tiles, rooms and requests. Exported so a test renders each state.
 * `venture` is `ventureRooms(data, search)` (D6162), or null.
 */
export function DiligenceBody({ loading, error, data, filter, now, onRetry, venture = null }) {
  if (loading && !data) {
    return (
      <div role="status" aria-busy="true" data-testid="rooms-loading">
        <span className="sr-only">Loading your rooms…</span>
        <DataState state="loading" size="block" />
      </div>
    );
  }
  if (error && isRefusal(error)) {
    return (
      <DataState
        state="refused" size="block" what="your rooms" data-testid="rooms-refused"
        claim="This list is open only to the investor a founder named. Only the founder can grant a room."
        accessRoute={<Link to="/deals" className={LINK}>Go to your deals</Link>}
      />
    );
  }
  if (error || !data) {
    return <DataState state="unavailable" size="block" what="Your rooms list" claim={UNAVAILABLE_CLAIM} onRetry={onRetry} data-testid="rooms-unavailable" />;
  }
  const shown = view(data, filter);
  const t = tiles(data);
  const marked = new Set(venture && (venture.state === 'one' || venture.state === 'many') ? venture.rooms.map((r) => r.grant_uid) : []);
  return (
    <>
      <VentureLine venture={venture} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="room-tiles">
        <Tile eye="Rooms granted" sub="rooms, live grants as of now" testid="tile-granted"><Figure>{t.granted}</Figure></Tile>
        <Tile eye="Partly staged" sub="rooms with files behind an NDA you have not signed" testid="tile-partial"><Figure>{t.partlyStaged}</Figure></Tile>
        <Tile eye="Requests open" sub={t.requestsOpen == null ? null : 'waiting on a founder'} testid="tile-requests">
          {t.requestsOpen == null
            ? <DataState state="unavailable" size="tile" what="Your requests" claim={UNAVAILABLE_CLAIM} />
            : <Figure>{t.requestsOpen}</Figure>}
        </Tile>
      </div>

      {shown.rooms && (
        <Card padding="lg" data-testid="rooms-block">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-extrabold tracking-tight">Room access</h3>
            <span className="text-[11px] text-gray-600 dark:text-gray-300">Live grants as of now · scope is what they staged, not what was asked</span>
          </div>
          {!(data.items || []).length ? (
            <DataState
              state="none" size="block" data-testid="rooms-none"
              action={<Link to="/deals" className={LINK}>Go to your deals</Link>}
            >
              {NO_ROOMS.all}
            </DataState>
          ) : !shown.rooms.length ? (
            <DataState state="none" size="block" data-testid="rooms-none-partial">{NO_ROOMS[shown.filter] || NO_ROOMS.partial}</DataState>
          ) : (
            <>
              <div className={`hidden gap-x-3 border-b border-gray-200 pb-2 text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-600 dark:border-gray-800 dark:text-gray-400 lg:grid ${ROW_GRID}`} aria-hidden="true">
                {COLUMNS.map((h) => <span key={h}>{h}</span>)}<span />
              </div>
              <ul className="divide-y divide-gray-200 dark:divide-gray-800" aria-label="Rooms opened to you">
                {shown.rooms.map((r) => <RoomRow key={r.grant_uid} r={r} now={now} marked={marked.has(r.grant_uid)} />)}
              </ul>
              <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
                Behind an NDA is a count, never the names. What is behind it is not listed until an NDA is active between you.
              </p>
            </>
          )}
        </Card>
      )}

      {shown.requests !== undefined && <RequestsBlock requests={shown.requests} filter={shown.filter} onRetry={onRetry} />}
    </>
  );
}

export default function DiligenceZone({ zoneActions, zoneFilters, role = 'founder', now: nowProp }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  // D6269: each chip selects a real state (`diligenceZoneRead.js` FILTERS).
  const [filter, setFilter] = useState('all');
  const now = nowProp ?? Date.now();

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.research.diligence();
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e || new Error('Room access did not load.'), data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const rooms = data ? (view(data, filter).rooms || []) : [];

  // D6162: the venture a data-room link named, matched only once the list has
  // been read. One live grant for it opens that room, the query and hash kept.
  const location = useLocation();
  const navigate = useNavigate();
  const venture = data && !state.error ? ventureRooms(data, location.search) : null;
  const openUid = venture?.state === 'one' ? venture.rooms[0].grant_uid : null;
  useEffect(() => {
    if (openUid) navigate(roomTarget(openUid, { search: location.search, hash: location.hash }), { replace: true });
  }, [openUid, navigate, location.search, location.hash]);

  return (
    <div className="space-y-6">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: setFilter, counts: data ? chipCounts(data) : {} }) : []}
          actions={zoneActions(rooms)}
        />
      )}
      <ZoneHeading
        title="Rooms opened to you"
        blurb="Data rooms founders opened to you, live now. Every row is a live grant; only the founder can open or widen one."
      />

      <DiligenceBody loading={state.loading} error={state.error} data={data} filter={filter} now={now} onRetry={load} venture={venture} />

      <StatedLimit title="What this page will not do">
        This list is the rooms you have been let into, so nothing here asks a founder for
        one. A room you do not see here has not been opened to you. A room is asked for on
        its deal: open the deal from{' '}
        <Link to="/deals" className="font-bold underline">Deals</Link>, then Documents, then
        Ask for access. The founder decides, and the grant stays theirs to revoke.
      </StatedLimit>
    </div>
  );
}
