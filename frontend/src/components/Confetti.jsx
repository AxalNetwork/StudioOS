import React, { useEffect, useMemo, useState } from 'react';

/**
 * Task #6 (IF) — Lightweight CSS confetti celebration.
 *
 * No npm dependency: spawns ~80 absolutely-positioned coloured squares
 * that fall + rotate via inline transition. Auto-cleans after ~4s and
 * calls `onDone` so the parent can unmount us (preventing a re-render
 * loop). Renders a fixed-position overlay; pointer-events disabled so
 * clicks pass through.
 */
const COLORS = ['#8b5cf6', '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const COUNT = 80;
const DURATION_MS = 4000;

export default function Confetti({ onDone }) {
  const [phase, setPhase] = useState('falling');
  const pieces = useMemo(() => Array.from({ length: COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 600,
    rotate: Math.floor(Math.random() * 720 - 360),
    size: 6 + Math.random() * 6,
    dur: 2500 + Math.random() * 1500,
  })), []);

  useEffect(() => {
    const t = setTimeout(() => setPhase('done'), DURATION_MS);
    const t2 = setTimeout(() => { if (onDone) onDone(); }, DURATION_MS + 200);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [onDone]);

  if (phase === 'done') return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[200] pointer-events-none overflow-hidden"
      role="presentation"
    >
      {/* "Welcome to Axal VC" banner */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-3 rounded-full shadow-2xl text-sm font-semibold animate-pulse">
        🎉 Welcome to Axal VC — you're set up!
      </div>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: `-10px`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            animation: `axal-confetti-fall ${p.dur}ms ${p.delay}ms linear forwards`,
            transform: `rotate(${p.rotate}deg)`,
            borderRadius: 1,
          }}
        />
      ))}
      <style>{`
        @keyframes axal-confetti-fall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
