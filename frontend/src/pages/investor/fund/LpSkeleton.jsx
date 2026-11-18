import React from 'react';

export default function LpSkeleton() {
  return (
    <div className="space-y-4" data-testid="lp-workspace-loading">
      <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-72 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
        <div className="h-72 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}
