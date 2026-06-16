import React from 'react';
import { DISPLAY_FONT } from '../brandKit';
import SectionHeader from './SectionHeader';

export default function FeatureGrid({
  features,
  headline,
  eyebrow,
  sub,
  cols = 3,
  bg = 'bg-gray-50',
  className = '',
}) {
  const gridCols =
    cols === 2
      ? 'md:grid-cols-2'
      : cols === 4
      ? 'md:grid-cols-2 lg:grid-cols-4'
      : 'md:grid-cols-2 lg:grid-cols-3';

  return (
    <section className={`py-20 px-6 ${bg} ${className}`}>
      <div className="max-w-7xl mx-auto">
        {headline && <SectionHeader eyebrow={eyebrow} headline={headline} sub={sub} />}
        <div className={`grid grid-cols-1 ${gridCols} gap-5`}>
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-[#6D5BFF]/40 hover:shadow-lg transition-all group"
              >
                {Icon && (
                  <div className="w-11 h-11 rounded-xl bg-[#EEF0FF] flex items-center justify-center mb-5">
                    <Icon size={20} className="text-[#6D5BFF]" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900">
                    {f.title}
                  </h3>
                  {f.tag && (
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-[#EEF0FF] text-[#6D5BFF] font-medium">
                      {f.tag}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
