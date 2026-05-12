/**
 * Task #5 (AV) — Find & deep-link tool registry.
 *
 * Twelve tools that return a uniform `{ result, cta: { label, route, primary,
 * secondary? } }` envelope. The chat client renders the CTA inline so the
 * user reaches the right page in a single click.
 *
 * Wiring:
 *   - Persona / tier / rate / cost / arg-shape gating is delegated to AW's
 *     `gateToolCall` (see guardrails.ts). The /api/advisor/tool route runs
 *     the gate before invoking executeTool() here.
 *   - Search-flavoured tools (findMentor / findInvestor / findPartner /
 *     findDeal) are backed by the `axal-search` Vectorize index via
 *     services/vectorize.searchSemantic.
 *   - Tier-gated tools (findInvestor, startContract,
 *     draftCofounderAgreement) fall back to `surfacePaywall` when the
 *     tier check fails — the LLM never sees a raw refusal, just an
 *     upgrade-CTA result.
 *
 * Output contract — every tool resolves to:
 *   {
 *     result: <plain JSON describing the answer>,
 *     cta: { label, route, primary: { label, route }, secondary?: { label, route } }
 *   }
 *
 * The `route` field is always a relative app-router path (e.g.
 * `/mentorship?mentor=42`); never an external URL. The chat row component
 * renders `cta.primary` as the highlighted button and `cta.secondary` as a
 * ghost button beneath it.
 */
import type { Env, User } from '../../types';
import { searchSemantic, type SearchHit, type EntityType } from '../vectorize';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface CtaButton {
  label: string;
  route: string;
}

export interface ToolCta {
  label: string;
  route: string;
  primary: CtaButton;
  secondary?: CtaButton;
}

export interface ToolEnvelope {
  result: unknown;
  cta: ToolCta;
}

export interface ToolContext {
  env: Env;
  user: User;
  persona: string;
  tiers: Set<string>;
  conversationId: number | null;
}

export type ToolName =
  | 'findMentor'
  | 'findInvestor'
  | 'findPartner'
  | 'findDeal'
  | 'openPage'
  | 'startContract'
  | 'bookOfficeHours'
  | 'exploreDocs'
  | 'draftCofounderAgreement'
  | 'scheduleMeeting'
  | 'listMyTasks'
  | 'surfacePaywall';

export const ALL_TOOL_NAMES: ToolName[] = [
  'findMentor', 'findInvestor', 'findPartner', 'findDeal',
  'openPage', 'startContract', 'bookOfficeHours', 'exploreDocs',
  'draftCofounderAgreement', 'scheduleMeeting', 'listMyTasks',
  'surfacePaywall',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function asString(v: unknown, max = 500): string {
  if (v == null) return '';
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function asPositiveInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Allow-list of route paths used by openPage. Mirrors the `pageLabel`
 * map in `frontend/src/lib/advisor/router.js` plus the tool-specific
 * destinations below. Keeps the LLM from inventing routes that 404.
 */
const PAGE_ALLOWLIST: Record<string, string> = {
  '/projects': 'Projects',
  '/build/discovery': 'Discovery',
  '/build/roadmap': 'Roadmap',
  '/build/brand': 'Brand',
  '/build/deck': 'Pitch Deck',
  '/network': 'Network',
  '/onboarding/persona': 'Persona',
  '/matches': 'AI Matches',
  '/portfolio': 'Portfolio',
  '/mentorship': 'Mentorship',
  '/partners': 'Partners',
  '/legal-capital': 'Legal & Capital',
  '/compliance': 'Compliance',
  '/docs': 'Docs',
  '/calendar': 'Calendar',
  '/billing': 'Billing',
  '/dashboard': 'Dashboard',
};

function isAllowedRoute(path: string): boolean {
  if (!path || !path.startsWith('/')) return false;
  // Strip query/hash before matching against the allowlist.
  const base = path.split(/[?#]/)[0];
  return base in PAGE_ALLOWLIST
    || Object.keys(PAGE_ALLOWLIST).some((p) => base === p || base.startsWith(p + '/'));
}

function pageLabel(route: string): string {
  const base = route.split(/[?#]/)[0];
  return PAGE_ALLOWLIST[base]
    || Object.entries(PAGE_ALLOWLIST).find(([p]) => base.startsWith(p + '/'))?.[1]
    || base;
}

// ---------------------------------------------------------------------------
// Search-backed tools
// ---------------------------------------------------------------------------
async function searchByType(
  env: Env, query: string, type: EntityType, topK: number,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  return searchSemantic(env, query, { type, topK: Math.max(1, Math.min(20, topK)) });
}

function hitsToResult(hits: SearchHit[]) {
  return hits.map((h) => ({
    id: h.entity_id,
    title: h.title,
    snippet: h.snippet,
    route: h.url,
    score: Number(h.score.toFixed(4)),
  }));
}

async function findMentor(ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const query = asString(args?.query || args?.q || args?.expertise || '');
  const limit = asPositiveInt(args?.limit) || 5;
  const hits = await searchByType(ctx.env, query, 'mentor', limit);
  const result = { query, count: hits.length, mentors: hitsToResult(hits) };
  const top = hits[0];
  const cta: ToolCta = top
    ? {
        label: `Open ${top.title}`,
        route: top.url || '/mentorship',
        primary: { label: `Open ${top.title}`, route: top.url || '/mentorship' },
        secondary: { label: 'Browse all mentors', route: '/mentorship' },
      }
    : {
        label: 'Browse mentors',
        route: '/mentorship',
        primary: { label: 'Browse mentors', route: '/mentorship' },
      };
  return { result, cta };
}

async function findInvestor(ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const query = asString(args?.query || args?.q || args?.thesis || '');
  const limit = asPositiveInt(args?.limit) || 5;
  const hits = await searchByType(ctx.env, query, 'investor', limit);
  const result = { query, count: hits.length, investors: hitsToResult(hits) };
  const top = hits[0];
  const cta: ToolCta = top
    ? {
        label: `Open ${top.title}`,
        route: top.url || '/network',
        primary: { label: `Open ${top.title}`, route: top.url || '/network' },
        secondary: { label: 'Browse all investors', route: '/network' },
      }
    : {
        label: 'Browse investors',
        route: '/network',
        primary: { label: 'Browse investors', route: '/network' },
      };
  return { result, cta };
}

async function findPartner(ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const query = asString(args?.query || args?.q || '');
  const limit = asPositiveInt(args?.limit) || 5;
  const hits = await searchByType(ctx.env, query, 'partner', limit);
  const result = { query, count: hits.length, partners: hitsToResult(hits) };
  const top = hits[0];
  const cta: ToolCta = top
    ? {
        label: `Open ${top.title}`,
        route: top.url || '/partners',
        primary: { label: `Open ${top.title}`, route: top.url || '/partners' },
        secondary: { label: 'Browse all partners', route: '/partners' },
      }
    : {
        label: 'Browse partners',
        route: '/partners',
        primary: { label: 'Browse partners', route: '/partners' },
      };
  return { result, cta };
}

async function findDeal(ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const query = asString(args?.query || args?.q || '');
  const limit = asPositiveInt(args?.limit) || 5;
  const hits = await searchByType(ctx.env, query, 'deal', limit);
  const result = { query, count: hits.length, deals: hitsToResult(hits) };
  const top = hits[0];
  const cta: ToolCta = top
    ? {
        label: `Open ${top.title}`,
        route: top.url || '/projects',
        primary: { label: `Open ${top.title}`, route: top.url || '/projects' },
        secondary: { label: 'See all deals', route: '/projects' },
      }
    : {
        label: 'Browse deals',
        route: '/projects',
        primary: { label: 'Browse deals', route: '/projects' },
      };
  return { result, cta };
}

// ---------------------------------------------------------------------------
// Deterministic deep-link tools
// ---------------------------------------------------------------------------
async function openPage(_ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const route = asString(args?.route || args?.path || '/dashboard', 200);
  if (!isAllowedRoute(route)) {
    // Refuse silently — fall back to dashboard so the LLM cannot route the
    // user to an arbitrary URL via a manufactured argument.
    return openPage(_ctx, { route: '/dashboard' });
  }
  const label = `Open ${pageLabel(route)}`;
  return {
    result: { route, page: pageLabel(route) },
    cta: { label, route, primary: { label, route } },
  };
}

async function startContract(ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const template = asString(args?.template || 'safe', 64);
  const counterparty = asString(args?.counterparty || args?.party || '', 200);
  const dealId = asPositiveInt(args?.deal_id);
  const params = new URLSearchParams();
  params.set('template', template);
  if (counterparty) params.set('counterparty', counterparty);
  if (dealId) params.set('deal_id', String(dealId));
  const route = `/legal-capital?${params.toString()}`;
  const label = `Draft ${template.toUpperCase()}`;
  return {
    result: { template, counterparty, deal_id: dealId, prefilled: true },
    cta: {
      label, route,
      primary: { label, route },
      secondary: { label: 'See all contracts', route: '/legal-capital' },
    },
  };
}

async function bookOfficeHours(_ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const mentorId = asPositiveInt(args?.mentor_id || args?.id);
  const slotId = asPositiveInt(args?.slot_id);
  const params = new URLSearchParams();
  if (mentorId) params.set('mentor', String(mentorId));
  if (slotId) params.set('slot', String(slotId));
  params.set('book', '1');
  const route = `/mentorship?${params.toString()}`;
  const label = mentorId ? `Book mentor #${mentorId}` : 'Book office hours';
  return {
    result: { mentor_id: mentorId, slot_id: slotId },
    cta: {
      label, route,
      primary: { label, route },
      secondary: { label: 'Find a different mentor', route: '/mentorship' },
    },
  };
}

async function exploreDocs(_ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const anchor = asString(args?.anchor || args?.topic || '', 200)
    .replace(/[^a-zA-Z0-9/_-]/g, '');
  const route = anchor ? `/docs/${anchor}` : '/docs';
  const label = anchor ? `Read “${anchor}”` : 'Open docs';
  return {
    result: { anchor: anchor || null },
    cta: {
      label, route,
      primary: { label, route },
      secondary: anchor ? { label: 'Browse all docs', route: '/docs' } : undefined,
    },
  };
}

async function draftCofounderAgreement(_ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const cofounderEmail = asString(args?.cofounder_email || '', 200);
  const equityPct = asPositiveInt(args?.equity_pct);
  const params = new URLSearchParams();
  params.set('template', 'cofounder');
  if (cofounderEmail) params.set('cofounder_email', cofounderEmail);
  if (equityPct) params.set('equity_pct', String(equityPct));
  const route = `/legal-capital?${params.toString()}`;
  const label = 'Draft cofounder agreement';
  return {
    result: { template: 'cofounder', cofounder_email: cofounderEmail || null, equity_pct: equityPct },
    cta: {
      label, route,
      primary: { label, route },
      secondary: { label: 'See all templates', route: '/legal-capital' },
    },
  };
}

async function scheduleMeeting(_ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const attendee = asString(args?.attendee || args?.with || '', 200);
  const subject = asString(args?.subject || args?.title || '', 200);
  const startsAt = asString(args?.starts_at || '', 64);
  const params = new URLSearchParams();
  params.set('compose', '1');
  if (attendee) params.set('attendee', attendee);
  if (subject) params.set('subject', subject);
  if (startsAt) params.set('starts_at', startsAt);
  const route = `/calendar?${params.toString()}`;
  const label = attendee ? `Schedule with ${attendee}` : 'Open calendar';
  return {
    result: { attendee, subject, starts_at: startsAt || null },
    cta: {
      label, route,
      primary: { label, route },
      secondary: { label: 'View full calendar', route: '/calendar' },
    },
  };
}

async function listMyTasks(ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const limit = Math.max(1, Math.min(20, asPositiveInt(args?.limit) || 5));
  let tasks: Array<{ id: number; title: string; due_at: string | null; status: string }> = [];
  try {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, title, due_at, status
         FROM compliance_tasks
        WHERE user_id = ? AND status IN ('pending','in_progress','overdue')
        ORDER BY (due_at IS NULL), due_at ASC, id ASC
        LIMIT ?`,
    ).bind(ctx.user.id, limit).all<any>();
    tasks = (rows.results || []).map((r) => ({
      id: Number(r.id),
      title: String(r.title || ''),
      due_at: r.due_at || null,
      status: String(r.status || 'pending'),
    }));
  } catch (e) {
    // Table may not exist on a dev DB — degrade gracefully.
    console.warn('[advisor.tools] listMyTasks:', (e as Error).message);
  }
  const top = tasks[0];
  const route = top ? `/compliance?task=${top.id}` : '/compliance';
  const label = top ? `Open “${top.title}”` : 'Open compliance';
  return {
    result: { count: tasks.length, tasks },
    cta: {
      label, route,
      primary: { label, route },
      secondary: tasks.length ? { label: 'See all tasks', route: '/compliance' } : undefined,
    },
  };
}

async function surfacePaywall(_ctx: ToolContext, args: any): Promise<ToolEnvelope> {
  const feature = asString(args?.feature || args?.gated_tool || 'studio', 64);
  const tier = asString(args?.required_tier || 'studio', 32);
  const route = `/billing/upgrade?feature=${encodeURIComponent(feature)}&tier=${encodeURIComponent(tier)}`;
  const label = `Upgrade to ${tier === 'investor_pro' ? 'Investor Pro' : 'Studio'}`;
  return {
    result: { feature, required_tier: tier, gated: true },
    cta: {
      label, route,
      primary: { label, route },
      secondary: { label: 'Compare plans', route: '/billing' },
    },
  };
}

// ---------------------------------------------------------------------------
// Registry + dispatcher
// ---------------------------------------------------------------------------
type ToolFn = (ctx: ToolContext, args: any) => Promise<ToolEnvelope>;

export const TOOL_REGISTRY: Record<ToolName, ToolFn> = {
  findMentor,
  findInvestor,
  findPartner,
  findDeal,
  openPage,
  startContract,
  bookOfficeHours,
  exploreDocs,
  draftCofounderAgreement,
  scheduleMeeting,
  listMyTasks,
  surfacePaywall,
};

export function isToolName(s: string): s is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, s);
}

/**
 * JSON schemas surfaced to the LLM via aiRouter.run({task:'tool_call'}).
 * Kept compact — the LLM picks the tool name + assembles args; the
 * dispatcher re-validates everything against the schema below before
 * executing.
 */
export const TOOL_SCHEMAS: Array<{ name: ToolName; description: string; parameters: any }> = [
  {
    name: 'findMentor',
    description: 'Find a mentor by topic or expertise (e.g. "fundraising", "B2B GTM").',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'findInvestor',
    description: 'Find an investor matching a thesis, sector, or stage. Studio tier required.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'findPartner',
    description: 'Find a service partner (legal, accounting, design, etc.).',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'findDeal',
    description: 'Find a deal in the pipeline by sector, stage, or company name (investor / partner / admin).',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'openPage',
    description: 'Deep-link the user to a specific app page. The route MUST be one of the allow-listed paths.',
    parameters: { type: 'object', properties: { route: { type: 'string' } }, required: ['route'] },
  },
  {
    name: 'startContract',
    description: 'Pre-fill a contract draft (template defaults to "safe"). Studio tier required.',
    parameters: { type: 'object', properties: { template: { type: 'string' }, counterparty: { type: 'string' }, deal_id: { type: 'number' } } },
  },
  {
    name: 'bookOfficeHours',
    description: 'Open the office-hours booking flow for a specific mentor.',
    parameters: { type: 'object', properties: { mentor_id: { type: 'number' }, slot_id: { type: 'number' } } },
  },
  {
    name: 'exploreDocs',
    description: 'Open a doc anchor (e.g. "fundraising/safe-vs-priced").',
    parameters: { type: 'object', properties: { anchor: { type: 'string' } } },
  },
  {
    name: 'draftCofounderAgreement',
    description: 'Pre-fill a cofounder agreement draft. Studio tier required.',
    parameters: { type: 'object', properties: { cofounder_email: { type: 'string' }, equity_pct: { type: 'number' } } },
  },
  {
    name: 'scheduleMeeting',
    description: 'Open the calendar composer with optional attendee + subject + start time.',
    parameters: { type: 'object', properties: { attendee: { type: 'string' }, subject: { type: 'string' }, starts_at: { type: 'string' } } },
  },
  {
    name: 'listMyTasks',
    description: "List the user's open compliance tasks.",
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'surfacePaywall',
    description: 'Surface an upgrade CTA when a free-tier user requested a paid feature.',
    parameters: { type: 'object', properties: { feature: { type: 'string' }, required_tier: { type: 'string' } } },
  },
];

/** Execute a tool by name. Caller MUST run gateToolCall first. */
export async function executeTool(
  ctx: ToolContext, name: ToolName, args: unknown,
): Promise<ToolEnvelope> {
  const fn = TOOL_REGISTRY[name];
  if (!fn) throw new Error(`unknown tool: ${name}`);
  return fn(ctx, args && typeof args === 'object' ? args : {});
}
