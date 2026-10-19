/**
 * D781 (#2106) part 2 — the render check for the Investor profile's routes: each
 * route in D768's page map, rendered in the real App as a Investor member, draws
 * exactly one rail with its page key in the DOM, or is listed in
 * `RENDER_NOT_YET`. The harness, the states and the ratchet are in
 * `_airailRender.mjs`; one file per profile so `node --test` runs them side by side.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/airail_render_investor_d781.test.mjs
 */
import { renderProfile } from './_airailRender.mjs';

renderProfile('Investor');
