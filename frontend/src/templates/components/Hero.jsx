import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { DISPLAY_FONT, BTN } from '../brandKit';

export default function Hero({
  eyebrow,
  badge,
  headline,
  sub,
  ctaPrimary,
  ctaSecondary,
  pills,
  variant = 'light',
  children,
}) {
  const bg =
    variant === 'dark'
      ? 'bg-[#0B0B12] text-white'
      : variant === 'paper'
      ? 'bg-[#F6F5F0] text-gray-900'
      : 'bg-white text-gray-900';

  const subColor = variant === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const pillCls =
    variant === 'dark'
      ? 'bg-white/10 text-white border border-white/20'
      : 'bg-gray-100 text-gray-700 border border-gray-200';
  const secondaryBtn = variant === 'dark' ? BTN.whiteOutline : BTN.ghost;

  return (
    <section className={`pt-32 pb-20 px-6 ${bg}`}>
      <div className="max-w-7xl mx-auto">
        <div className="max-w-4xl mx-auto text-center">
          {(badge || eyebrow) && (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#EEF0FF] border border-[#6D5BFF]/30 rounded-full text-xs font-semibold text-[#6D5BFF] mb-8">
              {badge && <span className="w-1.5 h-1.5 rounded-full bg-[#6D5BFF] animate-pulse" />}
              {badge || eyebrow}
            </div>
          )}

          <h1
            style={DISPLAY_FONT}
            className="text-5xl md:text-7xl font-bold leading-tight mb-6"
          >
            {headline}
          </h1>

          {sub && (
            <p className={`text-lg md:text-xl max-w-2xl mx-auto mb-8 leading-relaxed ${subColor}`}>
              {sub}
            </p>
          )}

          {pills && pills.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
              {pills.map((p) => (
                <span key={p} className={`text-xs px-3 py-1 rounded-full ${pillCls}`}>
                  {p}
                </span>
              ))}
            </div>
          )}

          {(ctaPrimary || ctaSecondary) && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-2">
              {ctaPrimary && (
                <Link to={ctaPrimary.href} className={BTN.primary}>
                  {ctaPrimary.label} <ArrowRight size={16} />
                </Link>
              )}
              {ctaSecondary && (
                <Link to={ctaSecondary.href} className={secondaryBtn}>
                  {ctaSecondary.label} <ArrowRight size={16} />
                </Link>
              )}
            </div>
          )}

          {children}
        </div>
      </div>
    </section>
  );
}
