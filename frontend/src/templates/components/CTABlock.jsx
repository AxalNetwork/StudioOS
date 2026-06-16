import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { DISPLAY_FONT, BTN } from '../brandKit';

export default function CTABlock({
  headline,
  sub,
  ctaPrimary,
  ctaSecondary,
  variant = 'dark',
  note,
  className = '',
}) {
  const bgClass =
    variant === 'violet'
      ? 'bg-[#6D5BFF]'
      : variant === 'light'
      ? 'bg-[#F6F5F0]'
      : 'bg-[#0B0B12]';

  const headlineColor = variant === 'light' ? 'text-gray-900' : 'text-white';
  const subColor = variant === 'light' ? 'text-gray-600' : 'text-gray-300';
  const noteColor = variant === 'light' ? 'text-gray-400' : 'text-gray-500';
  const primaryBtn = variant === 'light' ? BTN.primary : BTN.white;
  const secondaryBtn = BTN.whiteOutline;

  return (
    <section className={`py-20 px-6 ${bgClass} ${className}`}>
      <div className="max-w-4xl mx-auto text-center">
        <h2 style={DISPLAY_FONT} className={`text-3xl md:text-4xl font-bold mb-4 ${headlineColor}`}>
          {headline}
        </h2>
        {sub && (
          <p className={`max-w-2xl mx-auto mb-8 leading-relaxed ${subColor}`}>{sub}</p>
        )}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {ctaPrimary && (
            <Link to={ctaPrimary.href} className={primaryBtn}>
              {ctaPrimary.label} <ArrowRight size={16} />
            </Link>
          )}
          {ctaSecondary && (
            <Link to={ctaSecondary.href} className={variant === 'light' ? BTN.ghost : secondaryBtn}>
              {ctaSecondary.label} <ArrowRight size={16} />
            </Link>
          )}
        </div>
        {note && (
          <p className={`mt-6 text-xs ${noteColor}`}>{note}</p>
        )}
      </div>
    </section>
  );
}
