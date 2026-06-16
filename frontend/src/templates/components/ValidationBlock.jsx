import React from 'react';
import { CheckCircle } from 'lucide-react';
import { DISPLAY_FONT } from '../brandKit';
import SectionHeader from './SectionHeader';

export default function ValidationBlock({
  items,
  headline,
  eyebrow,
  sub,
  bg = 'bg-[#EEF0FF]',
  className = '',
}) {
  return (
    <section className={`py-20 px-6 ${bg} ${className}`}>
      <div className="max-w-5xl mx-auto">
        {headline && <SectionHeader eyebrow={eyebrow} headline={headline} sub={sub} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {items.map((item, i) => {
            const Icon = item.icon || CheckCircle;
            return (
              <div
                key={i}
                className="flex items-start gap-3 bg-white rounded-xl p-5 border border-[#6D5BFF]/10 shadow-sm"
              >
                <div className="w-8 h-8 rounded-lg bg-[#EEF0FF] flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-[#6D5BFF]" />
                </div>
                <div>
                  {item.label && (
                    <div style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900 mb-0.5">
                      {item.label}
                    </div>
                  )}
                  <p className="text-xs text-gray-600 leading-relaxed">{item.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
