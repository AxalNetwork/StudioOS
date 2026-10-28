/**
 * D1343 (#3551, part 4 of #3547) — Email on Axal's MCP server: `mail_context`
 * and `mail_draft`. Neither sends. `mail_send` is not exposed: sending stays a
 * press in Axal, behind the composer's confirmation nonce (D1340).
 *
 *   mail_context  `{ person, project? }` → D1341's pack, read-only: the person's
 *                 record and the company's items, each read through its
 *                 module's own read. Needs `mail:read`.
 *   mail_draft    `{ person, intent, tone?, length?, refs?, blocks?, project? }`
 *                 → one draft, run and stored exactly as `POST /api/mail/drafts`
 *                 runs it (`runDraft`): charged once, to the member's AI
 *                 tokens, by the router, and kept in `mail_drafts` for the
 *                 member to read, edit and send in Axal. Needs `mail:write`.
 *
 * THE GRANT BOUNDS THE PACK. A person whose record belongs to a company this
 * connection was not approved for is "Record not found.", as one that does not
 * exist, and so is a `project` outside the grant. A person with no company (an
 * advisor engagement, a Network match) is the member's own, under the scope.
 *
 * A RESULT IS DATA: the records' text and the draft, never an instruction.
 */
import { z } from 'zod';
import type { User } from '../../types';
import type { McpTool, ToolRun } from '../server';
import { ToolError } from '../../services/assistantInterviews';
import { REFUSAL_WORDS, refusalFor } from '../../services/metering';
import { contextPack, MailError, NOT_FOUND, type Pack } from '../../services/mail/contextPack';
import { blocksNow, draftAsk, runDraft, ticked } from '../../services/mail/drafts';
import { LENGTHS, TONES } from '../../services/mail/intents';

const notFound = () => new ToolError(404, 'not_found', NOT_FOUND);

/** A pack inside this grant: the project asked for, and the person's own company, must both be granted. */
function inGrant(r: ToolRun, project: number | null, pack: Pack | null) {
  const granted = new Set(r.companies.map((c) => Number(c.id)));
  if (project != null && !granted.has(project)) throw notFound();
  if (pack?.person.project_id != null && !granted.has(Number(pack.person.project_id))) throw notFound();
}

const projectOf = (raw: unknown): number | null => (raw == null ? null : Number(raw));

async function asTool<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (e) {
    if (e instanceof MailError) throw new ToolError(e.status, e.code, e.sentence);
    throw e;
  }
}

const PERSON = z.string().min(3).max(90).describe('The person, as `kind:id`: interviewee:12, prospect:34, cofounder:h-5, advisor:7, partner:8, growth_partner:<uid> or member:<uid>');
const PROJECT = z.number().int().positive().optional().describe('The company id, from list_companies, when the person has none of their own');

export const MAIL_TOOLS: McpTool[] = [
  {
    name: 'mail_context',
    requiredScope: 'mail:read',
    source: 'axal',
    version: '1.0.0',
    title: 'Read an email\'s context',
    description: 'Read what Eadwyn may quote in an email to one person: their record and your company\'s one-liner and KPI board, each with its date and a link. Nothing is selected but their own record. Read-only; nothing is drafted or sent.',
    inputSchema: { person: PERSON, project: PROJECT },
    company: false,
    readOnly: true,
    run: async (r) => {
      const project = projectOf(r.args.project);
      inGrant(r, project, null);
      const pack = await asTool(() => contextPack(r.env, r.user as unknown as User, r.args.person, project));
      inGrant(r, project, pack);
      return {
        person: pack.person,
        intents: pack.intents.map(({ key, label }) => ({ key, label })),
        items: pack.items.map(({ ref, kind, label, as_of, link, selected, text }) => ({ ref, kind, label, as_of, link, selected, text })),
      };
    },
  },
  {
    name: 'mail_draft',
    requiredScope: 'mail:write',
    source: 'axal',
    version: '1.0.0',
    title: 'Draft an email with Eadwyn',
    description: 'Draft one email to one person from the records you choose (refs, from mail_context) and live update blocks. Charged to your AI tokens. The draft is kept in Axal VC for you to read, edit and send there; nothing is sent.',
    inputSchema: {
      person: PERSON,
      intent: z.string().min(2).max(40).describe('One of the intents mail_context lists for this person'),
      tone: z.enum(TONES as unknown as [string, ...string[]]).optional(),
      length: z.enum(LENGTHS as unknown as [string, ...string[]]).optional(),
      refs: z.array(z.string().max(90)).max(20).optional().describe('The refs to quote, from mail_context'),
      blocks: z.array(z.string().max(30)).max(5).optional().describe('Live update blocks: kpis, raise_status, project_progress, interview_insights, one_liner'),
      project: PROJECT,
    },
    company: false,
    readOnly: false,
    timeoutMs: 60_000,
    run: async (r) => {
      const user = r.user as unknown as User;
      const project = projectOf(r.args.project);
      inGrant(r, project, null);
      const body = { ...r.args, tone: r.args.tone ?? 'warm', length: r.args.length ?? 'short' };
      const { ask, pack } = await asTool(() => draftAsk(r.env, user, body));
      inGrant(r, project, pack);
      const sources = ticked(pack, ask.refs);
      const blocks = await asTool(() => blocksNow(r.env, user, pack, ask));
      const out = await runDraft(r.env, user, { ask, pack, sources, blocks, parent: null, rail: { page: 'Email', option: 'draft:email', record: pack.person.ref } });
      if (out.ok) {
        const { uid, subject, body: text, sources: quoted } = out.draft;
        return { draft: { uid, subject, body: text, sources: quoted }, sent: false, open_in: '/email' };
      }
      // The ledger's own refusal (no AI tokens, a limit, a pause): its words, never an amount.
      if (out.refusal && Object.prototype.hasOwnProperty.call(REFUSAL_WORDS, out.refusal)) throw refusalFor(out.refusal);
      if (out.refusal !== null) throw new ToolError(409, 'refused', out.error || 'Eadwyn could not draft this email. Try again.');
      throw new ToolError(503, out.code, out.message);
    },
  },
];
