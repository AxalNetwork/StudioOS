/**
 * D4597 (#4597) — a metered outline or build names the quote it was shown, so a test about what a run does
 * first asks for its price the way the page does, from the same inputs, and sends the quote back.
 *
 *   const call = quoting(rawCall);   // rawCall(f, who, method, path, json?, ...rest) → { status, body }
 *
 * A build from a proposal quotes that proposal's outline; a build with no audience takes the fast path's
 * (the Worker's own default), on the quote and the run alike. `unquoted: true` sends no quote.
 */
import { FAST_PATH_AUDIENCE } from '../src/services/decks/newDeck.ts';

type Reply = { status: number; body: any };
export type RawCall = (f: any, who: number, method: string, path: string, json?: any, ...rest: any[]) => Promise<Reply>;

export function quoting(raw: RawCall): RawCall {
  return async (f, who, method, path, json, ...rest) => {
    const step = path === '/api/decks/outline' ? 'outline' : path === '/api/decks/generate' ? 'build' : null;
    if (method !== 'POST' || !step || !json || typeof json !== 'object') return raw(f, who, method, path, json, ...rest);
    const { unquoted, ...asked } = json;
    if (unquoted || asked.quote_uid !== undefined) return raw(f, who, method, path, asked, ...rest);
    const { proposal_id, base_hash, start, ...inputs } = asked;
    let body = asked;
    let quoteBody: any = { ...inputs, step };
    if (proposal_id != null) {
      const row = f.db.prepare('SELECT outline_json FROM pitch_deck_proposals WHERE id = ?').get(Number(proposal_id)) as any;
      const o = row?.outline_json ? JSON.parse(row.outline_json) : {};
      quoteBody = {
        ...quoteBody, audience: inputs.audience ?? o.audience, length: inputs.length ?? o.length, outline: inputs.outline ?? o.rows,
        ...(o.round_ref && !inputs.round_ref ? { round_ref: o.round_ref } : {}),
        ...(o.exclude?.length && inputs.exclude === undefined ? { exclude: o.exclude } : {}),
      };
    } else if (inputs.audience === undefined) {
      body = { ...asked, audience: FAST_PATH_AUDIENCE, length: asked.length ?? 'standard' };
      quoteBody = { ...quoteBody, audience: FAST_PATH_AUDIENCE, length: asked.length ?? 'standard' };
    }
    const q = await raw(f, who, 'POST', '/api/decks/new/quote', quoteBody, ...rest);
    return raw(f, who, method, path, q.body?.quote_uid ? { ...body, quote_uid: q.body.quote_uid } : body, ...rest);
  };
}
