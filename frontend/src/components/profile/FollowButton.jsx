import React, { useEffect, useState } from 'react';
import { UserPlus, UserCheck, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { reportError } from '../../lib/log';

/**
 * Task #66 — Follow / unfollow control for a person or startup.
 *
 * Props:
 *  - entityType: 'user' | 'project'
 *  - entityId:   numeric id of the entity
 *  - initialFollowers: optional seed count (avoids a flash before status loads)
 *  - showCount:  render the follower count pill (default true)
 *  - size:       'sm' | 'md'
 *
 * The follower count is public; the following state requires auth. When the
 * viewer is signed out we render a count-only pill and route a follow attempt
 * to /login so the CTA still reads as "you can follow this".
 */
export default function FollowButton({
  entityType,
  entityId,
  initialFollowers = null,
  showCount = true,
  size = 'md',
}) {
  const { user } = useAuth() || {};
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(initialFollowers);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!entityType || !entityId) return undefined;
    api.followStatus(entityType, entityId)
      .then((r) => {
        if (!alive) return;
        setFollowing(!!r.following);
        if (typeof r.followers === 'number') setFollowers(r.followers);
      })
      .catch(() => { /* keep seed values */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [entityType, entityId]);

  async function toggle() {
    if (!user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    const wasFollowing = following;
    try {
      const r = wasFollowing
        ? await api.unfollow(entityType, entityId)
        : await api.follow(entityType, entityId);
      setFollowing(!!r.following);
      if (typeof r.followers === 'number') setFollowers(r.followers);
    } catch (e) {
      reportError(e, { where: 'FollowButton.toggle', entityType, entityId });
    } finally {
      setBusy(false);
    }
  }

  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  const iconSize = size === 'sm' ? 13 : 15;

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
        className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition ${pad} ${
          following
            ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
            : 'bg-violet-600 text-white hover:bg-violet-700'
        } ${busy ? 'opacity-60' : ''}`}
      >
        {following ? <UserCheck size={iconSize} /> : <UserPlus size={iconSize} />}
        {following ? 'Following' : 'Follow'}
      </button>
      {showCount && followers != null && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          title={`${followers} follower${followers === 1 ? '' : 's'}`}
        >
          <Users size={12} /> {followers.toLocaleString()}
          {!ready && <span className="sr-only"> loading</span>}
        </span>
      )}
    </div>
  );
}
