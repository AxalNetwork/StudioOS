/**
 * D1588 (#3835, deck v2 F9) — the deck and raise tools, for an MCP client and
 * for Eadwyn (which lists the same registry, `services/eadwynTools.ts`).
 *
 *   decks.read_outline     (raise:read)  the deck's cards and their areas, by grid block range
 *   decks.propose_area     (raise:write) new words for one text area → a card edit waiting on the deck's Ask
 *   decks.propose_variant  (raise:write) a variant of the whole deck → the deck proposal, Keep or Discard
 *   raise.prospect_brief   (raise:read)  D1585's brief for one investor meeting
 *   raise.qa_prep          (raise:read)  the questions to prepare, from the objections logged, with answers
 *   raise.draft_follow_up  (raise:write) a follow-up the caller wrote → a draft in Email, never sent
 *
 * Every write tool PROPOSES (`proposes: true`): its run leaves a proposal or a
 * draft in a store the founder already decides from, and answers it with
 * `saved: false`. None saves a deck version, a card, a prospect or an email.
 * There is no chat or thread tool here (plan §0, §4.4–4.5).
 *
 * Each takes the company (the venture) and is refused for anyone but the
 * venture's own founders (`ownVenture`), whatever the grant's read allows.
 */
import { z } from 'zod';
import type { User } from '../../types';
import type { McpTool, ToolRun } from '../server';
import { ToolError } from '../../services/assistantInterviews';
import {
  AREA_ACTIONS, DeckToolError, VARIANT_EDITS_MAX, draftFollowUp, ownVenture, proposeArea, proposeVariant, qaPrep, readOutline, readProspectBrief,
} from '../../services/decks/eadwynDeckTools';

const COMPANY = z.number().int().positive().describe('The company id, from list_companies');
const DECK = z.number().int().positive().optional().describe('A deck version id; the current version when left out');
const CARD = z.union([z.string().min(1).max(40), z.number().int().positive()]).describe('The card: its uid, or its number from the outline (1 is the first)');
const AREA = z.object({
  c1: z.number().int(), c2: z.number().int(), r1: z.number().int(), r2: z.number().int(),
}).describe('The area as a block range on the 12 × 6 grid: columns c1–c2 (1–12), rows r1–r2 (1–6), from the outline');
const WORDS = z.string().min(1).max(4000).describe('The words to propose. No figures: a deck’s figures come from its records');
const PROSPECT = z.number().int().positive().describe('The investor (a Capital relationships prospect id)');

/** The tool's own refusals, as the server answers a refused tool (status, code, sentence). */
async function guarded<T>(r: ToolRun, fn: (projectId: number, userId: number) => Promise<T>): Promise<T> {
  const user = r.user as unknown as User;
  try {
    await ownVenture(r.env, user, r.company!.id);
    return await fn(r.company!.id, Number(user.id));
  } catch (e) {
    if (e instanceof DeckToolError) throw new ToolError(e.status, e.code, e.sentence);
    throw e;
  }
}

const base = { source: 'axal' as const, version: '1.0.0', company: true };

export const DECK_TOOLS: McpTool[] = [
  {
    ...base,
    name: 'decks.read_outline',
    requiredScope: 'raise:read',
    title: 'Read a deck’s outline',
    description: 'Read one venture’s pitch deck: each card with its number, uid and title, and each area on the card as a block range on the 12 × 6 grid (c1–c2, r1–r2) with its kind and, for text, its words. Use the ranges to propose changes.',
    inputSchema: { company: COMPANY, deck: DECK },
    run: (r) => guarded(r, (pid) => readOutline(r.env, pid, (r.args.deck as number | undefined) ?? null)),
  },
  {
    ...base,
    name: 'decks.propose_area',
    requiredScope: 'raise:write',
    readOnly: false,
    proposes: true,
    title: 'Propose new words for one deck area',
    description: 'Propose new words for one text area of a card, named by its block range from decks.read_outline. Nothing changes on the deck: the proposal waits on the deck’s Ask until the founder accepts or discards it. Words that name a figure are refused.',
    inputSchema: {
      company: COMPANY, deck: DECK, card: CARD, area: AREA, text: WORDS,
      action: z.enum(AREA_ACTIONS as unknown as [string, ...string[]]).optional().describe('What the change is: rewrite (default), shorten, expand or tone'),
    },
    run: (r) => guarded(r, (pid, uid) => proposeArea(r.env, uid, pid, {
      deck: (r.args.deck as number | undefined) ?? null, card: r.args.card, area: r.args.area, text: r.args.text,
      action: (r.args.action as any) ?? null, tool: 'decks.propose_area',
    })),
  },
  {
    ...base,
    name: 'decks.propose_variant',
    requiredScope: 'raise:write',
    readOnly: false,
    proposes: true,
    title: 'Propose a variant of the whole deck',
    description: 'Propose a variant of the deck: new words in up to 20 text areas, a new card order, or both. Nothing changes on the deck: the variant waits as the deck’s proposal until the founder keeps or discards it. Refused while another deck proposal is waiting, and for words that name a figure.',
    inputSchema: {
      company: COMPANY, deck: DECK,
      edits: z.array(z.object({ card: CARD, area: AREA, text: WORDS })).max(VARIANT_EDITS_MAX).optional(),
      order: z.array(CARD).max(60).optional().describe('Every card once, in the new order'),
      title: z.string().max(120).optional(),
    },
    run: (r) => guarded(r, (pid, uid) => proposeVariant(r.env, uid, pid, {
      deck: (r.args.deck as number | undefined) ?? null, edits: (r.args.edits as any[]) ?? null, order: (r.args.order as unknown[]) ?? null, title: (r.args.title as string) ?? null,
    })),
  },
  {
    ...base,
    name: 'raise.prospect_brief',
    requiredScope: 'raise:read',
    title: 'Read the brief for an investor meeting',
    description: 'Read the brief for one investor: who they are and where they stand, the meeting, the last time you met, the latest steps, their deck links with views and signals, and their objections first. Read from your records; no model runs and no email address is returned.',
    inputSchema: { company: COMPANY, prospect: PROSPECT, event: z.number().int().positive().optional().describe('The meeting being prepared, when known') },
    run: (r) => guarded(r, (pid) => readProspectBrief(r.env, pid, r.args.prospect as number, (r.args.event as number | undefined) ?? null)),
  },
  {
    ...base,
    name: 'raise.qa_prep',
    requiredScope: 'raise:read',
    title: 'Prepare for investor questions',
    description: 'The questions to prepare for: the objections the venture logged, the ones this investor raised first, each with the answer the founder recorded or null. No model runs.',
    inputSchema: { company: COMPANY, prospect: PROSPECT.optional() },
    run: (r) => guarded(r, (pid) => qaPrep(r.env, pid, (r.args.prospect as number | undefined) ?? null)),
  },
  {
    ...base,
    name: 'raise.draft_follow_up',
    requiredScope: 'raise:write',
    readOnly: false,
    proposes: true,
    title: 'Draft a follow-up to an investor',
    description: 'Keep a follow-up email you wrote to one investor as a draft in Email, for the founder to edit and send. Nothing is sent. Words that name a figure are refused.',
    inputSchema: {
      company: COMPANY, prospect: PROSPECT,
      subject: z.string().min(1).max(200), body: z.string().min(1).max(6000),
    },
    run: (r) => guarded(r, (pid, uid) => draftFollowUp(r.env, uid, pid, { prospect: r.args.prospect as number, subject: r.args.subject, body: r.args.body })),
  },
];
