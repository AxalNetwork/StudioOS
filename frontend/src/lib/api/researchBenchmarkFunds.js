// D6278 (#6278) — a Research benchmark's "Ours" from a fund's recorded TVPI or
// DPI. Worker: routes/research_benchmark_funds.ts
// (`GET /api/research/benchmarks/fund-figures`,
// `POST /api/research/benchmarks/:uid/ours-from-fund`).
import { request } from '../api.js';

export const researchBenchmarkFundsApi = {
  /** `{ items: [{ fund_id, name, as_of, tvpi, dpi }], as_of }`; each figure is `{ value, display, reason }`. */
  figures: () => request('/research/benchmarks/fund-figures'),
  /**
   * Copy one fund figure onto the caller's benchmark. A typed "Ours" answers
   * 409 `typed_value` until `replace` is true; an unrecorded figure answers 409
   * `figure_not_recorded`. Answers the benchmark detail read.
   */
  useFigure: (uid, { fund_id, metric, replace = false }) =>
    request(`/research/benchmarks/${encodeURIComponent(uid)}/ours-from-fund`, {
      method: 'POST',
      body: JSON.stringify({ fund_id, metric, replace }),
    }),
};
