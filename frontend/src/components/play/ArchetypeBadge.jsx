// Task #7 — Compact archetype chip surfaced on event roster + networking views.
//
// Lazily fetches a user's PUBLISHED assessment archetype. assessment.results is
// consent-gated server-side: for anyone but the caller/admin it only returns
// results the user has published, so this never leaks an unpublished archetype.
// Resolutions are memoised in a module-level cache with in-flight de-duplication
// so a roster of N rows issues at most one request per distinct user. Renders
// nothing when there's no published archetype, on error, or while loading — it's
// an enhancement, never a layout dependency.
import React, { useEffect, useState } from 'react';
import { assessment } from '../../lib/api';
import { archetypeMeta, iconFor } from '../../lib/assessmentMeta';

// userId → { slug, label } | null   (null = resolved: no published archetype)
const _cache = new Map();
const _inflight = new Map();

async function resolveArchetype(userId) {
  if (_cache.has(userId)) return _cache.get(userId);
  if (_inflight.has(userId)) return _inflight.get(userId);
  const p = (async () => {
    try {
      const res = await assessment.results(userId);
      const list = Array.isArray(res?.results)
        ? res.results
        : Array.isArray(res)
          ? res
          : (res && res.archetype_slug ? [res] : []);
      const hit = list.find((r) => r && r.archetype_slug);
      const out = hit ? { slug: hit.archetype_slug, label: hit.archetype_label || null } : null;
      _cache.set(userId, out);
      return out;
    } catch {
      _cache.set(userId, null); // resolved-as-absent; don't retry on every render
      return null;
    } finally {
      _inflight.delete(userId);
    }
  })();
  _inflight.set(userId, p);
  return p;
}

export default function ArchetypeBadge({ userId, className = '' }) {
  const [data, setData] = useState(() =>
    (userId != null && _cache.has(userId) ? _cache.get(userId) : undefined),
  );

  useEffect(() => {
    let alive = true;
    if (userId == null) { setData(null); return undefined; }
    if (_cache.has(userId)) { setData(_cache.get(userId)); return undefined; }
    resolveArchetype(userId).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [userId]);

  if (!data) return null;
  const meta = archetypeMeta(data.slug);
  const label = meta?.label || data.label;
  if (!label) return null;
  const Icon = iconFor(meta?.icon);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 ${className}`}
      title={meta?.tagline || label}
    >
      <Icon size={11} style={meta?.accent ? { color: meta.accent } : undefined} aria-hidden="true" />
      {label}
    </span>
  );
}
