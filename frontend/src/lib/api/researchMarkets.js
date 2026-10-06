import { request } from '../api.js';

const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** D533 — Research · Markets and · Geographies (routes/research_markets.ts). */
export const researchMarketsApi = {
  list: (params) => request(`/research/markets${qs(params)}`),
  get: (slug) => request(`/research/markets/${encodeURIComponent(slug)}`),
  geographies: (params) => request(`/research/geographies${qs(params)}`),
  geography: (code) => request(`/research/geographies/${encodeURIComponent(code)}`),
};
