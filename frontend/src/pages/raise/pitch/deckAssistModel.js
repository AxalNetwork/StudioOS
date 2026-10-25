/**
 * D899 (#2678, part 5 of #2434) — what the editor's card tools say and send.
 * Pure: no React, no fetch. Worker: routes/deck_assist.ts over
 * services/decks/assist.ts, which holds the rules; this mirrors its words.
 *
 * Every press asks for a quote first and shows its cost before it runs; the
 * run is charged to the founder who pressed. What comes back is a proposal:
 * Accept places it on the card, Save writes the version. A figure bound to a
 * record is never a tool's to change.
 */
import { aiTokens } from './newDeckModel';

/** PD7's selection bar, in its order. Tone and Translate take a choice; Ask an instruction. */
export const TEXT_TOOLS = [
  { action: 'rewrite', label: 'Rewrite', option: 'deck:rewrite' },
  { action: 'shorten', label: 'Shorten', option: 'deck:shorten' },
  { action: 'expand', label: 'Expand', option: 'deck:expand' },
  { action: 'tone', label: 'Change tone', option: 'deck:tone' },
  { action: 'translate', label: 'Translate', option: 'deck:translate' },
  { action: 'ask', label: 'Ask', option: 'deck:rewrite' },
];

/** The Add menu's tools that read your records into a block (PD7, PD9). */
export const CHART_TOOLS = [
  { action: 'chart', label: 'Chart from your records', option: 'deck:chart', size: { cols: 6, rows: 3 } },
  { action: 'table', label: 'Table from your records', option: 'deck:table', size: { cols: 6, rows: 3 } },
  { action: 'timeline', label: 'Timeline from your records', option: 'deck:timeline', size: { cols: 12, rows: 2 } },
];

/** The Add menu (PD7), in its order. */
export const ADD_ITEMS = [
  { id: 'text', label: 'Text' },
  { id: 'chart', label: 'Chart' },
  { id: 'image', label: 'Image' },
  { id: 'background', label: 'Background' },
  { id: 'connector', label: 'From a connector' },
  { id: 'layout', label: 'Layout' },
];

export const TONES = [['confident', 'Confident'], ['plain', 'Plain'], ['warm', 'Warm'], ['formal', 'Formal']];
export const LANGUAGES = ['French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Chinese (Simplified)', 'Korean', 'Arabic', 'Hindi'];
export const INSTRUCTION_MAX = 300;

export const AI_OFF_LINE = 'AI assistance is off on this page. Your records still fill the figures.';
export const FIGURE_LINE = (module) => `Figures come from your records. Update ${module || 'its module'} to change this one.`;
export const ACCEPT_LINE = 'Accept places it on the card. Nothing is a version until you save.';
export const FREE_LINE = 'Figures from your records are free.';

/**
 * PD28: the models on this page's rail row, in its order. Prices come from
 * the catalogue (`GET /api/public/ai/models`). FLUX.2 Klein 9B is listed and
 * not routed: no card tool in this part makes an image, and it is a partner
 * model behind `AI_PARTNER_MODELS` (D899).
 */
export const RAIL_MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Fast', role: 'Writes the wording' },
  { id: '@cf/black-forest-labs/flux-2-klein-9b', name: 'FLUX.2 Klein 9B', role: 'Images', unrouted: 'Not routed on this page yet: no card tool makes an image in this release.' },
  { id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 Schnell', role: 'Quick images' },
  { id: '@cf/google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B', role: 'Reads your slides' },
];

const UNIT_ORDER = ['tokens_out', 'tokens_in', 'tiles', 'steps', 'first_megapixels', 'images'];

/** One rail row model with its catalogue price, or "Not offered" when the catalogue does not list it. */
export function railModelRows(catalogue = []) {
  const byId = new Map((Array.isArray(catalogue) ? catalogue : []).map((m) => [m.id, m]));
  return RAIL_MODELS.map((m) => {
    const cat = byId.get(m.id);
    const billed = cat?.billed && typeof cat.billed === 'object' ? cat.billed : null;
    const unit = billed ? UNIT_ORDER.find((u) => billed[u] != null) || Object.keys(billed)[0] : null;
    const usd = unit != null ? Number(billed[unit]) : NaN;
    const price = Number.isFinite(usd)
      ? `$${usd < 0.01 ? Number(usd.toPrecision(2)) : usd.toFixed(usd < 1 ? 4 : 2)} ${cat.unit_words?.[unit] || unit.replace(/_/g, ' ')}`
      : null;
    return { ...m, offered: Boolean(cat), price: price || (cat ? null : 'Not offered on your plan') };
  });
}

/** The cost a press shows before it runs: from its quote, or why it cannot run. */
export function costLine(quote) {
  if (!quote) return 'Reading the cost…';
  if (quote.ai === false) return quote.reason === 'assist_off' ? AI_OFF_LINE : (quote.message || 'Eadwyn cannot run this now.');
  const cost = aiTokens(quote.hold_microusd);
  return cost ? `Up to ${cost} in AI tokens, charged to you when it runs.` : 'Paid in AI tokens, charged to you when it runs.';
}

/** The body a text press sends: the block it sits in, and the words as they stand. */
export function textBody(action, block, extra = {}) {
  const body = { action, block: block ? { id: block.id, kind: block.kind, ...(block.binding ? { binding: block.binding } : {}) } : null, text: String(block?.text ?? '') };
  if (action === 'tone') body.tone = extra.tone;
  if (action === 'translate') body.language = extra.language;
  if (action === 'ask') body.instruction = String(extra.instruction ?? '').trim();
  return body;
}

/** Why a block takes no text tool, or null: a figure bound to a record is the record's. */
export function blockRefusal(block, items = []) {
  if (!block) return null;
  if (block.kind === 'metric' || block.binding?.source_key) {
    const module = items.find((i) => i.source_key === block.binding?.source_key)?.module ?? null;
    return FIGURE_LINE(module);
  }
  if (block.kind !== 'text') return 'Select a text block to use Eadwyn on its words.';
  if (!String(block.text ?? '').trim()) return 'This block has no words yet. Type some, then ask Eadwyn.';
  return null;
}

/** The proposal as PD7 draws it: the before struck, the after on lavender. */
export function textProposal(result) {
  if (!result?.proposal) return null;
  return { uid: result.proposal.uid, before: String(result.before ?? ''), after: String(result.after ?? ''), cost: aiTokens(result.cost?.charged_microusd) };
}

/** A chart, table or timeline proposal, placed at the card's first free range of its size. */
export function chartProposal(result, tool) {
  if (!result?.proposal || !result.block) return null;
  return { uid: result.proposal.uid, block: result.block, title: result.title || null, size: tool?.size || { cols: 6, rows: 3 }, cost: aiTokens(result.cost?.charged_microusd) };
}

/**
 * PD9d: which connector feeds a source, by its key and its own `source`
 * field. A source no connector feeds is not listed under one.
 */
const CONNECTOR_OF_SLOT = {
  'build.commits_90d': 'github',
  'build.releases_90d': 'github',
  'grow.mercury_revenue': 'mercury',
  'grow.mercury_growth': 'mercury',
  'grow.net_burn': 'mercury',
  'grow.runway': 'mercury',
};
const STRIPE_SLOTS = new Set(['grow.mrr', 'grow.arr', 'grow.churn', 'grow.paying_customers']);

export function connectorOf(item) {
  if (!item?.source_key) return null;
  if (CONNECTOR_OF_SLOT[item.source_key]) return CONNECTOR_OF_SLOT[item.source_key];
  if (STRIPE_SLOTS.has(item.source_key) && /stripe/i.test(String(item.source || ''))) return 'stripe';
  return null;
}

const providerKey = (c) => String(c?.provider_key || '').toLowerCase();

/**
 * The lightbox's groups: each connected integration with its state and last
 * sync, and the recorded items it feeds. A connector with nothing bindable is
 * still listed, so the founder sees it is connected.
 */
export function connectorGroups(integrations = [], items = []) {
  const rows = Array.isArray(integrations) ? integrations : [];
  const byProvider = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const p = connectorOf(it);
    if (!p || it.state !== 'recorded') continue;
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p).push(it);
  }
  const groups = rows.map((c) => ({
    uid: c.uid, provider: providerKey(c), name: c.display_name || c.provider_key || 'Connector',
    status: c.status || 'unknown', lastSync: c.last_synced_at || null, error: c.last_error || null,
    items: byProvider.get(providerKey(c)) || [],
  }));
  // A source fed by a connector that the integrations list does not carry (Mercury reads through its own link).
  for (const [p, list] of byProvider) {
    if (!groups.some((g) => g.provider === p)) groups.push({ uid: p, provider: p, name: p[0].toUpperCase() + p.slice(1), status: 'connected', lastSync: null, error: null, items: list });
  }
  return groups;
}

export function syncLine(group, now = Date.now()) {
  if (!group?.lastSync) return group?.status === 'connected' ? 'Connected' : String(group?.status || 'Unknown').replace(/_/g, ' ');
  const t = Date.parse(group.lastSync);
  if (!Number.isFinite(t)) return 'Connected';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  const ago = mins < 60 ? `${mins} min ago` : mins < 60 * 48 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `Last sync ${ago}`;
}

/** The new card PD9d makes: a title block, then one metric tile bound to each chosen item. */
export function connectorCard(chosen = [], headline = '') {
  const tiles = chosen.slice(0, 4);
  const blocks = [
    { id: 'b1', kind: 'text', style: 'heading', text: String(headline || '').trim() || 'From your records', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
    ...tiles.map((i, n) => ({
      id: `b${n + 2}`, kind: 'metric', label: i.label, value: i.value == null ? null : String(i.value),
      binding: { source_key: i.source_key, record_ref: i.record_ref ?? null, as_of: i.as_of ?? null, grade: i.grade ?? null, snapshot_hash: i.snapshot_hash ?? null },
      grid: { c1: 1 + n * 3, c2: 3 + n * 3, r1: 3, r2: 4 },
    })),
  ];
  return { title: String(headline || '').trim() || 'From your records', blocks };
}
