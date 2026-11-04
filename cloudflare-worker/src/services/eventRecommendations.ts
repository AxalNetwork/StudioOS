/** D1487 (#3724): private, record-backed event signals and bounded D1-only semantic ranking. */
import type { Env, User } from '../types';
import { embedText } from './vectorize';
import { eventTopics, validEventTopics } from './eventTopics';
import { EVENT_TYPE_IDS } from './eventTypes';
import { registrationEligibility } from './eventOrganiser';
import { shapeEvent } from './eventsCommon';

export type Reason = { code: string; text: string; ref: { kind: string; id: number | string } };
type Signal = Reason & { match: string[]; fundraising?: boolean };
export const RECOMMENDATION_DEPS = { embed: embedText };
export const REC_FORMATS = ['virtual', 'in_person', 'hybrid'];
const DEFAULT_PREFS = { enabled: true, interests: [] as string[], goals_90d: null as string | null, formats: [] as string[], types: [] as string[], home_city: null as string | null, travel_km: null as number | null };
export async function readRecPrefs(env: Env, userId: number) {
  const row = await env.DB.prepare('SELECT * FROM event_rec_prefs WHERE user_id = ?').bind(userId).first<any>();
  if (!row) return { ...DEFAULT_PREFS };
  return { enabled: row.enabled === 1, interests: JSON.parse(row.interests_json), goals_90d: row.goals_90d, formats: JSON.parse(row.formats_json), types: JSON.parse(row.types_json), home_city: row.home_city, travel_km: row.travel_km };
}
export function prefsError(b: any): { error: string; field: string } | null {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'bad_field', field: 'prefs' };
  for (const k of Object.keys(b)) if (!Object.hasOwn(DEFAULT_PREFS, k)) return { error: 'bad_field', field: k };
  if ('enabled' in b && typeof b.enabled !== 'boolean') return { error: 'bad_field', field: 'enabled' };
  if ('interests' in b && !validEventTopics(b.interests, 10)) return { error: 'bad_field', field: 'interests' };
  for (const [key, allowed] of [['formats', REC_FORMATS], ['types', EVENT_TYPE_IDS]] as const) {
    if (key in b && (!Array.isArray(b[key]) || b[key].length > allowed.length || new Set(b[key]).size !== b[key].length || b[key].some((v: unknown) => !(allowed as readonly unknown[]).includes(v)))) return { error: 'bad_field', field: key };
  }
  for (const [key, max] of [['goals_90d', 500], ['home_city', 120]] as const) {
    if (key in b && b[key] !== null && typeof b[key] !== 'string') return { error: 'bad_field', field: key };
    if (typeof b[key] === 'string' && b[key].length > max) return { error: 'too_long', field: key };
  }
  if ('travel_km' in b && b.travel_km !== null && (!Number.isInteger(b.travel_km) || b.travel_km < 0 || b.travel_km > 20000)) return { error: 'bad_field', field: 'travel_km' };
  return null;
}
export async function saveRecPrefs(env: Env, userId: number, body: any) {
  const p = { ...await readRecPrefs(env, userId), ...body };
  await env.DB.prepare("INSERT INTO event_rec_prefs (user_id,enabled,interests_json,goals_90d,formats_json,types_json,home_city,travel_km) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,interests_json=excluded.interests_json,goals_90d=excluded.goals_90d,formats_json=excluded.formats_json,types_json=excluded.types_json,home_city=excluded.home_city,travel_km=excluded.travel_km,updated_at=datetime('now')")
    .bind(userId, p.enabled ? 1 : 0, JSON.stringify(p.interests), p.goals_90d, JSON.stringify(p.formats), JSON.stringify(p.types), p.home_city, p.travel_km).run();
  return p;
}
const clean = (v: unknown) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
const STOP_WORDS = new Set(['the','and','for','with','in','at','of','to','an','is']);
const words = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(w => w.length >= 2 && !STOP_WORDS.has(w));
function list(raw: unknown): string[] { const v = JSON.parse(String(raw || '[]')); if (!Array.isArray(v)) throw new Error('invalid signal'); return v.filter(x => typeof x === 'string').map(clean).filter(Boolean); }
export async function ownEventSignals(env: Env, u: Omit<User, 'role'> & { role: string }) {
  const states: Record<string, 'read' | 'not_recorded' | 'unreadable'> = {};
  const signals: Signal[] = [];
  let track: string | null = null;
  async function group(name: string, query: string, map: (r: any) => Signal[], bind: unknown = u.id) {
    try {
      const rows = await env.DB.prepare(query).bind(bind).all<any>();
      if (!Array.isArray(rows.results)) throw new Error('unreadable');
      const found = rows.results.flatMap(map); states[name] = found.length ? 'read' : 'not_recorded'; signals.push(...found);
    } catch { states[name] = 'unreadable'; }
  }
  const sig = (code: string, value: unknown, text: (v: string) => string, kind: string, id: number | string, fundraising = false): Signal[] => clean(value) ? [{ code, text: text(clean(value)), ref: { kind, id }, match: words(clean(value)), fundraising }] : [];
  await group('track', 'SELECT track FROM assessment_results WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', r => { track = clean(r.track) || null; return sig('track', track, () => u.role === 'exploring' ? 'Popular with new members' : 'Matches your track', 'assessment', u.id); });
  if (u.role === 'exploring' && !signals.some(s => s.code === 'track')) signals.push({ code:'track',text:'Popular with new members',ref:{kind:'profile',id:u.id},match:[] });
  if (u.role === 'founder') {
    await group('sector', 'SELECT p.id,p.sector FROM projects p JOIN users u ON u.founder_id=p.founder_id WHERE u.id=? AND p.deleted_at IS NULL ORDER BY p.id LIMIT 20', r => sig('sector', r.sector, v => 'Your venture is in ' + v + '.', 'project', r.id));
    await group('stage', 'SELECT p.id,p.stage FROM projects p JOIN users u ON u.founder_id=p.founder_id WHERE u.id=? AND p.deleted_at IS NULL ORDER BY p.id LIMIT 20', r => sig('stage', r.stage, v => 'Your venture is at ' + v + ' stage.', 'project', r.id));
    await group('raise_round', "SELECT r.id,r.name FROM raise_rounds r JOIN projects p ON p.id=r.project_id JOIN users u ON u.founder_id=p.founder_id WHERE u.id=? AND p.deleted_at IS NULL AND r.status='active' ORDER BY r.id LIMIT 20", r => sig('raise_round', r.name, v => 'You have a ' + v + ' round open.', 'raise_round', r.id, true));
    await group('segment', 'SELECT s.id,s.name FROM customer_segments s JOIN projects p ON p.id=s.project_id JOIN users u ON u.founder_id=p.founder_id WHERE u.id=? AND p.deleted_at IS NULL AND s.archived_at IS NULL ORDER BY s.id LIMIT 20', r => sig('segment', r.name, v => 'Your customer segment is ' + v + '.', 'customer_segment', r.id));
    await group('hiring', "SELECT j.id,j.title FROM job_postings j JOIN projects p ON p.id=j.project_id JOIN users u ON u.founder_id=p.founder_id WHERE u.id=? AND p.deleted_at IS NULL AND j.status='published' ORDER BY j.id LIMIT 20", r => sig('hiring', r.title, v => 'You have an open ' + v + ' post.', 'job_posting', r.id));
  } else if (u.role === 'investor') {
    await group('thesis', 'SELECT sectors_json,stages_json FROM investor_profiles WHERE user_id=?', r => [...list(r.sectors_json), ...list(r.stages_json)].flatMap(v => sig('thesis', v, x => 'Your investment focus includes ' + x + '.', 'investor_profile', u.id)));
  } else if (u.role === 'advisor') {
    await group('service', 'SELECT s.id,s.title FROM advisor_services s JOIN advisors a ON a.id=s.advisor_id WHERE a.user_id=? AND s.is_active=1 ORDER BY s.id LIMIT 20', r => sig('service', r.title, v => 'Your service is ' + v + '.', 'advisor_service', r.id));
  } else if (u.role === 'partner') {
    await group('engagement', "SELECT e.id,p.name,p.stage FROM engagements e JOIN users u ON u.partner_id=e.partner_id JOIN projects p ON p.id=e.project_id WHERE u.id=? AND p.deleted_at IS NULL AND e.status NOT IN ('cancelled','completed') ORDER BY e.id LIMIT 20", r => sig('engagement', clean(r.name) + (clean(r.stage) ? ' at ' + clean(r.stage) + ' stage' : ''), v => 'Your engagement is with ' + v + '.', 'engagement', r.id));
  }
  return { states, signals, track };
}
export function rulesFor(event: any, signals: Signal[], prefs: Awaited<ReturnType<typeof readRecPrefs>>, affinity: Set<string>) {
  const topics = eventTopics(event.topics_json);
  const tokens = new Set(words([event.title,event.summary,event.description,...topics].filter(Boolean).join(' ')));
  const reasons: Reason[] = signals.filter(s => s.code === 'track' ? s.text === 'Popular with new members' || affinity.has(event.type) : s.match.some(w => tokens.has(w)) || (s.fundraising && topics.includes('fundraising'))).map(({ code, text, ref }) => ({ code, text, ref }));
  for (const topic of prefs.interests.filter((t: string) => topics.includes(t))) reasons.push({ code: 'interest', text: 'You are interested in ' + topic.replace(/_/g, ' ') + '.', ref: { kind: 'preferences', id: 'interests' } });
  if (prefs.formats.includes(event.location_kind)) reasons.push({ code: 'format', text: 'This matches your preferred format.', ref: { kind: 'preferences', id: 'formats' } });
  return { reasons, score: reasons.length * 10 + (prefs.types.includes(event.type) ? 10 : 0) + (Number(event.featured) === 1 ? 3 : 0) };
}
async function hash(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2,'0')).join(''); }
export function cosine(a: number[], b: number[]): number {
  if (a.length !== 768 || b.length !== 768 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
  const norm = (v: number[]) => Math.sqrt(v.reduce((s,x) => s+x*x,0));
  const d = norm(a)*norm(b); return d > 0 ? Math.max(-1,Math.min(1,a.reduce((s,x,i) => s+x*b[i],0)/d)) : 0;
}
/** The table/key pairs below are fixed SQL, never a request-supplied identifier. */
async function cachedVector(env: Env, member: boolean, id: number, text: string, budget: { left: number }) {
  const digest = await hash('bge-base-en-v1.5:768:' + text);
  const read = member ? 'SELECT vector FROM event_rec_member_vectors WHERE user_id=? AND content_hash=?' : 'SELECT vector FROM event_rec_vectors WHERE event_id=? AND content_hash=?';
  try {
    const row = await env.DB.prepare(read).bind(id,digest).first<any>();
    if (row) {
      const bytes = row.vector instanceof ArrayBuffer ? new Uint8Array(row.vector) : new Uint8Array(row.vector);
      if (bytes.byteLength === 768*4) { const v = Array.from(new Float32Array(bytes.slice().buffer)); if (v.every(Number.isFinite)) return v; }
    }
    if (budget.left <= 0) return null; budget.left--;
    const v = await RECOMMENDATION_DEPS.embed(env,text);
    if (!v || v.length !== 768 || !v.every(Number.isFinite)) return null;
    const norm = Math.sqrt(v.reduce((s,x) => s+x*x,0)); if (!norm) return null;
    const insert = member ? "INSERT INTO event_rec_member_vectors (user_id,vector,norm,content_hash) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET vector=excluded.vector,norm=excluded.norm,content_hash=excluded.content_hash,updated_at=datetime('now')" : "INSERT INTO event_rec_vectors (event_id,vector,norm,content_hash) VALUES (?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET vector=excluded.vector,norm=excluded.norm,content_hash=excluded.content_hash,updated_at=datetime('now')";
    await env.DB.prepare(insert).bind(id,new Uint8Array(new Float32Array(v).buffer),norm,digest).run(); return v;
  } catch { return null; }
}
export async function recommendedEvents(env: Env, u: Omit<User, 'role'> & { role: string }, affinityOf: (track: string | null) => Set<string>, limit: number, vectors = true) {
  const prefs = await readRecPrefs(env,u.id);
  if (!prefs.enabled) return { enabled: false, profile: u.role, signals: {}, events: [] };
  const own = await ownEventSignals(env,u);
  const rows = await env.DB.prepare("SELECT e.*,f.verdict FROM events e LEFT JOIN event_rec_feedback f ON f.event_id=e.id AND f.user_id=? WHERE e.visibility='public' AND e.status='published' AND e.admin_published=1 AND datetime(e.starts_at)>=datetime('now') AND e.host_user_id!=? AND COALESCE(f.verdict,'')!='not_for_me' AND NOT EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_id=e.id AND r.user_id=? AND r.status IN ('registered','confirmed','attended','waitlisted')) ORDER BY e.starts_at,e.id LIMIT 200").bind(u.id,u.id,u.id).all<any>();
  if (!Array.isArray(rows.results)) throw new Error('candidates unreadable');
  const eligible = [];
  for (const event of rows.results) { const registration = await registrationEligibility(env,event,u.id,u.email); if (registration.eligible) eligible.push({ event,registration }); }
  const budget = { left: vectors && env.AI ? 10 : 0 };
  const text = [...own.signals.map(s=>s.text),...prefs.interests,prefs.goals_90d,...prefs.formats,...prefs.types].filter(Boolean).join(' ').slice(0,4000);
  const member = text ? await cachedVector(env,true,u.id,text,budget) : null;
  const scored: Array<{ score: number; event: Record<string, any> & { reasons: Reason[] } }> = [];
  for (const {event,registration} of eligible) {
    const rule = rulesFor(event,own.signals,prefs,affinityOf(own.track));
    const vector = member ? await cachedVector(env,false,event.id,[event.title,event.summary,event.description,...eventTopics(event.topics_json)].filter(Boolean).join(' ').slice(0,4000),budget) : null;
    scored.push({ score: rule.score + (member && vector ? cosine(member,vector)*5 : 0), event: { ...shapeEvent(event), source: 'axal', saved: event.verdict === 'saved', registration_eligible: registration, reasons: rule.reasons.slice(0,4) } });
  }
  scored.sort((a,b)=>b.score-a.score || String(a.event.starts_at).localeCompare(String(b.event.starts_at)) || Number(a.event.id)-Number(b.event.id));
  return { enabled: true, profile: u.role, signals: own.states, events: scored.slice(0,limit).map(s=>s.event) };
}
