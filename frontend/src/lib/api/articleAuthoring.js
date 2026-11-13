// D1409 (#3695) — Eadwyn's writing options in the article editor, and its images.
// Worker: routes/article_assist.ts over services/articleAssist.ts.
//   POST /api/articles/:id/assist/quote  { option, input }
//        → { option, ai: true, hold_microusd, model } | { option, ai: false, reason, message }
//   POST /api/articles/:id/assist        (same body)
//        → { proposal, option, cost: { charged_microusd | null, usage_log_id } }
// `option` is one of draft:article-outline, draft:article-section,
// rewrite:article, draft:article-continue, draft:article-headlines,
// draft:article-seo, draft:article-newsletter, check:article-facts.
// Nothing is written to the article: Insert, Replace and Accept decide the
// proposal (`POST /api/ai/rail/proposals/:uid/decide`), and the editor saves.
// `headers` on the run is the press's own rail context (`railPressHeaders`).
//
// Images (part 2):
//   POST /api/articles/:id/images/quote     { prompt, style, aspect, count }
//        → { ai: true, model, model_label, per_image_microusd, count, total_microusd, balance: { ok, code?, message? } }
//          | { ai: false, reason, message }
//   POST /api/articles/:id/images/generate  (same body) → { images: [{ uid, url, filename, width, height, style, aspect,
//        alt, charged_microusd | null, usage_log_id }], stopped? }
//   POST /api/articles/:id/images/:uid/discard → { ok: true, uid, deleted }
//   POST /api/articles/:id/cover            { image: 'img-….png' } → { ok, cover_url }: the cover copied from one of the
//        article's own images (routes/articles.ts).
// `style` is photo, illustration, diagram or abstract; `aspect` 16:9, 4:3, 1:1 or 3:4; `count` 1 to 4.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}), ...(headers ? { headers } : {}) });

export const articleAuthoringApi = {
  quote: (articleId, option, input = {}) => post(`/articles/${enc(articleId)}/assist/quote`, { option, input }),
  assist: (articleId, option, input = {}, headers) => post(`/articles/${enc(articleId)}/assist`, { option, input }, headers),
  imagesQuote: (articleId, ask = {}) => post(`/articles/${enc(articleId)}/images/quote`, ask),
  imagesGenerate: (articleId, ask = {}, headers) => post(`/articles/${enc(articleId)}/images/generate`, ask, headers),
  imageDiscard: (articleId, uid) => post(`/articles/${enc(articleId)}/images/${enc(uid)}/discard`, {}),
  coverFromImage: (articleId, filename) => post(`/articles/${enc(articleId)}/cover`, { image: filename }),
};
