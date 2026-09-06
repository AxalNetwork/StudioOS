import { exportView } from '../lib/csvExport';

/**
 * Every founder zone's header actions — the canvas's labels, and for each one
 * either a thing that happens or a sentence saying why it does not.
 *
 * WHERE THE LABELS COME FROM. Verbatim from the `ops:` array of the zone's
 * artboard in `design/canvases/integrated/Pages · Founder {Build,Grow,Network,
 * Raise}.dc.html`, in the canvas's own order. Nothing is invented and nothing
 * is dropped: a zone whose canvas asks for three actions lists three here, even
 * when all three are gaps, because the gap is the answer the reader needs.
 *
 * THE THREE OUTCOMES, AND WHY THE MIDDLE ONE EXISTS.
 *
 *   `export` — runs here, over the rows the page has loaded. See
 *              `lib/csvExport.js` for what "the rows the page has loaded"
 *              costs and why the label says "this view".
 *   `to`     — the flow is built, on another route, and this is a link to it.
 *              `/raise/capital/cap-table` really does add an instrument; the
 *              cap-table zone does not. Sending the reader there is the honest
 *              answer, and a far better one than rebuilding the form.
 *   `note`   — nothing performs this yet. Rendered as text, never as a button
 *              (`ZoneActions` enforces that), and it names what the reader CAN
 *              do wherever something adjacent exists.
 *
 * EVERY `to` WAS CHECKED AGAINST THE ROUTER, NOT ASSUMED. Each one is a path
 * `App.jsx` mounts with a guard that admits `founder`, and lands on a component
 * that calls the write method the label promises. Four labels lost their link
 * that way: `/matches` (where `introductionsRequest` lives) is admin, partner
 * and investor only; `/contacts` redirects to `/network?tab=contacts`, whose
 * tab a founder's Network desk does not read; `/build/discovery` renders
 * `FounderValidatePage` for a founder, so the waitlist invite panel behind it
 * is not theirs to reach; and `/build/team` renders the Grow desk, not
 * `TeamBuildingPage`. All four are notes below. A link that 404s, or that
 * lands on a page the reader is not allowed to open, is the same broken
 * promise as a button that does nothing — it is just slower to discover.
 *
 * `frontend/test/founder_zone_actions.test.mjs` re-derives the labels from the
 * canvases and re-checks every `to` against `App.jsx`, so this table cannot
 * drift from either without failing the build.
 */

/** Merge a page's `?project_id=…` into a link that may carry its own query. */
export function withQuery(to, query) {
  if (!query) return to;
  const [path, own = ''] = String(to).split('?');
  const params = new URLSearchParams(own);
  for (const [k, v] of new URLSearchParams(String(query).replace(/^\?/, ''))) params.set(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

export const FOUNDER_ZONE_ACTIONS = {
  // ── Build ────────────────────────────────────────────────────────────────
  'build/this-week': [
    { label: 'Export CSV', kind: 'export' },
    { label: 'Configure zone', note: 'nothing here is configurable — this desk reads the roadmap’s Now column' },
  ],
  'build/board': [
    { label: 'Bulk move', note: 'no bulk stage change is stored; a deal moves from its own row' },
    { label: 'Automations', note: 'no automation rules are stored' },
    { label: 'Configure lanes', note: 'the lanes are the pipeline’s stored stages and are not editable here' },
  ],
  'build/roadmap': [
    { label: 'New scenario', to: '/execution/roadmap', linkNote: 'objectives and key results are edited in Execution' },
    { label: 'Export', kind: 'export' },
    { label: 'Configure', note: 'no roadmap settings are stored' },
  ],
  'build/cadence': [
    { label: 'New ritual', note: 'rituals are not a stored record yet' },
    { label: 'Edit templates', note: 'no cadence templates are stored' },
    { label: 'Export archive', note: 'no cadence history is stored, so there is no archive to export' },
  ],
  'build/kpi': [
    { label: 'Bulk entry', to: '/build/metrics' },
    { label: 'Import CSV', note: 'no importer is built; snapshots are entered one at a time' },
    { label: 'Stripe sync', to: '/build/metrics' },
    { label: 'Definitions', note: 'metric definitions are not stored' },
  ],

  // ── Grow ─────────────────────────────────────────────────────────────────
  'grow/focus': [
    { label: 'New experiment', note: 'experiments are not a stored record' },
    { label: 'Change metric', to: '/build/metrics' },
    { label: 'Export', kind: 'export' },
  ],
  'grow/talent': [
    { label: 'Post a role', note: 'no role posting is stored' },
    { label: 'Bulk reject', note: 'no candidate records exist to act on' },
    { label: 'Export', kind: 'export' },
  ],
  'grow/customers': [
    { label: 'Bulk sequence', note: 'no sequence store exists — nothing here sends mail' },
    { label: 'New segment', note: 'segments are not stored' },
    { label: 'Export', kind: 'export' },
  ],
  'grow/partnerships': [
    { label: 'New proposal', to: '/comarketing' },
    { label: 'Export terms', kind: 'export' },
  ],
  'grow/capital-match': [
    { label: 'Draft outreach', note: 'no outreach drafting runs on this desk' },
    { label: 'Export shortlist', kind: 'export' },
  ],
  'grow/brand': [
    { label: 'New page', to: '/spinout-lab/brand' },
    { label: 'Export leads', kind: 'export' },
    { label: 'Edit templates', note: 'landing templates are chosen in the brand builder, not edited' },
  ],
  'grow/launch': [
    { label: 'New item', to: '/calendar' },
    { label: 'Export calendar', kind: 'export' },
  ],

  // ── Network ──────────────────────────────────────────────────────────────
  'network/relationships': [
    { label: 'Add person', note: 'the contact form is not reachable from a founder’s Network desk' },
    { label: 'Set reminders', note: 'no reminder store exists' },
    { label: 'Export', kind: 'export' },
  ],
  'network/introductions': [
    { label: 'Request an intro', note: 'the request flow lives on a surface a founder cannot open' },
    { label: 'Offer one', note: 'offering an introduction is not built' },
    { label: 'Export', kind: 'export' },
  ],
  'network/organizations': [
    { label: 'Add org', note: 'the contact form is not reachable from a founder’s Network desk' },
    { label: 'Merge duplicates', note: 'no merge is built; duplicates stay as separate rows' },
    { label: 'Export', kind: 'export' },
  ],

  // ── Raise ────────────────────────────────────────────────────────────────
  'raise/status': [
    { label: 'Export brief', kind: 'export' },
    { label: 'Share war-room', note: 'no share link is issued for this view' },
  ],
  'raise/pitch': [
    { label: 'New version', to: '/raise/pitch?mode=workspace' },
    { label: 'Export PDF', to: '/raise/pitch?mode=workspace' },
    { label: 'Revoke a link', note: 'share links are revoked where they are issued, in the deck builder' },
  ],
  'raise/capital': [
    { label: 'Model a round', to: '/raise/capital/model' },
    { label: 'Export to Carta', to: '/raise/capital/cap-table', linkNote: 'the cap table exports CSV; there is no Carta connection' },
    { label: 'Add instrument', to: '/raise/capital/cap-table' },
  ],
  'raise/legal': [
    { label: 'Send for signature', note: 'no e-signature provider is connected' },
    { label: 'Add document', to: '/legal' },
    { label: 'Calendar', to: '/raise/legal-engine/compliance' },
  ],
  'raise/data-room': [
    { label: 'Grant access', to: '/raise/data-room?mode=workspace' },
    { label: 'Revoke', to: '/raise/data-room?mode=workspace' },
    { label: 'Export log', kind: 'export' },
  ],
  'raise/liquidity': [
    { label: 'Model an exit', to: '/raise/capital/model' },
    { label: 'Export', kind: 'export' },
  ],
};

/**
 * Build the `items` array `ZoneActions` renders for one zone.
 *
 * `view` is the export payload: `{ scope, header, rows, cells }`. `cells` maps
 * one loaded record to the array of values under `header`, so the file carries
 * the columns the page is showing rather than whatever keys the API happens to
 * return — and it runs on the click, not on every render.
 *
 * An export over nothing loaded is offered as a SENTENCE rather than a button.
 * A file with a header row and no body reads as "there is no data" when the
 * truth is almost always "it has not loaded yet".
 */
export function founderZoneActions(key, { query = '', view = null } = {}) {
  const spec = FOUNDER_ZONE_ACTIONS[key];
  if (!spec) return [];
  const slug = key.split('/').pop();
  return spec.map((item) => {
    const testid = `action-${slug}-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (item.kind === 'export') {
      const rows = view?.rows || [];
      if (!rows.length) {
        return { label: item.label, testid, note: 'nothing loaded to export yet' };
      }
      return {
        label: `${item.label} · this view`,
        testid,
        onClick: () => exportView({
          scope: view.scope,
          zone: view.zone || slug,
          header: view.header,
          rows: view.cells ? rows.map(view.cells) : rows,
        }),
      };
    }
    if (item.to) {
      return { label: item.label, testid, to: withQuery(item.to, query), title: item.linkNote };
    }
    return { label: item.label, testid, note: item.note };
  });
}
