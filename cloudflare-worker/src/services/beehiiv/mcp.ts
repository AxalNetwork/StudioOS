/**
 * D2407 (#2407 part 1) — Beehiiv's two frozen tool lists and its MCP server
 * URL, from Beehiiv's record (`MCP_PROVIDERS.beehiiv`) and nothing else.
 *
 *   BEEHIIV_READ_TOOLS    the record's `read_tools`: the only names
 *                         `services/beehiiv/reads.ts` sends.
 *   BEEHIIV_DRAFT_TOOLS   the record's `write_tools`: the one draft tool #2407
 *                         part 3 plans to call from the PUBLISH adapter's
 *                         `publish`, after PUBLISH's confirm. NO PUBLISH PATH
 *                         EXISTS IN THIS PART: nothing imports this list but
 *                         its tests, and the shared session refuses a write
 *                         tool before any request (`mcpClient.ts`, no publish
 *                         ticket exists). `beehiiv_connection_2407.test.ts`
 *                         holds both.
 *
 * Only `reads.ts` imports this file in the source tree. The names are
 * UNVERIFIED (#2407's candidates, D2407.md §5); the record is where they
 * change once Beehiiv's own `tools/list` is read at the first sign-in.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';

const BEEHIIV = MCP_PROVIDERS.beehiiv;

/** Beehiiv's hosted MCP server, which a member's sign-in reads through (UNVERIFIED). */
export const BEEHIIV_MCP_URL = 'https://mcp.beehiiv.com/mcp';

/** The tools Axal VC may call: the record's `read_tools`, frozen. */
export const BEEHIIV_READ_TOOLS: readonly string[] = BEEHIIV.read_tools;

/** The draft tool part 3 asks for: the record's `write_tools`, frozen; unreachable in this part. */
export const BEEHIIV_DRAFT_TOOLS: readonly string[] = BEEHIIV.write_tools;

export function isBeehiivReadTool(name: string): boolean {
  return BEEHIIV_READ_TOOLS.includes(name);
}
