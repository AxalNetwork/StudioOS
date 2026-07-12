// SectionScaffold — a clean, honest placeholder for navigation sections whose
// full page is not built yet. The route and sidebar entry are live so the
// information architecture is complete and navigable; this page states plainly
// that the surface is in development and lists the capabilities planned for it.
// It deliberately shows NO fabricated data.
import React from 'react';
import { Hammer, Sparkles, ArrowRight } from 'lucide-react';

export default function SectionScaffold({ title, description, planned = [] }) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2.5 py-1 text-[11px] font-semibold mb-3">
          <Hammer size={12} /> In development
        </span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40 p-8">
        <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100 font-semibold">
          <Sparkles size={16} className="text-violet-600" /> What&rsquo;s coming to this section
        </div>

        {planned.length > 0 && (
          <ul className="mt-4 space-y-2.5">
            {planned.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <ArrowRight size={15} className="mt-0.5 shrink-0 text-violet-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
          The navigation and route for this section are live now, so it&rsquo;s reachable
          from the sidebar and by direct link. The working surface will be filled in here.
        </p>
      </div>
    </div>
  );
}
