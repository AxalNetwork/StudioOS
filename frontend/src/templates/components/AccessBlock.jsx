import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import { DISPLAY_FONT, BTN } from '../brandKit';

export default function AccessBlock({
  headline,
  sub,
  items,
  cta,
  note,
  bg = 'bg-[#0B0B12]',
  className = '',
}) {
  return (
    <section className={`py-20 px-6 ${bg} ${className}`}>
      <div className="max-w-5xl mx-auto">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-10 md:p-14 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 rounded-full text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-6">
              <Lock size={10} /> Gated Access
            </div>
            <h2 style={DISPLAY_FONT} className="text-2xl md:text-3xl font-bold text-white mb-4">
              {headline}
            </h2>
            {sub && <p className="text-gray-300 leading-relaxed mb-8">{sub}</p>}
            {cta && (
              <Link to={cta.href} className={BTN.white}>
                {cta.label} <ArrowRight size={16} />
              </Link>
            )}
            {note && <p className="mt-4 text-xs text-gray-500">{note}</p>}
          </div>
          {items && items.length > 0 && (
            <div className="space-y-3">
              {items.map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex items-center gap-3 py-3 border-b border-white/10 last:border-0">
                    {Icon && (
                      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                        <Icon size={14} className="text-white/70" />
                      </div>
                    )}
                    <div>
                      {item.label && (
                        <div style={DISPLAY_FONT} className="text-sm font-semibold text-white">
                          {item.label}
                        </div>
                      )}
                      {item.desc && <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>}
                    </div>
                    <div className="ml-auto">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/50">
                        {item.status || 'Available'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
