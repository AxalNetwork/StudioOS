import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DISPLAY_FONT } from '../brandKit';
import SectionHeader from './SectionHeader';

export default function FAQ({
  items,
  headline = 'Frequently Asked Questions',
  eyebrow = 'FAQ',
  bg = 'bg-white',
  className = '',
}) {
  const [open, setOpen] = useState(null);

  return (
    <section className={`py-20 px-6 ${bg} ${className}`}>
      <div className="max-w-3xl mx-auto">
        <SectionHeader eyebrow={eyebrow} headline={headline} />
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900 pr-4">
                  {item.q}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform shrink-0 ${open === i ? 'rotate-180' : ''}`}
                />
              </button>
              {open === i && (
                <div className="px-6 pb-5 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
