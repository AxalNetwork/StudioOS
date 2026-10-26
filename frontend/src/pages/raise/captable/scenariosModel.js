/**
 * D1024 (#2861) — Scenarios complete (CT6–CT9), kept pure so the tests read it
 * without a browser.
 *
 * WHAT A SCENARIO IS. A `cap_table_scenarios` row with `is_variant = 1`
 * (D632). One kind starts from Today: its stored inputs carry D1018's `start`
 * (the record's holders) and every run re-reads the record through
 * `POST /scenarios/by-project/:id/simulate`, so the scenario always starts
 * from what is recorded now. The other kind starts from the model: founders,
 * a pool, SAFEs and rounds typed by hand, as the variants page edited them; it
 * runs through `POST /captable/simulate`. The saved model itself is
 * "Cap table · model" (CT19b); it is the main cap table, so Scenarios reads it
 * and never renames, deletes or edits it.
 *
 * ON RECORD AND MODELLED. Today's column is the record. Every figure after a
 * round, every payout and every read-back is Modelled. A value the engine did
 * not give is "Not recorded"; a payout it could not calculate is never 0.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { HOME_PATH, dollars, pct, shares, tabSearch } from './capTableModel';

export { foundersAfter, scenarioCard, scenarioCards } from './capTableModel';

export const SCENARIOS_PATH = `${HOME_PATH}/scenarios`;
export const COMPARE = 'compare';
export const MAX_COMPARE = 3;
export const MAX_EXITS = 4;
export const MODEL_NAME = 'Cap table · model';
export const SAVED = 'Saved. The main cap table did not change.';
export const NOT_READ = 'Not read here yet';
export const NOT_CONVERTED = 'Not converted';
export const NOT_IN = 'Not in this scenario';
export const MODEL_LOCKED = 'This is your saved model. A scenario never writes it: duplicate it to change its inputs.';
/** Who wrote a read-back: the engine's numbers, in words. Eadwyn's own reads of the model are on Overview. */
export const READ_SOURCE = 'Read back from the engine’s numbers, every step shown. Eadwyn’s own read of your saved model is on Overview.';
export const READ_ONLY = 'You can read these scenarios. Only the venture’s owner and co-founders change them.';
/** The Worker's own assumptions arrive with the Today read; these are said when it has not answered. */
export const ASSUMPTIONS_FALLBACK = [
  '1× non-participating preferred, no participation, no seniority stack.',
  'The unallocated pool takes no proceeds; granted options are counted as if exercised.',
  'A SAFE that has not converted takes cash back or converts at its cap, whichever pays more.',
];

const UID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────── addresses

/** A scenario's own page. `compare` is the compare page, never a scenario. */
export const scenarioHref = (uid, search = '') => `${SCENARIOS_PATH}/${encodeURIComponent(uid)}${tabSearch(search)}`;

/** The compare page for up to three scenarios, in the order chosen; the venture rides along. */
export function compareHref(uids, search = '') {
  const ids = (uids || []).filter((u) => UID.test(String(u))).slice(0, MAX_COMPARE);
  const q = new URLSearchParams(tabSearch(search).replace(/^\?/, ''));
  q.set('ids', ids.join(','));
  return `${SCENARIOS_PATH}/${COMPARE}?${q}`;
}

/** The scenarios the compare page holds: up to three distinct ids from `?ids=`. */
export function compareIds(search = '') {
  const raw = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('ids') || '';
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UID.test(s)))].slice(0, MAX_COMPARE);
}

// ─────────────────────────────────────────────────────────── the list (CT6)

export const fromToday = (s) => !!s?.inputs?.start;

/** The head line: how many scenarios, and where they start. */
export function scenariosHead(read, today) {
  const n = Array.isArray(read?.variants) ? read.variants.length : 0;
  const where = today?.today?.available ? 'each new one starts from Today' : 'nothing is recorded yet, so a new one starts from your model';
  return `${n === 1 ? '1 scenario' : `${n} scenarios`} · ${where}`;
}

/** Ticking a card for Compare: up to three, in the order ticked. */
export function toggleCompare(list, uid) {
  if (list.includes(uid)) return list.filter((u) => u !== uid);
  return list.length >= MAX_COMPARE ? list : [...list, uid];
}

// ─────────────────────────────────────────────────────────── the dialogs

/** The next free "Scenario N" name. */
export function nextName(read) {
  const names = new Set([...(read?.variants || [])].map((v) => String(v?.name || '').trim()));
  let n = names.size + 1;
  while (names.has(`Scenario ${n}`)) n += 1;
  return `Scenario ${n}`;
}

/**
 * New scenario's starting inputs. From Today when the record holds shares
 * (the record's holders and instruments, the model's rounds and exit), else
 * from the model, as the variants page did; null when there is neither.
 */
export function newScenarioInputs(today, canonical) {
  const model = canonical?.inputs || null;
  const rounds = Array.isArray(model?.rounds) ? model.rounds : [];
  const exits = exitsOf(model);
  if (today?.today?.available && today.today.inputs) {
    return { from: 'today', inputs: { ...today.today.inputs, rounds, ...(exits.length ? { exit_values: exits } : {}) } };
  }
  if (model) return { from: 'model', inputs: model };
  return null;
}

/** What each dialog says it changes and who sees it. */
export function dialogCopy(kind, scenario, { from } = {}) {
  const name = String(scenario?.name || '').trim() || 'this scenario';
  const who = 'Anyone who can open this venture’s cap table sees it. The main cap table does not change.';
  if (kind === 'new') {
    return {
      title: 'New scenario',
      lines: [
        from === 'today'
          ? 'It starts from Today: the holders and instruments on record now, with your model’s round to change.'
          : 'Nothing is recorded yet, so it starts from your saved model, as a copy to change.',
        who,
      ],
      action: 'Create scenario',
    };
  }
  if (kind === 'duplicate') return { title: `Duplicate ${name}?`, lines: ['A copy with the same inputs, to change on its own.', who], action: 'Duplicate' };
  if (kind === 'rename') return { title: `Rename ${name}`, lines: ['Only the name changes. Its inputs and results stay as they are.', who], action: 'Rename' };
  if (kind === 'delete') {
    return {
      title: `Delete ${name}?`,
      lines: ['The scenario and its inputs are deleted. This cannot be undone.', 'The record and the main cap table do not change. History keeps a line saying it was deleted.'],
      action: 'Delete scenario',
    };
  }
  if (kind === 'attach') {
    return {
      title: `Attach this read to ${name}?`,
      lines: ['It is saved with the scenario, for anyone who opens it. Changing the scenario’s inputs later takes it off, since it would describe the old ones.', 'The main cap table does not change.'],
      action: 'Attach to scenario',
    };
  }
  return null;
}

/** A name is 1 to 200 characters, as the Worker takes it. */
export function nameError(name) {
  const n = String(name || '').trim();
  if (!n) return 'A scenario needs a name.';
  if (n.length > 200) return 'A name is at most 200 characters.';
  return '';
}

// ─────────────────────────────────────────────────────────── the editor (CT6)

const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const s = String(v ?? '').replace(/[,\s$]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** A scenario's exits: `exit_values`, else the single `exit_value`, else none. */
export function exitsOf(inputs) {
  if (Array.isArray(inputs?.exit_values) && inputs.exit_values.length) return inputs.exit_values.filter(isNum).slice(0, MAX_EXITS);
  return isNum(inputs?.exit_value) ? [inputs.exit_value] : [];
}

/**
 * The editable form of a scenario that starts from Today: its rounds, the
 * instruments that convert (by name, all by default) and up to four exits.
 * Its holders are the record's, so they are not edited here.
 */
export function todayDraft(s) {
  const i = s?.inputs || {};
  const safes = Array.isArray(i.safes) ? i.safes : [];
  return {
    kind: 'today',
    name: str(s?.name),
    rounds: (i.rounds || []).map((r) => ({
      name: str(r.name), pre_money: str(r.pre_money), investment: str(r.investment),
      pool: str(r.post_round_pool_pct), payer: r.top_up_payer === 'post_money' ? 'post_money' : 'pre_money',
    })),
    holdOut: safes.filter((x) => x?.converts === false).map((x) => String(x.name)),
    exits: exitsOf(i).map(String),
  };
}

/**
 * The simulate body from a Today draft, or the sentences that stop it. A
 * blank field is left out, never sent as zero; the record's instruments are
 * named to convert unless held out.
 */
export function todayBody(d, instruments = []) {
  const errors = [];
  const need = (v, label, required = true) => {
    const n = num(v);
    if (Number.isNaN(n)) errors.push(`${label} is not a number.`);
    else if (n == null && required) errors.push(`${label} is missing.`);
    else if (n != null && n < 0) errors.push(`${label} cannot be negative.`);
    return n;
  };
  const rounds = d.rounds.map((r, k) => {
    const label = r.name.trim() || `Round ${k + 1}`;
    if (!r.name.trim()) errors.push(`Round ${k + 1} needs a name.`);
    const out = { name: r.name.trim(), pre_money: need(r.pre_money, `${label} pre-money`), investment: need(r.investment, `${label} amount raised`) };
    const pool = need(r.pool, `${label} pool target`, false);
    if (pool != null) {
      if (pool >= 100) errors.push(`${label} pool target must be under 100%.`);
      out.post_round_pool_pct = pool;
      out.top_up_payer = r.payer === 'post_money' ? 'post_money' : 'pre_money';
    }
    return out;
  });
  const exits = d.exits.map((v, k) => need(v, `Exit value ${k + 1}`)).filter((v) => v != null);
  if (d.exits.length > MAX_EXITS) errors.push(`Up to ${MAX_EXITS} exit values.`);
  const held = new Set(d.holdOut);
  const converting = instruments.map((x) => x.name).filter((n) => !held.has(n));
  return { errors, body: { rounds, exit_values: exits, converting } };
}

/** The editable form of a scenario typed by hand (the variants page's). Discounts read as percent. */
export function draftFromScenario(s) {
  const i = s?.inputs || {};
  return {
    name: str(s?.name),
    founders: (i.founders || []).map((f) => ({ name: str(f.name), shares: str(f.shares) })),
    option_pool_pct: str(i.option_pool_pct),
    safes: (i.safes || []).map((x) => ({
      ...x,
      name: str(x.name), amount: str(x.amount), cap: str(x.cap),
      discount: x.discount == null ? '' : String(Math.round(Number(x.discount) * 10000) / 100),
    })),
    rounds: (i.rounds || []).map((r) => ({ ...r, name: str(r.name), investment: str(r.investment), pre_money: str(r.pre_money) })),
    exit_value: str(i.exit_value),
  };
}

/**
 * The inputs the route takes, from the hand-typed form. A field left blank is
 * left out (or `null` for the exit value), never sent as zero. Fields the form
 * does not edit — a SAFE's basis or instrument, a round's pool top-up — ride
 * along unchanged. A value that is not a number is reported here, in a sentence.
 */
export function inputsFromDraft(d) {
  const errors = [];
  const need = (v, label) => {
    const n = num(v);
    if (Number.isNaN(n)) errors.push(`${label} is not a number.`);
    return n;
  };
  const founders = d.founders.map((f, k) => ({ name: f.name.trim(), shares: need(f.shares, `Founder ${k + 1} shares`) }));
  const safes = d.safes.map((s, k) => {
    const { name, amount, cap, discount, ...rest } = s;
    const out = { ...rest, name: name.trim(), amount: need(amount, `SAFE ${k + 1} amount`) };
    const c = need(cap, `SAFE ${k + 1} cap`);
    const p = need(discount, `SAFE ${k + 1} discount`);
    if (c != null) out.cap = c;
    if (p != null) out.discount = Math.round(p * 100) / 10000;
    return out;
  });
  const rounds = d.rounds.map((r, k) => ({
    ...r,
    name: r.name.trim(),
    investment: need(r.investment, `Round ${k + 1} raise`),
    pre_money: need(r.pre_money, `Round ${k + 1} pre-money`),
  }));
  const pool = need(d.option_pool_pct, 'Option pool');
  const exit = need(d.exit_value, 'Exit value');
  return {
    errors,
    inputs: {
      founders,
      ...(pool == null ? {} : { option_pool_pct: pool }),
      safes,
      rounds,
      exit_value: exit,
    },
  };
}

/** The route's refusal, as the sentences it carries. */
export function variantSaveErrors(e) {
  const list = e?.data?.errors || e?.data?.detail?.errors;
  if (Array.isArray(list) && list.length) return list.map(String);
  if (e?.status === 402) return ['Editing a scenario needs the Raise + Grow plan.'];
  if (e?.status === 403) return ['You can read this cap table, but not change it.'];
  return [e?.message || 'The scenario could not be saved.'];
}

/** Inputs that carry the attached reads forward, or drop them when the inputs changed. */
export function withNotes(inputs, previous, { keep }) {
  const notes = keep && Array.isArray(previous?.notes) ? previous.notes : [];
  const { notes: _drop, ...rest } = inputs || {};
  return notes.length ? { ...rest, notes } : rest;
}

/** True when two input sets compute the same scenario (their notes left aside). */
export function sameInputs(a, b) {
  const strip = (x) => { const { notes: _n, ...rest } = x || {}; return JSON.stringify(rest); };
  return strip(a) === strip(b);
}

// ─────────────────────────────────────────────────────────── results (CT6)

export const GROUPS = [
  { key: 'founders', label: 'Founders', types: ['founder'], tone: 'violet' },
  { key: 'investors', label: 'Investors', types: ['preferred', 'safe'], tone: 'sky' },
  { key: 'people', label: 'Employees and advisors', types: ['options'], tone: 'muted' },
  { key: 'pool', label: 'Pool unallocated', types: ['option_pool'], tone: 'amber' },
];
const groupOf = (type) => GROUPS.find((g) => g.types.includes(type)) || GROUPS[1];

const pctOf = (ledger, test) => {
  if (!Array.isArray(ledger) || !ledger.some((h) => isNum(h?.pct))) return null;
  const hit = ledger.filter(test);
  return hit.length ? hit.reduce((t, h) => t + (isNum(h.pct) ? h.pct : 0), 0) : null;
};
const lastLedger = (result) => {
  const rounds = Array.isArray(result?.rounds) ? result.rounds : [];
  return rounds.length ? rounds[rounds.length - 1].ledger : null;
};
const change = (a, b) => {
  if (a == null || b == null) return '—';
  const d = Math.round((b - a) * 100) / 100;
  if (d === 0) return '0.00';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
};

/**
 * Before and after by holder and group (CT6). Before is the scenario's start:
 * the record for a scenario from Today, its own typed founders otherwise.
 * A group with no holder on either side is left out, never drawn as 0%.
 */
export function beforeAfter(result) {
  const before = result?.founding;
  const after = lastLedger(result);
  const rows = [];
  for (const g of GROUPS) {
    const has = (l) => Array.isArray(l) && l.some((h) => g.types.includes(h?.type));
    if (!has(before) && !has(after)) continue;
    const b = pctOf(before, (h) => g.types.includes(h?.type));
    const a = after ? pctOf(after, (h) => g.types.includes(h?.type)) : null;
    rows.push({ key: g.key, label: g.label, group: true, before: b == null ? (has(before) ? NOT_RECORDED : '—') : pct(b), after: after ? (a == null ? '—' : pct(a)) : NOT_RECORDED, change: change(b, a) });
    if (g.key !== 'founders') continue;
    const names = [...new Set([...(before || []), ...(after || [])].filter((h) => h?.type === 'founder').map((h) => h.holder))];
    for (const n of names) {
      const bb = pctOf(before, (h) => h?.type === 'founder' && h.holder === n);
      const aa = after ? pctOf(after, (h) => h?.type === 'founder' && h.holder === n) : null;
      rows.push({ key: `f-${n}`, label: n, group: false, before: bb == null ? '—' : pct(bb), after: after ? (aa == null ? '—' : pct(aa)) : NOT_RECORDED, change: change(bb, aa) });
    }
  }
  const rounds = Array.isArray(result?.rounds) ? result.rounds : [];
  const last = rounds[rounds.length - 1];
  rows.push({ key: 'price', label: 'Price per share', group: false, before: NOT_READ, after: last ? `$${last.price_per_share.toFixed(4)}` : 'No round modelled', change: '—' });
  rows.push({ key: 'post', label: 'Post-money', group: false, before: 'No round modelled', after: last ? dollars(last.post_money) : 'No round modelled', change: '—' });
  return rows;
}

const BINDING = { cap: 'at the cap', discount: 'at the discount', none: 'at the round price' };

/** What happens in each round (CT6), in plain words from the engine's numbers. */
export function roundEvents(result) {
  const rounds = Array.isArray(result?.rounds) ? result.rounds : [];
  return rounds.map((r, k) => {
    const prev = k ? rounds[k - 1].ledger : result?.founding || [];
    const label = `${r.name} Investors`;
    const before = (prev || []).filter((h) => h.holder === label).reduce((t, h) => t + h.shares, 0);
    const now = (r.ledger || []).filter((h) => h.holder === label).reduce((t, h) => t + h.shares, 0);
    const lines = [];
    if (r.top_up && r.top_up.shares > 0) {
      lines.push(`Option pool topped up by ${shares(r.top_up.shares)} shares, paid by ${r.top_up.payer === 'post_money' ? 'everyone, the new investors included' : 'the holders before the round'}`);
    }
    for (const c of r.conversions || []) {
      lines.push(`${c.instrument === 'note' ? 'Note' : 'SAFE'} ${c.name} converts ${BINDING[c.binding] || BINDING.none}: ${shares(c.shares)} shares at $${c.price_per_share.toFixed(4)}`);
    }
    if (now - before > 0) lines.push(`New money: ${shares(now - before)} ${r.name} preferred at $${r.price_per_share.toFixed(4)} for ${dollars(r.investment)}`);
    return { round: r.name, lines };
  });
}

/** What the engine could not do, in its own sentences, with the over-100% check first. */
export function engineNotes(result) {
  const out = [];
  if (result?.over_100 && result?.post_money_check) out.push(`Post-money caps promise ${result.post_money_check.pct}% of the company. These terms cannot all be honoured, so no exit is calculated.`);
  for (const w of Array.isArray(result?.warnings) ? result.warnings : []) if (!out.includes(w)) out.push(String(w));
  for (const n of Array.isArray(result?.outstanding_instruments) ? result.outstanding_instruments : []) out.push(`${n} stays outstanding: it is set not to convert.`);
  return out;
}

/** The record's instruments not modelled, each with D1018's sentence. */
export const notModelled = (read) => (Array.isArray(read?.not_modelled) ? read.not_modelled.map((n) => `${n.name || 'An instrument'}: ${n.sentence || n.reason}`) : []);

// ─────────────────────────────────────────────────────────── the waterfall (CT9)

/** "$29.07M" or "$950K", for chart labels; the tables keep whole dollars. */
export function short(v) {
  if (!isNum(v)) return NOT_RECORDED;
  const a = Math.abs(v);
  if (a >= 1e9) return `$${+(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${+(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** Each exit's waterfall, in order: `waterfalls`, else the single `waterfall`. */
export function waterfallsOf(result) {
  if (Array.isArray(result?.waterfalls) && result.waterfalls.length) return result.waterfalls.map((w) => ({ exit: w.exit_value, wf: w.waterfall || null }));
  return result?.waterfall ? [{ exit: result.waterfall.exit_value, wf: result.waterfall }] : [];
}

const TAKES = {
  '1x non-participating preference': 'Takes the preference',
  'pro-rata (converted preferred)': 'Converts',
  'pro-rata (common)': 'Common',
  'purchase amount (SAFE liquidity)': 'Takes cash back',
  'as-converted (SAFE liquidity)': 'Converts at the cap',
};

/** One exit's waterfall as CT9's table: who takes the preference or converts, and the payout. */
export function waterfallTable(wf, ledger) {
  if (!wf) return null;
  const rows = (wf.rows || []).map((r) => {
    const g = groupOf(r.type);
    const prefd = (r.type === 'preferred' || r.type === 'safe') && isNum(r.preference) && r.preference > 0;
    return {
      holder: r.holder,
      group: g.label,
      preference: prefd ? `1× · ${dollars(r.preference)}` : r.type === 'options' ? 'None · options' : 'None · common',
      takes: r.type === 'options' ? 'Exercise and take common' : TAKES[r.source] || r.source || NOT_RECORDED,
      payout: dollars(r.payout),
    };
  });
  if ((ledger || []).some((h) => h?.type === 'option_pool' && h.shares > 0)) rows.push({ holder: 'Unallocated pool', group: 'Pool', preference: '—', takes: 'Takes no proceeds', payout: '—' });
  const total = wf.totals?.total_distributed;
  const foot = isNum(total) && Math.abs(total - wf.exit_value) < 0.01
    ? `Payouts add up to the ${dollars(wf.exit_value)} exit.`
    : `Payouts add up to ${dollars(total)} of the ${dollars(wf.exit_value)} exit.`;
  return { exit: wf.exit_value, rows, foot };
}

/** Payout by group at one exit; null where the engine did not calculate it. */
export function payoutByGroup(wf) {
  if (!wf) return null;
  const out = { founders: 0, investors: 0, people: 0 };
  for (const r of wf.rows || []) {
    const g = groupOf(r.type).key;
    if (g in out && isNum(r.payout)) out[g] += r.payout;
  }
  return out;
}

/**
 * Each priced investor's conversion point (CT9): the exit above which its
 * share of the exit is worth more than its 1× preference. This is the
 * engine's own test (`preference > exit × shares ÷ total`), read off the
 * shares and preferences its waterfall returned. A pre-round waterfall
 * (SAFEs choosing cash back) has none.
 */
export function conversionPoints(wf) {
  const rows = (wf?.rows || []);
  if (!rows.length || rows.some((r) => r.source === 'purchase amount (SAFE liquidity)' || r.source === 'as-converted (SAFE liquidity)')) return { paidInFull: null, points: [] };
  const total = rows.reduce((t, r) => t + (isNum(r.shares) ? r.shares : 0), 0);
  const prefd = rows.filter((r) => (r.type === 'preferred' || r.type === 'safe') && isNum(r.preference) && r.preference > 0 && r.shares > 0);
  const points = prefd.map((r) => ({ holder: r.holder, at: (r.preference * total) / r.shares })).sort((a, b) => a.at - b.at);
  return { paidInFull: prefd.length ? prefd.reduce((t, r) => t + r.preference, 0) : null, points };
}

// ─────────────────────────────────────────────────────────── the read-backs

/**
 * "Read the round back" (CT7): the first round in plain words, every step
 * from the engine's numbers. No figure is written here that the engine did
 * not return; Eadwyn's own band reads the saved model (`raise/capital`).
 */
export function roundReadBack(result) {
  const r = result?.rounds?.[0];
  if (!r) return null;
  const steps = [];
  const price = `$${r.price_per_share.toFixed(4)}`;
  steps.push(`Price: ${price} a share, the pre-money of ${dollars(r.pre_money)} spread over the ${shares(r.shares_pre)} shares before the round.`);
  const label = `${r.name} Investors`;
  const bought = (r.ledger || []).filter((h) => h.holder === label).reduce((t, h) => t + h.shares, 0);
  if (bought > 0) steps.push(`New money: ${dollars(r.investment)} at ${price} buys ${shares(bought)} new ${r.name} preferred.`);
  if (r.top_up?.shares > 0) {
    const pool = (r.ledger || []).filter((h) => h.type === 'option_pool').reduce((t, h) => t + (isNum(h.pct) ? h.pct : 0), 0);
    steps.push(r.top_up.payer === 'post_money'
      ? `The pool tops up by ${shares(r.top_up.shares)} shares to reach ${pct(pool)} after the round. The top-up sits in the post-money, so everyone carries it, the new investors included.`
      : `The pool tops up by ${shares(r.top_up.shares)} shares to reach ${pct(pool)} after the round. The top-up sits in the pre-money, so the holders before the round carry it.`);
  }
  const conv = r.conversions || [];
  if (conv.length) steps.push(`${conv.length === 1 ? 'One instrument converts' : `The ${conv.length} instruments convert`}: ${conv.map((c) => `${c.name} ${BINDING[c.binding] || BINDING.none}, ${shares(c.shares)} shares`).join('; ')}.`);
  else steps.push('No instrument converts in this round.');
  const b = pctOf(result.founding, (h) => h?.type === 'founder');
  const a = pctOf(r.ledger, (h) => h?.type === 'founder');
  if (b != null && a != null) steps.push(`Founders go from ${pct(b)} before the round to ${pct(a)} after it.`);
  return { kind: 'round', title: 'Read the round back', steps };
}

/** "Explain the order of payment" (CT9) at one exit, from that exit's waterfall. */
export function paymentReadBack(wf) {
  if (!wf) return null;
  const { paidInFull, points } = conversionPoints(wf);
  const steps = [];
  const rows = wf.rows || [];
  const cash = rows.filter((r) => r.source === 'purchase amount (SAFE liquidity)');
  if (cash.length || rows.some((r) => r.source === 'as-converted (SAFE liquidity)')) {
    steps.push('No round has priced the company yet, so each SAFE takes the more of its money back or what it would hold at its cap.');
    if (cash.length) steps.push(`At a ${dollars(wf.exit_value)} exit, ${cash.map((r) => r.holder).join(', ')} take${cash.length === 1 ? 's' : ''} cash back: ${dollars(cash.reduce((t, r) => t + r.payout, 0))} in all.`);
    else steps.push(`At a ${dollars(wf.exit_value)} exit every SAFE converts at its cap.`);
    steps.push('What is left is shared by ownership, leaving out the unallocated pool.');
    return { kind: 'payment', title: 'Explain the order of payment', steps };
  }
  if (paidInFull == null) {
    steps.push(`No holder has a preference, so a ${dollars(wf.exit_value)} exit is shared by ownership, leaving out the unallocated pool.`);
    return { kind: 'payment', title: 'Explain the order of payment', steps };
  }
  steps.push(`First, each investor may take back what it put in: ${dollars(paidInFull)} in all, 1× and non-participating.`);
  const last = points[points.length - 1];
  if (points.length > 1) steps.push(`Above ${short(points[0].at)}, ${points[0].holder} does better converting to common. Above ${short(last.at)}, every investor does.`);
  else if (last) steps.push(`Above ${short(last.at)}, ${last.holder} does better converting to common.`);
  const taking = rows.filter((r) => r.source === '1x non-participating preference');
  steps.push(taking.length
    ? `At a ${dollars(wf.exit_value)} exit, ${taking.map((r) => r.holder).join(', ')} take${taking.length === 1 ? 's' : ''} the preference; the rest is shared by ownership, leaving out the unallocated pool.`
    : `At a ${dollars(wf.exit_value)} exit everyone converts, so the exit is shared by ownership, leaving out the unallocated pool.`);
  if (last) steps.push(`Nothing records a seniority order between the investors. Above ${short(last.at)} it does not matter; below it, check the charter.`);
  return { kind: 'payment', title: 'Explain the order of payment', steps };
}

/** A read attached to the scenario, if one is stored for this kind. */
export const attachedRead = (inputs, kind) => (Array.isArray(inputs?.notes) ? inputs.notes.find((n) => n?.kind === kind) || null : null);

/** The inputs with this read attached (one per kind, the newest kept). */
export function attachRead(inputs, read, at = new Date().toISOString()) {
  const notes = (Array.isArray(inputs?.notes) ? inputs.notes : []).filter((n) => n?.kind !== read.kind);
  return { ...inputs, notes: [...notes, { kind: read.kind, title: read.title, steps: read.steps, attached_at: at }] };
}

// ─────────────────────────────────────────────────────────── compare (CT7)

/** The exits every compared scenario is run at: theirs together, smallest first, at most four. */
export function compareExits(scenarios) {
  const all = new Set();
  for (const s of scenarios) for (const v of exitsOf(s?.inputs)) all.add(v);
  return [...all].sort((a, b) => a - b).slice(0, MAX_EXITS);
}

/**
 * The compare table (CT7): Today (the record, dotted) then each scenario.
 * `cols` are `{ name, result | null, status }`; a column whose run failed
 * says so in every row rather than drawing a figure.
 */
export function compareRows(today, cols) {
  const series = [{ result: today, today: true }, ...cols.map((c) => ({ result: c.result, status: c.status }))];
  const cell = (s, fn) => (s.status && s.status !== 'ready' ? (s.status === 'loading' ? 'Reading…' : 'Could not be read') : s.result ? fn(s.result, s.today) : NOT_RECORDED);
  const groupPct = (types) => (r, isToday) => {
    const l = isToday ? r.founding : lastLedger(r) || r.founding;
    const v = pctOf(l, (h) => types.includes(h?.type));
    return v == null ? '—' : pct(v);
  };
  const founders = [...new Set(series.flatMap((s) => [...(s.result?.founding || []), ...(lastLedger(s.result) || [])]).filter((h) => h?.type === 'founder').map((h) => h.holder))];
  const instruments = [...new Set(cols.flatMap((c) => (c.result?.rounds || []).flatMap((r) => (r.conversions || []).map((x) => x.name))))];
  const rows = [];
  rows.push({ label: 'Founders', bold: true, cells: series.map((s) => cell(s, groupPct(['founder']))) });
  for (const f of founders) {
    rows.push({ label: f, cells: series.map((s) => cell(s, (r, isToday) => {
      const v = pctOf(isToday ? r.founding : lastLedger(r) || r.founding, (h) => h?.type === 'founder' && h.holder === f);
      return v == null ? NOT_IN : pct(v);
    })) });
  }
  for (const g of GROUPS.slice(1)) rows.push({ label: g.label, bold: true, cells: series.map((s) => cell(s, groupPct(g.types))) });
  const lastRound = (r) => (r.rounds || [])[(r.rounds || []).length - 1];
  rows.push({ label: 'Price per share', cells: series.map((s) => cell(s, (r, isToday) => (isToday ? NOT_READ : lastRound(r) ? `$${lastRound(r).price_per_share.toFixed(4)}` : 'No round modelled'))) });
  rows.push({ label: 'Post-money', cells: series.map((s) => cell(s, (r, isToday) => (isToday || !lastRound(r) ? 'No round modelled' : dollars(lastRound(r).post_money)))) });
  for (const n of instruments) {
    rows.push({ label: `${n} · shares`, cells: series.map((s) => cell(s, (r, isToday) => {
      if (isToday) return NOT_CONVERTED;
      const c = (r.rounds || []).flatMap((x) => x.conversions || []).find((x) => x.name === n);
      return c ? shares(c.shares) : NOT_CONVERTED;
    })) });
  }
  return rows;
}

/**
 * Founder ownership as small multiples (CT7): one panel per scenario, each
 * founder's share at the start and after each round. The first point is on
 * record only for a scenario that starts from Today.
 */
export function founderPanels(cols) {
  const TONES = ['violet', 'sky', 'amber', 'emerald', 'muted'];
  return cols.filter((c) => c.result).map((c) => {
    const ledgers = [c.result.founding || [], ...(c.result.rounds || []).map((r) => r.ledger || [])];
    const names = [...new Set(ledgers.flat().filter((h) => h?.type === 'founder').map((h) => h.holder))].slice(0, TONES.length);
    return {
      name: c.name,
      onRecord: !!c.fromToday,
      labels: [c.fromToday ? 'Today' : 'Start', ...(c.result.rounds || []).map((r) => r.name)],
      series: names.map((n, k) => ({
        label: n, tone: TONES[k],
        values: ledgers.map((l) => {
          const v = pctOf(l, (h) => h?.type === 'founder' && h.holder === n);
          return v == null ? null : Math.round(v * 100) / 100;
        }),
      })),
    };
  });
}

/** The exit waterfall across scenarios (CT7): one panel per exit, a stacked bar per scenario. */
export function exitPanels(cols, exits) {
  return exits.map((exit) => ({
    exit,
    rows: cols.map((c) => {
      const wf = waterfallsOf(c.result).find((w) => w.exit === exit)?.wf || null;
      const by = payoutByGroup(wf);
      if (!by) return { label: c.short, value: 0, open: true, text: NOT_RECORDED, by: null };
      return {
        label: c.short,
        value: by.founders + by.investors + by.people,
        text: `F ${short(by.founders)}`,
        parts: [{ value: by.founders, tone: 'violet' }, { value: by.investors, tone: 'sky' }, { value: by.people, tone: 'muted' }],
        by,
      };
    }),
  }));
}

/**
 * D1028 (#2865, CT23c): the compare table on a phone, one scenario per card
 * to swipe through. A share reads "Today → after" when Today has one; a
 * figure Today does not have (a price, a post-money, a conversion) reads alone.
 */
export function swipeCards(rows, cols) {
  const n = cols.length;
  const isPct = (v) => typeof v === 'string' && /%$/.test(v);
  return cols.map((c, k) => ({
    name: c.name,
    status: c.status,
    meta: `${k + 1} of ${n}${n > 1 ? ' · swipe ›' : ''}`,
    rows: rows.map((r) => {
      const today = r.cells[0];
      const after = r.cells[k + 1];
      return { label: r.label, bold: !!r.bold, value: isPct(today) && isPct(after) ? `${today} → ${after}` : after };
    }),
  }));
}

/**
 * D1028 (CT23c): one scenario's exit waterfall as a table on a phone: each
 * exit, and what founders, investors and employees take. An exit the engine
 * did not calculate says so in every cell, never $0.
 */
export function exitTable(col, exits) {
  const head = ['Exit', ...GROUPS.slice(0, 3).map((g) => g.label)];
  const rows = exits.map((exit) => {
    const by = payoutByGroup(waterfallsOf(col?.result).find((w) => w.exit === exit)?.wf || null);
    return { exit, cells: [dollars(exit), ...(by ? [by.founders, by.investors, by.people].map(dollars) : [NOT_RECORDED, NOT_RECORDED, NOT_RECORDED])] };
  });
  return { head, rows };
}

/** A short column label for a chart: the name's last words, at most 14 characters. */
export function shortName(name) {
  const s = String(name || '').trim();
  const tail = s.includes('·') ? s.split('·').pop().trim() : s;
  return tail.length > 14 ? `${tail.slice(0, 13)}…` : tail;
}

/** The step chart's columns (CT9): each exit's share by group, with the conversion points marked. */
export function shareSteps(result) {
  const list = waterfallsOf(result);
  const columns = list.map(({ exit, wf }) => {
    const by = payoutByGroup(wf);
    if (!by || !(exit > 0)) return { exit, shares: null };
    return { exit, shares: { founders: (100 * by.founders) / exit, investors: (100 * by.investors) / exit, people: (100 * by.people) / exit } };
  });
  const firstWf = list.find((w) => w.wf)?.wf || null;
  return { columns, ...conversionPoints(firstWf) };
}

/**
 * How a saved scenario is run, at the exits given (or its own). From Today:
 * the record with its rounds and the instruments it lets convert, through the
 * venture's simulate. From the model: its own inputs, through the engine.
 */
export function runRequest(scenario, exits = null) {
  const i = scenario?.inputs || {};
  const exitList = exits || exitsOf(i);
  if (fromToday(scenario)) {
    const held = new Set((i.safes || []).filter((x) => x?.converts === false).map((x) => x.name));
    return {
      kind: 'today',
      body: {
        rounds: Array.isArray(i.rounds) ? i.rounds : [],
        exit_values: exitList,
        converting: (i.safes || []).map((x) => x.name).filter((n) => !held.has(n)),
      },
    };
  }
  const { notes: _n, exit_value: _e, ...rest } = i;
  return { kind: 'model', inputs: { ...rest, ...(exitList.length ? { exit_values: exitList } : {}) } };
}
