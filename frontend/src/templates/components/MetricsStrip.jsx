import React, { useEffect, useRef, useState } from 'react';
import { DISPLAY_FONT } from '../brandKit';

function useCountUp(target, durationMs = 700) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || typeof target !== 'number' || Number.isNaN(target)) return;
    started.current = true;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / durationMs);
      setValue(Math.round(target * (0.5 - 0.5 * Math.cos(Math.PI * p))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function Metric({ value, label, suffix, prefix }) {
  const n = useCountUp(typeof value === 'number' ? value : 0);
  const display = typeof value === 'number' ? n.toLocaleString() : value;
  return (
    <div className="text-center px-4">
      <div style={DISPLAY_FONT} className="text-3xl md:text-4xl font-bold text-[#6D5BFF] tabular-nums">
        {prefix || ''}{display}<span className="text-xl">{suffix || ''}</span>
      </div>
      <div className="text-xs text-gray-500 uppercase tracking-wider mt-2 font-medium">{label}</div>
    </div>
  );
}

export default function MetricsStrip({ metrics, className = '' }) {
  return (
    <div className={`max-w-5xl mx-auto mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 ${className}`}>
      {metrics.map((m, i) => (
        <Metric key={i} {...m} />
      ))}
    </div>
  );
}
