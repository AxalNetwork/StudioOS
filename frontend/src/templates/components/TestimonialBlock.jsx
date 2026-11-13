import React from 'react';
import { Quote } from 'lucide-react';
import { DISPLAY_FONT } from '../brandKit';
import SectionHeader from './SectionHeader';

function TestimonialCard({ quote, name, role, company, avatar }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-7 flex flex-col gap-4 hover:border-[#6D5BFF]/30 hover:shadow-lg transition-all">
      <Quote size={20} className="text-[#6D5BFF] opacity-60" />
      <p className="text-sm text-gray-700 leading-relaxed flex-1 italic">"{quote}"</p>
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        {avatar ? (
          <img src={avatar} alt={name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-[#EEF0FF] flex items-center justify-center text-[#6D5BFF] font-bold text-sm">
            {name?.[0] || '?'}
          </div>
        )}
        <div>
          <div style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900">{name}</div>
          <div className="text-xs text-gray-500">
            {role}{company ? `, ${company}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TestimonialBlock({
  testimonials,
  headline,
  eyebrow,
  sub,
  bg = 'bg-gray-50',
  className = '',
}) {
  return (
    <section className={`py-20 px-6 ${bg} ${className}`}>
      <div className="max-w-7xl mx-auto">
        {headline && <SectionHeader eyebrow={eyebrow} headline={headline} sub={sub} />}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <TestimonialCard key={i} {...t} />
          ))}
        </div>
      </div>
    </section>
  );
}
