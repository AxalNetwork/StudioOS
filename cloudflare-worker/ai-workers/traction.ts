/**
 * AI traction review: takes recent metrics_snapshots for a project and
 * returns a 1-paragraph health assessment + a numeric momentum score.
 */
import type { Env } from '../src/types';

export interface TractionInput {
  project_id: number;
  snapshots: Array<{ metric_name: string; value: number; captured_at: string }>;
}

export interface TractionOutput {
  momentum: number;     // 0-10
  trend: 'up' | 'flat' | 'down';
  summary: string;
}

export async function aiTractionReview(env: Env, input: TractionInput): Promise<TractionOutput> {
  if (!input.snapshots.length) {
    return { momentum: 0, trend: 'flat', summary: 'No metrics captured yet.' };
  }
  const lines = input.snapshots.slice(-30).map(s =>
    `${s.captured_at} ${s.metric_name}=${s.value}`
  ).join('\n');
  const prompt = `Analyze these venture-studio metric snapshots. Return JSON:
{"momentum": int(0-10), "trend": "up"|"flat"|"down", "summary": "<=240 chars"}
${lines}`;
  let parsed: any = {};
  try {
    const resp: any = await (env as any).AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Strict JSON only.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 250,
    });
    const m = (resp?.response ?? '').match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (e) { console.error('aiTractionReview failed', e); }
  const momentum = Math.max(0, Math.min(10, Math.round(Number(parsed.momentum ?? 5))));
  const trend = ['up','flat','down'].includes(parsed.trend) ? parsed.trend : 'flat';
  return { momentum, trend, summary: String(parsed.summary ?? 'No summary.').slice(0, 280) };
}
