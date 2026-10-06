import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { EmptyState, Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, Chips, INPUT, LoadingRows, PanelCard, useAccountRead } from './AccountCenter';
import { filterFollows, followRows } from './accountCenterModel';

/**
 * D568 — Following: the people and companies you follow, with Unfollow on the
 * row. The canvas's `ac_following` block.
 *
 * `GET /follows/mine` returns people (`users`) and startups (`projects`), each
 * with its public handle. Unfollow is `DELETE /follows`, the route the Follow
 * button on a profile already calls. An unfollowed row stays in place with
 * Undo (`POST /follows`) until the page is left, so a mis-tap costs nothing
 * and no confirmation box is needed for a step this easy to take back.
 *
 * Two canvas details have no data behind them, and both are said: the follow's
 * date ("since …" — the route selects `created_at` and does not return it) and
 * the "Recent" sort (without that date the list cannot be put in follow
 * order, so it is sorted by name).
 */

const FOLLOW_DATE_REASON = 'the follow list does not return when you followed';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length ? parts.slice(0, 2).map((p) => p[0]).join('') : '?').toUpperCase();
}

export function FollowingList({ follows, query, kind, onQuery, onKind, removed = {}, pending = {}, errors = {}, onUnfollow, onUndo }) {
  const rows = follows.status === 'ready' ? followRows(follows.data) : [];
  const visible = filterFollows(rows, { query, kind });
  const people = rows.filter((r) => r.kind === 'person').length;
  const companies = rows.length - people;
  return (
    <PanelCard
      title="Following"
      aside={follows.status === 'ready' ? `${visible.length} of ${rows.length}` : null}
      data-testid="card-following"
      footer={follows.status === 'ready' && rows.length > 0 ? `Sorted by name. The date of each follow is not recorded: ${FOLLOW_DATE_REASON}.` : null}
    >
      {follows.status === 'loading' ? <LoadingRows lines={4} />
        : follows.status === 'unreadable' ? (
          <Unreadable what="Who you follow" claim={follows.message || 'This is not a claim that you follow nobody.'} onRetry={follows.reload} />
        ) : rows.length === 0 ? (
          <EmptyState size="sm" data-testid="following-empty" title="You follow nobody yet." body="Follow a person or a startup from their public profile, and they are listed here." cta={{ label: 'Browse the directory', to: '/directory' }} />
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2">
              <input type="search" className={INPUT} placeholder="Search…" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="Search who you follow" data-testid="input-following-search" />
              <Chips label="Kind" items={[
                { key: 'all', label: `All ${rows.length}`, active: kind === 'all', onSelect: () => onKind('all') },
                { key: 'person', label: `People ${people}`, active: kind === 'person', onSelect: () => onKind('person'), testid: 'chip-following-people' },
                { key: 'company', label: `Companies ${companies}`, active: kind === 'company', onSelect: () => onKind('company'), testid: 'chip-following-companies' },
              ]} />
            </div>
            {visible.length === 0 ? (
              <p className="py-2 text-[13px] text-axal-muted dark:text-gray-400">Nobody you follow matches this search.</p>
            ) : (
              <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
                {visible.map((r) => {
                  const gone = !!removed[r.key];
                  return (
                    <li key={r.key} data-testid={`follow-${r.key}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5 text-[13px]">
                      <div className={`flex min-w-0 items-center gap-2.5 ${gone ? 'opacity-60' : ''}`}>
                        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-axal-hairline bg-axal-ground font-mono text-[10px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          {initials(r.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {r.name && r.href
                              ? <Link to={r.href} className="font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{r.name}</Link>
                              : <span className="font-semibold text-axal-ink dark:text-gray-100">{r.name || <Unrecorded reason="this profile has no name set">Name not recorded</Unrecorded>}</span>}
                            <Pill tone={r.kind === 'person' ? 'info' : 'neutral'}>{r.kind === 'person' ? 'Person' : 'Company'}</Pill>
                            <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">since <Unrecorded reason={FOLLOW_DATE_REASON}>not recorded</Unrecorded></span>
                          </div>
                          {r.sub && <div className="truncate text-[12px] text-axal-muted dark:text-gray-400">{r.sub}</div>}
                          {errors[r.key] && <div role="alert" className="text-[12px] text-red-700 dark:text-red-300">{errors[r.key]}</div>}
                        </div>
                      </div>
                      {gone ? (
                        <span className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
                          Unfollowed
                          <button type="button" className={BTN.link} onClick={() => onUndo(r)} disabled={!!pending[r.key]} data-testid={`button-refollow-${r.key}`}>Undo</button>
                        </span>
                      ) : (
                        <button type="button" className={BTN.ghost} onClick={() => onUnfollow(r)} disabled={!!pending[r.key]} data-testid={`button-unfollow-${r.key}`}>
                          {pending[r.key] ? 'Unfollowing…' : 'Unfollow'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
    </PanelCard>
  );
}

/** The container: one read, and the two writes a row can make. */
export default function FollowingSection() {
  const follows = useAccountRead(() => api.followsMine());
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [removed, setRemoved] = useState({});
  const [pending, setPending] = useState({});
  const [errors, setErrors] = useState({});

  const write = async (row, call, nextRemoved) => {
    setPending((p) => ({ ...p, [row.key]: true }));
    setErrors((e) => ({ ...e, [row.key]: null }));
    try {
      await call(row.entityType, row.id);
      setRemoved((m) => ({ ...m, [row.key]: nextRemoved }));
    } catch (e) {
      setErrors((m) => ({ ...m, [row.key]: e?.message || 'That did not go through. Try again in a moment.' }));
    } finally {
      setPending((p) => ({ ...p, [row.key]: false }));
    }
  };

  return (
    <FollowingList
      follows={follows}
      query={query}
      kind={kind}
      onQuery={setQuery}
      onKind={setKind}
      removed={removed}
      pending={pending}
      errors={errors}
      onUnfollow={(row) => write(row, (t, id) => api.unfollow(t, id), true)}
      onUndo={(row) => write(row, (t, id) => api.follow(t, id), false)}
    />
  );
}
