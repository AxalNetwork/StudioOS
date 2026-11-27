// Task #2 — Per-mechanic renderers for the assessment player. Each renders a
// single decision per screen and emits an engine-compatible response shape via
// onAnswer(response, { latencyMs, confidenceWager }):
//   dilemma / sjt / speed → { key }
//   card_sort            → { picked: [keys in rank order] }
//   allocation           → { allocation: { bucketKey: points } }
//   reflection           → { takeaway } (unscored; triggers the reveal)
// Shapes mirror cloudflare-worker/src/services/assessmentScoring.ts.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ArrowRight, Sparkles } from 'lucide-react';

// Latency measured from item render → selection (per the scoring engine, used
// only for the speed mechanic; harmless on the rest).
function useItemTimer(itemId) {
  const startRef = useRef(performance.now());
  useEffect(() => { startRef.current = performance.now(); }, [itemId]);
  return useCallback(() => Math.max(0, Math.round(performance.now() - startRef.current)), []);
}

const OPTION_BASE =
  'w-full text-left rounded-xl border px-4 py-3.5 text-sm transition flex items-start gap-3 disabled:opacity-60';
const OPTION_IDLE =
  'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:border-violet-400 dark:hover:border-violet-500';
const OPTION_SEL =
  'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-900 dark:text-violet-100';

function ContinueButton({ disabled, onClick, label = 'Continue' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
    >
      {label} <ArrowRight className="h-4 w-4" />
    </button>
  );
}

export function DilemmaMechanic({ item, onAnswer, busy }) {
  const latency = useItemTimer(item.id);
  const options = Array.isArray(item.options?.options) ? item.options.options : [];
  return (
    <div className="space-y-3">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={busy}
          onClick={() => onAnswer({ key: o.key }, { latencyMs: latency() })}
          className={`${OPTION_BASE} ${OPTION_IDLE}`}
        >
          <span className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full border-2 border-violet-400" />
          <span className="leading-snug">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function CardSortMechanic({ item, onAnswer, busy }) {
  const latency = useItemTimer(item.id);
  const cards = Array.isArray(item.options?.cards) ? item.options.cards : [];
  const pickN = Number(item.options?.pick_n ?? item.config?.pick_n ?? 2);
  const [picked, setPicked] = useState([]);
  useEffect(() => { setPicked([]); }, [item.id]);

  const toggle = (key) =>
    setPicked((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= pickN ? cur : [...cur, key],
    );
  const ready = picked.length === pickN;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Tap to rank your top {pickN}. Tap again to remove.
      </p>
      {cards.map((c) => {
        const r = picked.indexOf(c.key);
        const sel = r >= 0;
        return (
          <button
            key={c.key}
            type="button"
            disabled={busy}
            onClick={() => toggle(c.key)}
            className={`${OPTION_BASE} ${sel ? OPTION_SEL : OPTION_IDLE}`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                sel
                  ? 'bg-violet-600 text-white'
                  : 'border border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500'
              }`}
            >
              {sel ? r + 1 : ''}
            </span>
            <span className="leading-snug">{c.label}</span>
          </button>
        );
      })}
      <ContinueButton
        disabled={!ready || busy}
        onClick={() => onAnswer({ picked }, { latencyMs: latency() })}
      />
    </div>
  );
}

const WAGERS = [
  { label: 'Low', value: 0.33 },
  { label: 'Medium', value: 0.66 },
  { label: 'High', value: 1 },
];

export function SjtMechanic({ item, onAnswer, busy }) {
  const latency = useItemTimer(item.id);
  const options = Array.isArray(item.options?.options) ? item.options.options : [];
  const [choice, setChoice] = useState(null);
  useEffect(() => { setChoice(null); }, [item.id]);

  return (
    <div className="space-y-3">
      {options.map((o) => {
        const sel = choice === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={busy}
            onClick={() => setChoice(o.key)}
            className={`${OPTION_BASE} ${sel ? OPTION_SEL : OPTION_IDLE}`}
          >
            <span
              className={`mt-0.5 h-5 w-5 flex-shrink-0 rounded-full border-2 ${
                sel ? 'border-violet-500 bg-violet-500' : 'border-violet-400'
              }`}
            />
            <span className="leading-snug">{o.label}</span>
          </button>
        );
      })}
      {choice && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
          <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            How sure are you? Wager your confidence.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {WAGERS.map((w) => (
              <button
                key={w.label}
                type="button"
                disabled={busy}
                onClick={() => onAnswer({ key: choice }, { latencyMs: latency(), confidenceWager: w.value })}
                className="rounded-lg border border-violet-300 bg-white px-2 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:bg-gray-900 dark:text-violet-200 dark:hover:bg-violet-900/30"
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SpeedMechanic({ item, onAnswer, busy }) {
  const timerMs = Number(item.config?.timer_ms ?? item.options?.timer_ms ?? 6000);
  const options = Array.isArray(item.options?.options) ? item.options.options : [];
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  // Hold onAnswer in a ref so the countdown interval is NOT torn down/restarted
  // when onAnswer's identity changes mid-item (which would reset the timer).
  const onAnswerRef = useRef(onAnswer);
  useEffect(() => { onAnswerRef.current = onAnswer; }, [onAnswer]);
  const [remaining, setRemaining] = useState(timerMs);

  useEffect(() => {
    startRef.current = performance.now();
    doneRef.current = false;
    setRemaining(timerMs);
    const id = setInterval(() => {
      const left = Math.max(0, timerMs - (performance.now() - startRef.current));
      setRemaining(left);
      if (left <= 0 && !doneRef.current) {
        doneRef.current = true;
        clearInterval(id);
        onAnswerRef.current({ key: null }, { latencyMs: timerMs });
      }
    }, 50);
    return () => clearInterval(id);
  }, [item.id, timerMs]);

  const pick = (key) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onAnswerRef.current({ key }, { latencyMs: Math.round(performance.now() - startRef.current) });
  };

  const frac = Math.max(0, Math.min(1, remaining / timerMs));
  const C = 2 * Math.PI * 26;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <div className="relative h-20 w-20">
          <svg viewBox="0 0 60 60" className="h-20 w-20 -rotate-90">
            <circle cx="30" cy="30" r="26" fill="none" stroke="#9ca3af" strokeOpacity="0.35" strokeWidth="6" />
            <circle
              cx="30"
              cy="30"
              r="26"
              fill="none"
              stroke={frac > 0.33 ? '#7c3aed' : '#ef4444'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-gray-800 dark:text-gray-100">
            {Math.ceil(remaining / 1000)}
          </span>
        </div>
      </div>
      <div className="space-y-3">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={busy}
            onClick={() => pick(o.key)}
            className={`${OPTION_BASE} ${OPTION_IDLE} font-medium`}
          >
            <span className="leading-snug">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function initAlloc(buckets, total) {
  const out = {};
  if (buckets.length === 2) {
    const half = Math.round(total / 2);
    out[buckets[0].key] = half;
    out[buckets[1].key] = total - half;
  } else {
    buckets.forEach((b) => { out[b.key] = 0; });
  }
  return out;
}

export function AllocationMechanic({ item, onAnswer, busy }) {
  const latency = useItemTimer(item.id);
  const buckets = Array.isArray(item.options?.buckets) ? item.options.buckets : [];
  const total = Number(item.config?.total ?? item.options?.total ?? 100);
  const [alloc, setAlloc] = useState(() => initAlloc(buckets, total));
  useEffect(() => { setAlloc(initAlloc(buckets, total)); }, [item.id]);

  // Two-bucket split → a single slider that always sums to the total exactly.
  if (buckets.length === 2) {
    const a = buckets[0];
    const b = buckets[1];
    const va = Number(alloc[a.key]) || 0;
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          <span>{a.label}: <b className="text-violet-700 dark:text-violet-300">{va}</b></span>
          <span>{b.label}: <b className="text-violet-700 dark:text-violet-300">{total - va}</b></span>
        </div>
        <input
          type="range"
          min="0"
          max={total}
          value={va}
          disabled={busy}
          onChange={(e) => {
            const x = Number(e.target.value);
            setAlloc({ [a.key]: x, [b.key]: total - x });
          }}
          className="w-full accent-violet-600"
          aria-label={`Allocate between ${a.label} and ${b.label}`}
        />
        <ContinueButton disabled={busy} onClick={() => onAnswer({ allocation: alloc }, { latencyMs: latency() })} />
      </div>
    );
  }

  // 3+ buckets → per-bucket sliders; Continue is gated on an exact total.
  const sum = Object.values(alloc).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const remaining = total - sum;
  return (
    <div className="space-y-5">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Allocate all {total} points · <span className={remaining === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{remaining} left</span>
      </div>
      {buckets.map((bk) => (
        <div key={bk.key} className="space-y-1">
          <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
            <span>{bk.label}</span>
            <b className="text-violet-700 dark:text-violet-300">{Number(alloc[bk.key]) || 0}</b>
          </div>
          <input
            type="range"
            min="0"
            max={total}
            value={Number(alloc[bk.key]) || 0}
            disabled={busy}
            onChange={(e) => setAlloc((cur) => ({ ...cur, [bk.key]: Number(e.target.value) }))}
            className="w-full accent-violet-600"
            aria-label={`Allocate to ${bk.label}`}
          />
        </div>
      ))}
      <ContinueButton
        disabled={busy || remaining !== 0}
        onClick={() => onAnswer({ allocation: alloc }, { latencyMs: latency() })}
      />
    </div>
  );
}

export function ReflectionMechanic({ item, onAnswer, busy }) {
  const fields = Array.isArray(item.options?.fields) ? item.options.fields : [];
  const textField = fields.find((f) => f.kind === 'text');
  const [takeaway, setTakeaway] = useState('');
  useEffect(() => { setTakeaway(''); }, [item.id]);

  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
        <Sparkles className="h-8 w-8 text-violet-600 dark:text-violet-300" />
      </div>
      {textField && (
        <div className="text-left">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{textField.label}</label>
          <textarea
            value={takeaway}
            onChange={(e) => setTakeaway(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            placeholder="Optional"
          />
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onAnswer({ takeaway: takeaway.trim() || undefined }, {})}
        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        <Check className="h-4 w-4" /> Reveal my Scout Report
      </button>
    </div>
  );
}

export const MECHANICS = {
  dilemma: DilemmaMechanic,
  card_sort: CardSortMechanic,
  sjt: SjtMechanic,
  speed: SpeedMechanic,
  allocation: AllocationMechanic,
  reflection: ReflectionMechanic,
};
