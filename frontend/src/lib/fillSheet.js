/**
 * D1327 (#3488, part 4 of #2431) — Fill with Eadwyn's mark and sheet: their
 * words and derivations, with no React. `ui/FillMark.jsx` and
 * `ui/FillSheet.jsx` draw them.
 *
 * WHAT IS READ. `GET /api/fills/sheet` (D1325): each field's value, mark,
 * waiting values, choices, never-fill flag and trigger; each source's state;
 * the member's own average for this form. `POST /api/ai/rail/run` (D1326): a
 * stream whose `done` event carries Eadwyn's proposals, what it dropped and
 * what the run charged, or the refusal.
 *
 * THE RULES (#2431, D1323 §4). Eadwyn proposes and a person accepts; in a form
 * nothing is written until Save; a typed value is never taken by Accept all;
 * a never-fill field has no trigger and is listed under "Not filled here"; no
 * model name or option key reaches the page (the run's `meta.model` is never
 * read); a failed read is "Unreadable", never "Typed".
 */

/** The five Source words (#2431), each with its dot colour. Eadwyn is a mark, not a source. */
export const SOURCE_WORDS = Object.freeze({
  connector: { word: 'Connector', dot: 'bg-axal-violet dark:bg-violet-400' },
  document: { word: 'Document', dot: 'bg-sky-500' },
  recorded: { word: 'Recorded', dot: 'bg-amber-500' },
  signed: { word: 'Signed', dot: 'bg-emerald-500' },
  typed: { word: 'Typed', dot: 'bg-gray-400' },
});

const PROVIDERS = Object.freeze({
  github: 'GitHub', mercury: 'Mercury', stripe: 'Stripe', notion: 'Notion', google_workspace: 'Google Workspace',
  vercel: 'Vercel', lovable: 'Lovable', hubspot: 'HubSpot', posthog: 'PostHog', carta: 'Carta',
});
const MODULES = Object.freeze({ validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' });

/** A connector's name from its key (`github` → GitHub). */
export const providerLabel = (ref) => PROVIDERS[String(ref || '').toLowerCase()] || (ref ? String(ref) : 'a connector');
/** A module source's cycle (`validate/problem-discovery` → Validate). */
export const moduleLabel = (ref) => MODULES[String(ref || '').split('/')[0]] || 'your records';

/** `2026-10-12` → `12 Oct`; anything else, null. */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Micro-dollars as dollars, keeping a fraction of a cent (`$0.0012`); null when none was recorded. */
export function money(microusd) {
  if (microusd == null || !Number.isFinite(Number(microusd)) || Number(microusd) < 0) return null;
  const n = Number(microusd) / 1e6;
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
}
export const COST_NOT_RECORDED = 'Cost not recorded';
export const NO_TOKENS = 'No AI tokens';

/**
 * A provenance mark as the pill draws it. `mark` is D1325's (`source_kind`,
 * `source_ref`, `source_label`, `source_as_of`, `edited`, `fill_class`) or
 * `{ state: 'unreadable' }`; null is a value nobody filled.
 *
 *   null, own form   nothing: the absence says a person wrote it
 *   null, a reader   a muted "Typed" chip (AF15)
 *   unreadable       a muted "Unreadable", never blank and never Typed (AF14)
 *   placed           "Not saved", dashed, before the form's Save (AF7)
 */
export function markView(mark, { readOnly = false, placed = false } = {}) {
  if (placed) return { kind: 'placed', text: 'Not saved' };
  if (mark && mark.state === 'unreadable') return { kind: 'unreadable', text: 'Unreadable' };
  if (!mark) return readOnly ? { kind: 'typed', text: 'Typed', dot: SOURCE_WORDS.typed.dot } : null;
  if (mark.source_kind === 'connector') {
    const when = shortDate(mark.source_as_of);
    return { kind: 'connector', text: ['Connector', providerLabel(mark.source_ref), when].filter(Boolean).join(' · '), dot: SOURCE_WORDS.connector.dot };
  }
  if (mark.source_kind === 'module') {
    const word = SOURCE_WORDS[mark.source_label]?.word || 'Recorded';
    return { kind: 'module', text: `${word} · From ${moduleLabel(mark.source_ref)}`, dot: (SOURCE_WORDS[mark.source_label] || SOURCE_WORDS.recorded).dot };
  }
  // Eadwyn's (a row from before migration 643 has no source_kind and is Eadwyn's, D1325 §2).
  if (mark.edited) return { kind: 'eadwyn', text: 'Eadwyn · edited', edited: true };
  const sourced = mark.fill_class === 'sourced' || !!mark.citation;
  return { kind: 'eadwyn', text: sourced ? 'Eadwyn · sourced' : 'Eadwyn' };
}

/** The provenance card's lines (AF8): the source, its quote, the run, the change. No model, no option key. */
export function cardLines(mark, runLine) {
  if (!mark || mark.state === 'unreadable') return [];
  const out = [];
  const view = markView(mark);
  if (mark.source_kind === 'connector') out.push(`From ${providerLabel(mark.source_ref)}${shortDate(mark.source_as_of) ? `, as of ${shortDate(mark.source_as_of)}` : ''}.`);
  else if (mark.source_kind === 'module') out.push(`${view.text}.`);
  else out.push(mark.edited ? 'Eadwyn proposed this and you changed it before saving.' : 'Eadwyn supplied this value.');
  const cite = mark.citation;
  const source = cite?.kind === 'library' ? cite.title || 'a document in your library' : cite?.source || null;
  if (source) out.push(`Source: ${source}`);
  if (cite?.quote) out.push(`“${cite.quote}”`);
  if (mark.edited && mark.proposed_value) out.push(`It proposed: ${mark.proposed_value}`);
  if (runLine) out.push(runLine);
  return out;
}

/** "Your average: $0.0011 over 9 runs", or why there is none. Never a zero. */
export function averageLine(quote) {
  if (!quote || quote.state === 'unreadable') return 'Your average could not be read. The cost shows after the run.';
  if (!quote.runs || quote.average_microusd == null) return 'No average yet. The cost shows after the run.';
  return `Your average: ${money(quote.average_microusd)} over ${quote.runs} ${quote.runs === 1 ? 'run' : 'runs'}`;
}

/** "Eadwyn never fills signatures and consents." */
export const neverFillSentence = (nf) => `Eadwyn never fills ${String(nf?.label || 'this field').toLowerCase()}.`;

/** The Sources step (AF4): connectors and modules first, Eadwyn last. */
export function sourceRows(read) {
  const all = Array.isArray(read?.sources) ? read.sources : [];
  const fields = Array.isArray(read?.fields) ? read.fields : [];
  const holds = (key) => fields.reduce((n, f) => n + (f.waiting || []).filter((w) => w.source === key).length + ((f.choices || []).some((c) => c.source === key) ? 1 : 0), 0);
  const rows = all.filter((s) => s.kind !== 'eadwyn').map((s) => ({
    key: s.key, kind: s.kind, label: s.label, state: s.state, as_of: s.as_of, holds: holds(s.key),
    tickable: s.state === 'ok',
  }));
  const eadwyn = all.find((s) => s.kind === 'eadwyn') || (fields.some((f) => f.offered_to_eadwyn) ? { key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok' } : null);
  if (eadwyn) rows.push({ key: eadwyn.key, kind: 'eadwyn', label: 'Eadwyn', state: eadwyn.state, as_of: null, holds: holds(eadwyn.key), tickable: eadwyn.state !== 'unreadable' });
  return rows;
}

/** What one source row says it holds. */
export function sourceHolds(row) {
  if (row.state === 'not_connected') return 'Not connected';
  if (row.state === 'unreadable') return 'Unreadable';
  if (row.kind === 'eadwyn') return 'For what’s left';
  const when = shortDate(row.as_of);
  return `${row.holds ? `${row.holds} ${row.holds === 1 ? 'value' : 'values'}` : 'Nothing for this form yet'}${when ? ` · last sync ${when}` : ''}`;
}

const blank = (v) => v == null || String(v).trim() === '';
const ORDER = { connector: 0, module: 1, eadwyn: 2 };

/**
 * The Preview's rows (AF5, AF6): one per field the sheet may fill.
 *
 *   now        what the form holds (the page's own values first, else the record's)
 *   candidates every value waiting for it from a ticked source, and Eadwyn's run,
 *              connectors before modules before Eadwyn (AF6's order)
 *   kept       the member's own value: "Yours · kept", never ticked by Accept all
 *   reason     why a blank field has nothing: no source said it, or Eadwyn left it
 */
export function planRows(read, { values = {}, ticked = new Set(), run = null } = {}) {
  const kinds = new Map((read?.sources || []).map((s) => [s.key, s.kind]));
  const labels = new Map((read?.sources || []).map((s) => [s.key, s.label]));
  const fields = (read?.fields || []).filter((f) => !f.never_fill);
  const dropped = new Map((run?.dropped || []).map((d) => [d.field, d.why]));
  return fields.map((f) => {
    const now = Object.prototype.hasOwnProperty.call(values, f.field) ? values[f.field] : f.value;
    const waiting = (f.waiting || []).filter((w) => ticked.has(w.source)).map((w) => {
      const kind = kinds.get(w.source) || 'eadwyn';
      return {
        key: `${w.source}:${w.ref ?? w.value}`, source: w.source, kind, label: labels.get(w.source) || w.source,
        value: w.value, shown: kind === 'eadwyn' ? shownChoice(f, w.value) : w.label || String(w.value ?? ''), ref: w.ref ?? null,
        // An Eadwyn value waiting from an earlier run is its proposal (D1325: `ref` is the proposal's uid).
        proposal_uid: kind === 'eadwyn' ? w.ref ?? null : null,
      };
    });
    const fromRun = (run?.proposals || []).filter((p) => p.field === f.field).map((p) => ({
      key: `run:${p.uid}`, source: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', value: p.value, shown: shownChoice(f, p.value), ref: null, proposal_uid: p.uid, ran: true,
    }));
    const candidates = [...waiting, ...fromRun].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
    // A module offers its records to pick from, never a value of its own (D1325): the member picks.
    const choices = (f.choices || []).filter((c) => ticked.has(c.source)).map((c) => ({
      key: `${c.source}:${c.ref ?? c.value}`, source: c.source, kind: 'module', label: labels.get(c.source) || c.source, value: c.value, shown: c.label, ref: c.ref ?? null, proposal_uid: null,
    }));
    const kept = !blank(now);
    const reason = kept || candidates.length || choices.length ? null
      : dropped.has(f.field) || (run && f.offered_to_eadwyn && ticked.has('eadwyn')) ? 'Eadwyn left this blank: nothing in your records supports it.'
        : 'No source said it.';
    return {
      field: f.field, label: f.label, now: kept ? String(now) : null, kept, candidates, choices,
      chosen: kept ? null : candidates[0]?.key ?? null, accept: !kept && candidates.length > 0, reason,
    };
  });
}

/** A module field's value read back as its record's words, else the value. */
function shownChoice(f, value) {
  const c = (f.choices || []).find((x) => String(x.value) === String(value));
  return c?.label || String(value ?? '');
}

/** Eadwyn's or a source's chip in the Preview. */
export function candidateChip(c, asOf) {
  if (!c) return null;
  if (c.kind === 'eadwyn') return 'Eadwyn';
  if (c.kind === 'connector') return ['Connector', c.label, shortDate(asOf)].filter(Boolean).join(' · ');
  return `Recorded · From ${c.label}`;
}

/** "5 fields · 3 from your sources · 2 from Eadwyn · charged $0.0012" (AF5). */
export function topLine(rows, chosen, charged) {
  const picks = rows.filter((r) => !r.kept).map((r) => pickOf(r, chosen)).filter(Boolean);
  const fromSources = picks.filter((c) => c.kind !== 'eadwyn').length;
  const fromEadwyn = picks.filter((c) => c.kind === 'eadwyn').length;
  const parts = [`${rows.length} ${rows.length === 1 ? 'field' : 'fields'}`, `${fromSources} from your sources`, `${fromEadwyn} from Eadwyn`];
  if (fromEadwyn) parts.push(charged === undefined ? 'not run' : money(charged) ? `charged ${money(charged)}` : COST_NOT_RECORDED);
  return parts.join(' · ');
}

/** The candidate a row will fill with: the member's pick, else the first in AF6's order. */
export function pickOf(row, chosen = {}) {
  const key = chosen[row.field] ?? row.chosen;
  return [...row.candidates, ...(row.choices || [])].find((c) => c.key === key) || null;
}

/** "Filled 3 of 5." when some fields found nothing (AF10). */
export function partialLine(rows) {
  const open = rows.filter((r) => !r.kept);
  const filled = open.filter((r) => r.candidates.length || (r.choices || []).length).length;
  return open.length && filled < open.length ? `Filled ${filled} of ${open.length}.` : null;
}

const OUT_OF_TOKENS = new Set(['budget_user_day', 'budget_user_month', 'budget_org_month', 'kill_switch']);

/**
 * A refused run in the canvas's words (AF11, AF12), with what the sheet
 * offers next. The Worker's own sentence is kept where only it knows the
 * figures (a spend limit's reset date).
 */
export function refusalView(refusal, { charged = null } = {}) {
  const code = refusal?.code || '';
  if (code === 'assist_off') return { kind: 'off', text: 'AI assistance is off on this page.', sources: true };
  if (code === 'guard_blocked' || code === 'guard_blocked_output') {
    return { kind: 'guard', text: `Eadwyn’s draft was held back by the safety check.${money(charged) ? ` You were charged ${money(charged)} for the check and the run.` : ''}`, sources: true };
  }
  if (code === 'guard_unavailable' || code === 'misconfigured') return { kind: 'guard', text: 'The safety check could not be reached, so nothing ran. Nothing was charged.', sources: true };
  if (code === 'record_changed') return { kind: 'changed', text: 'This form changed while Eadwyn worked, so the result was dropped.', again: true };
  if (OUT_OF_TOKENS.has(code)) return { kind: 'tokens', text: 'The included AI allowance and top-up balance cannot cover this run.', addTokens: true, sources: true };
  if (code === 'spend_limit') return { kind: 'tokens', text: refusal?.message || 'You reached today’s AI limit.', sources: true };
  if (code === 'ai_paused') return { kind: 'tokens', text: 'AI is paused for your studio.', sources: true };
  if (code === 'nothing_to_fill') return { kind: 'empty', text: 'Nothing to fill. Every field here already has a value.' };
  const said = typeof refusal?.message === 'string' && refusal.message.trim() && !/^[a-z_]+$/.test(refusal.message.trim()) ? refusal.message.trim() : null;
  return { kind: 'other', text: said || 'Eadwyn could not be reached. Nothing was proposed.', sources: true };
}

/** The stream `POST /api/ai/rail/run` answers, as events. `meta` (which names the model) is dropped here. */
export function parseStream(text) {
  const out = [];
  for (const block of String(text || '').split(/\n\n+/)) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (!ev || ev === 'meta' || data == null) continue;
    try { out.push({ event: ev, data: JSON.parse(data) }); } catch { /* a broken line is skipped */ }
  }
  return out;
}

/** The reference a failed read shows, so support can find the log line. */
export const errorRef = (seed = Date.now()) => {
  const h = Math.abs(Math.imul(Number(seed) % 2147483647, 2654435761)).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
  return `${h.slice(0, 4)}-${h.slice(4, 8)}`;
};
