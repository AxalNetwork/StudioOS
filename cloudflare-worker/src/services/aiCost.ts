/**
 * D787 (#2212, part of D785) — a member's own AI cost: per day and per model,
 * tokens in and out, the other units, what each run cost Cloudflare and what
 * the member was charged.
 *
 * WHAT IS READ. The member's own `ai_usage_logs` rows in the range, newest
 * first, at most `MAX_COST_RUNS` of them (`truncated` says when there were
 * more). `WHERE user_id = ? AND created_at >= ? AND created_at < ?` is
 * answered by `idx_ai_usage_user_created` (migration 040), so no new index.
 *
 * HOW A ROW COUNTS.
 *   - A refused row (`refusal` set) is counted in `totals.refused` and in
 *     nothing else: no run, no tokens, no cost, no charge.
 *   - Every other row is a run under its own `model`. A Llama Guard row
 *     (D763, `guard_for` set) carries the guard model there, so it counts
 *     and shows as that model.
 *   - Tokens are `prompt_tokens` and `completion_tokens`. `units` sums the
 *     units in `units_json` (D762) that are not tokens: audio minutes,
 *     characters, images and the rest.
 *   - `cost_usd` is `est_cost_usd`, what the run cost Cloudflare, summed in
 *     micro-USD and given rounded to six decimals.
 *   - `charged_microusd` is what the member paid. A NULL charge (a row from
 *     before migration 493, or a run held for a D640 review) is never a zero:
 *     it is counted in `not_recorded`, and a bucket whose every row is NULL
 *     reads `charged_microusd: null`.
 *
 * Days and ranges are UTC, as `created_at` is (`datetime('now')`).
 *
 * D805 (#2243) adds, for the Usage console's B2:
 *   - `totals.by_kind`: cost and charge by the model's catalogue `kind`,
 *     through `KIND_GROUP` (tokens, audio and speech, image, other). A model
 *     the catalogue does not know counts in `other` and is named in
 *     `totals.other_models`, never dropped. A guard row counts under its own
 *     model's kind.
 *   - `totals.output_not_recorded`: runs on a model priced per output token
 *     that recorded no output count. `completion_tokens` is `NOT NULL DEFAULT
 *     0` (migration 040), so an unrecorded count is a 0: a streamed reply
 *     from before D762 settled on its input alone. A cached answer, a refusal
 *     and a model priced by the minute, the character or the image have no
 *     output tokens to record and are not counted.
 */
import type { Env } from '../types';
import { MODEL_NAMES } from './aiCatalog';
import { modelById } from './ai/catalogue';
import { resolveRailOption } from './ai/railMatrix';
import { unitPrice } from './ai/pricing';

export type CostRange = 'mtd' | '30d' | 'prev_month';
export type CostGroup = 'model' | 'page' | 'option';
export const COST_RANGES: readonly CostRange[] = ['mtd', '30d', 'prev_month'];
export const COST_GROUPS: readonly CostGroup[] = ['model', 'page', 'option'];
/** At most this many runs are read; `truncated` says when there were more. */
export const MAX_COST_RUNS = 10_000;

export type KindGroup = 'tokens' | 'audio_speech' | 'image' | 'other';
export const KIND_GROUPS: readonly KindGroup[] = ['tokens', 'audio_speech', 'image', 'other'];
/**
 * D805: every catalogue `kind` (`services/ai/catalogue.ts`), and the cost line
 * it is drawn on. The test fails on a kind the catalogue has and this map does
 * not place, so a new kind is placed on purpose.
 */
export const KIND_GROUP: Readonly<Record<string, KindGroup>> = {
  'Text Generation': 'tokens',
  Summarization: 'tokens',
  Translation: 'tokens',
  'Text Embeddings': 'tokens',
  'Automatic Speech Recognition': 'audio_speech',
  'Text-to-Speech': 'audio_speech',
  'Text-to-Image': 'image',
  'Image-to-Text': 'image',
  'Text Classification': 'other',
  'Voice Activity Detection': 'other',
  'Image Classification': 'other',
  'Object Detection': 'other',
};

/** The model's cost line: its catalogue kind's group, or `other` for a model the catalogue does not know. */
export function kindGroupOf(model: string): KindGroup {
  const kind = modelById(model)?.kind;
  return (kind && KIND_GROUP[kind]) || 'other';
}

/** Whether the model is priced per output token, so a run on it has an output count to record. */
export function pricedPerOutputToken(model: string): boolean {
  const price = unitPrice(model, 'tokens_out');
  return price != null && Number(price) > 0;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The range's days, UTC: `from` and `to` are its first and last day,
 * inclusive; `start` and `end` bound `created_at` (`end` exclusive).
 *   - `mtd`: the first of this month to today;
 *   - `30d`: the 30 days ending today;
 *   - `prev_month`: the whole of last month.
 */
export function costRange(range: CostRange, now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = Date.UTC(y, m, now.getUTCDate());
  let first: number;
  let last: number;
  if (range === 'mtd') { first = Date.UTC(y, m, 1); last = today; }
  else if (range === '30d') { first = today - 29 * DAY_MS; last = today; }
  else { first = Date.UTC(y, m - 1, 1); last = Date.UTC(y, m, 1) - DAY_MS; }
  return { from: isoDay(first), to: isoDay(last), start: `${isoDay(first)} 00:00:00`, end: `${isoDay(last + DAY_MS)} 00:00:00` };
}

/** Every day from `from` to `to`, inclusive. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += DAY_MS) out.push(isoDay(t));
  return out;
}

/** The model's name in the catalogue, or null. */
export function modelName(id: string): string | null {
  return MODEL_NAMES[id] ?? modelById(id)?.name ?? null;
}

interface LogRow {
  day: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  est_cost_usd: number | null;
  charged_microusd: number | null;
  units_json: string | null;
  rail_page: string | null;
  rail_option: string | null;
  refusal: string | null;
  cached: number | null;
}

/** A running sum: cost in whole micro-USD so six decimals never drift. */
class Sum {
  runs = 0;
  input_tokens = 0;
  output_tokens = 0;
  costMicro = 0;
  charged = 0;
  recorded = 0;
  not_recorded = 0;
  units: Record<string, number> = {};

  add(r: LogRow, units: Record<string, number> | null) {
    this.runs += 1;
    this.input_tokens += num(r.prompt_tokens);
    this.output_tokens += num(r.completion_tokens);
    this.costMicro += Math.round(num(r.est_cost_usd) * 1_000_000);
    if (r.charged_microusd == null) this.not_recorded += 1;
    else { this.charged += num(r.charged_microusd); this.recorded += 1; }
    if (units) for (const [k, v] of Object.entries(units)) this.units[k] = round6((this.units[k] ?? 0) + v);
  }

  money() {
    return { cost_usd: this.costMicro / 1_000_000, charged_microusd: this.recorded > 0 ? this.charged : null };
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

/** The non-token units a row recorded (`units_json`), or null. A malformed value counts nothing. */
export function otherUnits(json: string | null): Record<string, number> | null {
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (k.startsWith('tokens')) continue;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

const byMoney = (a: { cost_usd: number; model?: string; key?: string | null }, b: { cost_usd: number; model?: string; key?: string | null }) =>
  b.cost_usd - a.cost_usd || String(a.model ?? a.key ?? '').localeCompare(String(b.model ?? b.key ?? ''));

/** The member's own cost in the range, grouped as `group` asks. Throws when the log cannot be read. */
export async function memberCost(env: Env, userId: number, range: CostRange, group: CostGroup, now = new Date()) {
  const r = costRange(range, now);
  const rows = (await env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day, model, prompt_tokens, completion_tokens, est_cost_usd, charged_microusd,
            units_json, rail_page, rail_option, refusal, cached
       FROM ai_usage_logs
      WHERE user_id = ? AND created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
  ).bind(userId, r.start, r.end, MAX_COST_RUNS + 1).all<LogRow>()).results ?? [];
  const truncated = rows.length > MAX_COST_RUNS;
  const read = rows.slice(0, MAX_COST_RUNS);

  const total = new Sum();
  let refused = 0;
  let outputNotRecorded = 0;
  const kinds = new Map<KindGroup, Sum>(KIND_GROUPS.map((k) => [k, new Sum()]));
  const otherModels = new Set<string>();
  const models = new Map<string, Sum>();
  const days = new Map<string, Map<string, Sum>>();
  const groups = new Map<string, { key: string | null; page?: string | null; label: string | null; sum: Sum }>();
  for (const row of read) {
    if (row.refusal) { refused += 1; continue; }
    const units = otherUnits(row.units_json);
    total.add(row, units);
    const model = String(row.model);
    const kind = kindGroupOf(model);
    kinds.get(kind)!.add(row, units);
    if (kind === 'other') otherModels.add(model);
    if (!row.cached && !num(row.completion_tokens) && pricedPerOutputToken(model)) outputNotRecorded += 1;
    if (!models.has(model)) models.set(model, new Sum());
    models.get(model)!.add(row, units);
    if (!days.has(row.day)) days.set(row.day, new Map());
    const day = days.get(row.day)!;
    if (!day.has(model)) day.set(model, new Sum());
    day.get(model)!.add(row, units);
    if (group !== 'model') {
      const page = row.rail_page ?? null;
      const option = row.rail_option ?? null;
      const id = group === 'page' ? JSON.stringify([page]) : JSON.stringify([page, option]);
      if (!groups.has(id)) {
        groups.set(id, group === 'page'
          ? { key: page, label: page, sum: new Sum() }
          : { key: option, page, label: option ? (resolveRailOption(page, option)?.optionLabel ?? option) : null, sum: new Sum() });
      }
      groups.get(id)!.sum.add(row, units);
    }
  }

  const modelRows = [...models].map(([model, s]) => ({
    model, name: modelName(model), runs: s.runs, input_tokens: s.input_tokens, output_tokens: s.output_tokens,
    units: s.units, ...s.money(), not_recorded: s.not_recorded,
  })).sort(byMoney);

  const groupRows = group === 'model'
    ? modelRows.map((m) => ({ key: m.model, label: m.name, runs: m.runs, input_tokens: m.input_tokens, output_tokens: m.output_tokens, charged_microusd: m.charged_microusd }))
    : [...groups.values()].map((g) => ({
      key: g.key, ...(group === 'option' ? { page: g.page ?? null } : {}), label: g.label,
      runs: g.sum.runs, input_tokens: g.sum.input_tokens, output_tokens: g.sum.output_tokens,
      charged_microusd: g.sum.money().charged_microusd, cost_usd: g.sum.money().cost_usd,
    })).sort(byMoney).map(({ cost_usd: _cost, ...g }) => g);

  return {
    range: { name: range, from: r.from, to: r.to },
    group,
    totals: {
      runs: total.runs, input_tokens: total.input_tokens, output_tokens: total.output_tokens,
      ...total.money(), refused, not_recorded: total.not_recorded,
      by_kind: Object.fromEntries(KIND_GROUPS.map((k) => [k, kinds.get(k)!.money()])) as Record<KindGroup, { cost_usd: number; charged_microusd: number | null }>,
      other_models: [...otherModels].sort(),
      output_not_recorded: outputNotRecorded,
    },
    days: daysOf(r.from, r.to).map((day) => ({
      day,
      by_model: [...(days.get(day) ?? new Map<string, Sum>())].sort(([a], [b]) => a.localeCompare(b)).map(([model, s]) => ({
        model, runs: s.runs, input_tokens: s.input_tokens, output_tokens: s.output_tokens, ...s.money(),
      })),
    })),
    models: modelRows,
    groups: groupRows,
    truncated,
  };
}

export type MemberCost = Awaited<ReturnType<typeof memberCost>>;

const CSV_COLUMNS = ['day', 'model', 'name', 'kind', 'runs', 'input_tokens', 'output_tokens', 'cost_usd', 'charged_microusd'] as const;

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The same read as CSV: one row per day and model that had a run, oldest day first. */
export function costCsv(cost: MemberCost): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const d of cost.days) {
    for (const m of d.by_model) {
      lines.push([d.day, m.model, modelName(m.model), kindGroupOf(m.model), m.runs, m.input_tokens, m.output_tokens, m.cost_usd.toFixed(6), m.charged_microusd]
        .map(csvCell).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}
