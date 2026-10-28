/** #3626: self-scoped module operations over the member's supplied material.
 * No project/user ids, business-record reads/writes or automatic actions.
 * Auth, preferences and billing metadata use the existing services. The common
 * router owns guarding, switches, budget holds, settlement and usage logs.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { resolveRail, resolveRailOption } from '../services/ai/railMatrix';
import { moduleConnections } from '../services/ai/moduleConnections';
import { pcmBytes, pcmMinutes, pcmWave, questionsValid } from '../services/ai/moduleShapes';
import { INDIC_FLORES, INDIC_TRANSLATION_MODEL, imagesRefusal } from '../services/ai/shapes';
import { run as runModuleModel, quoteRun, normaliseSurface, type RunOptions, type TaskClass } from '../services/aiRouter';

const modules = new Hono<{ Bindings: Env }>();
modules.use('*', bodyLimit({ maxSize: 7_000_000, onError: c => refuse(c, 413, { code: 'payload_too_large', message: 'That material is too large for one run.' }) }));
export function modulePageAllowed(user: { role: string; is_super_admin?: number | null }, page: string): boolean {
  const profile = page.split(' · ')[0];
  if (profile === 'Super Admin') return user.role === 'admin' && user.is_super_admin === 1;
  const profiles: Record<string, string> = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', admin: 'Admin' };
  // Match requireRole: admins may use View as; the charged id stays their own.
  return user.role === 'admin' ? Object.values(profiles).includes(profile) : profiles[user.role] === profile;
}
function bytes64(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
const invalid = (c: any, message: string) => refuse(c, 400, { code: 'invalid_input', message });

modules.get('/', async c => {
  const user = await requireAuth(c), row = resolveRail(c.req.query('page'));
  if (!row || !modulePageAllowed(user, row.pageKey)) return refuse(c, 403, { code: 'forbidden', message: 'That module is not available for this account.' });
  return c.json({ ok: true, page: row.pageKey, models: moduleConnections(row, c.env) });
});

/** POST /api/ai/modules/run (or /quote): page, model, text and the shape's inputs.
 * Authentication supplies the charged member; the body cannot choose one.
 */
for (const action of ['run', 'quote'] as const) modules.post(`/${action}`, async c => {
  const user = await requireAuth(c);
  const length = Number(c.req.header('content-length') || 0);
  if (length > 7_000_000) return invalid(c, 'That material is too large for one run.');
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 7_000_000) return invalid(c, 'That material is too large for one run.');
  let body: Record<string, any>;
  try { body = JSON.parse(raw); } catch { return invalid(c, 'Send a JSON object.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(c, 'Send a JSON object.');
  const row = resolveRail(body.page);
  if (!row || !modulePageAllowed(user, row.pageKey)) return refuse(c, 403, { code: 'forbidden', message: 'That module is not available for this account.' });
  const on = body.option == null ? row : resolveRailOption(row.pageKey, body.option);
  if (!on) return invalid(c, 'That option is not registered on this module.');
  const connection = moduleConnections(on, c.env).find(m => m.id === body.model);
  if (!connection) return refuse(c, 400, { code: 'model_not_offered', message: 'That model is not connected to this module.' });
  // Like the rail composer, retain the browser's page path for the spend view.
  // It is provenance only: role, member id and module access never come from it.
  const surface = normaliseSurface(body.surface);
  if (!surface) return invalid(c, 'Send the page address this material was selected on.');
  if (typeof body.text !== 'string' || body.text.length > 24_000) return invalid(c, 'Send up to 24,000 characters of material.');
  const images = body.images;
  if (images != null && (!Array.isArray(images) || imagesRefusal(images))) return invalid(c, 'Send bounded embedded images.');
  const operation = connection.operation;
  // Each operation has one input shape. An ignored field must not pretend it ran.
  const allowed = ['page', 'surface', 'option', 'model', 'text', ...(operation === 'chat' || operation === 'vision' || operation === 'image_labels' ? ['images'] : []),
    ...(operation === 'decision' ? ['questions'] : []), ...(operation === 'turn' || operation === 'transcribe' ? ['audio_pcm16'] : []),
    ...(operation === 'translate' ? ['source_language', 'target_language'] : []), ...(operation === 'rerank' ? ['contexts'] : []),
    ...(operation === 'voice' ? ['voice', 'language'] : [])];
  if (Object.keys(body).some(k => !allowed.includes(k))) return invalid(c, 'An input does not belong to this operation.');
  const opts: RunOptions = {
    task: `module_${operation}` as TaskClass,
    userId: user.id, model: connection.id, text: body.text, maxTokens: 1024, role: user.role,
    surface, rail: { page: row.pageKey, option: body.option ?? undefined },
    ...(images?.length ? { images } : {}),
  };
  if (operation === 'decision') {
    if (!questionsValid(body.questions)) return invalid(c, 'Send one to eight typed questions.');
    opts.specialist = { operation, questions: body.questions };
  } else if (operation === 'sentiment' || operation === 'image_labels') opts.specialist = { operation };
  else if (operation === 'turn' || operation === 'transcribe') {
    const pcm = pcmBytes(body.audio_pcm16);
    if (!pcm) return invalid(c, 'Send a bounded 16 kHz mono PCM16 audio excerpt.');
    opts.audioMinutes = pcmMinutes(pcm);
    if (operation === 'turn') opts.specialist = { operation, pcm16: body.audio_pcm16 };
    else { opts.audio = pcmWave(pcm); opts.audioMime = 'audio/wav'; }
  } else if (operation === 'translate') {
    opts.translate = { sourceLang: body.source_language, targetLang: body.target_language };
    if (connection.id === INDIC_TRANSLATION_MODEL && (body.source_language !== 'en' || !Object.hasOwn(INDIC_FLORES, body.target_language))) return invalid(c, 'This model translates English into a supported Indic language.');
  } else if (operation === 'rerank') opts.rerank = { query: body.text, contexts: body.contexts };
  else if (operation === 'voice') opts.speak = { voice: body.voice, lang: body.language };
  else if (operation === 'draw') opts.draw = {};
  else if (operation === 'vision' && images?.length !== 1) return invalid(c, 'Send one image and a question.');
  const result = action === 'quote' ? await quoteRun(c.env, { ...opts, surface })
    : await runModuleModel(c.env, { ...opts, surface, rail: opts.rail });
  if (action === 'quote' || !result.ok) return c.json(result as any, result.ok ? 200 : 422);
  const r = result as Awaited<ReturnType<typeof runModuleModel>>;
  return c.json({ ok: true, output: r.output ?? null, embedding: r.embedding ?? null, ranking: r.ranking ?? null,
    audio: r.audio ? { mime: r.audio.mime, data: bytes64(r.audio.bytes) } : null,
    image: r.image ? { mime: r.image.mime, data: bytes64(r.image.bytes), width: r.image.width, height: r.image.height } : null,
    usage: r.usage, units: r.units, guard: r.guard });
});
export default modules;
