#!/usr/bin/env node
/**
 * Validate the Open Graph / social-preview metadata of the built site.
 *
 * This is the regression gate for the "every axal.vc link previews with the
 * same wrong image" class of bug. It runs against the build output in `docs/`
 * — the bytes a crawler actually receives — rather than against source, so it
 * catches the failure modes that only appear post-build:
 *
 *   - a route that ships the shell's generic tags because it was not prerendered
 *   - `og:image` pointing at a file that does not exist (the original bug: the
 *     shell declared /og.png, which was never in the repo)
 *   - a relative `og:image` (WhatsApp and LinkedIn will not resolve one)
 *   - a card that is not 1200x630, or is over the ~5MB platform limit
 *   - `twitter:card` missing, so X renders a thumbnail instead of a large image
 *   - two routes sharing one card, which is how "generic image everywhere"
 *     creeps back in
 *   - registry copy drifting from the PRODUCT_PAGES copy it mirrors
 *
 * Usage:
 *   node scripts/validate-og-tags.mjs            # validate ./docs
 *   node scripts/validate-og-tags.mjs --dir DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OG_ROUTES, ogTagsFor, SITE_URL } from '../frontend/src/lib/ogRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DIR = path.resolve(ROOT, arg('--dir', 'docs'));

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // platform limit is ~5MB
const REQUIRED_WIDTH = 1200;
const REQUIRED_HEIGHT = 630;

const errors = [];
const warnings = [];
const fail = (route, msg) => errors.push(`${route}: ${msg}`);
const warn = (route, msg) => warnings.push(`${route}: ${msg}`);

/**
 * Decode the entities the prerenderer emits. Comparing raw HTML against
 * registry values without this reports false failures: `&` is correctly written
 * as `&amp;` in an attribute, and is not a defect.
 */
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" does not become "<"
}

/**
 * Every `<meta property|name=… content=…>` in the document, in source order.
 *
 * Both attribute values are matched with a backreference to their own opening
 * quote rather than a `[^"']*` class: descriptions legitimately contain
 * apostrophes ("What's new…"), and a naive class truncates at the first one.
 *
 * One literal pattern for the whole document, rather than building a regex per
 * lookup key — a hardcoded regex cannot be a ReDoS vector, and it drops the
 * metacharacter-escaping dance the per-key version needed.
 */
const META_RE =
  /<meta\s+(?:property|name)=(["'])((?:(?!\1)[\s\S])*)\1\s+content=(["'])((?:(?!\3)[\s\S])*)\3/gi;

function metaTags(html) {
  return [...html.matchAll(META_RE)].map((m) => ({ key: m[2], content: m[4] }));
}

/** Pull a meta tag's content out of raw HTML (property= or name=). */
function meta(html, key) {
  const hit = metaTags(html).find((t) => t.key.toLowerCase() === key.toLowerCase());
  return hit ? decodeEntities(hit.content) : null;
}

function titleOf(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]) : null;
}

/** Count occurrences so we catch duplicated tags (crawlers pick unpredictably). */
function countTag(html, key) {
  return metaTags(html).filter((t) => t.key.toLowerCase() === key.toLowerCase()).length;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

function routeFile(pathname) {
  return pathname === '/'
    ? path.join(DIR, 'index.html')
    : path.join(DIR, pathname.replace(/^\//, ''), 'index.html');
}

/**
 * The registry inlines the four audience-page descriptions because importing
 * `../data/productPages.js` would drag React into the build scripts. Inlined
 * copy drifts, so re-read that module as text and compare.
 */
function checkProductCopyDrift() {
  const src = path.join(ROOT, 'frontend/src/data/productPages.js');
  if (!fs.existsSync(src)) {
    warn('registry', 'productPages.js not found — skipped copy drift check');
    return;
  }
  const text = fs.readFileSync(src, 'utf8');
  const found = new Map();
  const re =
    /path:\s*'(\/for-[a-z-]+)',[\s\S]{0,400}?meta:\s*\{\s*title:\s*'([^']+)',\s*description:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(text))) found.set(m[1], { title: m[2], description: m[3] });

  for (const route of OG_ROUTES) {
    if (!route.path.startsWith('/for-')) continue;
    const src2 = found.get(route.path);
    if (!src2) {
      warn(route.path, 'could not read meta from productPages.js to compare');
      continue;
    }
    if (src2.title !== route.title) {
      fail(
        route.path,
        `title drifted from productPages.js\n      registry: ${route.title}\n      source:   ${src2.title}`,
      );
    }
    if (src2.description !== route.description) {
      fail(
        route.path,
        `description drifted from productPages.js — re-copy it into ogRegistry.js`,
      );
    }
  }
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`No build output at ${path.relative(ROOT, DIR)}. Run the frontend build first.`);
    process.exit(1);
  }

  const imageUsage = new Map();

  for (const route of OG_ROUTES) {
    const file = routeFile(route.path);
    const rel = path.relative(ROOT, file);

    if (!fs.existsSync(file)) {
      fail(route.path, `not prerendered — expected ${rel}. Run: node scripts/prerender-og.mjs`);
      continue;
    }
    const html = fs.readFileSync(file, 'utf8');
    const expected = ogTagsFor(route.path);

    // --- required tags present and matching the registry --------------------
    const checks = [
      ['<title>', titleOf(html), expected.title],
      ['og:title', meta(html, 'og:title'), expected.title],
      ['og:description', meta(html, 'og:description'), expected.description],
      ['og:url', meta(html, 'og:url'), expected.url],
      ['og:image', meta(html, 'og:image'), expected.image],
      ['og:type', meta(html, 'og:type'), expected.type],
      ['og:site_name', meta(html, 'og:site_name'), expected.siteName],
      ['twitter:card', meta(html, 'twitter:card'), expected.card],
      ['twitter:title', meta(html, 'twitter:title'), expected.title],
      ['twitter:description', meta(html, 'twitter:description'), expected.description],
      ['twitter:image', meta(html, 'twitter:image'), expected.image],
    ];
    for (const [key, actual, want] of checks) {
      if (actual === null) fail(route.path, `missing ${key}`);
      else if (actual !== want) {
        fail(route.path, `${key} mismatch\n      got:  ${actual}\n      want: ${want}`);
      }
    }

    // --- no duplicates ------------------------------------------------------
    for (const key of ['og:image', 'og:title', 'og:url', 'twitter:card', 'twitter:image']) {
      const n = countTag(html, key);
      if (n > 1) fail(route.path, `${key} appears ${n} times — crawlers pick unpredictably`);
    }
    const titles = (html.match(/<title>/gi) || []).length;
    if (titles > 1) fail(route.path, `<title> appears ${titles} times`);

    // --- description sanity -------------------------------------------------
    if (!expected.description) {
      fail(route.path, 'empty og:description — add one in ogRegistry.js');
    } else if (expected.description.length > 300) {
      warn(route.path, `og:description is ${expected.description.length} chars; most platforms truncate near 200`);
    }

    // --- image must be absolute https, exist, and be correctly sized --------
    const img = meta(html, 'og:image');
    if (img) {
      if (!/^https:\/\//i.test(img)) {
        fail(route.path, `og:image must be an absolute https URL (got "${img}")`);
      } else if (!img.startsWith(`${SITE_URL}/`)) {
        warn(route.path, `og:image points off-site: ${img}`);
      } else {
        const urlPath = img.slice(SITE_URL.length).split('?')[0];
        const imgFile = path.join(DIR, urlPath.replace(/^\//, ''));
        if (!fs.existsSync(imgFile)) {
          fail(
            route.path,
            `og:image 404s — no file at ${path.relative(ROOT, imgFile)}.\n` +
              '      This is the original bug: a declared-but-missing image makes crawlers\n' +
              '      scrape an arbitrary page raster instead.',
          );
        } else {
          const size = pngSize(imgFile);
          if (!size) fail(route.path, `og:image is not a readable PNG: ${urlPath}`);
          else {
            if (size.width !== REQUIRED_WIDTH || size.height !== REQUIRED_HEIGHT) {
              fail(
                route.path,
                `og:image is ${size.width}x${size.height}, must be ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT}`,
              );
            }
            if (size.bytes > MAX_IMAGE_BYTES) {
              fail(route.path, `og:image is ${Math.round(size.bytes / 1024)}KB, over the ~5MB limit`);
            }
          }
          const declaredW = meta(html, 'og:image:width');
          const declaredH = meta(html, 'og:image:height');
          if (size && declaredW && Number(declaredW) !== size.width) {
            fail(route.path, `og:image:width says ${declaredW}, file is ${size.width}`);
          }
          if (size && declaredH && Number(declaredH) !== size.height) {
            fail(route.path, `og:image:height says ${declaredH}, file is ${size.height}`);
          }
        }
        const seen = imageUsage.get(urlPath) || [];
        seen.push(route.path);
        imageUsage.set(urlPath, seen);
      }
    }
  }

  // --- the headline regression: one image doing duty for the whole site -----
  for (const [img, routes] of imageUsage) {
    if (routes.length > 1 && img.endsWith('/og/default.png')) {
      warn(
        'sitewide',
        `${routes.length} routes fall back to the sitewide default card (${img}): ${routes.join(', ')}\n` +
          '      Give them a section or page card in ogRegistry.js.',
      );
    }
  }
  const distinct = new Set([...imageUsage.keys()]).size;
  if (OG_ROUTES.length > 1 && distinct === 1) {
    fail('sitewide', 'every route resolves to the SAME og:image — this is the bug this check exists to prevent');
  }

  checkProductCopyDrift();

  // --- report --------------------------------------------------------------
  for (const w of warnings) console.warn(`  warn  ${w}`);
  if (errors.length) {
    console.error(`\nOG validation FAILED — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  error ${e}`);
    console.error('\nUsual fix: node scripts/generate-og-images.mjs && node scripts/prerender-og.mjs');
    process.exit(1);
  }
  console.log(
    `OG validation passed — ${OG_ROUTES.length} routes, ${distinct} distinct cards, ` +
      `${warnings.length} warning(s).`,
  );
}

main();
