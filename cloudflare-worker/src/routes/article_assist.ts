/**
 * D1409 (#3695) — Eadwyn's writing options in the article editor, and its
 * images.
 *
 *   POST /api/articles/:id/assist/quote   { option, input }
 *        → { option, ai: true, hold_microusd, model } | { option, ai: false, reason, message }
 *   POST /api/articles/:id/assist         (the same body)
 *        → { proposal, option, cost: { charged_microusd | null, usage_log_id } }
 *   POST /api/articles/:id/images/quote   { prompt, style, aspect, count }
 *        → { ai: true, model, model_label, per_image_microusd, count, total_microusd, balance: { ok, code?, message? } }
 *          | { ai: false, reason, message }
 *   POST /api/articles/:id/images/generate  (the same body) → { images: [image], stopped? }
 *   POST /api/articles/:id/images/:uid/discard → { ok: true, uid, deleted }
 *
 * `option` is one of `ARTICLE_OPTION_KEYS` (services/articleAssist.ts). Each
 * press runs once through `run()` as that rail option on "<Profile> · Articles",
 * is charged to the member who pressed, and leaves one `ai_rail_proposals` row.
 * Nothing here writes the article: Insert, Replace and Accept go through
 * `POST /api/ai/rail/proposals/:uid/decide`, and the editor's `PUT
 * /api/articles/:id` saves.
 *
 * THE GATE, in order: signed in; the article's author or an admin
 * (`loadOwned`, else 404 `not_found_or_forbidden`); not published (409
 * `already_published`); not a support session (403 `support_session_refused`).
 * A run's refusals answer as every rail press does (`refuseRun`): 402 for a
 * budget stop, 403 for the switch or a pause, 422 for the guard.
 *
 * IMAGES (part 2). Each image is one run() of the `article_image` task
 * (FLUX.1 Schnell) on the rail option `draft:article-image`, charged to the
 * member who pressed. Its bytes are stored at `articles/<id>/img-<uuid>.<ext>`
 * and read through `articles.ts`'s `GET /:id/image/:filename`, at an absolute
 * URL; its proposal row (`kind: 'proposal'`) keeps the run's `usage_log_id`.
 * Refused before any quote or hold: a real person (422 `real_person`, the
 * face words or the author's name). Refused before any hold: a balance that
 * cannot cover every image asked for (402), and no storage room (413).
 *
 * Logs carry codes only: never a brief, a prompt, the article or a model's answer.
 *
 * Mounted in index.ts BEFORE `articles`, at `/api/articles`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import {
  EXTENSION, IMAGE_BYTES_ESTIMATE, IMAGE_MODEL, IMAGE_MODEL_LABEL, MIMES, REAL_PERSON_MESSAGE, balanceRefusal, personIn, sniffMime,
} from '../services/aiImages';
import { ensureNewsSchema } from '../services/newsSchema';
import {
  ARTICLE_IMAGE_OPTION, ARTICLE_OPTIONS, ARTICLE_OPTION_KEYS, articlePage, articleRecord, guardTextOf, imageAskOf, imagePromptOf, inputOf,
  isArticleOption, messageOf, payloadOf, type ArticleImageAsk, type ArticleInput, type ArticleOption,
} from '../services/articleAssist';
import { isValidArticleImageName } from '../services/newsRender';
import { decideRail, getRail, proposeRail } from '../services/railProposals';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import { forgetArticleStorage } from '../services/storageUsage';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { loadOwned } from './articles';

const articleAssist = new Hono<{ Bindings: Env }>();

type Press = { id: number; article: any; option: ArticleOption; input: ArticleInput };

/** The article a press may run on, or the response that refuses it. */
export async function gateArticle(c: any, user: User): Promise<{ id: number; article: any } | { refused: Response }> {
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return { refused: c.json({ error: 'not_found_or_forbidden' }, 404) };
  const article = await loadOwned(c.env, id, Number(user.id), String(user.role));
  if (!article) return { refused: c.json({ error: 'not_found_or_forbidden' }, 404) };
  if (article.status === 'published') return { refused: c.json({ error: 'already_published' }, 409) };
  if ((await selectJwt(c))?.payload?.impersonated_by) {
    return { refused: refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot run Eadwyn on a member’s article.' }) };
  }
  return { id, article };
}

async function pressOf(c: any, user: User): Promise<{ press: Press } | { refused: Response }> {
  const gate = await gateArticle(c, user);
  if ('refused' in gate) return gate;
  const body = await c.req.json().catch(() => ({} as any));
  const option = body?.option;
  if (!isArticleOption(option)) {
    return { refused: refuse(c, 400, { code: 'unknown_option', message: `option must be one of ${ARTICLE_OPTION_KEYS.join(', ')}` }) };
  }
  const got = inputOf(option, body?.input);
  if ('field' in got) return { refused: refuse(c, 400, { code: 'invalid_input', message: got.error, extra: { field: got.field } }) };
  return { press: { id: gate.id, article: gate.article, option, input: got.input } };
}

/** The run one press makes, so the quote and the run read the same input. */
function runOptions(c: any, user: User, p: Press): RunOptions {
  const msg = messageOf(p.option, p.article, p.input);
  // The press names its own option: a header can name the page, never another option's price.
  const rail = { ...railFor(c, { page: articlePage(user.role), option: p.option }, articleRecord(p.id)), option: p.option };
  return {
    task: 'rail_write',
    userId: Number(user.id) || 0,
    surface: AI_SURFACE.articles,
    rail,
    systemPrompt: msg.system,
    messages: [{ role: 'user', content: msg.user }],
    guardText: guardTextOf(p.input),
    temperature: p.option === 'check:article-facts' || p.option === 'draft:article-seo' ? 0.2 : 0.6,
    maxTokens: ARTICLE_OPTIONS[p.option].maxTokens,
  };
}

/** What a run charged, from its usage row; null when it is not known. */
async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

articleAssist.post('/:id/assist/quote', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const q = await quoteRun(c.env, runOptions(c, user, p));
  if (q.ok) return c.json({ option: p.option, ai: true, hold_microusd: q.hold_microusd, model: q.model });
  return c.json({ option: p.option, ai: false, reason: q.refusal, message: q.error });
});

articleAssist.post('/:id/assist', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const userId = Number(user.id) || 0;
  const opts = runOptions(c, user, p);
  const res = await run(c.env, { ...opts, surface: AI_SURFACE.articles, rail: opts.rail });
  if (!res.ok) {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
  }
  const cost = { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null };
  const payload = payloadOf(p.option, res.output, p.input);
  if (!payload) return refuse(c, 422, { code: 'nothing_proposed', message: 'Eadwyn’s answer had nothing to place, so nothing was proposed. It was charged for the run.', extra: { cost } });
  let proposal = null;
  try {
    proposal = await proposeRail(c.env, {
      userId, page: opts.rail!.page, option: p.option, record: articleRecord(p.id), kind: ARTICLE_OPTIONS[p.option].kind,
      payload, model: res.usage?.model ?? null, usageLogId: res.usageLogId ?? null,
    });
  } catch {
    return refuse(c, 503, { code: 'proposal_unsaved', message: 'Eadwyn answered, but the proposal could not be kept. It was charged for the run; try again in a moment.', extra: { cost } });
  }
  return c.json({ proposal, option: p.option, cost });
});

// ── Images (part 2) ──────────────────────────────────────────────────────────

const NO_STORAGE = 'Images cannot be stored here yet. Nothing was run and nothing was charged.';
const UID = /^[0-9a-f-]{36}$/;

/** The absolute URL an article image is read at, through `articles.ts`'s image route. */
export const articleImageUrl = (requestUrl: string, id: number, filename: string) => new URL(`/api/articles/${id}/image/${filename}`, requestUrl).toString();

/** The article author's display name: the only person an article names (it has no venture). */
async function authorNames(env: Env, article: any): Promise<string[]> {
  const row = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(Number(article.author_user_id) || 0).first<{ name: string | null }>().catch(() => null);
  const name = String(row?.name ?? '').trim();
  return name.length >= 3 ? [name] : [];
}

function imageRunOptions(c: any, user: User, id: number, ask: ArticleImageAsk): RunOptions {
  const rail = { ...railFor(c, { page: articlePage(user.role), option: ARTICLE_IMAGE_OPTION }, articleRecord(id)), option: ARTICLE_IMAGE_OPTION };
  return { task: 'article_image', userId: Number(user.id) || 0, text: imagePromptOf(ask).slice(0, 2048), draw: {}, surface: AI_SURFACE.articles, rail };
}

type Priced = { id: number; authorId: number; ask: ArticleImageAsk; opts: RunOptions; per: number; total: number };

/**
 * The checked image press and its price, or the response that refuses it,
 * shared by the quote and the run. A quote refusal from the run path comes
 * back as `{ quoteRefusal }`, so the quote can answer `ai: false`.
 */
async function pricedImage(c: any, user: User): Promise<Priced | { refused: Response } | { quoteRefusal: { refusal?: string; error?: string } }> {
  const gate = await gateArticle(c, user);
  if ('refused' in gate) return gate;
  const body = await c.req.json().catch(() => ({} as any));
  const read = imageAskOf(body);
  if ('field' in read) return { refused: refuse(c, 400, { code: 'invalid_input', message: read.error, extra: { field: read.field } }) };
  // Before anything is quoted or held: a face, or the author named.
  if (personIn(read.ask.prompt, await authorNames(c.env, gate.article))) return { refused: refuse(c, 422, { code: 'real_person', message: REAL_PERSON_MESSAGE }) };
  if (!c.env.FILES) return { refused: refuse(c, 503, { code: 'storage_unavailable', message: NO_STORAGE }) };
  const opts = imageRunOptions(c, user, gate.id, read.ask);
  const q = await quoteRun(c.env, opts);
  if (!q.ok) return { quoteRefusal: { refusal: q.refusal, error: q.error } };
  // D1411: an article's images count to its author's storage plan, whoever presses.
  return { id: gate.id, authorId: Number(gate.article.author_user_id) || 0, ask: read.ask, opts, per: q.hold_microusd, total: q.hold_microusd * read.ask.count };
}

articleAssist.post('/:id/images/quote', async (c) => {
  const user = await requireAuth(c);
  const p = await pricedImage(c, user);
  if ('refused' in p) return p.refused;
  if ('quoteRefusal' in p) return c.json({ ai: false, reason: p.quoteRefusal.refusal ?? 'model_unavailable', message: p.quoteRefusal.error ?? 'The image model is not available.' });
  const short = await balanceRefusal(c.env, Number(user.id), p.total);
  return c.json({
    ai: true, model: IMAGE_MODEL, model_label: IMAGE_MODEL_LABEL, per_image_microusd: p.per, count: p.ask.count, total_microusd: p.total,
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  });
});

articleAssist.post('/:id/images/generate', async (c) => {
  const user = await requireAuth(c);
  const p = await pricedImage(c, user);
  if ('refused' in p) return p.refused;
  if ('quoteRefusal' in p) {
    return refuseRun(c, p.quoteRefusal) ?? refuse(c, 503, { code: 'model_unavailable', message: 'The image model is not available. Nothing was run.' });
  }
  const userId = Number(user.id) || 0;
  // Before any hold: the presser's balance for every image asked for, then room
  // on the author's storage plan (D1411: the bytes live in the author's article).
  const short = await balanceRefusal(c.env, userId, p.total);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { userId: p.authorId }, IMAGE_BYTES_ESTIMATE * p.ask.count, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const images: any[] = [];
  let stopped: { code: string; message: string } | null = null;
  for (let i = 0; i < p.ask.count; i += 1) {
    const r = await run(c.env, { ...p.opts, surface: AI_SURFACE.articles, rail: p.opts.rail });
    if (!r.ok || !r.image) {
      const answer = refuseRun(c, r);
      if (!images.length) return answer ?? refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not draw the image. Nothing was charged and nothing changed.' });
      const body: any = await answer?.clone().json().catch(() => null);
      stopped = { code: body?.error || 'model_unavailable', message: body?.message || 'Eadwyn stopped before drawing every image. What it drew is below.' };
      break;
    }
    const charged = await chargedOf(c.env, r.usageLogId, userId);
    const mime = (MIMES as readonly string[]).includes(r.image.mime) ? r.image.mime as typeof MIMES[number] : sniffMime(r.image.bytes);
    if (!mime) { stopped = { code: 'image_unreadable', message: 'The image came back in a format the article cannot show. It was charged; nothing was placed.' }; break; }
    const filename = `img-${crypto.randomUUID()}.${EXTENSION[mime]}`;
    const key = `articles/${p.id}/${filename}`;
    try {
      await c.env.FILES!.put(key, r.image.bytes, { httpMetadata: { contentType: mime }, customMetadata: { articleId: String(p.id), userId: String(userId) } });
    } catch {
      stopped = { code: 'image_unsaved', message: 'Eadwyn drew the image, but it could not be stored. It was charged for the run; try again in a moment.' };
      break;
    }
    forgetArticleStorage(p.id);
    const url = articleImageUrl(c.req.url, p.id, filename);
    const payload = { filename, url, width: r.image.width ?? null, height: r.image.height ?? null, style: p.ask.style, aspect: p.ask.aspect, alt: '' };
    let proposal;
    try {
      proposal = await proposeRail(c.env, {
        userId, page: p.opts.rail!.page, option: ARTICLE_IMAGE_OPTION, record: articleRecord(p.id), kind: 'proposal',
        payload, model: r.usage?.model ?? IMAGE_MODEL, usageLogId: r.usageLogId ?? null,
      });
    } catch {
      // No proposal names the bytes, so nothing could ever place or discard them.
      try { await c.env.FILES!.delete(key); } catch { /* the object is unreachable either way */ }
      stopped = { code: 'proposal_unsaved', message: 'Eadwyn drew the image, but it could not be kept. It was charged for the run; try again in a moment.' };
      break;
    }
    images.push({ uid: proposal.uid, ...payload, charged_microusd: charged, usage_log_id: r.usageLogId ?? null });
  }
  await noteStorageLanded(c.env, ticket);
  return c.json({ images, ...(stopped ? { stopped } : {}) });
});

articleAssist.post('/:id/images/:uid/discard', async (c) => {
  const user = await requireAuth(c);
  const gate = await gateArticle(c, user);
  if ('refused' in gate) return gate.refused;
  const uid = String(c.req.param('uid') || '');
  const userId = Number(user.id) || 0;
  const open = UID.test(uid) ? await getRail(c.env, userId, uid) : null;
  const filename = String(open?.payload?.filename ?? '');
  // Only the presser's own image proposal on this article.
  if (!open || open.rail_option !== ARTICLE_IMAGE_OPTION || open.record_ref !== articleRecord(gate.id) || !isValidArticleImageName(filename)) {
    return c.json({ error: 'not_found' }, 404);
  }
  const decided = await decideRail(c.env, userId, uid, 'discard');
  if (!decided) return refuse(c, 409, { code: 'already_decided', message: 'This image was already placed or discarded.' });
  // The bytes go unless the article already shows them (a body that names the file, or its cover key).
  const body = String(gate.article.body_markdown ?? '');
  const cover = String(gate.article.cover_r2_key ?? '');
  const inUse = body.includes(filename) || cover.endsWith(`/${filename}`);
  let deleted = false;
  if (!inUse && c.env.FILES) {
    try { await c.env.FILES.delete(`articles/${gate.id}/${filename}`); deleted = true; } catch { deleted = false; }
    forgetArticleStorage(gate.id);
  }
  return c.json({ ok: true, uid, deleted });
});

export default articleAssist;
