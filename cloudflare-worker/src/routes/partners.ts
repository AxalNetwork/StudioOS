import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { computeRadar } from '../services/radar';
import { RADAR_AXES } from '../services/skillsTaxonomySchema';
import { filterOptedInUserIds } from '../services/matchingConsent';
import { logMatchListGeneration } from '../services/matchAudit';

const partners = new Hono<{ Bindings: Env }>();
const RADAR_AXIS_SLUGS: readonly string[] = RADAR_AXES.map((a) => a.slug);

function cosineSimilarity(a: Record<number, number>, b: Record<number, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const ids = new Set<number>([...Object.keys(a).map(Number), ...Object.keys(b).map(Number)]);
  for (const id of ids) {
    const av = a[id] || 0;
    const bv = b[id] || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

// Listing returns each partner row. Admins additionally get linked-user
// metadata (email, KYC, active, verified) so they can open the full
// user-profile modal from a partner row. Non-admin authenticated users
// (founder/partner/investor/advisor) only get the public partner directory
// fields PLUS the linked user_id (Task #39 — needed by the partner-row
// trust-score badge for admin/investor/partner viewers; the trust-score
// endpoint itself enforces viewer-role access). No other users'
// account/KYC info is leaked on the non-admin path.
partners.get('/', async (c) => {
  const me = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = me.role === 'admin'
    ? await sql`
        SELECT p.*, u.id AS user_id, u.email AS user_email, u.is_active AS user_is_active,
               u.email_verified AS user_email_verified, u.kyc_status AS user_kyc_status
          FROM partners p
          LEFT JOIN users u ON u.partner_id = p.id
         ORDER BY p.created_at DESC`
    : await sql`
        SELECT p.*, u.id AS user_id
          FROM partners p
          LEFT JOIN users u ON u.partner_id = p.id
         ORDER BY p.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

partners.post('/', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const refCode = `AXAL-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const sql = getSQL(c.env);
  const [partner] = await sql`INSERT INTO partners (name, company, email, specialization, referral_code) VALUES (${data.name}, ${data.company || null}, ${data.email}, ${data.specialization || null}, ${refCode}) RETURNING *`;
  await sql.end();
  return c.json(partner, 201);
});

partners.get('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM partners WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Partner not found' }, 404);
  return c.json(rows[0]);
});

partners.get('/referral/:code', async (c) => {
  await requireAuth(c);
  const code = c.req.param('code');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM partners WHERE referral_code = ${code}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Invalid referral code' }, 404);
  return c.json(rows[0]);
});

partners.post('/referral/:code/use', async (c) => {
  await requireAuth(c);
  const code = c.req.param('code');
  const sql = getSQL(c.env);
  const rows = await sql`UPDATE partners SET referrals_count = referrals_count + 1 WHERE referral_code = ${code} RETURNING *`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Invalid referral code' }, 404);
  return c.json({ message: 'Referral tracked', partner: rows[0] });
});

partners.get('/matchmaking/recommend', async (c) => {
  const me = await requireAuth(c);
  const sector = c.req.query('sector');
  const sql = getSQL(c.env);
  const rows = sector
    ? await sql`SELECT p.*, u.id AS user_id FROM partners p LEFT JOIN users u ON u.partner_id = p.id WHERE p.status = 'active' AND p.accepting_intros = 1 AND p.specialization LIKE ${'%' + sector + '%'}`
    : await sql`SELECT p.*, u.id AS user_id FROM partners p LEFT JOIN users u ON u.partner_id = p.id WHERE p.status = 'active' AND p.accepting_intros = 1`;
  await sql.end();
  // Task #19 — hard consent filter: drop linked-user partners not opted into
  // matching; keep directory-only partners (no linked user). Strip the joined
  // user_id so the response shape is unchanged.
  const optedIn = await filterOptedInUserIds(c.env, (rows as any[]).map((r) => Number(r.user_id)));
  const matches = (rows as any[])
    .filter((r) => !r.user_id || optedIn.has(Number(r.user_id)))
    .map(({ user_id, ...rest }: any) => rest);
  await logMatchListGeneration(c.env, me as any, 'partner_matchmaking_recommend', { result_count: matches.length });
  return c.json({ matches, count: matches.length });
});

partners.post('/matchPartners', async (c) => {
  const me = await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const allPartners = await sql`SELECT p.*, u.id AS user_id FROM partners p LEFT JOIN users u ON u.partner_id = p.id WHERE p.status = 'active' AND p.accepting_intros = 1`;
  await sql.end();

  // Task #19 — hard consent filter (see /matchmaking/recommend above).
  const optedIn = await filterOptedInUserIds(c.env, (allPartners as any[]).map((p) => Number(p.user_id)));
  const visiblePartners = (allPartners as any[]).filter((p) => !p.user_id || optedIn.has(Number(p.user_id)));

  const ranked = visiblePartners.map((p: any) => {
    let score = 10;
    const reasons: string[] = [];
    if (data.sector && p.specialization) {
      const specs = p.specialization.toLowerCase().replace(/\//g, ',').split(',').map((s: string) => s.trim());
      if (specs.includes(data.sector.toLowerCase())) { score += 40; reasons.push(`Sector match: ${p.specialization}`); }
    }
    if (data.expertise_needed && p.specialization) {
      for (const kw of data.expertise_needed.split(',')) {
        if (p.specialization.toLowerCase().includes(kw.trim().toLowerCase())) { score += 20; reasons.push(`Expertise match: ${kw.trim()}`); }
      }
    }
    if (p.referrals_count > 0) { score += Math.min(p.referrals_count * 5, 20); reasons.push(`Referral track record: ${p.referrals_count}`); }
    return { partner_id: p.id, name: p.name, company: p.company, specialization: p.specialization, match_score: Math.min(score, 100), reasons, referral_code: p.referral_code };
  }).sort((a: any, b: any) => b.match_score - a.match_score);

  // Task #19 — audit when an admin generates this partner match list (no-op otherwise).
  await logMatchListGeneration(c.env, me as any, 'partner_match_legacy', { result_count: ranked.length });

  return c.json({ startup_id: data.startup_id, matches: ranked, total_matched: ranked.length });
});

// ---------------------------------------------------------------------------
// Task #15 — Intent-scoped partner matching.
// ---------------------------------------------------------------------------
// Weights:
//   domain_fit          0.50
//   track_record        0.25
//   values_alignment    0.15
//   availability_capacity 0.10
//
// Domain fit uses the radar axis for the requested intent when the partner
// has a linked user account (skills taxonomy + endorsements). Otherwise it
// falls back to a keyword match against the partner's specialization.
// ---------------------------------------------------------------------------

partners.post('/match', async (c) => {
  const me = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const intent = (body.intent || '') as string;
  if (!RADAR_AXIS_SLUGS.includes(intent)) {
    return c.json({ error: 'Invalid intent. Must be one of: ' + RADAR_AXIS_SLUGS.join(', ') }, 400);
  }

  const sql = getSQL(c.env);

  // Load only active partners that are accepting intros.
  const allPartners = await sql`
    SELECT p.id, p.name, p.company, p.email, p.specialization, p.referral_code,
           p.referrals_count, u.id AS user_id
      FROM partners p
      LEFT JOIN users u ON u.partner_id = p.id
     WHERE p.status = 'active'
       AND p.accepting_intros = 1
     ORDER BY p.id
  `;

  // Task #19 — hard consent filter. Partners with a linked user account are
  // people, so they must have opted into matching to appear. Partners with NO
  // linked user (directory-only contacts, no privacy preference to honor) are
  // kept as before.
  const linkedPartnerUserIds = (allPartners as any[]).map((p) => Number(p.user_id)).filter(Boolean);
  const optedInPartners = await filterOptedInUserIds(c.env, linkedPartnerUserIds);
  const visiblePartners = (allPartners as any[]).filter(
    (p) => !p.user_id || optedInPartners.has(Number(p.user_id)),
  );

  // Load founder's values vector for alignment computation.
  const founderValuesRows = await sql`
    SELECT v.dimension_id, v.score, v.confidence
      FROM user_values v
     WHERE v.user_id = ${me.id}
  `;
  const founderValues: Record<number, number> = {};
  for (const r of founderValuesRows) {
    founderValues[Number(r.dimension_id)] = Number(r.score) * Number(r.confidence);
  }

  // Pre-compute radar for every partner that has a linked user account.
  const partnerWithUser = visiblePartners.filter((p: any) => p.user_id);
  const radarByUserId = new Map<number, number>(); // user_id → axis score (0-100)
  for (const p of partnerWithUser) {
    const uid = Number(p.user_id);
    const radar = await computeRadar(c.env, [uid]);
    const axis = radar.axes.find((a) => a.slug === intent);
    radarByUserId.set(uid, axis?.score ?? 0);
  }

  // Load partner values for alignment computation.
  const userIds = partnerWithUser.map((p: any) => Number(p.user_id));
  const partnerValuesMap = new Map<number, Record<number, number>>(); // user_id → dim→score
  if (userIds.length > 0) {
    const ph = userIds.map(() => '?').join(',');
    const valuesRows = await sql.unsafe(
      `SELECT user_id, dimension_id, score, confidence FROM user_values WHERE user_id IN (${ph})`,
      userIds,
    );
    for (const r of valuesRows) {
      const uid = Number(r.user_id);
      const dim = Number(r.dimension_id);
      const score = Number(r.score) * Number(r.confidence);
      let m = partnerValuesMap.get(uid);
      if (!m) { m = {}; partnerValuesMap.set(uid, m); }
      m[dim] = score;
    }
  }

  // Load partner endorsement counts for track_record.
  const endorsementMap = new Map<number, number>(); // user_id → count
  if (userIds.length > 0) {
    const ph = userIds.map(() => '?').join(',');
    const endRows = await sql.unsafe(
      `SELECT endorsee_id, COUNT(*) AS n FROM skill_endorsements WHERE endorsee_id IN (${ph}) GROUP BY endorsee_id`,
      userIds,
    );
    for (const r of endRows) {
      endorsementMap.set(Number(r.endorsee_id), Number(r.n));
    }
  }

  // Load partner profile capacity for availability_capacity.
  // partner_profiles is keyed by invitation_id; it has a user_id FK that
  // links to users.id, and users.partner_id links to partners.id. Query by
  // user_id instead since we already have the partner-linked user_ids.
  const partnerWithUserIds = visiblePartners.filter((p: any) => p.user_id);
  const partnerUserIds = partnerWithUserIds.map((p: any) => Number(p.user_id));
  const userIdToPartnerId = new Map<number, number>();
  for (const p of partnerWithUserIds) userIdToPartnerId.set(Number(p.user_id), Number(p.id));
  const capacityMap = new Map<number, number>(); // partner_id → capacity 0-100
  if (partnerUserIds.length > 0) {
    const ph = partnerUserIds.map(() => '?').join(',');
    const capRows = await sql.unsafe(
      `SELECT user_id, capacity_per_month FROM partner_profiles WHERE user_id IN (${ph})`,
      partnerUserIds,
    );
    for (const r of capRows) {
      const uid = Number(r.user_id);
      const pid = userIdToPartnerId.get(uid);
      if (pid == null) continue;
      const raw = String(r.capacity_per_month || '').toLowerCase().trim();
      let score = 50;
      if (raw === 'full-time') score = 100;
      else if (raw === 'part-time') score = 60;
      else if (raw === 'advisory') score = 30;
      else if (raw === 'project') score = 40;
      else if (raw === 'none') score = 0;
      else if (raw === 'limited') score = 20;
      else if (raw.includes('10+')) score = 90;
      else if (raw.includes('5-10')) score = 70;
      else if (raw.includes('1-5')) score = 50;
      else if (raw.includes('0-1')) score = 20;
      capacityMap.set(pid, score);
    }
  }

  await sql.end();

  const results = visiblePartners.map((p: any) => {
    const reasons: string[] = [];

    // 1. domain_fit (0-100)
    let domainScore = 0;
    const uid = p.user_id ? Number(p.user_id) : null;
    if (uid && radarByUserId.has(uid)) {
      domainScore = radarByUserId.get(uid)!;
      if (domainScore > 0) reasons.push(`Domain fit on ${intent}: ${domainScore}`);
    }
    // Fallback: keyword match against specialization when radar is 0 or absent.
    if (domainScore === 0 && intent && p.specialization) {
      const intentKeywords = RADAR_AXES.find((a) => a.slug === intent)?.legacy || [intent];
      const spec = p.specialization.toLowerCase();
      for (const kw of intentKeywords) {
        if (spec.includes(kw.toLowerCase())) {
          domainScore = 60;
          reasons.push(`Keyword match: ${kw}`);
          break;
        }
      }
    }

    // 2. track_record (0-100) — referral count + endorsements
    let trackScore = 0;
    const refBonus = Math.min(p.referrals_count * 10, 40);
    const endorseCount = uid ? (endorsementMap.get(uid) || 0) : 0;
    const endBonus = Math.min(endorseCount * 5, 20);
    trackScore = Math.min(refBonus + endBonus, 100);
    reasons.push(`Track record: ${p.referrals_count} referrals${endorseCount > 0 ? `, ${endorseCount} endorsements` : ''}`);

    // 3. values_alignment (0-100) — cosine similarity of user_values vectors
    let valuesScore = 0;
    if (uid && partnerValuesMap.has(uid) && Object.keys(founderValues).length > 0) {
      const pv = partnerValuesMap.get(uid)!;
      valuesScore = Math.round(cosineSimilarity(founderValues, pv) * 100);
      if (valuesScore > 0) reasons.push(`Values alignment: ${valuesScore}`);
    }

    // 4. availability_capacity (0-100)
    const availScore = capacityMap.get(Number(p.id)) ?? 50;
    if (availScore > 0) reasons.push(`Availability: ${availScore}`);

    const overall = Math.round(
      domainScore * 0.50 +
      trackScore * 0.25 +
      valuesScore * 0.15 +
      availScore * 0.10,
    );

    return {
      partner_id: p.id,
      name: p.name,
      company: p.company,
      specialization: p.specialization,
      referral_code: p.referral_code,
      match_score: overall,
      breakdown: {
        domain_fit: domainScore,
        track_record: trackScore,
        values_alignment: valuesScore,
        availability_capacity: availScore,
      },
      reasons,
    };
  }).sort((a: any, b: any) => b.match_score - a.match_score);

  // Task #19 — audit when an admin generates a partner match list (no-op otherwise).
  await logMatchListGeneration(c.env, me as any, 'partner_match', {
    intent,
    result_count: results.length,
  });

  return c.json({ intent, matches: results, total_matched: results.length });
});

export default partners;
