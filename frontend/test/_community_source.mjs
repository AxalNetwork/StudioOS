/**
 * #4717 package 6 — the Community page's source, read as a whole. The model is
 * `communityModel.js` and the domain modules under `model/`; the page is
 * `AdminCommunity.jsx` and the parts beside it under `page/`. A test that
 * guards what the page must never read (a profile list, a wellbeing route,
 * the analytics summary) reads all of it, so moving code between files can
 * never move it out of the guard's sight.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'frontend/src/pages/admin/community');
const all = (sub) => (existsSync(join(DIR, sub)) ? readdirSync(join(DIR, sub)).filter((f) => /\.(js|jsx)$/.test(f)).sort().map((f) => join(DIR, sub, f)) : []);

/** Every file of the model, joined. */
export const communityModelSource = () => [join(DIR, 'communityModel.js'), ...all('model')].map((f) => readFileSync(f, 'utf8')).join('\n');
/** Every file of the page (not the lightboxes), joined. */
export const communityPageSource = () => [join(DIR, 'AdminCommunity.jsx'), ...all('page')].map((f) => readFileSync(f, 'utf8')).join('\n');
