import React from 'react';
import { DISPLAY_FONT } from '../brandKit';

export default function SectionHeader({ eyebrow, headline, sub, align = 'center', className = '' }) {
  const base = align === 'left' ? 'text-left' : 'text-center mx-auto';
  return (
    <div className={`max-w-3xl mb-16 ${base} ${className}`}>
      {eyebrow && (
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#EEF0FF] border border-[#6D5BFF]/20 rounded-full text-[11px] font-semibold text-[#6D5BFF] uppercase tracking-wider mb-5">
          {eyebrow}
        </div>
      )}
      <h2 style={DISPLAY_FONT} className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 leading-tight">
        {headline}
      </h2>
      {sub && <p className="text-lg text-gray-600 leading-relaxed">{sub}</p>}
    </div>
  );
}
