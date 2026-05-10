import { ShieldCheck, ShieldAlert } from 'lucide-react';

export function computeTrustScore(obligations = []) {
  const required = obligations.filter(o => o.required);
  if (required.length === 0) return 100;
  const satisfied = required.filter(o => o.status === 'satisfied' || o.status === 'waived').length;
  return Math.round((satisfied / required.length) * 100);
}

const SIZE = {
  sm: { ring: 36, stroke: 4, font: 'text-[10px]', icon: 12 },
  md: { ring: 56, stroke: 5, font: 'text-xs',     icon: 14 },
  lg: { ring: 96, stroke: 8, font: 'text-base',   icon: 18 },
};

export default function TrustScoreBadge({
  score = 0,
  size = 'md',
  label,
  missing,
}) {
  const s = SIZE[size] || SIZE.md;
  const r = (s.ring - s.stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  const tone =
    score >= 90 ? 'text-emerald-600'  :
    score >= 60 ? 'text-amber-600'    :
                  'text-red-600';
  const ring =
    score >= 90 ? 'stroke-emerald-500' :
    score >= 60 ? 'stroke-amber-500'   :
                  'stroke-red-500';
  const tooltip =
    missing && missing.length
      ? `Missing: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`
      : 'All required obligations satisfied';

  return (
    <span
      className="inline-flex items-center gap-2"
      title={tooltip}
      data-trust-score={score}
    >
      <span className="relative inline-flex items-center justify-center" style={{ width: s.ring, height: s.ring }}>
        <svg width={s.ring} height={s.ring} className="-rotate-90">
          <circle
            cx={s.ring / 2} cy={s.ring / 2} r={r}
            className="stroke-slate-200 dark:stroke-slate-700"
            fill="none" strokeWidth={s.stroke}
          />
          <circle
            cx={s.ring / 2} cy={s.ring / 2} r={r}
            className={ring} fill="none" strokeWidth={s.stroke}
            strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center font-semibold ${s.font} ${tone}`}>
          {score}
        </span>
      </span>
      {label !== false && (
        <span className={`inline-flex items-center gap-1 ${s.font} ${tone} font-medium`}>
          {score >= 90
            ? <ShieldCheck size={s.icon} />
            : <ShieldAlert size={s.icon} />}
          {label || 'Trust'}
        </span>
      )}
    </span>
  );
}
