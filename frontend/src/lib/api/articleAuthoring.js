// D1409 (#3695) — Eadwyn's writing options in the article editor.
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
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}), ...(headers ? { headers } : {}) });

export const articleAuthoringApi = {
  quote: (articleId, option, input = {}) => post(`/articles/${enc(articleId)}/assist/quote`, { option, input }),
  assist: (articleId, option, input = {}, headers) => post(`/articles/${enc(articleId)}/assist`, { option, input }, headers),
};
