import { Link } from 'react-router-dom';

/**
 * D6266 (#6266): the deals on a room's company that you may open, from the
 * diligence reads' `deals` (`GET /api/research/diligence`, `/:grantUid`). Each
 * shows its stage in the deal page's own word and links to it. With none, the
 * Worker's sentence says so in plain words; it is never drawn as Not recorded.
 */
export const NO_ROOM_DEAL = 'No deal you are invited to is recorded for this company.';

/** The deal page's header word for a status: the stored word, capitalised; a missing one says so. */
export function stageWord(status) {
  const s = status == null ? '' : String(status).trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Status not recorded';
}

export default function RoomDeals({ deals, note = null }) {
  const list = Array.isArray(deals) ? deals.filter((d) => d && d.id != null) : [];
  if (!list.length) {
    return <p className="m-0 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300" data-testid="room-deal-none">{note || NO_ROOM_DEAL}</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="room-deals">
      {list.map((d) => (
        <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-[12px] text-gray-700 dark:text-gray-300" data-testid="room-deal">
          <span>Deal stage: <b className="font-bold text-axal-ink dark:text-gray-100">{stageWord(d.stage)}</b></span>
          <Link to={`/deals/${encodeURIComponent(d.id)}`} className="font-semibold text-indigo-700 underline dark:text-indigo-300" data-testid="room-deal-open">Open the deal</Link>
        </li>
      ))}
    </ul>
  );
}
