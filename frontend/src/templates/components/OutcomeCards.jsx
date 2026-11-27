import React from 'react';
import { CheckCircle } from 'lucide-react';
import { DISPLAY_FONT } from '../brandKit';
import SectionHeader from './SectionHeader';

export default function OutcomeCards({
  outcomes,
  headline,
  eyebrow,
  sub,
  cols = 3,
  bg = 'bg-white',
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
          {outcomes.map((o, i) => {
            const Icon = o.icon || CheckCircle;
            return (
              <div
                key={i}
                className={`rounded-2xl p-6 border transition-all ${
                  o.highlight
                    ? 'bg-[#6D5BFF] border-[#6D5BFF] text-white shadow-xl shadow-[#6D5BFF]/20'
                    : 'bg-white border-gray-200 hover:border-[#6D5BFF]/40 hover:shadow-lg'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
                    o.highlight ? 'bg-white/20' : 'bg-[#EEF0FF]'
                  }`}
                >
                  <Icon size={18} className={o.highlight ? 'text-white' : 'text-[#6D5BFF]'} />
                </div>
                <h3
                  style={DISPLAY_FONT}
                  className={`text-sm font-semibold mb-2 ${o.highlight ? 'text-white' : 'text-gray-900'}`}
                >
                  {o.title}
                </h3>
                <p className={`text-sm leading-relaxed ${o.highlight ? 'text-white/80' : 'text-gray-600'}`}>
                  {o.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
