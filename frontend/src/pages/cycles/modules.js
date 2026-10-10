/**
 * D661 (#1474) — each wired cycle's modules, in tab order, as its Worker read
 * lists them. A module page builds its tabs from this rather than reading the
 * whole overview again. `cloudflare-worker/test/cycle_adapters_d661.test.ts`
 * holds each list equal to the Worker's own.
 */
import { MODULES as VALIDATE } from './adapters/validate.js';

export const MODULES = {
  // services/cycleValidate.ts
  validate: VALIDATE,
  // services/raiseCycle.ts
  raise: [
    { slug: 'fundraising-readiness', name: 'Fundraising readiness' },
    { slug: 'investor-narrative', name: 'Investor narrative' },
    { slug: 'pitch-deck', name: 'Pitch deck' },
    { slug: 'data-room', name: 'Data room' },
    { slug: 'cap-table', name: 'Cap table' },
    { slug: 'use-of-funds', name: 'Use of funds' },
    { slug: 'capital-relationships', name: 'Capital relationships' },
  ],
};
