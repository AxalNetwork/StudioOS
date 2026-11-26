/**
 * D5585 part 16 (#5585, WorkGraph P1 under the #5577 epic): a release line's name. A line is a `composite` asset with a
 * fixed row, so its name is an append-only history in `work_graph_release_line_names`: the latest row is the name, a
 * rename is a later row, and every earlier name is kept. A Super Admin sets it from the `seq` they saw, so a stale
 * write is refused, never merged. Decision: `documentation/architecture/decisions/D5585-p16.md`.
 *
 * WHAT A NAME MAY BE. Text a person typed, trimmed and with runs of whitespace (a tab or line break included) made one
 * space, 1 to 120 characters. Never any other control character or a bidirectional override, which would let a name
 * display as something it is not.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
import { WORK_GRAPH_DEPS, type Cost } from './workGraphRevisions';
import { Meter, hashOf, keyOk, outOfScope, readLine, scopeOf } from './workGraphReleases';

export const RELEASE_LINE_NAME_LIMITS = Object.freeze({ nameMax: 120 });

/** C0 and C1 controls, and the bidirectional embedding, override and isolate characters. */
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

/** The name as stored: NFC, trimmed, inner whitespace made one space. Null when it is not a name this store keeps. */
export function normaliseLineName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Whitespace first (a pasted tab or line break is a space), then nothing left may be a control or direction mark.
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= RELEASE_LINE_NAME_LIMITS.nameMax && !FORBIDDEN.test(s) ? s : null;
}

/** A line's current name: what it is, its `seq`, who set it and when. `seq` 0 and a null name: never named. */
export interface LineName { name: string | null; seq: number; setByUserId: number | null; setAt: string | null }
export const UNNAMED: LineName = Object.freeze({ name: null, seq: 0, setByUserId: null, setAt: null });

/** The current names of these lines in one scope. One statement, none for no line. Every uid asked gets an entry. */
export async function lineNamesOf(env: Pick<Env, 'DB'>, m: Meter, scope: Scope, lineUids: readonly string[]): Promise<Map<string, LineName>> {
  const out = new Map<string, LineName>(lineUids.map((u) => [u, UNNAMED]));
  if (!lineUids.length) return out;
  const rows = await m.all<{ line_asset_uid: string; name: string; seq: number; actor_user_id: number; created_at: string }>(env.DB.prepare(
    `SELECT n.line_asset_uid, n.name, n.seq, n.actor_user_id, n.created_at FROM work_graph_release_line_names n
      WHERE n.tenant_id = ? AND n.company_id = ? AND n.line_asset_uid IN (SELECT value FROM json_each(?))
        AND n.seq = (SELECT MAX(x.seq) FROM work_graph_release_line_names x WHERE x.line_asset_uid = n.line_asset_uid)`,
  ).bind(scope.tenantId, scope.companyId, JSON.stringify(lineUids)));
  for (const r of rows) out.set(r.line_asset_uid, { name: r.name, seq: Number(r.seq), setByUserId: Number(r.actor_user_id), setAt: r.created_at });
  return out;
}

/** The fields every line read carries: the name, or null with the reason (D5585-p11 §3), and the `seq` a rename names. */
export const lineNameFields = (n: LineName) => ({
  lineName: n.name, lineNameReason: n.name === null ? ('not_recorded' as const) : null, lineNameSeq: n.seq,
});

export interface SetLineNameInput {
  scope: Scope;
  lineAssetUid: string;
  name: string;
  /** The `seq` of the name the Super Admin saw: 0 when the line was never named. */
  expectedSeq: number;
  actorUserId: number;
  idempotencyKey: string;
}
export type LineNameRefusalCode = 'malformed' | 'line_name_invalid' | 'not_found' | 'wrong_tenant' | 'stale_line_name' | 'idempotency_conflict';
export type SetLineNameResult =
  | { ok: true; name: string; seq: number; replayed: boolean; cost: Cost }
  | { ok: false; code: LineNameRefusalCode; ids: string[]; current?: LineName; cost: Cost };

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/** Name or rename one release line, from the `seq` the Super Admin saw. A replay of the same request answers the first. */
export async function setReleaseLineName(env: Pick<Env, 'DB'>, input: SetLineNameInput): Promise<SetLineNameResult> {
  const m = new Meter(env);
  const no = (code: LineNameRefusalCode, ids: string[], current?: LineName): SetLineNameResult => ({ ok: false, code, ids, cost: { ...m.cost }, ...(current ? { current } : {}) });
  if (!input || !input.scope || !posInt(input.scope.tenantId) || !posInt(input.scope.companyId) || typeof input.lineAssetUid !== 'string'
    || !/^[A-Za-z0-9_:.-]{1,80}$/.test(input.lineAssetUid) || !posInt(input.actorUserId) || !keyOk(input.idempotencyKey)
    || !Number.isSafeInteger(input.expectedSeq) || input.expectedSeq < 0) {
    return no('malformed', []);
  }
  const name = normaliseLineName(input.name);
  if (name === null) return no('line_name_invalid', [input.lineAssetUid]);
  const { tenantId, companyId } = input.scope;
  const requestHash = await hashOf({ op: 'line_name', line: input.lineAssetUid, name, expectedSeq: input.expectedSeq });
  const replay = async (): Promise<SetLineNameResult | null> => {
    const prior = await m.first<{ name: string; seq: number; request_hash: string }>(env.DB.prepare(
      'SELECT name, seq, request_hash FROM work_graph_release_line_names WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
    ).bind(tenantId, companyId, input.idempotencyKey));
    if (!prior) return null;
    return prior.request_hash === requestHash
      ? { ok: true, name: prior.name, seq: Number(prior.seq), replayed: true, cost: { ...m.cost } }
      : no('idempotency_conflict', [input.lineAssetUid]);
  };
  const first = await replay();
  if (first) return first;

  const line = await readLine(env, m, input.lineAssetUid);
  if (!line) return no('not_found', [input.lineAssetUid]);
  if (outOfScope({ scope: input.scope }, scopeOf(line))) return no('wrong_tenant', [input.lineAssetUid]);
  const current = (await lineNamesOf(env, m, input.scope, [input.lineAssetUid])).get(input.lineAssetUid) ?? UNNAMED;
  if (current.seq !== input.expectedSeq) return no('stale_line_name', [input.lineAssetUid], current);

  const next = current.seq + 1;
  try {
    // Conditional on the line still being at `seq`: a rename that landed in between makes this insert nothing.
    const res = await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_line_names (line_asset_uid, tenant_id, company_id, seq, name, actor_user_id, idempotency_key, request_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT MAX(x.seq) FROM work_graph_release_line_names x WHERE x.line_asset_uid = ?), 0) = ?`,
    ).bind(input.lineAssetUid, tenantId, companyId, next, name, input.actorUserId, input.idempotencyKey, requestHash,
      WORK_GRAPH_DEPS.now().toISOString(), input.lineAssetUid, current.seq));
    if (!res.meta?.changes) {
      const now = (await lineNamesOf(env, m, input.scope, [input.lineAssetUid])).get(input.lineAssetUid) ?? UNNAMED;
      return no('stale_line_name', [input.lineAssetUid], now);
    }
    return { ok: true, name, seq: next, replayed: false, cost: { ...m.cost } };
  } catch (e) {
    // A concurrent request under the same key (UNIQUE on the idempotency key) answers as its replay.
    const again = await replay();
    if (again) return again;
    throw e;
  }
}
