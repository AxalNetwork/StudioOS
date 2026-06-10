/**
 * Task #12 — Admin bank.
 *
 * Promoted from the single inline question that used to live in
 * questionBank.ts (`admin.preferences.digest_freq`) into a first-class
 * `banks/*.ts` module so it flows through the manifest generator, the
 * drift CI size target, and the write-router coverage check like every
 * other persona bank.
 *
 * Admin answers are operational preferences / oversight settings — they
 * have no typed domain column beyond `admin.preferences.digest_freq`
 * (which writes `user_settings.digest_frequency`). The rest persist in
 * `advisor_answers` plus the `users.advisor_extras_json` sidecar, so
 * their ids are listed under the `^admin\.` pattern in
 * `no_write_allowlist.json`.
 *
 * NEVER rename or delete `admin.preferences.digest_freq` — writeRouter
 * holds a hard-coded id→column mapping for it (Task #2 original).
 */
import type { Question } from '../questionBank';

type RowSpec = {
  id: string; prompt: string;
  kind?: Question['input_kind']; imp?: Question['importance'];
  hint?: string; opts?: string[]; skip?: boolean;
  followups?: string[];
};
const inferValidate = (k?: Question['input_kind']): Question['validate'] =>
  k === 'select' ? 'select' : k === 'number' ? 'number' :
  k === 'short' ? 'short'   : k === 'multi'  ? 'multi'  : 'long';
const block = (section: string, page: string, anchor: string,
               rows: RowSpec[]): Question[] =>
  rows.map(r => ({
    id: r.id, persona: 'admin', section,
    prompt: r.prompt, hint: r.hint,
    input_kind: r.kind ?? 'long', options: r.opts,
    importance: r.imp ?? 'normal',
    page_target: page, doc_anchor: anchor,
    validate: inferValidate(r.kind),
    skip_allowed: r.skip,
    followups: r.followups,
  }));

const FREQ = ['Daily', 'Weekly', 'Off'];
const CADENCE = ['Daily', 'Weekly', 'Monthly', 'Quarterly'];

export const ADMIN_BANK: Question[] = [
  // ---- PREFERENCES ----------------------------------------------------
  ...block('PREFS', '/settings', 'getting-started/personas', [
    // KEEP verbatim — writeRouter routes this id to user_settings.digest_frequency.
    { id: 'admin.preferences.digest_freq', prompt: 'How often do you want the daily-digest summary?', kind: 'select', opts: FREQ, followups: ['admin.preferences.alert_channel'] },
    { id: 'admin.preferences.alert_channel', prompt: 'Where should operational alerts reach you?', kind: 'select', opts: ['Email', 'Slack', 'In-app only', 'Off'], followups: ['admin.preferences.timezone'] },
    { id: 'admin.preferences.timezone', prompt: 'What timezone should we schedule digests and reports against? (e.g. "America/Montreal")', kind: 'short', skip: true },
  ]),

  // ---- OVERSIGHT ------------------------------------------------------
  ...block('OVERSIGHT', '/admin', 'getting-started/personas', [
    { id: 'admin.oversight.review_cadence', prompt: 'How often do you review portfolio health across the studio?', kind: 'select', opts: CADENCE, imp: 'high', followups: ['admin.oversight.risk_tolerance'] },
    { id: 'admin.oversight.portfolio_focus', prompt: 'Which 2-3 portfolio metrics do you watch most closely? (comma-separated)', kind: 'short', hint: 'e.g. runway, MRR growth, milestone slippage' },
    { id: 'admin.oversight.risk_tolerance', prompt: 'What is the studio\u2019s risk posture for early-stage bets right now?', kind: 'select', opts: ['Conservative', 'Balanced', 'Aggressive'], imp: 'high' },
    { id: 'admin.oversight.escalation_threshold', prompt: 'What conditions should trigger an immediate escalation to you? (1-2 sentences)', skip: true },
  ]),

  // ---- OPERATIONS -----------------------------------------------------
  ...block('OPERATIONS', '/admin', 'getting-started/personas', [
    { id: 'admin.operations.intake_priority', prompt: 'When intake volume is high, what do you prioritise first?', kind: 'select', opts: ['Founder fit', 'Market timing', 'Strategic alignment', 'Speed to decision'] },
    { id: 'admin.operations.onboarding_sla', prompt: 'What is your target turnaround for onboarding a new venture?', kind: 'select', opts: ['Same week', '2 weeks', '1 month', 'No fixed SLA'] },
  ]),

  // ---- GOVERNANCE -----------------------------------------------------
  ...block('GOVERNANCE', '/admin', 'getting-started/personas', [
    { id: 'admin.governance.data_retention_pref', prompt: 'How long should we retain inactive venture records before archival?', kind: 'select', opts: ['90 days', '1 year', '3 years', 'Indefinitely'], skip: true },
    { id: 'admin.governance.access_review_cadence', prompt: 'How often should admin/partner access be reviewed?', kind: 'select', opts: CADENCE, skip: true },
  ]),
];
