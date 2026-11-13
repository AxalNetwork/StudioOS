import React from 'react';
import { Construction } from 'lucide-react';

// Shell placeholder for advisor section tabs. Every advisor workspace tab
// renders this until its dedicated section task fills in real content and
// deterministic mock data. It is deliberately labelled as a placeholder so no
// advisor tab ever shows a blank screen while the shell is in place.
export default function AdvisorSectionStub({ title, description }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 p-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
        <Construction className="h-6 w-6 text-violet-600 dark:text-violet-300" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 dark:text-gray-400">{description}</p>
      )}
      <p className="mt-4 inline-block rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        Placeholder — content coming soon
      </p>
    </div>
  );
}
