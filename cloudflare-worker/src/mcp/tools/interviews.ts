/** D669: every interview service is reachable only through callTool. */
import { z } from 'zod';
import type { McpTool } from '../server';
import { submitInterview, proposePlacements, structureWithStudioos, TOOLS, type AssistantGrant, type SubmitArgs } from '../../services/assistantInterviews';

const grant = (props: { userId: number; companies: number[]; clientId: string; clientName: string | null }): AssistantGrant =>
  ({ ...props, clientName: props.clientName ?? 'An AI assistant' });
const interviewee = z.object({ label: z.string().min(1).max(80), role: z.string().max(80).optional(), company: z.string().max(120).optional() }).strict();
export const INTERVIEW_TOOLS: McpTool[] = [
  {
    name: 'submit_interview', title: 'Submit an interview', description: TOOLS.submit_interview.description,
    requiredScope: 'validate:write', company: true, readOnly: false,
    inputSchema: {
      company: z.number().int().positive(),
      channel: z.enum(['in_person', 'video', 'phone', 'text', 'manual']),
      occurred_at: z.string(), interviewee,
      consent: z.object({ status: z.literal('given'), method: z.string(), recorded_at: z.string() }),
      transcript: z.array(z.object({ text: z.string(), speaker: z.string().max(80).optional(), start_ms: z.number().int().nonnegative().optional() })).max(200).optional(),
      notes: z.string().optional(), summary: z.string().max(4000).optional(),
    },
    run: ({ env, props, args }) => submitInterview(env, grant(props), args as unknown as SubmitArgs),
  },
  {
    name: 'propose_placements', title: 'Propose interview placements', description: TOOLS.propose_placements.description,
    requiredScope: 'validate:write', company: false, readOnly: false,
    inputSchema: { session_id: z.number().int().positive(), run_label: z.string().max(80).optional(),
      placements: z.array(z.object({ module: z.string(), kind: z.string(), payload: z.record(z.string(), z.unknown()), quote: z.string().max(400) })).min(1).max(100) },
    run: ({ env, props, args }) => proposePlacements(env, grant(props), args as any),
  },
  {
    name: 'structure_with_studioos', title: 'Structure an interview with StudioOS', description: TOOLS.structure_with_studioos.description,
    requiredScope: 'validate:write', company: false, readOnly: false,
    inputSchema: { session_id: z.number().int().positive(), model: z.string().optional() },
    run: ({ env, props, args }) => structureWithStudioos(env, grant(props), args as any),
  },
];
