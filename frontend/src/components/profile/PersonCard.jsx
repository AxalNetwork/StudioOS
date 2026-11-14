import React from 'react';
import { Link } from 'react-router-dom';
import FollowButton from './FollowButton';

const ROLE_TONE = {
  founder: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  investor: 'bg-violet-50 text-violet-700 ring-violet-200',
  partner: 'bg-amber-50 text-amber-700 ring-amber-200',
  admin: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/**
 * Task #66 — Reusable person card. Used across public profiles, startup
 * founder rows, and follow lists. `person` shape:
 *   { id, handle, name, headline, role, headshot_url }
 * `showFollow` renders the follow control when an id is present.
 */
export default function PersonCard({ person, showFollow = false, compact = false }) {
  if (!person) return null;
  const name = person.name || person.display_name || (person.handle ? `@${person.handle}` : 'Member');
  const role = (person.role || '').toLowerCase();
  const tone = ROLE_TONE[role] || ROLE_TONE.admin;
  const initial = (name || '?').charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      {person.headshot_url ? (
        <img src={person.headshot_url} alt="" className={`shrink-0 rounded-full object-cover ${compact ? 'h-9 w-9' : 'h-11 w-11'}`} />
      ) : (
        <div className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tone} ${compact ? 'h-9 w-9 text-sm' : 'h-11 w-11'}`}>
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {person.handle ? (
          <Link to={`/u/${person.handle}`} className="block truncate text-sm font-semibold text-gray-900 hover:text-violet-700 dark:text-gray-100">
            {name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</span>
        )}
        {person.headline && <p className="truncate text-xs text-gray-500">{person.headline}</p>}
        {role && (
          <span className={`mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ${tone}`}>
            {role}
          </span>
        )}
      </div>
      {showFollow && person.id != null && (
        <FollowButton entityType="user" entityId={person.id} size="sm" showCount={false} />
      )}
    </div>
  );
}
