/**
 * D856 (#2501, #2500) — the guided WhatsApp setup for Record a Session,
 * driven through Meta's WhatsApp Business Tools MCP (`MCP_PROVIDERS.
 * whatsapp_business`) on the shared client (D847). It ends in the same D684
 * connection row Embedded Signup writes (`storeWhatsAppConnection`), and
 * conversations keep arriving by the Cloud API webhook. Embedded Signup stays
 * the other way in.
 *
 * SIX STEPS, each one the founder presses:
 *   1. prerequisites  Meta's check: business admin, terms, payment method, verification
 *   2. number         the account's number, or the founder's pick of several
 *   3. register       the number registered for the Cloud API              (setup tool)
 *   4. webhook        Axal's app subscribed to the account's webhooks      (setup tool)
 *   5. template       the consent-notice template, in D754's words         (setup tool)
 *   6. connect        the D684 connection row
 *
 * Steps 3 to 6 change an account, so each needs the founder's confirm: the
 * route mints a one-time setup ticket for that step's tools only after it
 * (`mintMcpSetupTicket`), and the client refuses a setup tool without it.
 * Steps 1 and 2 only read. Adding a number, and Meta's OTP, stay in Meta's
 * own flow: no tool here creates an account, adds a number or sends a message.
 *
 * IDEMPOTENT AND RESUMABLE. Progress lives in the founder's own MCP sign-in
 * row (`integrations`, provider `whatsapp_business`, `config_json.setup`): ids,
 * the masked number and when each step finished. A finished step is not
 * called again (the template is looked for before it is created), a failed
 * step keeps its code and is pressed again, and another number of the same
 * account is registered and connected again (the account's subscription and
 * template carry over). The read (`readWhatsAppSetup`) never calls Meta.
 *
 * WHAT META ANSWERS IS DATA. Only the typed fields read below are used, and
 * only `=== true` passes a check: a field Meta does not send is not a pass.
 * Every field name is UNVERIFIED until the first live sign-in (D856.md §1).
 *
 * Nothing here logs or returns a token, a full phone number or Meta's own
 * text. A log line carries the step and its outcome code; a refusal carries a
 * code and our sentence.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { MCP_PROVIDERS, type McpProvider } from '../../integrations/mcpProviders';
import {
  MCP_AUTH_TYPE, McpClientError, mcpAccessFor, mcpCredentialsOf, openMcpSession,
  type McpFetch, type McpSession, type McpSetupTicket,
} from '../../integrations/mcpClient';
import { consentNoticeUrl, CONSENT_NOTICE_VERSION } from './consentNotice';
import { noticeText } from './consent';
import { maskNumber, storeWhatsAppConnection } from './whatsapp';

export const WA_SETUP_PROVIDER = 'whatsapp_business';

/** `WHATSAPP_MCP_SETUP`: on only when exactly "on"; off, the setup routes answer 404. */
export function whatsappMcpSetupOn(env: Pick<Env, 'WHATSAPP_MCP_SETUP'>): boolean {
  return String(env.WHATSAPP_MCP_SETUP ?? '').trim().toLowerCase() === 'on';
}
export const WA_SETUP_STEPS = ['prerequisites', 'number', 'register', 'webhook', 'template', 'connect'] as const;
export type WaSetupStep = typeof WA_SETUP_STEPS[number];

/** The setup tools each confirmed step may call, once each, on its ticket. */
export const WA_SETUP_TICKET_TOOLS: Readonly<Partial<Record<WaSetupStep, readonly string[]>>> = Object.freeze({
  register: Object.freeze(['register_phone_number']),
  webhook: Object.freeze(['subscribe_app']),
  template: Object.freeze(['create_message_template']),
});

/** What each step that changes an account says before the founder confirms it. */
export const WA_SETUP_CONFIRM: Readonly<Partial<Record<WaSetupStep, string>>> = Object.freeze({
  register: 'Register this number for WhatsApp’s Cloud API? Messages to it then reach your business through Meta’s Cloud API.',
  webhook: 'Subscribe Axal to this WhatsApp Business account? Meta then sends the account’s messages to Axal.',
  template: 'Create Axal’s consent notice as a message template in this WhatsApp Business account?',
  connect: 'Connect this number to Record a Session? Chats with your customers then arrive in Axal as pending conversations.',
});

/** The consent notice's template name: one per notice version. */
export const WA_CONSENT_TEMPLATE = `axal_consent_notice_v${CONSENT_NOTICE_VERSION}`;

/** Our sentence for each code a step can end in. */
export const WA_SETUP_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  not_signed_in: 'Sign in with Meta for WhatsApp Business first.',
  sign_in_again: 'Your Meta sign-in has expired. Sign in with Meta again; nothing was changed.',
  step_blocked: 'Finish the steps before this one first.',
  confirm_required: 'Confirm this step first; nothing was changed.',
  not_business_admin: 'Meta only lets an admin of this business set up WhatsApp. Ask an admin of the business in Meta Business Suite to do this step, or to make you an admin.',
  terms_not_accepted: 'Accept WhatsApp Business’s terms of service in Meta first, then check again.',
  payment_method_missing: 'Add a payment method to the WhatsApp Business account in Meta first, then check again.',
  business_not_verified: 'Meta has not verified this business yet. Finish Business Verification in Meta Business Suite, then check again.',
  no_business_account: 'Meta found no WhatsApp Business account for this business. Create one in Meta first, then check again.',
  check_prerequisites: 'Check that your business meets WhatsApp’s requirements.',
  no_number: 'Add your business number in WhatsApp Manager, where Meta checks it with a code, then press again.',
  choose_number: 'This WhatsApp Business account has more than one number. Choose the one your customers write to.',
  number_not_in_waba: 'That number is not part of this WhatsApp Business account.',
  pick_number: 'Choose your business number.',
  axal_number: "This is Axal's own WhatsApp number. Use your business's own number instead.",
  number_taken: 'This WhatsApp number is already connected to another Axal account.',
  register_number: 'Register your number for WhatsApp’s Cloud API.',
  subscribe_webhook: 'Subscribe Axal to your WhatsApp Business account.',
  create_template: 'Create Axal’s consent notice as a message template.',
  notice_link_missing: 'The public base URL is not set, so the consent notice has no link. Nothing was created.',
  connect_number: 'Connect your number to Record a Session.',
  tool_not_offered: 'Meta does not offer this step to Axal right now, so nothing was changed. Try again later, or connect with Embedded Signup instead.',
  meta_refused: 'Meta refused this step. Nothing was changed by Axal; check the account in Meta, then press again.',
  meta_unreachable: 'Meta could not be reached. Press again in a minute.',
  meta_busy: 'Meta asked Axal to slow down. Press again in a minute.',
  not_stored: 'The connection could not be saved. Press again.',
});
/** Our sentence for a setup code; an unknown code reads as Meta's refusal. */
export const waSetupSentence = (code: string) => WA_SETUP_SENTENCES[code] ?? WA_SETUP_SENTENCES.meta_refused;
const sentence = waSetupSentence;

/** What each step's `todo` asks of the founder. */
const TODO: Record<WaSetupStep, string> = {
  prerequisites: 'check_prerequisites', number: 'pick_number', register: 'register_number',
  webhook: 'subscribe_webhook', template: 'create_template', connect: 'connect_number',
};

/** What the sign-in row keeps: ids, the masked number and when each step finished. */
export interface WaSetupProgress {
  waba_id?: string;
  phone_number_id?: string;
  number_masked?: string | null;
  prerequisites_at?: string;
  number_at?: string;
  register_at?: string;
  webhook_at?: string;
  template_at?: string;
  connect_at?: string;
  failed?: { step: WaSetupStep; code: string };
}

export interface WaSetupStepView {
  step: number;
  key: WaSetupStep;
  state: 'done' | 'todo' | 'blocked';
  code: string;
  /** Our sentence; null once done. */
  action: string | null;
  /** What the confirm says, for a step that changes an account; else null. */
  confirm: string | null;
}

export interface WaSetupView {
  signed_in: boolean;
  number_masked: string | null;
  steps: WaSetupStepView[];
}

export class WaSetupError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(sentence(code));
    this.name = 'WaSetupError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const digits = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number') && /^\d{1,32}$/.test(String(v)) ? String(v) : null;
const now = () => new Date().toISOString();

function progressOf(row: Pick<IntegrationRow, 'config_json'> | null): WaSetupProgress {
  if (!row?.config_json) return {};
  try { return obj(obj(JSON.parse(row.config_json))?.setup) as WaSetupProgress ?? {}; } catch { return {}; }
}

/** The founder's active Meta sign-in for the setup, or null. */
async function signInRow(env: Env, userId: number): Promise<IntegrationRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM integrations WHERE user_id = ? AND provider_key = ? AND auth_type = ? AND status = 'active'`,
  ).bind(userId, WA_SETUP_PROVIDER, MCP_AUTH_TYPE).first<IntegrationRow>() ?? null;
}

async function saveProgress(env: Env, row: IntegrationRow, progress: WaSetupProgress): Promise<void> {
  let config: Record<string, unknown> = {};
  try { config = obj(JSON.parse(row.config_json || '{}')) ?? {}; } catch { config = {}; }
  const next = JSON.stringify({ ...config, setup: progress });
  await env.DB.prepare('UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .bind(next, row.id, row.user_id).run();
  row.config_json = next;
}

/** The six steps from what is stored; never calls Meta. */
export async function readWhatsAppSetup(env: Env, userId: number): Promise<WaSetupView> {
  const row = await signInRow(env, userId);
  const progress = progressOf(row);
  let open = !!row;
  const steps = WA_SETUP_STEPS.map((key, i): WaSetupStepView => {
    const confirm = WA_SETUP_CONFIRM[key] ?? null;
    if (!row) return { step: i + 1, key, state: 'blocked', code: 'not_signed_in', action: sentence('not_signed_in'), confirm };
    if (progress[`${key}_at`]) return { step: i + 1, key, state: 'done', code: 'done', action: null, confirm };
    if (!open) return { step: i + 1, key, state: 'blocked', code: 'step_blocked', action: sentence('step_blocked'), confirm };
    open = false;
    const code = progress.failed?.step === key ? progress.failed.code : TODO[key];
    return { step: i + 1, key, state: 'todo', code, action: sentence(code), confirm };
  });
  return { signed_in: !!row, number_masked: progress.number_masked ?? null, steps };
}

export interface WaSetupDeps {
  fetcher?: McpFetch;
  /** The record; a test may narrow it (pins). */
  provider?: McpProvider;
  log?: (line: string) => void;
}

/** A client failure, in our words. */
function fromClient(err: unknown): WaSetupError {
  if (err instanceof WaSetupError) return err;
  if (err instanceof McpClientError) {
    if (err.code === 'unauthorized' && err.status === 403) return new WaSetupError('not_business_admin', 403);
    if (err.code === 'unauthorized' || err.code === 'scope_insufficient') return new WaSetupError('sign_in_again', 409);
    if (err.code === 'path_not_allowed') return new WaSetupError('tool_not_offered', 409);
    if (err.code === 'rate_limited') return new WaSetupError('meta_busy', 503);
    if (err.code === 'timeout' || err.code === 'network_error') return new WaSetupError('meta_unreachable', 503);
    return new WaSetupError('meta_refused', 502);
  }
  throw err;
}

interface Numbered { id: string; number: Record<string, unknown> }

/** The account's numbers, from `list_phone_numbers`: ids only are trusted. */
async function numbersOf(session: McpSession, wabaId: string): Promise<Numbered[]> {
  const data = obj(await session.callTool('list_phone_numbers', { waba_id: wabaId }));
  const list = Array.isArray(data?.phone_numbers) ? data!.phone_numbers as unknown[] : [];
  return list.map(obj).flatMap((n) => {
    const id = digits(n?.id);
    return id && n ? [{ id, number: n }] : [];
  });
}

const offers = (session: McpSession, tool: string) => session.offered.includes(tool) || session.setup_offered.includes(tool);

/**
 * Run one step for the founder. A step whose finish is stored answers done
 * without calling Meta. `ticket` is the route's, minted after the confirm,
 * for this step's tools only. A refusal is a `WaSetupError` and is kept on
 * the row, so the read shows it until the step is pressed again.
 */
export async function runWhatsAppSetupStep(
  env: Env, userId: number, step: WaSetupStep,
  input: { phone_number_id?: string | null; ticket?: McpSetupTicket },
  deps: WaSetupDeps = {},
): Promise<{ step: WaSetupStep; state: 'done'; number_masked: string | null; connection?: { external_account_name: string | null } }> {
  const provider = deps.provider ?? MCP_PROVIDERS[WA_SETUP_PROVIDER];
  const log = deps.log ?? ((line: string) => console.log(line));
  const row = await signInRow(env, userId);
  if (!row) throw new WaSetupError('not_signed_in', 409);
  const progress = progressOf(row);
  const index = WA_SETUP_STEPS.indexOf(step);
  if (WA_SETUP_STEPS.slice(0, index).some((k) => !progress[`${k}_at`])) throw new WaSetupError('step_blocked', 409);

  const outcome = (code: string) => log(JSON.stringify({ event: 'whatsapp_mcp_setup', step, outcome: code }));
  // A finished step is not called again; choosing another number is the one way back.
  if (progress[`${step}_at`] && !(step === 'number' && input.phone_number_id && input.phone_number_id !== progress.phone_number_id)) {
    outcome('already_done');
    return { step, state: 'done', number_masked: progress.number_masked ?? null };
  }

  try {
    const creds = await mcpCredentialsOf(env, provider, row);
    if (!creds) throw new WaSetupError('sign_in_again', 409);
    const access = await mcpAccessFor(env, provider, row, creds, { fetcher: deps.fetcher });
    const era = (() => { try { const e = obj(JSON.parse(row.config_json || '{}'))?.era; return e === 'legacy' || e === 'modern' ? e : undefined; } catch { return undefined; } })();
    const session = await openMcpSession(provider, { accessToken: access.accessToken, fetcher: deps.fetcher, resource: access.resource, era, log });
    const need = (tool: string) => { if (!offers(session, tool)) throw new WaSetupError('tool_not_offered', 409); };
    const next: WaSetupProgress = { ...progress };
    delete next.failed;
    let connection: { external_account_name: string | null } | undefined;

    if (step === 'prerequisites') {
      need('check_prerequisites');
      const p = obj(await session.callTool('check_prerequisites', {})) ?? {};
      if (p.business_admin !== true) throw new WaSetupError('not_business_admin', 403);
      if (p.terms_accepted !== true) throw new WaSetupError('terms_not_accepted', 409);
      if (p.payment_method !== true) throw new WaSetupError('payment_method_missing', 409);
      if (p.business_verified !== true) throw new WaSetupError('business_not_verified', 409);
      const waba = digits(p.waba_id);
      if (!waba) throw new WaSetupError('no_business_account', 409);
      next.waba_id = waba;
    } else if (step === 'number') {
      need('list_phone_numbers');
      const listed = await numbersOf(session, progress.waba_id!);
      const wanted = input.phone_number_id ? digits(input.phone_number_id) : null;
      if (input.phone_number_id && !wanted) throw new WaSetupError('number_not_in_waba', 400);
      if (!wanted && listed.length === 0) throw new WaSetupError('no_number', 409);
      if (!wanted && listed.length > 1) {
        throw new WaSetupError('choose_number', 409, { numbers: listed.map((n) => ({ phone_number_id: n.id, number_masked: maskNumber(n.number.display_phone_number) })) });
      }
      const chosen = wanted ? listed.find((n) => n.id === wanted) : listed[0];
      if (!chosen) throw new WaSetupError('number_not_in_waba', 400);
      const axalNumber = String(env.WHATSAPP_AXAL_PHONE_NUMBER_ID ?? '').trim();
      const axalWaba = String(env.WHATSAPP_AXAL_WABA_ID ?? '').trim();
      if ((axalNumber && chosen.id === axalNumber) || (axalWaba && progress.waba_id === axalWaba)) throw new WaSetupError('axal_number', 409);
      const taken = await env.DB.prepare(
        `SELECT 1 AS t FROM integrations WHERE provider_key = 'whatsapp' AND external_account_id = ? AND status = 'active' AND user_id != ?`,
      ).bind(chosen.id, userId).first<{ t: number }>();
      if (taken) throw new WaSetupError('number_taken', 409);
      if (chosen.id !== progress.phone_number_id) {
        // Another number of the same account: its registration and connection
        // start again; the account's subscription and template carry over.
        for (const k of ['register_at', 'connect_at'] as const) delete next[k];
      }
      next.phone_number_id = chosen.id;
      next.number_masked = maskNumber(chosen.number.display_phone_number);
    } else if (step === 'register') {
      need('register_phone_number');
      await session.callTool('register_phone_number', { phone_number_id: progress.phone_number_id }, input.ticket);
    } else if (step === 'webhook') {
      need('subscribe_app');
      await session.callTool('subscribe_app', { waba_id: progress.waba_id }, input.ticket);
    } else if (step === 'template') {
      need('list_message_templates');
      const listed = obj(await session.callTool('list_message_templates', { waba_id: progress.waba_id }));
      const names = (Array.isArray(listed?.templates) ? listed!.templates as unknown[] : []).map((t) => obj(t)?.name);
      if (!names.includes(WA_CONSENT_TEMPLATE)) {
        const url = consentNoticeUrl(env);
        if (!url) throw new WaSetupError('notice_link_missing', 503);
        need('create_message_template');
        await session.callTool('create_message_template', {
          waba_id: progress.waba_id,
          name: WA_CONSENT_TEMPLATE,
          language: 'en',
          category: 'UTILITY',
          body: noticeText(CONSENT_NOTICE_VERSION, { firstName: '{{1}}', venture: '{{2}}', url }),
          quick_replies: ['Yes', 'No'],
        }, input.ticket);
      }
    } else {
      need('list_phone_numbers');
      const number = (await numbersOf(session, progress.waba_id!)).find((n) => n.id === progress.phone_number_id);
      if (!number) throw new WaSetupError('number_not_in_waba', 409);
      const stored = await storeWhatsAppConnection(env, userId, {
        wabaId: progress.waba_id!, phoneNumberId: number.id, number: number.number, token: access.accessToken,
      });
      if (!stored.ok) throw new WaSetupError(stored.code === 'number_taken' ? 'number_taken' : 'not_stored', stored.status);
      connection = { external_account_name: stored.name };
    }

    next[`${step}_at`] = now();
    await saveProgress(env, row, next);
    outcome('done');
    return { step, state: 'done', number_masked: next.number_masked ?? null, ...(connection ? { connection } : {}) };
  } catch (err) {
    const refusal = fromClient(err);
    await saveProgress(env, row, { ...progress, failed: { step, code: refusal.code } });
    outcome(refusal.code);
    throw refusal;
  }
}
