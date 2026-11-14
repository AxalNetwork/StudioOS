import React from 'react';
import { Link } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import FollowButton from './FollowButton';

/**
 * Task #66 — Reusable startup card. `startup` shape:
 *   { id, handle, name, sector, stage, status }
 * `showFollow` renders the follow control when an id is present.
 */
export default function StartupCard({ startup, showFollow = false }) {
  if (!startup) return null;
  const name = startup.name || (startup.handle ? `@${startup.handle}` : 'Startup');
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
        <Rocket size={18} />
      </div>
      <div className="min-w-0 flex-1">
        {startup.handle ? (
          <Link to={`/startups/${startup.handle}`} className="block truncate text-sm font-semibold text-gray-900 hover:text-violet-700 dark:text-gray-100">
            {name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</span>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {startup.sector && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {String(startup.sector).replace(/_/g, ' ')}
            </span>
          )}
          {startup.stage && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200">
              {String(startup.stage).replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>
      {showFollow && startup.id != null && (
        <FollowButton entityType="project" entityId={startup.id} size="sm" showCount={false} />
      )}
    </div>
  );
}
