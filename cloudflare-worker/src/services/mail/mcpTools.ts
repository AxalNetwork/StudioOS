/**
 * D1343 (#3551) — the mail services the MCP tools `mail_context` and
 * `mail_draft` run (`../../mcp/tools/mail.ts`), handed in by the Worker's entry.
 *
 * `mcp/tools/mail.ts` imports none of `services/mail/`: the MCP server is
 * reached from `auth.ts`, and the context pack reaches every module's record
 * read, which D707's and D714's import guards keep out of that graph. Only
 * `index.ts` (and a test) imports this file.
 */
import { provideMailServices, type MailServices } from '../../mcp/tools/mail';
import { contextPack, MailError } from './contextPack';
import { blocksNow, draftAsk, runDraft, ticked } from './drafts';

export const MAIL_TOOL_SERVICES: MailServices = {
  contextPack: (env, user, person, project) => contextPack(env, user, person, project),
  async prepareDraft(env, user, body) {
    const { ask, pack } = await draftAsk(env, user, body);
    return {
      pack,
      async run(rail) {
        const sources = ticked(pack, ask.refs);
        const blocks = await blocksNow(env, user, pack, ask);
        return runDraft(env, user, { ask, pack, sources, blocks, parent: null, rail });
      },
    };
  },
  refusalOf: (e) => (e instanceof MailError ? { status: e.status, code: e.code, sentence: e.sentence } : null),
};

/** Hand the services to the MCP tools. Called once by `index.ts`. */
export function bindMailTools(): void { provideMailServices(MAIL_TOOL_SERVICES); }
