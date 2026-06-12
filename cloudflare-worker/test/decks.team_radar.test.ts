/**
 * Task #26 — Spin-out demo-day deck: founding-team coverage radar shape.
 *
 * Task #17 wired a real 8-axis founding-team coverage radar (computeRadar →
 * buildTeamRadar) into the Spin-Out Demo Day deck's mentor_network slide.
 * This test pins the `mentor_network.team_radar` payload shape so a future
 * regression can't silently revert the deck to placeholder / empty radar
 * data. It drives the full fillAxalSpinoutDemoDay() pipeline against a fake
 * D1 env (so cofounder_connections team resolution is exercised too) for the
 * three distinct modes:
 *
 *   (a) solo founder            → member_count 1, has_data true
 *   (b) team via an active      → member_count 2, has_data true, gap axes
 *       cofounder_connection      surfaced with suggested roles
 *   (c) founder with no skills  → has_data false (graceful degradation)
 *
 * Run via:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/decks.team_radar.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';

// One skill per radar axis: skill id N maps to RADAR_AXES[N-1].slug. Keeps
// the axis→skill mapping trivially invertible for the per-user fixtures.
const SKILLS = RADAR_AXES.map((ax, i) => ({
  id: i + 1,
  slug: ax.slug,
  category_slug: ax.slug,
  display_order: i,
}));
const skillIdForAxis = (slug: string) => SKILLS.find((s) => s.category_slug === slug)!.id;

/**
 * Build a fake D1 env. `usersSkills` maps userId → { axisSlug: self_level }.
 * `connections` is the cofounder_connections result set. Everything the deck
 * reads but we don't care about returns empty, exercising the deck's
 * documented graceful-degradation path.
 */
function makeEnv(opts: {
  founderId: number;
  usersSkills: Record<number, Record<string, number>>;
  connections?: Array<{ user_a_id: number; user_b_id: number }>;
}) {
  const { founderId, usersSkills, connections = [] } = opts;

  const project = { id: 1, founder_id: founderId, name: 'Test Co', sector: 'B2B SaaS' };
  const user = { id: founderId, name: 'Founder', display_name: 'Founder', email: 'f@test.co', spinout_lab_active: 1, spinout_lab_week: 4, spinout_lab_started_at: null };

  const resolve = (sql: string, args: any[]) => {
    const s = sql.toLowerCase();
    // Order matters: user_skills / skill_endorsements contain "skill" too.
    if (s.includes('from user_skills')) {
      const uid = Number(args[0]);
      const skills = usersSkills[uid] || {};
      const rows = Object.entries(skills).map(([slug, lvl]) => ({ skill_id: skillIdForAxis(slug), self_level: lvl }));
      return { first: async () => rows[0] ?? null, all: async () => ({ results: rows }) };
    }
    if (s.includes('from skill_endorsements')) {
      return { first: async () => null, all: async () => ({ results: [] }) };
    }
    if (s.includes('from skills') && s.includes('is_active')) {
      return { first: async () => SKILLS[0], all: async () => ({ results: SKILLS }) };
    }
    if (s.includes('from cofounder_connections')) {
      return { first: async () => connections[0] ?? null, all: async () => ({ results: connections }) };
    }
    if (s.includes('from projects')) {
      return { first: async () => project, all: async () => ({ results: [project] }) };
    }
    if (s.includes('from users')) {
      return { first: async () => user, all: async () => ({ results: [user] }) };
    }
    return { first: async () => null, all: async () => ({ results: [] }) };
  };

  return {
    DB: {
      prepare(sql: string) {
        const direct = resolve(sql, []);
        return {
          bind: (...args: any[]) => {
            const r = resolve(sql, args);
            return { first: r.first, all: r.all, run: async () => ({ success: true }) };
          },
          first: direct.first,
          all: direct.all,
          run: async () => ({ success: true }),
        };
      },
      batch: async (_stmts: any[]) => [],
      exec: async (_sql: string) => ({ count: 0, duration: 0 }),
    },
  } as any;
}

const PROJECT_ID = 1;

function assertWellShaped(radar: any) {
  assert.ok(radar, 'team_radar must be present (not null)');
  // 8 canonical axes, every one shaped + normalized to a 0..1 fraction.
  assert.equal(radar.axes.length, RADAR_AXES.length, 'one entry per canonical axis');
  for (const ax of radar.axes) {
    assert.equal(typeof ax.slug, 'string');
    assert.equal(typeof ax.label, 'string');
    assert.equal(typeof ax.value, 'number');
    assert.ok(ax.value >= 0 && ax.value <= 1, `axis value 0..1, got ${ax.value} for ${ax.slug}`);
    assert.equal(typeof ax.gap, 'boolean');
  }
  // Axis slugs match the canonical taxonomy in order.
  assert.deepEqual(radar.axes.map((a: any) => a.slug), RADAR_AXES.map((a) => a.slug));
  // Dashed ideal reference is a constant 0..1 fraction.
  assert.equal(typeof radar.ideal, 'number');
  assert.ok(radar.ideal > 0 && radar.ideal <= 1, `ideal 0..1, got ${radar.ideal}`);
  // Gaps reference real axes and carry suggested roles.
  const axisSlugs = new Set(radar.axes.map((a: any) => a.slug));
  for (const g of radar.gaps) {
    assert.ok(axisSlugs.has(g.slug), `gap slug ${g.slug} must be a real axis`);
    assert.equal(typeof g.label, 'string');
    assert.ok(Array.isArray(g.roles), 'gap.roles is an array');
    assert.ok(g.roles.length >= 1 && g.roles.length <= 2, `gap roles 1..2, got ${g.roles.length}`);
  }
}

test('team_radar (a) solo founder — member_count 1, has_data true, shaped', async () => {
  const env = makeEnv({
    founderId: 1,
    usersSkills: { 1: { product: 5, engineering: 4 } },
  });
  const data = await fillAxalSpinoutDemoDay(env, 1, PROJECT_ID);
  const radar = data.mentor_network.team_radar;
  assertWellShaped(radar);
  assert.equal(radar!.member_count, 1, 'solo founder → exactly one member');
  assert.equal(radar!.has_data, true, 'solo founder with rated skills → has_data');
  // The rated axes plot above zero; an unrated axis is a gap.
  const product = radar!.axes.find((a) => a.slug === 'product')!;
  assert.ok(product.value > 0, 'rated axis plots above zero');
  assert.equal(product.gap, false, 'a strong axis is not a gap');
  const legal = radar!.axes.find((a) => a.slug === 'legal_compliance')!;
  assert.equal(legal.value, 0, 'unrated axis is zero');
  assert.equal(legal.gap, true, 'unrated axis is a gap');
});

test('team_radar (b) multi-founder via active cofounder connection — member_count 2, gaps with roles', async () => {
  const env = makeEnv({
    founderId: 1,
    usersSkills: {
      1: { product: 5, engineering: 4 },
      2: { design: 5, gtm_sales: 4 },
    },
    connections: [{ user_a_id: 1, user_b_id: 2 }],
  });
  const data = await fillAxalSpinoutDemoDay(env, 1, PROJECT_ID);
  const radar = data.mentor_network.team_radar;
  assertWellShaped(radar);
  assert.equal(radar!.member_count, 2, 'founder + 1 active cofounder → two members');
  assert.equal(radar!.has_data, true, 'team with rated skills → has_data');
  // Cofounder coverage lifts the cofounder's strong axes out of "gap".
  const design = radar!.axes.find((a) => a.slug === 'design')!;
  assert.ok(design.value > 0, 'cofounder skill contributes team coverage');
  assert.equal(design.gap, false, 'covered axis is not a gap');
  // Axes nobody covers remain gaps and surface suggested hiring roles.
  const finance = radar!.gaps.find((g) => g.slug === 'finance_ops');
  assert.ok(finance, 'uncovered axis is reported as a gap');
  assert.ok(finance!.roles.length >= 1, 'gap axis carries suggested roles');
});

test('team_radar (c) founder with no skills data — has_data false, degrades gracefully', async () => {
  const env = makeEnv({ founderId: 1, usersSkills: {} });
  const data = await fillAxalSpinoutDemoDay(env, 1, PROJECT_ID);
  const radar = data.mentor_network.team_radar;
  assertWellShaped(radar);
  assert.equal(radar!.has_data, false, 'no rated skills → has_data false');
  assert.equal(radar!.member_count, 1, 'solo, no connections');
  // Degradation is honest: every axis is zero and flagged a gap.
  for (const ax of radar!.axes) {
    assert.equal(ax.value, 0, `axis ${ax.slug} is zero with no data`);
    assert.equal(ax.gap, true, `axis ${ax.slug} is a gap with no data`);
  }
});
