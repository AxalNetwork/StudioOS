/**
 * D6221 (#6221, canvas D6220 EW-01 to EW-14): the pure model of the Exit
 * Waterfall, drawn in the Portfolio frame at `/portfolio/waterfall`. No React,
 * no fetch, no clock: the page passes every time it shows.
 *
 * Its sources are three Worker reads and two writes, all existing:
 *   - `GET /api/funds`: the picker. A GP of record or an admin reads the whole
 *     row (`carried_interest`, `can_manage`); an LP reads only what names the
 *     fund (D4636), so an LP's carry comes from `GET /api/funds/lp-portal`
 *     (`funds[<id>].carried_interest`), their own fund record.
 *   - `POST /api/fund-sim/funds/:id/waterfall/simulate`: five tranches, the
 *     totals and `lp_rows`, pro-rated by commitment.
 *   - `GET|POST /api/fund-sim/funds/:id/scenarios?kind=waterfall`, and
 *     `DELETE /api/fund-sim/scenarios/:uid`. There is no update route, so a
 *     scenario is never renamed or overwritten: "Save as new".
 *
 * What the engine does not say, this model says in words: the multiple and the
 * annualised return come back 0 when they cannot be computed, and the page
 * writes "Not computable" with the reason (never 0× or 0%). A measured zero
 * (exit $0 with money invested) stays 0.
 */
import { day, dayTime, money } from './portfolioModel';

export const MODEL_LINE = 'Model · provisional · not a distribution';
export const SOURCE_CHIP = 'From the fund’s terms';
export const ASSUMPTION_CHIP = 'Assumption · not recorded on the fund';
export const NAME_MAX = 120;
/** The Worker's clamps (`fund_simulator.ts`): carry and hurdle 0–50%, years 0–20. */
export const LIMITS = { carry: [0, 50], hurdle: [0, 50], years: [0, 20] };
/** Owner answer A (D6220 part 2): hurdle, catch-up and years are assumptions on this page. */
export const ASSUMED = { hurdle: '8', years: '5', catchup: true };
/** The engine's own default carry, used only as a labelled assumption. */
export const ASSUMED_CARRY = '20';
export const NOT_MODELLED = 'Management fee, GP commit, deal-by-deal (American) carry, recycling, dated cash flows.';

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));
const isNum = (v) => Number.isFinite(num(v));
/** A percentage typed on the page ↔ the fraction the engine reads. */
const fromPct = (v) => num(v) / 100;
const toPct = (f) => Number(f) * 100;

/** Whole US dollars: $19,500,000. Null when there is no number. */
export function dollars(v) {
  return isNum(v) ? money(Math.round(num(v))) : null;
}

/** A signed difference in whole dollars: +$1,500,000, −$300,000, or — when equal. */
export function signedDollars(d) {
  const n = Math.round(num(d));
  if (!Number.isFinite(n) || n === 0) return '—';
  return `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`;
}

/** `19,500,000`, `$19.5m` → 19500000; null when the text is not a number. */
export function parseMoney(text) {
  const s = String(text ?? '').replace(/[$,\s_]/g, '').toLowerCase();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(k|m|b)?$/.exec(s);
  if (!m) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return Math.round(Number(m[1]) * scale);
}

const pct1 = (v) => `${Number(v).toFixed(1)}%`;
const pctTrim = (v) => {
  const n = Math.round(Number(v) * 100) / 100;
  return `${Number.isInteger(n) ? n : n.toFixed(Number.isInteger(n * 10) ? 1 : 2)}%`;
};

/* ------------------------------------------------------------ the fund */

/** How the caller stands to the fund: 'admin', 'gp' or 'lp' (the list's `relationship`, D4636). */
export function relationOf(fund) {
  if (!fund) return null;
  if (['admin', 'gp', 'lp'].includes(fund.relationship)) return fund.relationship;
  return fund.can_manage === true ? 'gp' : 'lp';
}

export const RELATION_LINE = {
  admin: 'Admin · every fund',
  gp: 'You are the GP of record',
  lp: 'You are an LP of this fund',
};

/** The picker's words for one fund: name, then vintage and status when the row carries them. */
export function fundLabel(fund) {
  const bits = [fund?.vintage_year ? `vintage ${fund.vintage_year}` : null, fund?.status ? cap(fund.status) : null].filter(Boolean);
  return `${fund?.name || `Fund ${fund?.id}`}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/**
 * Where the carry comes from. `portal` is the LP portal read (`{ state, data }`),
 * read only for an LP. Returns `{ state, pct, chip }`:
 *   - 'fund': the fund row's `carried_interest` (GP of record, admin);
 *   - 'lp-record': the LP's own fund record;
 *   - 'loading': the LP record is being read;
 *   - 'not_recorded' / 'unreadable': no recorded carry, so the engine's 20%
 *     is used and labelled as an assumption.
 */
export function carryOf(fund, portal) {
  if (!fund) return null;
  const asPct = (fraction) => String(Math.round(Number(fraction) * 10000) / 100);
  if (relationOf(fund) !== 'lp') {
    return isNum(fund.carried_interest)
      ? { state: 'fund', pct: asPct(fund.carried_interest), chip: SOURCE_CHIP }
      : { state: 'not_recorded', pct: ASSUMED_CARRY, chip: `Not recorded · using ${ASSUMED_CARRY}% as an assumption` };
  }
  if (!portal || portal.state === 'loading') return { state: 'loading', pct: null, chip: 'Reading your fund record…' };
  if (portal.state === 'unreadable') return { state: 'unreadable', pct: ASSUMED_CARRY, chip: `Your fund record could not be read · using ${ASSUMED_CARRY}% as an assumption` };
  const facts = portal.data?.funds?.[fund.id] || portal.data?.funds?.[String(fund.id)];
  return isNum(facts?.carried_interest)
    ? { state: 'lp-record', pct: asPct(facts.carried_interest), chip: `${SOURCE_CHIP} · your LP record` }
    : { state: 'not_recorded', pct: ASSUMED_CARRY, chip: `Not recorded · using ${ASSUMED_CARRY}% as an assumption` };
}

/* ------------------------------------------------------------- inputs */

/** The page's inputs as typed: strings, and the catch-up switch. */
export function startingInputs(carryPct) {
  return { exit: '', carry: carryPct ?? ASSUMED_CARRY, hurdle: ASSUMED.hurdle, years: ASSUMED.years, catchup: ASSUMED.catchup };
}

const within = (text, [lo, hi]) => isNum(text) && num(text) >= lo && num(text) <= hi;

/** Each input's error, in words, or an empty object. An empty exit value is not an error: nothing is shown yet. */
export function inputErrors(inputs) {
  const out = {};
  if (inputs.exit !== '' && parseMoney(inputs.exit) == null) out.exit = 'Type the exit value in US dollars, such as 19,500,000.';
  if (!within(inputs.carry, LIMITS.carry)) out.carry = 'Carry is between 0% and 50%.';
  if (!within(inputs.hurdle, LIMITS.hurdle)) out.hurdle = 'Hurdle is between 0% and 50%.';
  if (!within(inputs.years, LIMITS.years)) out.years = 'Years held is between 0 and 20.';
  return out;
}

/**
 * The simulate body, or null while an input is out of range. With no exit
 * value typed yet the page still asks at $0, which returns the fund's
 * recorded committed and invested totals (for the 1× / 2× / 3× chips) and
 * draws no result.
 */
export function bodyOf(inputs) {
  if (Object.keys(inputErrors(inputs)).length) return null;
  return {
    exit_value: parseMoney(inputs.exit) ?? 0,
    carry_pct: fromPct(inputs.carry),
    hurdle_rate: fromPct(inputs.hurdle),
    years_held: num(inputs.years),
    gp_catchup: inputs.catchup !== false,
  };
}

/** One line under the result's heading. */
export function termsLine(body) {
  return `European, whole-of-fund · carry ${pctTrim(body.carry_pct * 100)} · hurdle ${pct1(body.hurdle_rate * 100)} · ${Number(body.years_held).toFixed(1)} years · catch-up ${body.gp_catchup ? 'on' : 'off'}`;
}

/** 1× / 2× / 3× the recorded invested total: arithmetic, not proposals. None when nothing is invested. */
export function presetsOf(totalInvested) {
  const inv = num(totalInvested);
  if (!Number.isFinite(inv) || inv <= 0) return [];
  return [1, 2, 3].map((m) => ({ multiple: m, value: Math.round(inv * m), label: `${m}× invested · ${dollars(inv * m)}` }));
}

/* ------------------------------------------------------------- result */

const tierKind = (t, i) => (t.to === 'GP' ? 'gp' : (i === 1 ? 'lp2' : 'lp'));

/** The tiers in the order they are paid, with running totals and their share of the exit. */
export function tiersOf(result) {
  const exit = num(result?.exit_value) || 0;
  let run = 0;
  return (result?.tranches || []).map((t, i) => {
    const amount = num(t.amount) || 0;
    run += amount;
    return {
      order: i + 1,
      name: String(t.name || '').replace(/\s+—\s+/g, ' · '),
      to: t.to === 'GP' ? 'GP' : 'LPs',
      kind: tierKind(t, i),
      amount,
      running: Math.round(run * 100) / 100,
      share: exit > 0 ? amount / exit : 0,
    };
  });
}

/** The text alternative for the tier bar. */
export function barLabel(result) {
  return `Tier bar at ${dollars(result?.exit_value)}: ${tiersOf(result).map((t) => `${t.name} to ${t.to} ${dollars(t.amount)}`).join('; ')}`;
}

/**
 * The four figures, as `FinancialMetric` reads them. The engine returns 0 for
 * the multiple when nothing is invested, and for the annualised return when
 * nothing is invested, nothing reaches LPs or years is 0: those read Not
 * computable with the reason.
 */
export function figuresOf(result) {
  const t = result?.totals || {};
  const invested = num(t.total_invested) || 0;
  const toLps = num(t.to_lps) || 0;
  const years = num(t.years_held) || 0;
  const nc = (key, label, reason, note) => ({ key, label, state: 'not_computable', value: `Not computable: ${reason}`, note });
  const multiple = invested > 0
    ? { key: 'lp-multiple', label: 'LP multiple', state: 'value', value: `${Number(t.lp_moic || 0).toFixed(2)}×`, note: `To LPs ÷ invested ${dollars(invested)}` }
    : nc('lp-multiple', 'LP multiple', 'nothing invested', 'never 0×');
  let irrReason = null;
  if (invested <= 0) irrReason = 'nothing invested';
  else if (toLps <= 0) irrReason = 'nothing returned to LPs';
  else if (years <= 0) irrReason = 'no holding period';
  const irr = irrReason
    ? nc('lp-return', 'Annualised return', irrReason, 'never 0%')
    : { key: 'lp-return', label: 'Annualised return', state: 'value', value: `${Number(t.lp_irr_pct || 0).toFixed(2)}%`, note: `One exit after ${years.toFixed(1)} years, not a dated IRR` };
  return [
    { key: 'to-lps', label: 'To LPs', state: 'value', value: dollars(t.to_lps), note: 'Return of capital + preferred return + LP split' },
    { key: 'to-gp', label: 'To GP', state: 'value', value: dollars(t.to_gp), note: 'GP catch-up + carry' },
    multiple,
    irr,
  ];
}

/** The source line under the result: where committed and invested come from, and the check that it adds up. */
export function sourceLineOf(result) {
  const t = result?.totals || {};
  const lps = (result?.lp_rows || []).length;
  const from = lps ? `from ${lps} LP ${lps === 1 ? 'row' : 'rows'}` : 'from the fund’s committed and deployed figures';
  const distributed = num(t.total_distributed) || 0;
  const exit = num(result?.exit_value) || 0;
  return [
    `Committed ${dollars(t.total_committed)} · invested ${dollars(t.total_invested)} · ${from}`,
    `Exit ${dollars(exit)} · ${(num(t.years_held) || 0).toFixed(1)} years`,
    Math.abs(distributed - exit) < 1
      ? `Total distributed ${dollars(distributed)} = exit value`
      : `Total distributed ${dollars(distributed)} · exit value ${dollars(exit)}`,
    'Gross: management fee not modelled',
  ];
}

/** Per-LP rows as returned, with their total; an LP's own multiple is Not computable when nothing is invested. */
export function lpRowsOf(result) {
  const rows = (result?.lp_rows || []).map((r, i) => ({
    key: `${i}-${r.name}`,
    name: r.name || 'Name not recorded',
    commitment: num(r.commitment_amount) || 0,
    invested: num(r.invested_amount) || 0,
    share: num(r.share_pct) || 0,
    payout: num(r.payout) || 0,
    profit: num(r.profit) || 0,
    multiple: (num(r.invested_amount) || 0) > 0 ? `${Number(r.moic || 0).toFixed(2)}×` : 'Not computable',
  }));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const invested = sum('invested');
  const payout = sum('payout');
  return {
    rows,
    total: rows.length ? {
      name: `${rows.length} ${rows.length === 1 ? 'LP' : 'LPs'}`,
      commitment: sum('commitment'),
      invested,
      share: Math.round(sum('share') * 1000) / 1000,
      payout,
      profit: sum('profit'),
      multiple: invested > 0 ? `${(payout / invested).toFixed(2)}×` : 'Not computable',
    } : null,
  };
}

/* ---------------------------------------------------------- scenarios */

/** What one saved scenario says in the list. `me` is the caller's user id. */
export function scenarioOf(s, me) {
  const i = s?.inputs || {};
  const t = s?.result?.totals || {};
  const multiple = (num(t.total_invested) || 0) > 0 && isNum(t.lp_moic) ? ` · ${Number(t.lp_moic).toFixed(2)}×` : '';
  return {
    uid: s.uid,
    name: s.name,
    savedAt: dayTime(s.created_at) || day(s.created_at),
    savedDay: day(s.created_at),
    by: me != null && Number(s.created_by_user_id) === Number(me) ? 'Saved by you' : 'Saved by another user · name not recorded',
    summary: `Exit ${dollars(i.exit_value) ?? 'not recorded'} · ${isNum(i.years_held) ? Number(i.years_held).toFixed(1) : '—'} yrs · LPs ${dollars(t.to_lps) ?? 'not recorded'}${multiple}`,
  };
}

/** A saved scenario's inputs, as the page types them. */
export function inputsFromScenario(s, fallback) {
  const i = s?.inputs || {};
  const base = fallback || startingInputs();
  const pctOf = (v, d) => (isNum(v) ? String(Math.round(num(v) * 10000) / 100) : d);
  return {
    exit: isNum(i.exit_value) ? Math.round(num(i.exit_value)).toLocaleString('en-US') : base.exit,
    carry: pctOf(i.carry_pct, base.carry),
    hurdle: pctOf(i.hurdle_rate, base.hurdle),
    years: isNum(i.years_held) ? String(num(i.years_held)) : base.years,
    catchup: i.gp_catchup == null ? base.catchup : i.gp_catchup !== false,
  };
}

const FIELD = [
  ['exit_value', 'exit', (b) => dollars(b.exit_value)],
  ['carry_pct', 'carry', (b) => pctTrim(b.carry_pct * 100)],
  ['hurdle_rate', 'hurdle', (b) => pct1(b.hurdle_rate * 100)],
  ['years_held', 'years held', (b) => Number(b.years_held).toFixed(1)],
  ['gp_catchup', 'catch-up', (b) => (b.gp_catchup ? 'on' : 'off')],
];

/** What changed since a scenario was loaded: `['exit $19,500,000 → $21,000,000', …]`, empty when nothing did. */
export function changesSince(loadedBody, body) {
  if (!loadedBody || !body) return [];
  return FIELD.filter(([k]) => (k === 'gp_catchup' ? Boolean(loadedBody[k]) !== Boolean(body[k]) : Math.abs(num(loadedBody[k]) - num(body[k])) > 1e-9))
    .map(([, label, fmt]) => `${label} ${fmt(loadedBody)} → ${fmt(body)}`);
}

/** The name's error, or null. */
export function nameError(name) {
  const n = String(name || '').trim().length;
  if (!n) return 'Give the scenario a name.';
  if (n > NAME_MAX) return `${n - NAME_MAX} ${n - NAME_MAX === 1 ? 'character' : 'characters'} over the ${NAME_MAX} limit.`;
  return null;
}

/** A refused or failed write, in the page's words. `act` is 'save' or 'delete'. */
export function refusalOf(err, act) {
  const status = err?.status;
  if (status === 402) return 'Saving scenarios needs the institutional investor tier. You can still run the model.';
  if (status === 403) return act === 'save' ? 'Only the fund’s GP of record or an admin can save. Your inputs are kept; nothing was saved.' : 'Only the person who saved it, or an admin, can delete this scenario.';
  if (status === 404) return act === 'save' ? 'This fund is no longer there. Nothing was saved.' : 'This scenario is no longer there.';
  if (status === 400 && act === 'save') return 'The scenario was refused as written. Check the name and try again.';
  return act === 'save' ? 'Couldn’t save the scenario. The server didn’t respond. Name and inputs are kept.' : 'Couldn’t delete the scenario. Try again.';
}

/* ------------------------------------------------------------ compare */

const ratePts = (d) => (Math.abs(d) < 0.005 ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} pts`);

/**
 * Two saved scenarios side by side, each as it was saved: nothing is re-run.
 * Inputs that differ are marked. Different holding periods stay two figures.
 */
export function compareOf(a, b) {
  const ia = a?.inputs || {};
  const ib = b?.inputs || {};
  const ta = a?.result?.totals || {};
  const tb = b?.result?.totals || {};
  const row = (label, va, vb, diff, differs = false) => ({ label, a: va, b: vb, diff, differs });
  const moneyRow = (label, x, y, mark) => row(label, dollars(x) ?? 'Not recorded', dollars(y) ?? 'Not recorded', isNum(x) && isNum(y) ? signedDollars(num(y) - num(x)) : '—', mark && isNum(x) && isNum(y) && Math.round(num(x)) !== Math.round(num(y)));
  const pctRow = (label, x, y) => {
    const has = isNum(x) && isNum(y);
    const d = has ? (num(y) - num(x)) * 100 : 0;
    return row(label, isNum(x) ? pctTrim(num(x) * 100) : 'Not recorded', isNum(y) ? pctTrim(num(y) * 100) : 'Not recorded', has ? ratePts(d) : '—', has && Math.abs(d) > 1e-9);
  };
  const yearsA = isNum(ia.years_held) ? Number(ia.years_held).toFixed(1) : 'Not recorded';
  const yearsB = isNum(ib.years_held) ? Number(ib.years_held).toFixed(1) : 'Not recorded';
  const yDiff = isNum(ia.years_held) && isNum(ib.years_held) ? num(ib.years_held) - num(ia.years_held) : 0;
  const cu = (v) => (v == null ? 'Not recorded' : (v === false ? 'Off' : 'On'));
  const tiersA = tiersOf(a?.result);
  const tiersB = tiersOf(b?.result);
  const fa = figuresOf(a?.result);
  const fb = figuresOf(b?.result);
  const multDiff = fa[2].state === 'value' && fb[2].state === 'value' ? (() => { const d = Number(tb.lp_moic) - Number(ta.lp_moic); return Math.abs(d) < 0.005 ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}×`; })() : '—';
  const irrText = (f, i) => (f[3].state === 'value' ? `${f[3].value} · ${isNum(i.years_held) ? Number(i.years_held).toFixed(1) : '—'} yrs` : f[3].value);
  const irrDiff = fa[3].state === 'value' && fb[3].state === 'value' ? ratePts(Number(tb.lp_irr_pct) - Number(ta.lp_irr_pct)) : '—';
  return {
    periodsDiffer: Math.abs(yDiff) > 1e-9,
    sections: [
      { title: 'Inputs', rows: [
        moneyRow('Exit value', ia.exit_value, ib.exit_value, true),
        pctRow('Carry', ia.carry_pct, ib.carry_pct),
        pctRow('Hurdle · assumption', ia.hurdle_rate, ib.hurdle_rate),
        row('Years held · assumption', yearsA, yearsB, Math.abs(yDiff) > 1e-9 ? `${yDiff > 0 ? '+' : '−'}${Math.abs(yDiff).toFixed(1)}` : '—', Math.abs(yDiff) > 1e-9),
        row('GP catch-up · assumption', cu(ia.gp_catchup), cu(ib.gp_catchup), '—', cu(ia.gp_catchup) !== cu(ib.gp_catchup)),
        row('Committed · invested', `${dollars(ta.total_committed) ?? 'Not recorded'} · ${dollars(ta.total_invested) ?? 'Not recorded'}`, `${dollars(tb.total_committed) ?? 'Not recorded'} · ${dollars(tb.total_invested) ?? 'Not recorded'}`, '—',
          Math.round(num(ta.total_committed)) !== Math.round(num(tb.total_committed)) || Math.round(num(ta.total_invested)) !== Math.round(num(tb.total_invested))),
      ] },
      { title: 'Tiers', rows: tiersA.map((t, i) => {
        const o = tiersB[i];
        return row(`${(o || t).name} · to ${t.to}`, dollars(t.amount), o ? dollars(o.amount) : 'Not recorded', o ? signedDollars(o.amount - t.amount) : '—');
      }) },
      { title: 'Totals', rows: [
        moneyRow('To LPs', ta.to_lps, tb.to_lps),
        moneyRow('To GP', ta.to_gp, tb.to_gp),
        moneyRow('Total distributed', ta.total_distributed, tb.total_distributed),
        row('LP multiple · to LPs ÷ invested', fa[2].value, fb[2].value, multDiff),
        row('Annualised return · one exit', irrText(fa, ia), irrText(fb, ib), irrDiff),
      ] },
    ],
  };
}

/* ---------------------------------------------------------- CSV files */

/** The tiers file: its first line says what it is; then the columns and one row per tier. */
export function tiersCsvOf({ fund, scenario, body, carry, result, modelledAt }) {
  const head = ['fund', 'scenario', 'exit_value', 'carry_pct', 'carry_source', 'hurdle_pct', 'years_held', 'gp_catchup', 'tier_order', 'tier', 'to', 'amount', 'running_total', 'modelled_at'];
  const rows = tiersOf(result).map((t) => [
    fund?.name ?? '', scenario ?? '', Math.round(body.exit_value), toPct(body.carry_pct), carry?.state === 'fund' || carry?.state === 'lp-record' ? 'fund terms' : 'assumption',
    toPct(body.hurdle_rate), body.years_held, body.gp_catchup ? 'on' : 'off', t.order, t.name, t.to, t.amount, t.running, modelledAt ?? '',
  ]);
  return { filename: 'exit-waterfall-tiers.csv', header: ['Model, not a distribution'], rows: [head, ...rows] };
}

/** The per-LP file, with the same first line. */
export function lpsCsvOf({ fund, scenario, body, result }) {
  const head = ['fund', 'scenario', 'exit_value', 'lp_name', 'commitment', 'invested', 'share_pct', 'modelled_payout', 'profit', 'multiple'];
  const rows = lpRowsOf(result).rows.map((r) => [fund?.name ?? '', scenario ?? '', Math.round(body.exit_value), r.name, r.commitment, r.invested, r.share, r.payout, r.profit, r.multiple]);
  return { filename: 'exit-waterfall-lps.csv', header: ['Model, not a distribution'], rows: [head, ...rows] };
}
