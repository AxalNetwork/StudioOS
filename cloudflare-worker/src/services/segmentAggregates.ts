/** D1001 (#2816): aggregate-only sign-up answers and displayed archetypes.
 * SQL returns counts, never member identifiers, open text or numeric samples.
 * Population and primary tie-break match D999. No request-selected cohorts.
 */
import type { Env } from '../types';
import { PERSONA_BY_ID, type PersonaQuestion } from '../personas';
import { ARCHETYPES_PROFILE_V2 } from './archetypeScoring';
import { SMALL_CELL_MIN, suppressGroup, type Cell } from './profileEvolution';

const POPULATION = `SELECT u.id FROM users u
  JOIN user_personas p ON p.id = (
    SELECT MAX(p2.id) FROM user_personas p2 WHERE p2.user_id = u.id AND p2.is_primary = 1
  )
  WHERE p.persona_id = ? AND COALESCE(u.role, '') <> 'admin'
    AND COALESCE(u.is_active, 1) <> 0`;
const MISSING = 'not_recorded';
type Bucket = { key: string; label: string; min: number; max: number | null };

function bucketsFor(key: string): Bucket[] {
  const edges = key === 'aum_usd' ? [0, 1e6, 1e7, 1e8]
    : key.endsWith('_usd') ? [0, 1e4, 2.5e4, 5e4]
      : key === 'deals_per_year' ? [0, 3, 6] : [0, 5, 10, 20];
  const fmt = (n: number) => key.endsWith('_usd')
    ? `$${n >= 1e6 ? `${n / 1e6}m` : `${n / 1e3}k`}` : String(n);
  return edges.map((min, i) => ({
    key: `band_${i}`, min, max: edges[i + 1] ?? null,
    label: i === 0 ? `Under ${fmt(edges[1])}` : edges[i + 1] === undefined
      ? `${fmt(min)} and over` : `${fmt(min)} to under ${fmt(edges[i + 1])}`,
  }));
}

const hidden = (): Cell => ({ count: null, suppressed: true });
function partition(counts: number[]) {
  const { cells } = suppressGroup(counts);
  // D999 exposes the member total. For a whole segment under five, hide
  // every cell, including zeros. Choosing just one zero companion by
  // position would reveal which hidden cell actually held the members.
  const total = counts.reduce((a, b) => a + b, 0);
  if (total > 0 && total < SMALL_CELL_MIN) {
    cells.forEach((_, i) => { cells[i] = hidden(); });
  }
  // An answered/profiled subtotal would undo complementary suppression when
  // the missing cell or one constituent was hidden. Publish no such subtotal.
  const recorded = cells.some((c) => c.suppressed) ? hidden()
    : { count: counts.slice(0, -1).reduce((a, b) => a + b, 0), suppressed: false };
  return { cells, recorded };
}

async function counts<T>(env: Env, sql: string, bindings: unknown[]): Promise<T[]> {
  const result = await env.DB.prepare(sql).bind(...bindings).all<T>();
  if (('success' in result && !result.success) || !Array.isArray(result.results)) throw new Error('Aggregate read failed');
  return result.results;
}

export async function segmentAnswers(env: Env, segment: string) {
  const persona = PERSONA_BY_ID[segment as keyof typeof PERSONA_BY_ID];
  const definitions = persona.follow_up_questions.map((q) => ({ ...q, buckets: q.type === 'number' ? bucketsFor(q.key) : [] }));
  const rows = await counts<{ question_key: string; bucket: string; n: number }>(env, `
    WITH members AS (${POPULATION}),
    inputs AS (
      SELECT json_extract(q.value, '$.key') AS question_key,
             json_extract(q.value, '$.type') AS kind,
             json_extract(q.value, '$.choices') AS choices,
             json_extract(q.value, '$.buckets') AS buckets,
             e.value AS answer,
             CASE WHEN json_valid(trim(e.value)) THEN
               CASE WHEN json_type(trim(e.value)) IN ('integer', 'real')
                    THEN json_extract(trim(e.value), '$') END END AS numeric_answer
      FROM members m CROSS JOIN json_each(?) q
      LEFT JOIN user_profile_extras e ON e.id = (
        SELECT MAX(e2.id) FROM user_profile_extras e2
        WHERE e2.user_id = m.id AND e2.persona_id = ? AND e2.key = json_extract(q.value, '$.key')
      )
    ), classified AS (
      SELECT question_key, CASE
        WHEN kind = 'text' AND length(trim(answer, char(9) || char(10) || char(13) || ' ')) > 0 THEN 'answered'
        WHEN kind = 'choice' AND answer IN (SELECT value FROM json_each(choices)) THEN answer
        WHEN kind = 'number' AND numeric_answer >= 0 AND numeric_answer <= 1.7976931348623157e308 THEN (
          SELECT json_extract(b.value, '$.key') FROM json_each(buckets) b
          WHERE numeric_answer >= json_extract(b.value, '$.min')
            AND (json_extract(b.value, '$.max') IS NULL OR numeric_answer < json_extract(b.value, '$.max'))
          LIMIT 1
        ) END AS bucket FROM inputs
    )
    SELECT question_key, COALESCE(bucket, 'not_recorded') AS bucket, COUNT(*) AS n
    FROM classified GROUP BY question_key, COALESCE(bucket, 'not_recorded')`,
  [segment, JSON.stringify(definitions), segment]);
  const questions = definitions.map((q) => {
    const labels = q.type === 'text' ? [{ key: 'answered', label: 'Answered' }]
      : q.type === 'choice' ? (q.choices || []).map((value) => ({ key: value, label: value }))
        : q.buckets.map(({ key, label }) => ({ key, label }));
    const n = (key: string) => Number(rows.find((r) => r.question_key === q.key && r.bucket === key)?.n ?? 0);
    const { cells, recorded } = partition([...labels.map((b) => n(b.key)), n(MISSING)]);
    return {
      key: q.key, prompt: q.prompt, type: q.type as PersonaQuestion['type'],
      answered: q.type === 'text' ? cells[0] : recorded,
      not_recorded: { label: 'Not recorded', ...cells[cells.length - 1] },
      buckets: q.type === 'text' ? [] : labels.map((b, i) => ({ ...b, ...cells[i] })),
    };
  });
  return { segment, small_cell_min: SMALL_CELL_MIN, themes_enabled: false, questions };
}

// Use code labels only: an unknown stored slug cannot become a response label.
const ARCHETYPES = Object.entries(ARCHETYPES_PROFILE_V2).flatMap(([persona, defs]) =>
  defs.map(({ slug, label }) => ({ persona, slug, label })));

export async function segmentArchetypes(env: Env, segment: string) {
  const rows = await counts<{ persona: string | null; slug: string | null; n: number }>(env, `
    WITH members AS (${POPULATION})
    SELECT s.persona AS persona, s.displayed_slug AS slug, COUNT(*) AS n
    FROM members m LEFT JOIN profile_snapshots s ON s.id = (
      SELECT MAX(s2.id) FROM profile_snapshots s2 WHERE s2.user_id = m.id
    )
    GROUP BY s.persona, s.displayed_slug`, [segment]);
  const values = ARCHETYPES.map((a) => rows.filter((r) => r.persona === a.persona && r.slug === a.slug).reduce((n, r) => n + Number(r.n), 0));
  const missing = rows.filter((r) => !ARCHETYPES.some((a) => a.persona === r.persona && a.slug === r.slug))
    .reduce((n, r) => n + Number(r.n), 0);
  const { cells, recorded } = partition([...values, missing]);
  return {
    segment, small_cell_min: SMALL_CELL_MIN, profiled: recorded,
    not_recorded: { label: 'Not recorded', ...cells[cells.length - 1] },
    archetypes: ARCHETYPES.map((a, i) => ({ ...a, ...cells[i] })),
  };
}
