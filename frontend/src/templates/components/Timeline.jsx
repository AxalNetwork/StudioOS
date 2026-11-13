import React from 'react';
import { DISPLAY_FONT } from '../brandKit';
import SectionHeader from './SectionHeader';

export default function Timeline({
  steps,
  headline,
  eyebrow,
  sub,
  bg = 'bg-white',
  orientation = 'vertical',
  className = '',
}) {
  if (orientation === 'horizontal') {
    return (
      <section className={`py-20 px-6 ${bg} ${className}`}>
        <div className="max-w-7xl mx-auto">
          {headline && <SectionHeader eyebrow={eyebrow} headline={headline} sub={sub} />}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-0 relative">
            <div className="absolute top-5 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-[#6D5BFF] via-[#5DE0B8] to-[#F2B33D] hidden md:block" />
            {steps.map((step, i) => (
              <div key={i} className="relative flex flex-col items-center text-center px-4 mb-10 md:mb-0">
                <div className="w-10 h-10 rounded-full bg-[#6D5BFF] text-white flex items-center justify-center font-bold text-sm z-10 mb-4">
                  {step.n || i + 1}
                </div>
                {step.label && (
                  <div className="text-[11px] uppercase tracking-wider text-[#6D5BFF] font-semibold mb-1">
                    {step.label}
                  </div>
                )}
                <h3 style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`py-20 px-6 ${bg} ${className}`}>
      <div className="max-w-4xl mx-auto">
        {headline && <SectionHeader eyebrow={eyebrow} headline={headline} sub={sub} />}
        <div className="relative">
          <div className="absolute left-5 top-6 bottom-6 w-0.5 bg-gradient-to-b from-[#6D5BFF] to-[#5DE0B8] hidden sm:block" />
          <ol className="space-y-10">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-6 relative">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#6D5BFF] text-white flex items-center justify-center font-bold text-sm z-10">
                  {step.n || i + 1}
                </div>
                <div className="flex-1 pt-1.5">
                  {step.label && (
                    <div className="text-[11px] uppercase tracking-wider text-[#6D5BFF] font-semibold mb-1">
                      {step.label}
                    </div>
                  )}
                  <h3 style={DISPLAY_FONT} className="text-base font-semibold text-gray-900 mb-1">
                    {step.title}
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
                  {step.bullets && (
                    <ul className="mt-3 space-y-1.5">
                      {step.bullets.map((b, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#6D5BFF] mt-1.5 shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
