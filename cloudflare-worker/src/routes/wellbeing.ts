/**
 * T11 — Founder Wellbeing (port of backend/app/api/routes/wellbeing.py).
 *
 * Endpoints (mounted at /api/wellbeing in index.ts):
 *   POST   /checkins                   — submit weekly pulse (founder/admin)
 *   GET    /checkins                   — list THIS user's history
 *   GET    /aggregate?days=30|90       — admin-only anonymized aggregate
 *   GET    /resources                  — list curated resources (any auth user)
 *   POST   /resources                  — admin only
 *   DELETE /resources/:id              — admin only
 *
 * Privacy contract (preserved verbatim from the Python source):
 *   • Per-row check-ins are visible ONLY to the authoring founder.
 *   • Investors are explicitly forbidden from /checkins and /aggregate.
 *   • Aggregate cohort floor = 7. Allowed windows = 30 or 90 days only.
 *     Counts bucketed to the nearest 5; means rounded to 1dp.
 *   • Answers are AES-GCM ciphertext on disk (services/cryptoBox.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { encryptString, decryptInt, decryptString } from '../services/cryptoBox';

const wellbeing = new Hono<{ Bindings: Env }>();

const MIN_AGGREGATE_COHORT = 7;
const ALLOWED_AGGREGATE_WINDOWS = [30, 90] as const;
const COUNT_BUCKET = 5;
const QUESTION_KEYS = ['stress', 'sleep', 'support', 'decisions', 'energy'] as const;
type QKey = typeof QUESTION_KEYS[number];

const ALLOWED_RESOURCE_CATEGORIES = new Set(['therapy', 'peer_group', 'hotline', 'reading', 'coaching']);

function bucket(n: number, step = COUNT_BUCKET): number {
  if (n <= 0) return 0;
  return Math.floor(n / step) * step;
}

function role(user: { role: string }): string {
  return String(user.role || '').toLowerCase();
}

// Monday of the ISO week containing `d` (UTC), as 'YYYY-MM-DD'.
function weekAnchor(d: Date = new Date()): string {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

function uuidHex(): string {
  // 32 hex chars, matches the Python uuid4().hex shape used in the source.
  return crypto.randomUUID().replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// Pulse check-ins
// ---------------------------------------------------------------------------
type CheckinRow = {
  id: number; uid: string; user_id: number; week_anchor: string;
  stress_enc: string; sleep_enc: string; support_enc: string;
  decisions_enc: string; energy_enc: string; notes_enc: string | null;
  created_at: string;
};

async function serializeOwn(env: Env, row: CheckinRow) {
  const [stress, sleep, support, decisions, energy, notes] = await Promise.all([
    decryptInt(env, row.stress_enc),
    decryptInt(env, row.sleep_enc),
    decryptInt(env, row.support_enc),
    decryptInt(env, row.decisions_enc),
    decryptInt(env, row.energy_enc),
    row.notes_enc ? decryptString(env, row.notes_enc) : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    uid: row.uid,
    week_anchor: row.week_anchor,
    created_at: row.created_at,
    stress, sleep, support, decisions, energy,
    notes,
  };
}

wellbeing.post('/checkins', async (c) => {
  const user = await requireAuth(c);
  const r = role(user);
  if (r !== 'founder' && r !== 'admin') {
    return c.json({ detail: 'Founders only' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  // Validate the five 1..5 integer answers + optional notes (≤4000 chars).
  const intAnswer = (k: QKey) => {
    const v = Number((body as any)?.[k]);
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`Field ${k} must be an integer 1..5`);
    }
    return v;
  };
  let answers: Record<QKey, number>;
  try {
    answers = {
      stress: intAnswer('stress'),
      sleep: intAnswer('sleep'),
      support: intAnswer('support'),
      decisions: intAnswer('decisions'),
      energy: intAnswer('energy'),
    };
  } catch (e: any) {
    return c.json({ detail: e?.message || 'Invalid payload' }, 400);
  }
  const rawNotes = (body as any)?.notes ?? null;
  if (rawNotes != null && (typeof rawNotes !== 'string' || rawNotes.length > 4000)) {
    return c.json({ detail: 'notes must be a string ≤ 4000 chars' }, 400);
  }

  const anchor = weekAnchor();
  const newUid = uuidHex();
  const [s_e, sl_e, su_e, d_e, en_e] = await Promise.all([
    encryptString(c.env, String(answers.stress)),
    encryptString(c.env, String(answers.sleep)),
    encryptString(c.env, String(answers.support)),
    encryptString(c.env, String(answers.decisions)),
    encryptString(c.env, String(answers.energy)),
  ]);
  const notesEnc = rawNotes ? await encryptString(c.env, rawNotes) : null;

  // Atomic upsert keyed on (user_id, week_anchor) so concurrent submits
  // are last-write-wins instead of dropping the loser.
  await c.env.DB.prepare(
    `INSERT INTO wellbeing_checkins
       (uid, user_id, week_anchor, stress_enc, sleep_enc, support_enc,
        decisions_enc, energy_enc, notes_enc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, week_anchor) DO UPDATE SET
       stress_enc    = excluded.stress_enc,
       sleep_enc     = excluded.sleep_enc,
       support_enc   = excluded.support_enc,
       decisions_enc = excluded.decisions_enc,
       energy_enc    = excluded.energy_enc,
       notes_enc     = excluded.notes_enc,
       created_at    = excluded.created_at`,
  ).bind(newUid, user.id, anchor, s_e, sl_e, su_e, d_e, en_e, notesEnc).run();

  const row = await c.env.DB.prepare(
    'SELECT * FROM wellbeing_checkins WHERE user_id = ? AND week_anchor = ?',
  ).bind(user.id, anchor).first<CheckinRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(await serializeOwn(c.env, row));
});

wellbeing.get('/checkins', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') {
    return c.json({ detail: 'Not available for investors' }, 403);
  }
  const limitRaw = Number(c.req.query('limit') ?? 26);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 26, 200));
  const res = await c.env.DB.prepare(
    `SELECT * FROM wellbeing_checkins
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
  ).bind(user.id, limit).all<CheckinRow>();
  const rows = (res.results || []) as CheckinRow[];
  const serialized = await Promise.all(rows.map((r) => serializeOwn(c.env, r)));
  const thisWeek = weekAnchor();
  return c.json({
    checkins: serialized,
    this_week_anchor: thisWeek,
    submitted_this_week: rows.some((r) => r.week_anchor === thisWeek),
  });
});

// ---------------------------------------------------------------------------
// Aggregate (admin only)
// ---------------------------------------------------------------------------
wellbeing.get('/aggregate', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  const days = Number(c.req.query('days') ?? 30);
  if (!ALLOWED_AGGREGATE_WINDOWS.includes(days as 30 | 90)) {
    return c.json({
      detail: `days must be one of ${JSON.stringify(ALLOWED_AGGREGATE_WINDOWS)} for privacy`,
    }, 400);
  }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await c.env.DB.prepare(
    `SELECT user_id, stress_enc, sleep_enc, support_enc, decisions_enc, energy_enc
       FROM wellbeing_checkins
      WHERE created_at >= ?`,
  ).bind(cutoff).all<Pick<CheckinRow, 'user_id' | 'stress_enc' | 'sleep_enc' | 'support_enc' | 'decisions_enc' | 'energy_enc'>>();
  const rows = res.results || [];
  const distinct = new Set(rows.map((r: any) => r.user_id));
  const cohort = distinct.size;

  // Audit log line — sensitive even when anonymized.
  console.log(
    `wellbeing aggregate access by admin user_id=${user.id} window_days=${days} cohort=${cohort}`,
  );

  if (cohort < MIN_AGGREGATE_COHORT) {
    return c.json({
      window_days: days,
      cohort_size: bucket(cohort),
      submissions: bucket(rows.length),
      insufficient_data: true,
      min_cohort: MIN_AGGREGATE_COHORT,
      averages: null,
    });
  }
  const buckets: Record<QKey, number[]> = {
    stress: [], sleep: [], support: [], decisions: [], energy: [],
  };
  for (const r of rows as any[]) {
    for (const k of QUESTION_KEYS) {
      const v = await decryptInt(c.env, r[`${k}_enc`]);
      if (v != null) buckets[k].push(v);
    }
  }
  const averages: Record<QKey, number | null> = {} as any;
  for (const k of QUESTION_KEYS) {
    averages[k] = buckets[k].length
      ? Math.round((buckets[k].reduce((s, v) => s + v, 0) / buckets[k].length) * 10) / 10
      : null;
  }
  return c.json({
    window_days: days,
    cohort_size: bucket(cohort),
    submissions: bucket(rows.length),
    insufficient_data: false,
    averages,
  });
});

// ---------------------------------------------------------------------------
// Resource directory
// ---------------------------------------------------------------------------
type ResourceRow = {
  id: number; uid: string; category: string; name: string;
  description: string | null; url: string | null; region: string | null;
  is_24_7: number; is_free: number; sort_order: number;
  created_at: string;
};

const DEFAULT_RESOURCES: Array<Omit<ResourceRow, 'id' | 'uid' | 'created_at'>> = [
  { category: 'hotline', name: '988 Suicide & Crisis Lifeline (US)',
    description: "Free, confidential 24/7 support if you're in crisis or know someone who is. Call or text 988.",
    url: 'https://988lifeline.org', region: 'us', is_24_7: 1, is_free: 1, sort_order: 1 },
  { category: 'hotline', name: 'Samaritans (UK & Ireland)',
    description: 'Free 24/7 emotional support. Call 116 123 from UK or Ireland.',
    url: 'https://www.samaritans.org', region: 'uk', is_24_7: 1, is_free: 1, sort_order: 2 },
  { category: 'peer_group', name: 'Founders Network — Mental Health Circle',
    description: 'Peer support group for founders navigating burnout, stress, and isolation.',
    url: 'https://foundersnetwork.com', region: 'global', is_24_7: 0, is_free: 0, sort_order: 10 },
  { category: 'peer_group', name: 'Reboot.io — Founder Coaching Community',
    description: 'Coaching circles + writing on the inner work of leadership.',
    url: 'https://www.reboot.io', region: 'global', is_24_7: 0, is_free: 0, sort_order: 11 },
  { category: 'therapy', name: 'BetterHelp — online therapy',
    description: 'Matched 1:1 with a licensed therapist; sessions by video, phone, or chat.',
    url: 'https://www.betterhelp.com', region: 'global', is_24_7: 0, is_free: 0, sort_order: 20 },
  { category: 'therapy', name: 'Open Path Collective',
    description: 'Affordable in-person and online therapy ($30-$70/session) with vetted clinicians.',
    url: 'https://openpathcollective.org', region: 'us', is_24_7: 0, is_free: 0, sort_order: 21 },
  { category: 'coaching', name: 'The Founder Coach Directory',
    description: 'Curated directory of executive coaches who specialize in early-stage founders.',
    url: 'https://www.foundercoach.directory', region: 'global', is_24_7: 0, is_free: 0, sort_order: 30 },
  { category: 'reading', name: "The Founder's Dilemmas (Noam Wasserman)",
    description: 'Evidence-based read on the human side of starting a company — co-founder splits, equity, control.',
    url: 'https://press.princeton.edu/books/paperback/9780691158303/the-founders-dilemmas',
    region: 'global', is_24_7: 0, is_free: 0, sort_order: 40 },
  { category: 'reading', name: "It's Called Imposter Syndrome (First Round Review)",
    description: 'Free essay on naming and working through imposter syndrome as a founder.',
    url: 'https://review.firstround.com', region: 'global', is_24_7: 0, is_free: 1, sort_order: 41 },
];

function serializeResource(r: ResourceRow) {
  return {
    id: r.id,
    uid: r.uid,
    category: r.category,
    name: r.name,
    description: r.description,
    url: r.url,
    region: r.region,
    is_24_7: !!r.is_24_7,
    is_free: !!r.is_free,
    sort_order: r.sort_order,
    created_at: r.created_at,
  };
}

async function ensureDefaultResources(env: Env): Promise<void> {
  // Idempotent seed keyed on (category, name) — UNIQUE constraint at SQL
  // level catches concurrent inserters.
  for (const spec of DEFAULT_RESOURCES) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO wellbeing_resources
           (uid, category, name, description, url, region, is_24_7, is_free, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uuidHex(), spec.category, spec.name, spec.description, spec.url,
        spec.region, spec.is_24_7, spec.is_free, spec.sort_order,
      ).run();
    } catch (e: any) {
      console.warn('[wellbeing] seed insert failed:', String(e?.message || e));
    }
  }
}

wellbeing.get('/resources', async (c) => {
  await requireAuth(c);
  await ensureDefaultResources(c.env);
  const category = c.req.query('category');
  const region = c.req.query('region');

  let sql = 'SELECT * FROM wellbeing_resources WHERE 1=1';
  const params: any[] = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (region) { sql += ' AND (region = ? OR region = ?)'; params.push(region, 'global'); }
  sql += ' ORDER BY sort_order ASC';

  const res = await c.env.DB.prepare(sql).bind(...params).all<ResourceRow>();
  return c.json({ resources: (res.results || []).map((r: any) => serializeResource(r)) });
});

wellbeing.post('/resources', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const category = String((body as any)?.category || '');
  if (!ALLOWED_RESOURCE_CATEGORIES.has(category)) {
    return c.json({ detail: `category must be one of ${[...ALLOWED_RESOURCE_CATEGORIES].sort()}` }, 400);
  }
  const name = String((body as any)?.name || '').trim();
  if (!name) return c.json({ detail: 'name is required' }, 400);

  const uid = uuidHex();
  await c.env.DB.prepare(
    `INSERT INTO wellbeing_resources
       (uid, category, name, description, url, region, is_24_7, is_free, sort_order, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, category, name,
    (body as any)?.description ?? null,
    (body as any)?.url ?? null,
    (body as any)?.region ?? null,
    (body as any)?.is_24_7 ? 1 : 0,
    (body as any)?.is_free ? 1 : 0,
    Number((body as any)?.sort_order ?? 100),
    user.id,
  ).run();
  const row = await c.env.DB.prepare(
    'SELECT * FROM wellbeing_resources WHERE uid = ?',
  ).bind(uid).first<ResourceRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(serializeResource(row));
});

wellbeing.delete('/resources/:id', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT id FROM wellbeing_resources WHERE id = ?',
  ).bind(id).first<{ id: number }>();
  if (!row) return c.json({ detail: 'Resource not found' }, 404);
  await c.env.DB.prepare('DELETE FROM wellbeing_resources WHERE id = ?').bind(id).run();
  return c.json({ deleted: true });
});

export default wellbeing;
