/**
 * D4708 part 3 (#4708) — the AI safety zone and its token-anomalies tile, moved out of
 * `../SecurityPage.jsx` unchanged. `AiSafetyWorkspace.jsx` keeps this zone behind
 * "How this is measured".
 */
import React from 'react';
import { Unrecorded, Unreadable } from '../../../ui';
import { Stat } from './SecurityParts.jsx';
import { num } from './securityShared.js';

/**
 * D152 — the "AI safety" zone stopped being one `<Absent>` line.
 *
 * It rendered `data.ai_safety.reason`, which said no guardrail, flagged-output
 * or token-anomaly counter was stored. Two of those three were false, and the
 * verdict rollup was ALREADY on screen elsewhere — `AiUsageTab` draws it as
 * "Guardrail safety (llama-guard)". So HQ's security desk denied a figure the
 * platform was showing one click away.
 *
 * FOUR TILES, TWO STORES, AND THE SPLIT IS THE POINT. A verdict is what the
 * guard THOUGHT; a block and a flag are what the platform DID about it. They
 * come from different tables and fail independently (`advisor_turn_audit` is
 * lazily bootstrapped), so each pair reads its own availability and an
 * unreadable half renders `<Unrecorded/>` with its reason rather than a zero —
 * on a safety counter, a false zero is the worst possible direction to be
 * wrong in.
 *
 * `!block` is loading-or-unreadable, never "nothing was recorded": the page's
 * own `<Unreadable/>` above says which, and these tiles must not answer a
 * question they were not able to ask.
 */
export function AiSafety({ block }) {
  // D4691 — a rollup that could not be read is unreadable as a whole, and the
  // token anomalies and the not-counted list (their own reads) still render.
  if (block && block.available === false) {
    return (
      <div data-testid="hq-ai-safety">
        <div data-testid="hq-ai-safety-unreadable">
          <Unreadable what="The AI guardrail counters" claim="This is not a claim that nothing was blocked or flagged." />
        </div>
        <TokenAnomalies block={block.token_anomalies} />
      </div>
    );
  }
  const v = block?.verdicts;
  const e = block?.enforcement;
  // `windowNote`, not `window`: a local of that name shadows the browser global
  // inside this component, which is legal and quietly confusing.
  const windowNote = block ? `in ${block.window_days} days` : 'unreadable';
  // A rate over an empty denominator is not 0%. The server sends null; the
  // note says what actually happened instead of printing a percentage.
  const rate = v?.available && v.safe_rate !== null && v.safe_rate !== undefined
    ? `${(v.safe_rate * 100).toFixed(1)}% judged safe`
    : (v?.available ? 'the guard did not run in this window' : (v?.reason || 'unreadable'));
  return (
    <div data-testid="hq-ai-safety">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Guard verdicts"
          value={v?.available ? num(v.evaluated) : null}
          note={v?.available ? `completed safety verdicts ${windowNote}` : (v?.reason || 'unreadable')}
        />
        <Stat
          label="Judged unsafe"
          value={v?.available ? num(v.unsafe_count) : null}
          note={rate}
          tone={v?.available && v.unsafe_count ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'}
        />
        <Stat
          label="Turns blocked"
          value={e?.available ? num(e.blocked) : null}
          note={e?.available ? 'refused before the model answered' : (e?.reason || 'unreadable')}
          tone={e?.available && e.blocked ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'}
        />
        <Stat
          label="Outputs flagged"
          value={e?.available ? num(e.flagged) : null}
          note={e?.available ? 'shadow-flagged, the turn still answered' : (e?.reason || 'unreadable')}
          tone={e?.available && e.flagged ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'}
        />
      </div>
      {/*
        D158 — WHICH RULE FIRED. Until migration 270 this panel could say how
        often the guard fired and never what for, and the list below carried a
        row saying so. Three things here follow the payload rather than the
        layout: `rules` and `states` are rendered apart, because a router
        failure is the guard NOT running and does not belong in a list headed
        "what tripped it"; `unclassified` is stated rather than folded in,
        because every turn recorded before 270 has no category and calling one
        `safe` would be a verdict nothing reached; and the whole block is
        absent, not zeroed, when `advisor_turn_audit` could not be read.
      */}
      {e?.available && e.breakdown_available === false && (
        <div className="mt-3" data-testid="hq-ai-safety-rules-unreadable">
          <div className="text-[11px] font-semibold text-axal-muted">What tripped the guard</div>
          <p className="mt-1 text-[11px] text-axal-muted">
            Unreadable — {e.breakdown_reason || 'the breakdown by rule could not be read.'} The totals above were read.
          </p>
        </div>
      )}
      {e?.available && e.breakdown_available !== false && (
        <div className="mt-3" data-testid="hq-ai-safety-rules">
          <div className="text-[11px] font-semibold text-axal-muted">What tripped the guard</div>
          {e.rules?.length ? (
            <ul className="mt-1 space-y-0.5">
              {e.rules.map((rr) => (
                <li key={rr.category} className="text-[11px] text-axal-muted tabular-nums">
                  <b className="text-axal-muted">{rr.category}</b> — {num(rr.turns)} {rr.turns === 1 ? 'turn' : 'turns'}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-[11px] text-axal-muted" data-testid="hq-ai-safety-rules-none">
              No turn in this window named a violated rule.
            </div>
          )}
          {e.unclassified > 0 && (
            <div className="mt-1 text-[11px] text-axal-muted" data-testid="hq-ai-safety-unclassified">
              {num(e.unclassified)} {e.unclassified === 1 ? 'turn was' : 'turns were'} recorded without a
              category. Turns written before the category was stored carry none — that is not a turn judged safe.
            </div>
          )}
          {e.states?.length > 0 && (
            <div className="mt-1 text-[11px] text-axal-muted" data-testid="hq-ai-safety-states">
              Classification outcomes: {e.states.map((ss) => `${ss.category} ${ss.turns}`).join(' · ')}. These
              describe the check itself, not a rule that fired.
            </div>
          )}
        </div>
      )}
      {v?.available && <p className="mt-3 text-[11px] text-axal-muted dark:text-gray-400" data-testid="hq-verdict-breakdown">
        {num(v.safe_count)} safe · {num(v.unsafe_count)} unsafe · {v.no_verdict_count == null ? 'Not recorded' : num(v.no_verdict_count)} without a verdict.
        {' '}Checks without a verdict are excluded from the safe rate. Check volume is not a measure of safety quality.
      </p>}
      <p className="mt-3 text-[11px] text-axal-muted dark:text-gray-400">
        Unsafe verdicts are historical checks, not unresolved incidents. Turns blocked and
        outputs flagged above cover the legacy chat audit; they do not include the router
        enforcement below. These totals cannot establish whether a particular output was delivered.
      </p>
      {block?.guard?.available ? (
        <div className="mt-3" data-testid="hq-router-enforcement">
          <h3 className="text-[11px] font-semibold text-axal-muted">Router enforcement · {windowNote}</h3>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Stat label="Inputs blocked" value={num(block.guard.by_page.reduce((n, p) => n + p.blocked_input, 0))} note="refused by the router guard" />
            <Stat label="Outputs withheld" value={num(block.guard.by_page.reduce((n, p) => n + p.withheld_output, 0))} note="stopped before delivery" />
          </div>
        </div>
      ) : block && <p className="mt-3 text-[11px] text-axal-muted">Router enforcement: {block.guard?.reason || 'Not recorded'}</p>}
      <TokenAnomalies block={block?.token_anomalies} />
      {(block?.not_counted || []).length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="hq-ai-safety-not-counted">
          {block.not_counted.map((n) => (
            <li key={n.what} className="text-[11px] leading-relaxed text-axal-muted">
              <b className="text-axal-muted">{n.what}</b> — <Unrecorded />. {n.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * D481 — H23's "Token anomalies" tile, from `ai_usage_logs`.
 *
 * It was the last row of D152's not-counted list, and the one that was true:
 * nothing computed a spike. The server computes it now and sends its own
 * `how`, because the threshold is a judgement and the reader should see it
 * beside the figure rather than infer it. Three states: absent (the overview
 * is still loading or failed — the page says which, so this says nothing),
 * UNREADABLE (the table could not be read: never a zero, and never "Not
 * recorded", which would claim the platform keeps no such figure), and the
 * figure with the accounts behind it.
 */
export function TokenAnomalies({ block }) {
  if (!block) return null;
  if (!block.available) {
    return (
      <div className="mt-3" data-testid="hq-token-anomalies-unreadable">
        <Unreadable
          what="Token consumption (ai_usage_logs)"
          claim="No account was checked — this is not a claim that nothing spiked."
        />
      </div>
    );
  }
  return (
    <div className="mt-3" data-testid="hq-token-anomalies">
      <Stat
        label="Token anomalies"
        value={num(block.count)}
        note={`last ${block.window_hours} hours against each account's own ${block.baseline_days}-day average · ${num(block.accounts_checked)} account${block.accounts_checked === 1 ? '' : 's'} checked`}
        tone={block.count ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'}
      />
      {block.rows.length > 0 && (
        <ul className="mt-1.5 space-y-0.5" data-testid="hq-token-anomaly-rows">
          {block.rows.map((a) => (
            <li key={a.user_id} className="text-[11px] text-axal-muted tabular-nums">
              <b className="text-axal-muted">{a.name || a.email || `user ${a.user_id}`}</b> — {num(a.tokens_24h)} tokens
              in 24 hours, {a.ratio}× an average day of {num(a.daily_avg_baseline)}
            </li>
          ))}
        </ul>
      )}
      {block.no_baseline > 0 && (
        <p className="mt-1 text-[11px] text-axal-muted" data-testid="hq-token-anomalies-no-baseline">
          {num(block.no_baseline)} account{block.no_baseline === 1 ? '' : 's'} crossed the floor with no usage in the
          {' '}{block.baseline_days} days before, so there is no usual to compare with. Not counted as anomalies, and
          not hidden: a dormant account waking up looks exactly like this.
        </p>
      )}
      <p className="mt-1 text-[10.5px] leading-relaxed text-axal-muted">{block.how}</p>
    </div>
  );
}
