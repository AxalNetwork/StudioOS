/** D4424: an outside assistant's only write-shaped tool leaves a human-reviewed Team proposal. */
import { z } from 'zod';
import type { McpTool } from '../server';
import { ToolRefused } from '../grants';
import { proposeOutsideText } from '../../services/agents/outsideProposals';

export const TEAM_TOOLS: McpTool[] = [{
  name: 'team.propose', requiredScope: 'team:propose', source: 'axal', version: '1.0.0',
  company: true, readOnly: false, proposes: true, outsideOnly: true,
  title: 'Propose text to your team',
  description: 'Leave text for a person to review in the team approvals queue, within your assigned role’s module and option. Nothing changes a record or sends anything. Reuse the same request_id when retrying the same proposal.',
  inputSchema: { company: z.number().int().positive(), module: z.string().min(1).max(80), option: z.string().min(1).max(160),
    text: z.string().min(1).max(4000), request_id: z.string().uuid() },
  run: async (r) => {
    if (!r.outside) throw new ToolRefused('Only a connected outside team assistant can use this tool.', 'outside_assistant_required');
    return proposeOutsideText(r.env, r.outside, r.grantId ?? null, r.args);
  },
}];
