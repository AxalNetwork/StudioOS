/**
 * D679 part 2 (#1553) — Programs & Events, Communities & Circles, Jobs, a job,
 * and the application sheet, built to the owner's canvas
 * `design/canvases/integrated/Axal VC Website.dc.html` (PROGRAMS & EVENTS,
 * COMMUNITIES & CIRCLES, JOBS, JOB DETAIL, REGISTRATION GATE).
 *
 * This pins:
 *   - every page opens with the Network sub-nav;
 *   - live data only: none of the canvas's sample events, circles, jobs,
 *     companies or program facts is in source, and every list is a live read;
 *   - the Programs row is the Spin-Out Lab card alone, read from the Lab's
 *     cohort helpers, with no card for the advisor intake or Fund I;
 *   - each row draws its live fields (an event's date in its own zone, a
 *     circle without cadence or seats, a job without invented facts);
 *   - the job filters are the Worker's employment types;
 *   - the sheet sends the application through the existing apply route and
 *     hands over to the existing registration or sign-in, and never runs a
 *     signup of its own.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_events_jobs_d679.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = {
  events: 'frontend/src/pages/events/PublicEventsPage.jsx',
  circles: 'frontend/src/pages/CirclesPage.jsx',
  jobs: 'frontend/src/pages/jobs/PublicJobsPage.jsx',
  job: 'frontend/src/pages/jobs/PublicJobDetailPage.jsx',
  lib: 'frontend/src/lib/siteNetwork2.js',
  css: 'frontend/src/pages/site/network2.css',
};
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));

const events = await import('../src/pages/events/PublicEventsPage.jsx');
const circles = await import('../src/pages/CirclesPage.jsx');
const jobs = await import('../src/pages/jobs/PublicJobsPage.jsx');
const job = await import('../src/pages/jobs/PublicJobDetailPage.jsx');
const net = await import('../src/lib/siteNetwork2.js');
const { openCohortCopy } = await import('../src/lib/spinoutLab.js');

const render = (el, path = '/') => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [path] }, el),
);
const renderAt = (path, pattern, Page) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(Routes, null, React.createElement(Route, { path: pattern, element: React.createElement(Page) }))),
);

test('every page opens with the Network sub-nav, above its heading', () => {
  const pages = [
    ['/events', '/events', events.default, 'Programs &amp; Events'],
    ['/circles', '/circles', circles.default, 'Communities &amp; Circles'],
    ['/jobs', '/jobs', jobs.default, '>Jobs</h1>'],
    ['/jobs/a-role', '/jobs/:slug', job.default, 'All roles'],
  ];
  for (const [path, pattern, Page, marker] of pages) {
    const html = renderAt(path, pattern, Page);
    const nav = html.indexOf('<nav class="ax-subnav" aria-label="Network">');
    assert.ok(nav > 0, `${path} renders the Network sub-nav`);
    const main = html.indexOf('<main');
    assert.ok(main > 0 && main < nav, `${path} puts the sub-nav inside the page, under the site nav`);
    const at = html.indexOf(marker, main);
    assert.ok(at > nav, `${path}: the sub-nav comes before the page's own content`);
  }
  for (const key of ['events', 'circles', 'jobs', 'job']) {
    assert.match(SRC[key], /import NetworkSubNav from '\.\.\/(\.\.\/)?components\/site\/NetworkSubNav'/,
      `${FILES[key]} uses the site's Network sub-nav`);
    assert.match(SRC[key], /import SitePage from '\.\.\/(\.\.\/)?components\/site\/SitePage'/,
      `${FILES[key]} renders inside SitePage`);
  }
});

test('no sample event, circle, job, company, person or program fact from the canvas ships', () => {
  const samples = [
    // events
    'Cohort 4 Demo Day', 'LP quarterly briefing', 'Formation & IP', 'Pricing pressure-test', 'Circle summit',
    '16:00 CET', 'All day',
    // programs
    'Advisor cohort intake', 'Fund I · LP onboarding', 'First close', '$20M', '$50K', '$6.8M', '0.25–1%',
    'Cohort 5', 'Sep 1, 2026', 'Review time',
    // circles
    'Founder Circle', 'Deeptech & Research', 'LP Circle', 'Operator Circle', 'Formation & Legal',
    'Regional Chapter', 'Fortnightly', '8 seats', 'Request a seat', 'Join waitlist',
    // jobs and companies
    'NovaCraft', 'Halyard Security', 'LoopSense', 'Verity Health', 'Kelp Bio', 'Arcline',
    'Founding Engineer', 'Head of Go-to-Market', 'Senior ML Engineer', 'Clinical Operations Lead',
    'Platform Engineer', 'Cohort Operations Associate', 'Materials Scientist', 'Enterprise Account Executive',
    // 'Compensation' is a live fact since #2181, drawn from the public read's band.
    'Engineering', 'Go-to-market', 'Readiness score', 'Interviews logged', 'Revenue to date', 'Reports to',
    'Pre-seed · Cohort',
    // people
    'Lin Zhang', 'Hana Kaur', 'Guillaume Lauzier', 'Elena Voss',
    // promises the code does not keep
    'within five business days', 'skills assessment', 'Account created', 'Requires a free Axal VC account',
    'Listings reach the full partner network', 'scheduled around the 28-day',
  ];
  for (const [key, src] of Object.entries(SRC)) {
    const body = key === 'css' ? src : code(src);
    for (const s of samples) {
      assert.ok(!body.includes(s), `${FILES[key]} carries the canvas sample "${s}"`);
    }
  }
  // The static program list in data/network.js is invented; the page no longer reads it.
  assert.doesNotMatch(code(SRC.events), /\bPROGRAMS\b|PROGRAM_CATEGORIES|AUDIENCES/, 'the curated program list is not drawn');
});

test('every list is a live read', () => {
  assert.match(SRC.events, /eventsPublic\.list\(\{/, 'the events are the public feed');
  assert.match(SRC.circles, /circlesPublic\.list\(\)/, 'the circles are the published circles');
  assert.match(SRC.jobs, /jobsPublic\.list\(\{/, 'the jobs are the public job feed');
  assert.match(SRC.job, /jobsPublic\.read\(slug\)/, 'a job is the public job read');
  assert.match(SRC.job, /jobsPublic\.list\(\{ q: job\.startup_name/, 'other roles are the feed, kept to the company');
  for (const key of ['events', 'circles', 'jobs', 'job']) {
    assert.doesNotMatch(code(SRC[key]), /const (ALL_JOBS|ALL_EVENTS|CIRCLES|JOBS|EVENTS)\s*=\s*\[/, `${FILES[key]} declares a literal list`);
  }
});

test('the Programs row is the Spin-Out Lab card alone, read from the cohort helpers', () => {
  const src = code(SRC.events);
  assert.match(src, /import \{ COHORT_WEEKS, openCohortCopy, useCohortPlaces \} from '\.\.\/\.\.\/lib\/spinoutLab'/);
  assert.match(src, /const cohort = openCohortCopy\(\);/, 'the cohort number and start come from the Lab cohort rule');
  assert.match(src, /const places = useCohortPlaces\(\);/, 'the places come from the cohort record');
  assert.match(src, /const COHORT_DAYS = COHORT_WEEKS \* 7;/, 'the duration is the cohort timing, not a typed 28');

  const c = openCohortCopy();
  const card = render(React.createElement(events.LabProgramCard));
  assert.ok(card.includes(`Spin-Out Lab · Cohort ${c.cohortNum}`), 'the card names the open cohort');
  assert.ok(card.includes(`Apply to Cohort ${c.cohortNum}`), 'the CTA names the open cohort');
  assert.ok(card.includes('href="/spinout-lab/apply"'), 'the CTA goes to the Lab application');
  assert.ok(card.includes(`<dt>Starts</dt><dd class="ax-mono">${c.startLabel}</dd>`), 'the start is the cohort rule\'s');
  assert.ok(card.includes('<dt>Duration</dt><dd class="ax-mono">28 days</dd>'));
  assert.ok(!card.includes('<dt>Places</dt>'), 'places are not drawn before the cohort record is read');

  const page = renderAt('/events', '/events', events.default);
  const programs = page.slice(page.indexOf('id="ax-n2-programs"'), page.indexOf('id="ax-n2-events"'));
  assert.equal((programs.match(/class="ax-card ax-n2-program"/g) || []).length, 1, 'one program card: the Lab');
});

test('an event row draws its date in the event\'s own zone, its type, and the way in', () => {
  const ev = {
    id: 1, slug: 'night-session', title: 'A night session', type: 'office_hours', summary: 'Bring a question.',
    starts_at: '2026-11-02T03:30:00Z', timezone: 'America/Los_Angeles', location_kind: 'virtual', price_cents: 0,
  };
  const up = render(React.createElement(events.EventRow, { ev, isPast: false }));
  assert.match(up, /ax-n2-day">01<\/div><div class="ax-lbl-q ax-n2-mon">Nov</, 'Nov 1 in Los Angeles, not Nov 2 UTC');
  assert.match(up, /07:30 PM PST/, 'the time is the event\'s, with its zone named');
  assert.match(up, /class="ax-chip ax-n2-chip-teal">Office Hours</, 'the type chip is the canonical label');
  assert.match(up, /href="\/events\/night-session"/);
  assert.match(up, />Register</);
  assert.match(up, /is-free">Free</);
  const past = render(React.createElement(events.EventRow, { ev, isPast: true }));
  assert.match(past, />View details</);
  assert.equal(net.eventDateParts('2026-11-02T03:30:00Z', 'Not/AZone').day, '02', 'an unknown zone falls back to UTC');
  assert.equal(net.eventDateParts('', 'UTC'), null);
});

test('a circle card draws the row\'s own fields: no cadence, no seats', () => {
  const pub = render(React.createElement(circles.CircleCard, {
    c: { id: 7, slug: 'lisbon', name: 'A test circle', type: 'city', access: 'public', region: 'Lisbon', tagline: 'Monthly dinners.', members: 1 },
  }));
  assert.match(pub, /City \/ region circles · Lisbon/);
  assert.match(pub, /ax-n2-chip-green">Public</);
  assert.match(pub, />1 member</);
  assert.match(pub, /href="\/register\?intent=circle&amp;circle=lisbon"[^>]*>Join</, 'join goes where it went before');
  assert.doesNotMatch(pub, /seat|cadence|Fortnightly|Monthly ·/i);

  const priv = render(React.createElement(circles.CircleCard, {
    c: { id: 8, name: 'Another', type: 'founder', access: 'private', members: 0 },
  }));
  assert.match(priv, /ax-chip-quiet">Invite-only</);
  assert.match(priv, /href="\/register\?intent=circle&amp;circle=8"[^>]*>Request access</);
  assert.doesNotMatch(priv, /members?</, 'a zero count is not drawn');
});

test('the job filters are the Worker\'s employment types, and a row draws only live fields', () => {
  const worker = read('cloudflare-worker/src/services/jobBoardCommon.ts');
  const ids = [...worker.match(/EMPLOYMENT_TYPES = \[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(net.JOB_TYPE_FILTERS.map((f) => f.value), ['', ...ids], 'All, then one pill per employment type');
  const sen = [...worker.match(/SENIORITIES = \[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(net.SENIORITY_LABELS), sen);
  assert.match(SRC.jobs, /<FilterPills label="Job type" options=\{JOB_TYPE_FILTERS\} value=\{employmentType\} onChange=\{setEmploymentType\} \/>/,
    'the pills drive the employment_type filter the feed already takes');

  const row = render(React.createElement(jobs.JobRow, {
    job: { id: 3, slug: 'a-role', title: 'A role', startup_name: 'Test Co', employment_type: 'contract', seniority: 'senior', remote: true, location_text: 'Porto' },
  }));
  assert.match(row, /href="\/jobs\/a-role"/);
  assert.match(row, />TC</, 'the company\'s initials');
  assert.match(row, /Test Co · Senior/);
  assert.match(row, /ax-chip-quiet">Contract</);
  assert.match(row, /Remote · Porto/);
  assert.match(row, />View role</);

  assert.equal(jobs.POST_ROLE_HREF, '/jobs/new', 'Post a role goes to the job editor');
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/jobs\/new" element=\{guard\(/, 'the job editor is a guarded route');
});

test('a job draws only the fields the read returns', () => {
  const html = render(React.createElement(job.JobBody, {
    job: {
      id: 9, slug: 'a-role', title: 'A role', startup_name: null, employment_type: 'full_time', seniority: 'lead',
      remote: false, location_text: null, summary: null, description: 'What you would own\n- the thing\n- the other thing',
      created_at: '2026-08-01 09:00:00',
    },
    related: null,
    onApply: () => {},
  }));
  assert.match(html, /<h1 class="ax-n2-job-h1">A role<\/h1>/);
  assert.match(html, /Posted Aug 1, 2026/);
  assert.match(html, /<dt class="ax-lbl-q">Level<\/dt><dd>Lead<\/dd>/);
  assert.match(html, /<dt class="ax-lbl-q">Commitment<\/dt><dd>Full-time<\/dd>/);
  assert.doesNotMatch(html, /Location<\/dt>/, 'no place, no Location fact');
  assert.doesNotMatch(html, /ax-n2-intro/, 'no summary, no intro');
  assert.doesNotMatch(html, /Other roles at|About /, 'no company, no company cards');
  assert.match(html, /<p>What you would own<\/p><ul class="ax-n2-bullets"><li>the thing<\/li><li>the other thing<\/li><\/ul>/);
  assert.match(html, /Apply now →/);

  assert.deepEqual(net.descriptionBlocks('## Role\nLine one\nLine two\n\n* a\n• b'), [
    { kind: 'h', text: 'Role' }, { kind: 'p', text: 'Line one\nLine two' }, { kind: 'list', items: ['a', 'b'] },
  ]);
  assert.deepEqual(net.otherRoles([{ id: 1, project_id: 4 }, { id: 2, project_id: 4 }, { id: 3, project_id: 5 }], { id: 1, project_id: 4 }),
    [{ id: 2, project_id: 4 }], 'other roles are the same company\'s, not this one');
  assert.deepEqual(net.otherRoles([{ id: 2, project_id: null }], { id: 1, project_id: null }), [], 'no company, no other roles');
});

test('the sheet applies through the existing route and hands over to the existing signup', () => {
  const src = code(SRC.job);
  // Step 1 is the existing public application, Turnstile and all.
  assert.match(src, /const res = await jobsPublic\.apply\(slug, \{/);
  assert.match(src, /turnstile_token: turnstileToken,/);
  assert.match(src, /if \(TURNSTILE_SITE_KEY && !turnstileToken\) \{/, 'no application leaves without the challenge');
  // It never creates an account or signs anyone in itself.
  assert.doesNotMatch(src, /api\.register\(|magicStart\(|\/auth\/|googleStartUrl/, 'the sheet runs no signup of its own');
  // Step 2 hands over to the routes that exist.
  assert.deepEqual(job.applyHandoff({ hasAccount: false, email: 'a+b@x.io', signedIn: false }),
    { href: '/register?email=a%2Bb%40x.io&intent=job-application', label: 'Create your account', line: 'Finish creating your account to track this and future applications.', auto: true });
  assert.equal(job.applyHandoff({ hasAccount: true, email: 'a@x.io', signedIn: false }).href, '/login?email=a%40x.io');
  assert.deepEqual(job.applyHandoff({ hasAccount: true, email: 'a@x.io', signedIn: true }).href, '/my/applications');
  const app = read('frontend/src/App.jsx');
  for (const p of ['/register', '/login', '/my/applications']) {
    assert.match(app, new RegExp(`<Route path="${p}" `), `${p} is a route`);
  }

  const sheet = render(React.createElement(job.ApplySheet, { job: { title: 'A role', startup_name: 'Test Co' }, slug: 'a-role', user: null, onClose: () => {} }));
  assert.match(sheet, /role="dialog" aria-modal="true" aria-labelledby="ax-n2-sheet-h"/);
  assert.match(sheet, /Step 1 of 2 · Your application/);
  assert.match(sheet, /A role at Test Co\./);
  assert.match(sheet, /href="\/login\?next=%2Fjobs%2Fa-role"[^>]*>Sign in</, 'sign-in returns to this role');
  assert.doesNotMatch(sheet, /type="password"|I agree to the/, 'no password or terms box: the sheet does not register');

  const member = render(React.createElement(job.ApplySheet, { job: { title: 'A role' }, slug: 'a-role', user: { name: 'M', email: 'm@x.io' }, onClose: () => {} }));
  assert.match(member, /value="m@x.io"/, 'a signed-in member has their email filled in');
  assert.doesNotMatch(member, /Already have an account/);

  const sent = render(React.createElement(job.ApplySent, {
    job: { title: 'A role', startup_name: 'Test Co' },
    handoff: job.applyHandoff({ hasAccount: false, email: 'a@x.io', signedIn: false }),
    onClose: () => {},
  }));
  assert.match(sent, /Application sent/);
  assert.match(sent, /<strong>A role<\/strong> at Test Co has been sent to the hiring founder\./);
  assert.match(sent, /href="\/register\?email=a%40x\.io&amp;intent=job-application"[^>]*>Create your account →</);
});
