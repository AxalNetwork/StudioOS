/**
 * D2407 (#2407 part 3) — a Beehiiv DRAFT post, built and created. The only
 * file that calls Beehiiv's draft tool, and the only minter of its publish
 * ticket (`beehiiv_publish_2407.test.ts` holds the tree to both).
 *
 * WHO REACHES IT. Only `integrations/providers/beehiiv.ts`'s `publish`, which
 * only `services/publishCore.ts` calls, inside the founder's confirm or retry
 * (D1319). No route, cron, sync or Eadwyn path imports this file.
 *
 * A DRAFT, NEVER A POST. The tool is called with a publication, a title and
 * the body as HTML, and NO `status`: Beehiiv's MCP cannot publish, schedule or
 * send, and Axal VC never asks it to. The founder publishes it from Beehiiv.
 *
 * ONE RENDER. `renderDraft` builds the title and the email-safe HTML from the
 * draft's text. The preview shows exactly that, the envelope hashes it, and
 * `createBeehiivDraft` sends the envelope's own fields after checking they
 * are still what `renderDraft` makes of its text. Nothing is cut silently: a
 * text over a limit is a problem line, and Send stays off.
 *
 * REFUSED BEFORE THE DRAFT REQUEST, as `not_created` (no post can exist):
 *  - `no_publication`: the destination is not a Beehiiv publication id;
 *  - `plan_required`: the member's Beehiiv does not offer the draft tool
 *    (drafts need a paid Beehiiv plan), so it is never called;
 *  - `not_connected`, `unauthorized`, `rate_limited`, `unreachable`: the
 *    session could not open.
 * AFTER THE REQUEST LEFT, only a refusal Beehiiv answered (a 4xx, a 429, a
 * tool error) is `not_created`. A timeout, a reset, a 5xx or an answer with no
 * post id is `unknown`: a draft may exist, so it is never sent again.
 *
 * UNVERIFIED until the owner's first live sign-in (D2407.md §5): the tool's
 * name, its argument names (`publication_id`, `title`, `body_content`), and
 * the answer's fields (`id`, `web_url`). Logs and errors carry codes only.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';
import {
  McpClientError, mcpAccessFor, mcpCredentialsOf, mintMcpPublishTicket, openMcpSession, type McpFetch, type McpSession,
} from '../../integrations/mcpClient';
import { mcpPreregisteredFor } from '../../integrations/mcpSignIn';
import { PublishError, type IntegrationRow, type PublishInput, type PublishPreview } from '../../integrations/registry';
import type { Env } from '../../types';
import { BEEHIIV_DRAFT_TOOLS } from './mcp';
import { ID_RE } from './reads';

const BEEHIIV = MCP_PROVIDERS.beehiiv;
/** The one draft tool: the record's `write_tools[0]`, never a literal here. */
const DRAFT_TOOL = BEEHIIV_DRAFT_TOOLS[0];

/**
 * Axal VC's own ceilings, not Beehiiv's (Beehiiv documents none for a draft;
 * UNVERIFIED): a draft's text is at most 20,000 characters, as
 * `publish_drafts` keeps it, and its title, the first line, at most 250.
 */
export const BEEHIIV_TEXT_LIMIT = 20_000;
export const BEEHIIV_TITLE_LIMIT = 250;
/** What the confirm line says a Beehiiv destination reaches. */
export const BEEHIIV_AUDIENCE = 'Draft only: not sent to subscribers';

export const BEEHIIV_PROBLEMS = Object.freeze({
  empty: 'There is nothing to put in the draft.',
  no_body: 'The draft has a title but nothing under it. Add a line under the first one.',
  media: 'A Beehiiv draft from Axal VC carries text only. Remove the images, and add them in Beehiiv.',
  no_publication: 'This is not a Beehiiv publication Axal VC can reach. Refresh your places.',
});

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const chars = (s: string) => [...s].length;

export interface BeehiivDraftRender {
  title: string;
  /** The body as email-safe HTML: one escaped paragraph per line, nothing else. */
  body_html: string;
  /** The body's lines, as the preview lists them. */
  lines: string[];
}

/** The title (the first non-empty line) and the body (the rest), as `publish` sends them. */
export function renderDraft(text: string): BeehiivDraftRender {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const [title = '', ...body] = lines;
  return { title, lines: body, body_html: body.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n') };
}

/** The preview PUBLISH shows and hashes, built only from `input`: no request is made. */
export function previewDraft(input: PublishInput): PublishPreview {
  const r = renderDraft(input.text);
  const used = chars(input.text ?? '');
  const titleUsed = chars(r.title);
  const problems: string[] = [];
  if (!r.title) problems.push(BEEHIIV_PROBLEMS.empty);
  else if (!r.lines.length) problems.push(BEEHIIV_PROBLEMS.no_body);
  if (used > BEEHIIV_TEXT_LIMIT) problems.push(`${used} of ${BEEHIIV_TEXT_LIMIT} characters: shorten the draft.`);
  if (titleUsed > BEEHIIV_TITLE_LIMIT) problems.push(`The title, your first line, is ${titleUsed} of ${BEEHIIV_TITLE_LIMIT} characters: shorten it.`);
  if (input.media_r2_keys.length) problems.push(BEEHIIV_PROBLEMS.media);
  if (!ID_RE.test(String(input.destination?.external_account_id ?? ''))) problems.push(BEEHIIV_PROBLEMS.no_publication);
  return {
    target: input.destination?.display_name ?? '',
    audience: BEEHIIV_AUDIENCE,
    fields: [{ name: 'title', value: r.title }, { name: 'body_html', value: r.body_html }],
    counts: [{ name: 'characters', used, limit: BEEHIIV_TEXT_LIMIT }, { name: 'title characters', used: titleUsed, limit: BEEHIIV_TITLE_LIMIT }],
    media: { count: input.media_r2_keys.length, limit: 0, types: [] },
    problems,
  };
}

const field = (p: PublishPreview, name: string) => {
  const v = p?.fields?.find((f) => f.name === name)?.value;
  return typeof v === 'string' ? v : null;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** The post id and link an answer carries: its own fields, or under `data` or `post`. */
export function draftResultOf(v: unknown): { id: string | null; url: string | null } {
  const o = obj(v);
  const d = obj(o?.data) ?? obj(o?.post) ?? o;
  const id = typeof d?.id === 'string' && ID_RE.test(d.id) ? d.id : null;
  let url: string | null = null;
  for (const k of ['web_url', 'url', 'edit_url', 'preview_url']) {
    const raw = d?.[k];
    if (typeof raw !== 'string' || raw.length > 500) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' && !u.username && !u.password) { url = u.toString(); break; }
    } catch { /* not a URL: not kept */ }
  }
  return { id, url };
}

/** A failure before the draft request: no draft can exist. */
const before = (code: string, httpStatus: number | null = null) => new PublishError('not_created', code, { httpStatus });

/** Open the member's session; a 401 at open tries a refresh once. Every failure here is before the draft request. */
async function openSession(env: Env, row: IntegrationRow, fetcher?: McpFetch): Promise<McpSession> {
  // Reading the stored tokens, or refreshing them first, sends no draft: any
  // failure here is `not_created`, never an unknown outcome.
  let access: Awaited<ReturnType<typeof mcpAccessFor>>;
  try {
    const creds = await mcpCredentialsOf(env, BEEHIIV, row);
    if (!creds) throw before('not_connected');
    access = await mcpAccessFor(env, BEEHIIV, row, creds, { fetcher, preregistered: mcpPreregisteredFor(env, BEEHIIV) });
  } catch (e) {
    if (e instanceof PublishError) throw e;
    throw before('unauthorized');
  }
  const open = (token: string) => openMcpSession(BEEHIIV, { accessToken: token, fetcher: access.fetcher, resource: access.resource });
  const asBefore = (e: unknown) => {
    if (!(e instanceof McpClientError)) return before('unreachable');
    if (e.code === 'unauthorized' || e.code === 'scope_insufficient') return before('unauthorized', e.status);
    if (e.code === 'rate_limited') return before('rate_limited', e.status ?? 429);
    return before('unreachable', e.status);
  };
  try {
    return await open(access.accessToken);
  } catch (e) {
    if (!(e instanceof McpClientError && e.code === 'unauthorized')) throw asBefore(e);
    const fresh = await access.refresh().catch(() => null);
    if (!fresh) throw before('unauthorized', e.status);
    try { return await open(fresh); } catch (again) { throw asBefore(again); }
  }
}

/**
 * Create the draft the founder confirmed, once. `envelope` is PUBLISH's
 * stored envelope: its preview's own title and HTML are sent, after checking
 * they are what `renderDraft` makes of its text.
 */
export async function createBeehiivDraft(env: Env, row: IntegrationRow, envelope: { input: PublishInput; preview: PublishPreview },
  opts: { fetcher?: McpFetch } = {}): Promise<{ external_post_id: string; external_url: string | null }> {
  const publicationId = String(envelope?.input?.destination?.external_account_id ?? '');
  if (!ID_RE.test(publicationId)) throw before('no_publication');
  const title = field(envelope.preview, 'title');
  const html = field(envelope.preview, 'body_html');
  const fresh = renderDraft(envelope.input.text);
  if (title === null || html === null || title !== fresh.title || html !== fresh.body_html || !title || !html) throw before('content_changed');

  const session = await openSession(env, row, opts.fetcher);
  // Drafts need a paid Beehiiv plan: a server that does not offer the tool is never asked.
  if (!session.write_offered.includes(DRAFT_TOOL)) throw before('plan_required');
  let answer: unknown;
  try {
    // NO `status`: a draft, never a post. The ticket buys this one call.
    answer = await session.callTool(DRAFT_TOOL, { publication_id: publicationId, title, body_content: html }, mintMcpPublishTicket(BEEHIIV, DRAFT_TOOL));
  } catch (e) {
    if (e instanceof McpClientError) {
      if (e.code === 'path_not_allowed') throw before('plan_required');
      if (e.code === 'rate_limited') throw new PublishError('not_created', 'rate_limited', { httpStatus: e.status ?? 429 });
      if (e.code === 'unauthorized' || e.code === 'scope_insufficient') throw new PublishError('not_created', 'unauthorized', { httpStatus: e.status });
      // Beehiiv answered and refused the draft: a tool error (`isError`), a
      // JSON-RPC error in a 200, or a 4xx. A 5xx is not a refusal.
      if (e.code === 'http_error' && (e.status == null || e.status < 500)) throw new PublishError('not_created', 'rejected', { httpStatus: e.status });
    }
    // A timeout, a reset, a 5xx, a body too large or unreadable: a draft may exist.
    throw new PublishError('unknown', e instanceof McpClientError ? e.code : 'unknown', { httpStatus: e instanceof McpClientError ? e.status : null });
  }
  const { id, url } = draftResultOf(answer);
  // Beehiiv said yes but named no post: it may exist, so never sent again.
  if (!id) throw new PublishError('unknown', 'no_post_id');
  return { external_post_id: id, external_url: url };
}
