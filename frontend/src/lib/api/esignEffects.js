// #8516 (D8516) — the operator's retry of one e-sign effect record (Super Admin).
// A record the signature set in motion (the next signer of a staged envelope)
// that failed is retried by the Worker tick up to a cap; this runs one more
// attempt by hand. A record already done changes nothing.
// Worker: routes/esign_effects.ts, services/esignEffects.ts.
import { request } from '../api.js';

export const esignEffectsApi = {
  retry: (id) => request(`/legal/esign/effects/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify({}) }),
};
