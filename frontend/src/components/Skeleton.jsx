import React from 'react';

/**
 * Task #3 (IC) — Skeleton placeholder primitives. Use these in place of
 * "Loading…" strings so the loading layout mirrors the final layout.
 *
 *   <Skeleton h={20} w="60%" />
 *   <Skeleton.Text lines={3} />
 *   <Skeleton.Card />
 *   <Skeleton.Table rows={5} cols={4} />
 *
 * Animation honors `prefers-reduced-motion: reduce` via the
 * `motion-safe:animate-pulse` Tailwind utility — users who've asked the
 * OS for reduced motion get a flat shimmer instead of a pulse.
 */
function Skeleton({ h = 16, w = '100%', rounded = 'rounded-md', className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`motion-safe:animate-pulse bg-gray-200 dark:bg-gray-700 ${rounded} ${className}`}
      style={{ height: typeof h === 'number' ? `${h}px` : h, width: typeof w === 'number' ? `${w}px` : w }}
    />
  );
}

Skeleton.Text = function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={12} w={`${90 - i * 12}%`} />
      ))}
    </div>
  );
};

Skeleton.Card = function SkeletonCard({ className = '' }) {
  return (
    <div className={`border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-4 ${className}`}>
      <Skeleton h={16} w="40%" className="mb-3" />
      <Skeleton.Text lines={3} />
    </div>
  );
};

Skeleton.Table = function SkeletonTable({ rows = 5, cols = 4, className = '' }) {
  return (
    <div className={`border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden ${className}`}>
      <div className="grid gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} h={10} w="60%" />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} h={14} w={c === 0 ? '80%' : `${50 + ((r + c) % 4) * 10}%`} />)}
        </div>
      ))}
    </div>
  );
};

Skeleton.Circle = function SkeletonCircle({ size = 40, className = '' }) {
  return <Skeleton h={size} w={size} rounded="rounded-full" className={className} />;
};

export default Skeleton;
