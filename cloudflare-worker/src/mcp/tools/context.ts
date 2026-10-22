/**
 * D666 (#1496) — the MCP server's read tools: `list_companies`,
 * `get_validate_context` and `get_interview_guide`.
 *
 * THE CONTEXT IS VALIDATE'S OWN READ. Themes, segments and hypotheses come
 * from `services/cycleValidate.ts`'s module records, the rows the founder sees
 * on the Validate pages, never a second query that could drift from them.
 * Customer research's records are NOT used: they carry interviewees' names.
 * Interviews are only counted. No interviewee's name or contact is returned.
 *
 * THE GUIDE IS BUILT BY CODE from the stored hypotheses and pain themes, the
 * same input always giving the same questions. No model writes it.
 *
 * A RESULT IS DATA. It carries facts and questions, never an instruction to
 * the assistant reading it.
 */
import { z } from 'zod';
import type { Env } from '../../types';
import { RECORDS_FOR, recordQuery, type Ctx } from '../../services/cycleValidate';
import type { McpTool } from '../server';

const today = () => new Date().toISOString().slice(0, 10);

/** Every row of one Validate module's records, page by page. */
async function allRows(env: Env, projectId: number, slug: 'problem-discovery' | 'ideal-customer-profile' | 'experiments') {
  const ctx: Ctx = { env, projectId, today: today() };
  const out: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 40; page += 1) {
    const r = await RECORDS_FOR[slug](ctx, recordQuery({ page }));
    out.push(...r.rows);
    if (out.length >= r.total || r.rows.length === 0) break;
  }
  return out;
}

const OPEN = new Set(['untested', 'testing', 'inconclusive']);

export async function validateContext(env: Env, projectId: number) {
  const [themes, segments, claims, counts] = await Promise.all([
    allRows(env, projectId, 'problem-discovery'),
    allRows(env, projectId, 'ideal-customer-profile'),
    allRows(env, projectId, 'experiments'),
    env.DB.prepare(
      `SELECT COUNT(*) AS recorded, SUM(CASE WHEN stage IS NULL OR stage = 'done' THEN 1 ELSE 0 END) AS held
         FROM discovery_interviews WHERE project_id = ?`,
    ).bind(projectId).first<{ recorded: number; held: number | null }>(),
  ]);
  const hypotheses = claims.map((c) => ({
    hypothesis: String(c.hypothesis ?? ''),
    status: c.status ?? null,
    evidence_links: c.evidence ?? null,
    strength: c.strength ?? null,
  }));
  return {
    hypotheses,
    pain_themes: themes.map((t) => ({ theme: String(t.theme ?? ''), mentions: t.mentions ?? null, severity: t.severity ?? null })),
    icp_segments: segments.map((s) => ({ segment: String(s.segment ?? ''), interviews: s.interviews ?? null, strong_fit: s.strong_fit ?? null, evidence: s.evidence ?? null })),
    open_questions: hypotheses.filter((h) => OPEN.has(String(h.status))).map((h) => h.hypothesis),
    interviews: { recorded: Number(counts?.recorded ?? 0), held: Number(counts?.held ?? 0) },
  };
}

/** The interview guide: deterministic questions from the open hypotheses and the strongest themes. */
export function interviewGuide(ctx: Awaited<ReturnType<typeof validateContext>>, hypothesis?: string) {
  const want = String(hypothesis || '').trim().toLowerCase();
  const open = ctx.hypotheses.filter((h) => OPEN.has(String(h.status)))
    .filter((h) => !want || h.hypothesis.toLowerCase().startsWith(want) || h.hypothesis.toLowerCase().includes(want));
  const themes = [...ctx.pain_themes].sort((a, b) => Number(b.mentions ?? 0) - Number(a.mentions ?? 0)).slice(0, 5);
  const questions: Array<{ question: string; why: string }> = [
    { question: 'What is your role, and what does a normal week look like?', why: 'Context before the problem.' },
  ];
  for (const t of themes) {
    questions.push({ question: `Tell me about the last time you ran into ${t.theme.toLowerCase()}. What happened?`, why: `Pain theme: ${t.theme}` });
    questions.push({ question: 'What did that cost you, in time or money? What do you do about it today?', why: `Severity of: ${t.theme}` });
  }
  for (const h of open) {
    questions.push({ question: `Can you give me a recent example that shows whether this is true: "${h.hypothesis}"?`, why: `Open hypothesis (${h.status})` });
  }
  questions.push({ question: 'Who else should I talk to about this?', why: 'Next interview.' });
  return { hypotheses_covered: open.map((h) => h.hypothesis), questions };
}

export const READ_TOOLS: McpTool[] = [
  {
    name: 'list_companies',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'List companies',
    description: 'List the StudioOS companies this connection was approved for.',
    inputSchema: {},
    company: false,
    run: async ({ companies }) => ({ companies }),
  },
  {
    name: 'get_validate_context',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'Get Validate context',
    description: 'Read one company\'s Validate context: its hypotheses and their status, its pain themes and their severity, its ideal-customer segments, its open questions, and how many interviews are recorded. Interviewees are never named.',
    inputSchema: { company: z.number().int().positive().describe('The company id, from list_companies') },
    company: true,
    run: async ({ env, company }) => ({ company: company!.name, ...(await validateContext(env, company!.id)) }),
  },
  {
    name: 'get_interview_guide',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'Get an interview guide',
    description: 'Get customer-interview questions for one company, built from its open hypotheses and its strongest pain themes. Optionally narrow to one hypothesis by its code or text.',
    inputSchema: {
      company: z.number().int().positive().describe('The company id, from list_companies'),
      hypothesis: z.string().max(200).optional().describe('A hypothesis code (for example H2) or words from it'),
    },
    company: true,
    run: async ({ env, company, args }) => ({ company: company!.name, ...interviewGuide(await validateContext(env, company!.id), args.hypothesis as string | undefined) }),
  },
];
