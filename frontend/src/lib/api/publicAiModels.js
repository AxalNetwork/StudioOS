// D678 (#1552) — the model registry, as the public Intelligence page shows it.
// Worker: `GET /api/public/ai-models` in routes/public.ts, no session needed.
// One row per job the router runs: `{ feature, model, name, provider }`, read
// from the router's own table, so the page never types a model name.
import { request } from '../api.js';

export const publicAiModelsApi = {
  list: () => request('/public/ai-models'),
};
