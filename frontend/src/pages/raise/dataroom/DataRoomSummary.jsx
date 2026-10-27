import React from 'react';
import { Card, Unrecorded } from '../../../ui';

/**
 * D1102, moved here from `DataRoomPage.jsx` by D1109 (#2989) — the read-only
 * summary an admin's read of a room is (`mode: 'summary'`): counts only, never
 * a file or folder name, never an owner action. The tool draws it in place of
 * any tab when the Worker answers a summary.
 */

const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

function StatTile({ k, v, sub }) {
  return (
    <Card>
      <div className={eyebrow}>{k}</div>
      {v === null
        ? <div className="mt-2"><Unrecorded reason={sub} /></div>
        : <div className="mt-1.5 font-mono text-[20px] font-bold tracking-tight text-axal-ink dark:text-gray-100">{v}</div>}
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

// D1102 — the files tool must not treat an admin's aggregate response as arrays
// or draw owner actions over a read-only summary.
export function AdminRoomSummary({ room, reload }) {
  const count = (block, key) => block?.available === true && typeof block[key] === 'number' ? block[key] : 'Unreadable';
  const covered = count(room.coverage, 'covered_items'), total = count(room.coverage, 'total_items');
  const coverage = typeof covered === 'number' && typeof total === 'number' ? `${covered} of ${total}` : 'Unreadable';
  const unreadable = [count(room.files, 'total'), count(room.folders, 'total'), coverage, count(room.grants, 'total')].includes('Unreadable');
  return (
    <div className="space-y-4" data-testid="data-room-admin-summary">
      <Card><h2 className="text-lg font-semibold text-axal-ink dark:text-white">Read-only summary</h2>
        <p className="mt-2 text-sm text-axal-muted">File names and files belong to the founder.</p>
        {unreadable && <button type="button" onClick={reload} className="mt-2 text-sm underline text-violet-700 dark:text-violet-300">Try again</button>}</Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile k="Files" v={count(room.files, 'total')} sub="Recorded files; no file names are shown." />
        <StatTile k="Folders" v={count(room.folders, 'total')} sub="Recorded folders; no folder names are shown." />
        <StatTile k="Checklist coverage" v={coverage} sub="Recorded tags, not a claim that investors can open the files." />
        <StatTile k="Grants" v={count(room.grants, 'total')} sub="Recorded grants; no investor details are shown." />
      </div>
    </div>
  );
}
