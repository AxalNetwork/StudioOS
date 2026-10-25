/**
 * D981 (#2376) — Program grants: the programs HQ may grant a licensed studio,
 * in the canvas's fixed order and groups, and the words each side reads. Pure,
 * so both pages and their tests share it.
 *
 * NO GRANT IS STORED YET. Nothing records which programs a licence holds or on
 * what terms (D981 §2; part 1 adds the store). So a grantable program's cell
 * reads "Not recorded", never "Not granted": not granting is a decision HQ has
 * not recorded either. What IS fixed, the canvas states and this list keeps:
 * Product testing stays at HQ, and two programs are not ready to grant.
 *
 * The keys are #2375's and D953's program keys, so the store part 1 adds keys
 * on the same strings as the Programs catalogue.
 */

export const GRANTS_PATH = '/admin/licences/programs';
/** D1126 (#3006): HQ's History tab. */
export const HISTORY_PATH = '/admin/licences/programs/history';
export const LEDGER_PATH = '/admin/licences';
export const MY_PROGRAMS_PATH = '/admin/my-licence/programs';

export const NOT_RECORDED_GRANT = 'Not recorded';
export const NO_STORE = 'HQ has not recorded any grant yet: the grant store arrives with D981 part 1.';

/** `grant`: 'yes' (HQ may grant it), 'hq' (HQ only), 'notready' (cannot be granted yet). */
export const PROGRAMS = [
  { key: 'spinout-lab', name: 'Spin-Out Lab', group: 'Ventures', grant: 'yes' },
  { key: 'ai-native-venture', name: 'AI-native Venture', group: 'Ventures', grant: 'notready', note: 'Proposed' },
  { key: 'mentor-cohorts', name: 'Mentor cohort access', group: 'Access', grant: 'yes' },
  { key: 'investor-cohorts', name: 'Investor cohort access', group: 'Access', grant: 'notready', note: 'Not built yet' },
  { key: 'referral-partners', name: 'Referral partners', group: 'Network and referrals', grant: 'yes' },
  { key: 'refer-and-earn', name: 'Refer & Earn', group: 'Network and referrals', grant: 'yes' },
  { key: 'perks', name: 'Perks', group: 'Rewards', grant: 'yes' },
  { key: 'learning', name: 'Learning', group: 'Learning', grant: 'yes' },
  { key: 'product-testing', name: 'Product testing', group: 'Product', grant: 'hq', note: 'HQ only · runs in Platform' },
];

/** The groups in order, each with how many programs it spans (the grid's header row). */
export function programGroups() {
  const out = [];
  for (const p of PROGRAMS) {
    const last = out[out.length - 1];
    if (last && last.group === p.group) last.span += 1;
    else out.push({ group: p.group, span: 1 });
  }
  return out;
}

/** HQ's word for a program that has no grant row (D981 §3). */
export function hqCell(program) {
  if (program.grant === 'hq') return { kind: 'hq', text: 'HQ only', tip: 'HQ keeps this program. It runs on HQ › Platform › Product testing.' };
  if (program.grant === 'notready') return { kind: 'notready', text: 'Not ready to grant', tip: program.note };
  return { kind: 'unrecorded', text: NOT_RECORDED_GRANT, tip: NO_STORE };
}

/** A studio's word for the same program (GR7's Admin-view states). */
export function adminCell(program) {
  if (program.grant === 'hq') return { kind: 'hq', text: 'Runs at HQ', line: 'HQ keeps this program.' };
  if (program.grant === 'notready') return { kind: 'notready', text: 'Not offered yet', line: program.note };
  return { kind: 'unrecorded', text: NOT_RECORDED_GRANT, line: 'HQ has not recorded a grant for this program yet.' };
}

const STATUS_WORD = { active: 'Active', pending_activation: 'Pending activation', suspended: 'Suspended', draft: 'Draft', terminated: 'Terminated' };
export const statusWord = (s) => STATUS_WORD[s] || NOT_RECORDED_GRANT;
export const kindWord = (k) => (k === 'white_label' ? 'White-label' : k === 'subsidiary' ? 'Subsidiary' : NOT_RECORDED_GRANT);

/**
 * The grid's rows: every licence but drafts and terminated ones (they hold no
 * territory to run a program in), in the ledger's order, with the row note a
 * suspended or pending licence carries (GR1).
 */
export function studioRows(items) {
  return (items || [])
    .filter((l) => l.status !== 'draft' && l.status !== 'terminated')
    .map((l) => ({
      uid: l.uid,
      ref: l.licence_ref || NOT_RECORDED_GRANT,
      name: l.brand_name || NOT_RECORDED_GRANT,
      kind: kindWord(l.kind),
      status: statusWord(l.status),
      territories: Array.isArray(l.territories) && l.territories.length ? l.territories.join(' ') : 'No territory',
      note: l.status === 'suspended'
        ? 'Suspended. Program changes are frozen until HQ lifts the suspension.'
        : l.status === 'pending_activation' ? 'Grants start when the licence is active.' : null,
    }));
}

/** GR1's first tile: studios with a licence, by status. Drafts and terminated licences are not studios yet or any more. */
export function studiosTile(items) {
  const rows = (items || []).filter((l) => l.status !== 'draft' && l.status !== 'terminated');
  const by = (s) => rows.filter((l) => l.status === s).length;
  return {
    value: rows.length,
    sub: `${by('active')} active · ${by('suspended')} suspended · ${by('pending_activation')} pending activation`,
  };
}

// ---------------------------------------------------------------------------
// D1126 (#3006) — the History tab's words. HQ's tabs (Grid, History) are
// literal `HeaderTab`s on each page, so the reachability walk finds them;
// Requests and Default terms join with D981 part 6 (#2778).
// ---------------------------------------------------------------------------


const word = (v) => (v === null || v === undefined || v === '' ? NOT_RECORDED_GRANT : String(v));
const termWord = (k) => String(k).replace(/_/g, ' ').replace(/\bbps\b/, 'basis points').replace(/\bcents\b/, '(cents)');

/**
 * One history row's lines: what happened, on what, and the detail. The
 * reason is HQ's own sentence and is drawn as it stands. A licence the ledger
 * no longer holds says so and is never given another studio's name.
 */
export function historyLine(e) {
  const studio = e?.licence
    ? [e.licence.brand_name || NOT_RECORDED_GRANT, e.licence.licence_ref].filter(Boolean).join(' · ')
    : 'A licence the ledger no longer holds';
  const what = e?.program_name ? `${e.action_label}: ${e.program_name}` : (e?.action_label || NOT_RECORDED_GRANT);
  const details = [];
  for (const c of Array.isArray(e?.changed) ? e.changed : []) details.push(`${termWord(c.key)}: ${word(c.before)} → ${word(c.after)}`);
  if (e?.deal_types) {
    const list = (v) => (Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : NOT_RECORDED_GRANT);
    details.push(`Partner deal types: ${list(e.deal_types.before)} → ${list(e.deal_types.after)}`);
  }
  return { studio, what, details, reason: e?.reason || null, by: e?.by ? `by ${e.by}` : 'by HQ' };
}

