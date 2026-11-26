/**
 * D8530 (#8530) — the VentureSpace data inventory: every store that holds a venture's data, and what each lifecycle
 * event does to it. This module is the single source; `documentation/operations/PROCESSING_AND_RETENTION_5510.md`
 * points here instead of repeating it.
 *
 * THE EVENTS (the real code paths; `test/venturespace_data_lifecycle_8530.test.ts` runs each one):
 *   move             `POST /api/projects/:id/move` — the venture changes company (`services/projectMove.ts`).
 *   archive          `DELETE /api/projects/:id` — the venture goes to Trash (`projects.deleted_at`, D1135). A venture
 *                    has no other archive; a company's archive (#4963) is a company event and is not listed here.
 *   restore          `POST /api/projects/:id/restore` — out of Trash, within 30 days.
 *   hard_delete      `hardDeleteProject` (`services/projectTrash.ts`), from HQ's hard delete or the 30-day sweep.
 *   account_erasure  the venture owner's account erased: `eraseAccountAgents` (D1530) is the only erasure code the
 *                    platform has; the rest of a data-subject erasure is manual (D168, `services/dsrRequests.ts`).
 *
 * THE ANSWERS, one per store and event:
 *   follows          the data stays with the venture, unchanged: the event does not touch it, and it keeps naming the
 *                    venture, so it moves, sits in Trash and comes back with it.
 *   removed          a code path deletes it (`by` names it).
 *   changed          a code path rewrites the venture's row on purpose and keeps it (`by` names it), as a move ending
 *                    the venture's data-room grants does (D8535).
 *   kept             it stays, for the stated reason (a legal or financial record, an audit trail).
 *   not_applicable   the store does not belong to a venture (it is keyed to a company), so a venture event leaves it.
 *   unspecified      nobody has decided. `today` says what the code does now (`untouched`, `unlinked` = its
 *                    project_id set to NULL, `changed`, `refuses` = the event fails while such a row exists, or
 *                    `unknown` for a store the test cannot read), and `question` names the owner's question in
 *                    `documentation/architecture/decisions/D8530.md`.
 *
 * CI. `test/venturespace_data_inventory_8530.test.ts` fails when a D1 table with a `project_id` or `company_id`
 * column, or an R2 key template under a venture's or company's id, is not here (or is here and no longer exists),
 * and when an unspecified answer's question is not in D8530.md. `test/venturespace_data_lifecycle_8530.test.ts`
 * builds a venture with a row in every store, runs each event, reads every store and fails when an answer here is
 * not what the code did, so a `removed` with no code path behind it cannot pass.
 */

export const LIFECYCLE_EVENTS = ['move', 'archive', 'restore', 'hard_delete', 'account_erasure'] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** The owner's questions in D8530.md, one per kind of undecided answer. */
export const QUESTIONS = {
  Q1: 'What erasing the venture owner\'s account does to the venture\'s data',
  Q2: 'On a move, rows that name both the venture and its company keep the company it left',
  Q3: 'A hard delete leaves these rows behind, naming a venture that no longer exists',
  Q4: 'A row here makes the hard delete fail, so the venture cannot be deleted',
  Q5: 'A hard delete keeps these rows with project_id set to NULL, with no reason recorded',
  Q6: 'A hard delete leaves these R2 objects behind',
  Q7: 'Stores the lifecycle test cannot read: what each event should do to them',
} as const;
export type QuestionId = keyof typeof QUESTIONS;

export type Today = 'untouched' | 'unlinked' | 'changed' | 'refuses' | 'unknown';
export type Answer =
  | { is: 'follows' }
  | { is: 'removed'; by: string }
  | { is: 'changed'; by: string }
  | { is: 'kept'; reason: string }
  | { is: 'not_applicable'; reason: string }
  | { is: 'unspecified'; question: QuestionId; today: Today };

export type StoreKind = 'd1_table' | 'r2_prefix' | 'other';
export type Store = {
  /** `d1:<table>`, `r2:<binding>/<prefix>` or `other:<binding>`. */
  id: string;
  kind: StoreKind;
  /** The table, the key template (`{project_id}`, `{project_uid}`, `{company_uid}`), or what the binding holds. */
  name: string;
  /** What names the venture in it: its project, its company, or both. */
  keyed_by: 'project' | 'company' | 'project_and_company';
  answers: Record<LifecycleEvent, Answer>;
};

const FOLLOWS: Answer = { is: 'follows' };
const COMPANY_DATA: Answer = { is: 'not_applicable', reason: 'keyed to a company, not a venture: a venture event leaves it' };
const unspecified = (question: QuestionId, today: Today): Answer => ({ is: 'unspecified', question, today });

/** What the hard delete does to a D1 table (see `hardDeleteOf`). */
type HardDelete = 'cleanup' | 'cascade' | 'kept_audit' | 'kept_receipts' | 'set_null' | 'refuses' | 'left' | 'company';
type Keyed = 'p' | 'c' | 'pc';

/**
 * Every D1 table with a `project_id` or `company_id` column, but `projects` itself (below): its name, what it is
 * keyed by (p = project_id, c = company_id, pc = both) and what the hard delete does to it.
 *   cleanup        `hardDeleteProject` deletes its rows by name (its CHILD_TABLES and deck statements, or
 *                  `eraseAgentData`).
 *   cascade        `DELETE FROM projects` removes them: its project_id is `REFERENCES projects(id) ON DELETE CASCADE`.
 *   kept_audit     `activity_logs`: kept with project_id set to NULL, the audit trail rule in `hardDeleteProject`.
 *   kept_receipts  `capital_calls`: a call with receipts is kept with project_id set to NULL (financial records); one
 *                  without is deleted.
 *   set_null       kept with project_id set to NULL by `ON DELETE SET NULL`; nobody stated why (Q5).
 *   refuses        its project_id references projects with no action and nothing deletes it first, so the delete
 *                  fails while a row exists (Q4).
 *   left           nothing deletes it and nothing references projects: the row stays, naming a gone venture (Q3).
 *   company        keyed to a company only: not applicable.
 */
const D1_TABLES: ReadonlyArray<readonly [string, Keyed, HardDelete]> = [
  ['activity_logs', 'p', 'kept_audit'],
  ['advisor_client_access_log', 'p', 'cascade'],
  ['advisor_client_grants', 'p', 'cascade'],
  ['advisor_profiles', 'c', 'company'],
  ['advisor_startups', 'p', 'left'],
  ['agent_custom_roles', 'pc', 'refuses'],
  ['agent_landing_setting_changes', 'pc', 'refuses'],
  ['agent_landing_settings', 'pc', 'refuses'],
  ['agent_memory_notes', 'pc', 'cleanup'],
  ['agent_publish_requests', 'pc', 'cascade'],
  ['agent_recruit_requests', 'pc', 'refuses'],
  ['agent_scope_settings', 'pc', 'refuses'],
  ['agent_skill_workflow_runs', 'pc', 'refuses'],
  ['agent_skill_workflows', 'c', 'company'],
  ['agent_skills', 'c', 'company'],
  ['ai_score_drafts', 'p', 'cascade'],
  ['api_usage_events', 'c', 'company'],
  ['beehiiv_grow_facts', 'p', 'cascade'],
  ['beehiiv_post_stats', 'p', 'cascade'],
  ['beehiiv_publication_links', 'p', 'cascade'],
  ['brand_sites', 'p', 'left'],
  ['build_evidence_links', 'p', 'cascade'],
  ['build_handoffs', 'p', 'cascade'],
  ['build_plan_items', 'p', 'cascade'],
  ['build_plans', 'p', 'cascade'],
  ['cap_table_access_grants', 'p', 'refuses'],
  ['cap_table_access_log', 'p', 'refuses'],
  ['cap_table_access_requests', 'p', 'cascade'],
  ['cap_table_currency', 'p', 'refuses'],
  ['cap_table_holders', 'p', 'cleanup'],
  ['cap_table_issuance_vesting', 'p', 'refuses'],
  ['cap_table_issuances', 'p', 'refuses'],
  ['cap_table_option_pools', 'p', 'refuses'],
  ['cap_table_scenarios', 'p', 'cleanup'],
  ['cap_table_securities', 'p', 'cleanup'],
  ['cap_table_share_classes', 'p', 'refuses'],
  ['cap_table_vesting', 'p', 'refuses'],
  ['capital_calls', 'p', 'kept_receipts'],
  ['captable_share_tokens', 'p', 'left'],
  ['closings', 'p', 'refuses'],
  ['comarketing_attributions', 'p', 'left'],
  ['comarketing_pitches', 'c', 'company'],
  ['commitments', 'c', 'company'],
  ['company_creation_proposals', 'p', 'left'],
  ['company_eins', 'p', 'refuses'],
  ['company_employment_history', 'c', 'company'],
  ['company_filing_suggestion_dismissals', 'p', 'cascade'],
  ['company_financials', 'c', 'company'],
  ['company_function_coverage', 'c', 'company'],
  ['company_funding_rounds', 'c', 'company'],
  ['company_headcount_plan', 'c', 'company'],
  ['company_invitations', 'c', 'company'],
  ['company_kyb_records', 'c', 'company'],
  ['company_locations', 'c', 'company'],
  ['company_membership_events', 'pc', 'cascade'],
  ['company_officers', 'c', 'company'],
  ['company_people', 'c', 'company'],
  ['company_receiving_accounts', 'c', 'company'],
  ['company_sources', 'c', 'company'],
  ['company_tax_ids', 'c', 'company'],
  ['competitor_analyses', 'p', 'left'],
  ['competitor_price_observations', 'p', 'cascade'],
  ['competitor_signals', 'p', 'left'],
  ['competitor_tracking', 'p', 'cascade'],
  ['compliance_events', 'pc', 'cleanup'],
  ['connector_fed_items', 'p', 'left'],
  ['connector_flow_runs', 'c', 'company'],
  ['connector_requests', 'c', 'company'],
  ['contacts', 'p', 'left'],
  ['content_calendar_items', 'p', 'cascade'],
  ['custom_kpis', 'p', 'cascade'],
  ['customer_segments', 'p', 'cascade'],
  ['data_room_access_log', 'p', 'cascade'],
  ['data_room_access_requests', 'p', 'cascade'],
  ['data_room_files', 'p', 'cascade'],
  ['data_room_folders', 'p', 'cascade'],
  ['data_room_grants', 'p', 'cascade'],
  ['data_room_library_settings', 'p', 'refuses'],
  ['data_room_passages', 'p', 'left'],
  ['data_room_search_state', 'p', 'left'],
  ['dataroom_deck_values', 'p', 'cascade'],
  ['deal_flow_attention_rules', 'c', 'company'],
  ['deal_flow_entries', 'c', 'company'],
  ['deal_invitations', 'c', 'company'],
  ['deal_memos', 'p', 'cleanup'],
  ['deal_notes', 'c', 'company'],
  ['deal_preparation_revisions', 'pc', 'left'],
  ['deal_preparations', 'pc', 'refuses'],
  ['deal_saved_views', 'c', 'company'],
  ['deal_seen', 'c', 'company'],
  ['deal_transfers', 'c', 'company'],
  ['deals', 'p', 'cleanup'],
  ['decision_journal_entries', 'p', 'left'],
  ['deck_approvers', 'p', 'cleanup'],
  ['deck_area_batches', 'p', 'left'],
  ['deck_area_proposals', 'p', 'left'],
  ['deck_brand_kits', 'p', 'cascade'],
  ['deck_brand_locks', 'p', 'cascade'],
  ['deck_checks', 'p', 'cleanup'],
  ['deck_comments', 'p', 'cleanup'],
  ['deck_custom_layouts', 'p', 'cascade'],
  ['deck_derivatives', 'p', 'cascade'],
  ['deck_grants', 'c', 'company'],
  ['deck_images', 'p', 'cleanup'],
  ['deck_logos', 'p', 'cascade'],
  ['deck_notes', 'p', 'cleanup'],
  ['deck_qa_answers', 'p', 'cascade'],
  ['deck_qa_written', 'p', 'cascade'],
  ['deck_r2_tombstones', 'p', 'cascade'],
  ['deck_recordings', 'p', 'cascade'],
  ['deck_rehearsal_extras', 'p', 'left'],
  ['deck_rehearsals', 'p', 'left'],
  ['deck_reviews', 'p', 'left'],
  ['deck_run_quotes', 'p', 'left'],
  ['deck_share_conversions', 'p', 'left'],
  ['deck_share_feedback', 'p', 'left'],
  ['deck_typed_values', 'p', 'cascade'],
  ['deck_variants', 'p', 'cascade'],
  ['demand_signals', 'p', 'cascade'],
  ['discovery_interviews', 'p', 'cleanup'],
  ['documents', 'pc', 'cleanup'],
  ['durability_checklist', 'p', 'cascade'],
  ['eadwyn_conversations', 'c', 'company'],
  ['eadwyn_pending_actions', 'c', 'company'],
  ['engagements', 'pc', 'left'],
  ['events', 'p', 'refuses'],
  ['facebook_page_facts', 'p', 'cascade'],
  ['facebook_page_links', 'p', 'cascade'],
  ['facebook_proposals', 'p', 'cascade'],
  ['filing_reminder_deliveries', 'p', 'left'],
  ['filing_reminder_event_deliveries', 'c', 'company'],
  ['financial_events', 'pc', 'left'],
  ['financial_models', 'p', 'cleanup'],
  ['financial_statement_pins', 'p', 'cascade'],
  ['financial_statement_snapshots', 'p', 'cascade'],
  ['formation_cases', 'pc', 'left'],
  ['formation_steps', 'p', 'cascade'],
  ['founder_checkins', 'p', 'cleanup'],
  ['founder_contributions', 'p', 'cascade'],
  ['founder_invites', 'p', 'left'],
  ['founder_needs', 'p', 'left'],
  ['fund_fee_offsets', 'p', 'refuses'],
  ['fund_reserve_allocations', 'p', 'cleanup'],
  ['github_contributors', 'p', 'left'],
  ['github_login_map', 'p', 'left'],
  ['github_repo_facts', 'p', 'left'],
  ['google_workspace_files', 'p', 'left'],
  ['google_workspace_proposals', 'p', 'left'],
  ['grow_campaigns', 'p', 'cascade'],
  ['grow_proposal_receipts', 'p', 'cascade'],
  ['grow_prospect_pages', 'p', 'cascade'],
  ['growth_channels', 'p', 'cascade'],
  ['growth_partners', 'p', 'cascade'],
  ['hypotheses', 'p', 'cascade'],
  ['hypothesis_evidence_links', 'p', 'cascade'],
  ['hypothesis_experiments', 'p', 'cascade'],
  ['hypothesis_verdict_history', 'p', 'left'],
  ['ic_decisions', 'pc', 'refuses'],
  ['incorporations', 'pc', 'left'],
  ['integration_companies', 'c', 'company'],
  ['interview_findings', 'p', 'cascade'],
  ['interview_guide_copies', 'p', 'cascade'],
  ['interview_guides', 'p', 'cascade'],
  ['interview_output_preferences', 'p', 'cascade'],
  ['interview_sessions', 'p', 'left'],
  ['investor_company_notes', 'p', 'cascade'],
  ['investor_dealroom_members', 'c', 'company'],
  ['investor_introductions', 'pc', 'cleanup'],
  ['job_postings', 'p', 'refuses'],
  ['kpi_alerts', 'p', 'cascade'],
  ['lab_report_shares', 'p', 'left'],
  ['landing_pages', 'p', 'left'],
  ['lovable_app_links', 'p', 'cascade'],
  ['lovable_signup_tokens', 'p', 'cascade'],
  ['market_figures', 'p', 'cascade'],
  ['market_readiness_marks', 'p', 'cascade'],
  ['market_sizing_versions', 'p', 'cascade'],
  ['market_sources', 'p', 'cascade'],
  ['markets', 'p', 'cascade'],
  ['meeting_bots', 'p', 'refuses'],
  ['mercury_grow_facts', 'p', 'cascade'],
  ['mercury_partner_proposals', 'p', 'cascade'],
  ['mercury_raise_facts', 'p', 'left'],
  ['mercury_raise_proposals', 'p', 'left'],
  ['metric_definitions', 'p', 'left'],
  ['metric_targets', 'p', 'cascade'],
  ['mvp_features', 'p', 'left'],
  ['mvp_test_sessions', 'p', 'cascade'],
  ['narrative_bindings', 'p', 'refuses'],
  ['narrative_checks', 'p', 'cascade'],
  ['narrative_notes', 'p', 'refuses'],
  ['narrative_objection_answers', 'p', 'cascade'],
  ['narrative_positioning', 'p', 'refuses'],
  ['narrative_read_reasons', 'p', 'refuses'],
  ['narrative_sections', 'p', 'refuses'],
  ['narrative_version_meta', 'p', 'cascade'],
  ['notion_proposals', 'p', 'left'],
  ['notion_sources', 'p', 'left'],
  ['okr_column_moves', 'p', 'left'],
  ['okr_dependencies', 'p', 'left'],
  ['outreach_sequences', 'p', 'cascade'],
  ['pain_group_aliases', 'p', 'cascade'],
  ['pain_groups', 'p', 'cascade'],
  ['perks', 'c', 'company'],
  ['pitch_deck_proposals', 'p', 'cleanup'],
  ['pitch_decks', 'p', 'cleanup'],
  ['portfolio_attention_alerts', 'p', 'refuses'],
  ['portfolio_distributions', 'p', 'refuses'],
  ['portfolio_health_snapshots', 'p', 'left'],
  ['portfolio_mark_requests', 'p', 'refuses'],
  ['portfolio_marks', 'p', 'refuses'],
  ['portfolio_positions', 'p', 'refuses'],
  ['portfolio_right_requests', 'p', 'refuses'],
  ['portfolio_rights', 'p', 'refuses'],
  ['portfolio_support_entries', 'p', 'refuses'],
  ['portfolio_update_chases', 'p', 'refuses'],
  ['portfolio_updates', 'p', 'refuses'],
  ['posthog_metric_facts', 'p', 'cascade'],
  ['posthog_project_links', 'p', 'cascade'],
  ['posthog_proposals', 'p', 'cascade'],
  ['posthog_survey_marks', 'p', 'cascade'],
  ['posthog_tracked_metrics', 'p', 'cascade'],
  ['product_feedback', 'p', 'cascade'],
  ['project_core_systems', 'p', 'cascade'],
  ['project_lanes', 'p', 'left'],
  ['project_market_assumptions', 'p', 'cascade'],
  ['project_member_invitations', 'p', 'left'],
  ['project_members', 'p', 'left'],
  ['project_metrics', 'p', 'cleanup'],
  ['project_move_followups', 'p', 'left'], // D8525: the move's owed follow-up step; no reference, nothing deletes it
  ['project_rituals', 'p', 'left'],
  ['publish_destinations', 'c', 'company'],
  ['publish_drafts', 'pc', 'cascade'],
  ['publish_sends', 'p', 'left'],
  ['quotes', 'c', 'company'],
  ['raise_claim_evidence', 'p', 'cascade'],
  ['raise_claims', 'p', 'cascade'],
  ['raise_closes', 'p', 'left'],
  ['raise_evidence_items', 'p', 'cascade'],
  ['raise_evidence_refreshes', 'p', 'cascade'],
  ['raise_evidence_share_links', 'p', 'cascade'],
  ['raise_investor_updates', 'p', 'left'],
  ['raise_pro_rata', 'p', 'left'],
  ['raise_prospect_invites', 'p', 'cascade'],
  ['raise_prospect_signals', 'p', 'cascade'],
  ['raise_prospects', 'p', 'left'],
  ['raise_rounds', 'p', 'left'],
  ['raise_share_pdf_copies', 'p', 'cascade'],
  ['readiness_items', 'p', 'cascade'],
  ['readiness_scores', 'p', 'cascade'],
  ['reference_checks', 'c', 'company'],
  ['report_documents', 'p', 'refuses'],
  ['reporting_duties', 'p', 'refuses'],
  ['reporting_events', 'p', 'refuses'],
  ['reporting_reminder_settings', 'p', 'refuses'],
  ['research_brief_notes', 'p', 'cascade'],
  ['research_funds', 'p', 'set_null'],
  ['research_project_answers', 'p', 'left'],
  ['research_project_attachments', 'p', 'left'],
  ['research_project_briefs', 'p', 'left'],
  ['research_project_collections', 'p', 'left'],
  ['research_project_comparisons', 'p', 'left'],
  ['research_project_documents', 'p', 'left'],
  ['research_project_findings', 'p', 'left'],
  ['research_project_sessions', 'p', 'left'],
  ['research_project_subjects', 'p', 'left'],
  ['research_room_refs', 'p', 'refuses'],
  ['research_studies', 'p', 'left'],
  ['research_study_decisions', 'p', 'left'],
  ['research_study_links', 'p', 'left'],
  ['research_study_questions', 'p', 'left'],
  ['research_study_segments', 'p', 'left'],
  ['revenue_entries', 'p', 'cascade'],
  ['revenue_movements', 'p', 'cascade'],
  ['ritual_runs', 'p', 'left'],
  ['ritual_templates', 'p', 'left'],
  ['roadmap_okrs', 'p', 'cleanup'],
  ['roadmap_releases', 'p', 'cascade'],
  ['roadmap_scenarios', 'p', 'left'],
  ['round_calls', 'pc', 'cleanup'],
  ['rounds', 'p', 'left'],
  ['safe_issuances', 'p', 'refuses'],
  ['scope_goals', 'pc', 'refuses'],
  ['scope_tasks', 'pc', 'refuses'],
  ['score_snapshots', 'p', 'cleanup'],
  ['search_console_daily_totals', 'p', 'cascade'],
  ['search_console_page_weeks', 'p', 'cascade'],
  ['search_console_revisions', 'p', 'cascade'],
  ['search_console_selections', 'p', 'cascade'],
  ['search_console_sync_runs', 'p', 'cascade'],
  ['search_console_sync_state', 'p', 'cascade'],
  ['search_console_top_pages', 'p', 'cascade'],
  ['section_83b_operator_assignments', 'p', 'refuses'],
  ['section_83b_operator_reviews', 'p', 'refuses'],
  ['section_83b_trackers', 'p', 'cascade'],
  ['service_offerings', 'c', 'company'],
  ['service_offerings_orphans_pre200', 'c', 'company'],
  ['solution_design_notes', 'p', 'left'],
  ['solution_design_proposals', 'p', 'left'],
  ['solution_design_stack', 'p', 'left'],
  ['spinout_certificates', 'p', 'set_null'],
  ['spinout_deck_overrides', 'p', 'refuses'],
  ['spinout_lab_enrollment_events', 'p', 'left'],
  ['spinout_lab_enrollments', 'p', 'left'],
  ['stage_norms', 'p', 'cascade'],
  ['swarm_admission_events', 'c', 'company'],
  ['task_comments', 'p', 'refuses'],
  ['task_labels', 'p', 'refuses'],
  ['task_milestones', 'p', 'refuses'],
  ['team_agents', 'pc', 'refuses'],
  ['team_rulebooks', 'pc', 'refuses'],
  ['telegram_captures', 'p', 'left'],
  ['tickets', 'p', 'cleanup'],
  ['tiktok_account_facts', 'p', 'cascade'],
  ['tiktok_account_links', 'p', 'cascade'],
  ['tiktok_proposals', 'p', 'cascade'],
  ['tiktok_video_facts', 'p', 'cascade'],
  ['typeform_evidence_mappings', 'p', 'cascade'],
  ['typeform_form_bindings', 'p', 'cascade'],
  ['typeform_form_syncs', 'p', 'cascade'],
  ['typeform_reviews', 'p', 'cascade'],
  ['uof_scenarios', 'p', 'cascade'],
  ['use_of_funds_hires', 'p', 'cascade'],
  ['user_company_links', 'c', 'company'],
  ['user_company_visits', 'c', 'company'],
  ['validate_proposals', 'p', 'cascade'],
  ['validation_decision_commitments', 'p', 'cascade'],
  ['validation_decision_shares', 'p', 'cascade'],
  ['validation_decisions', 'p', 'cascade'],
  ['validation_objectives', 'p', 'cascade'],
  ['valuation_409a_events', 'p', 'cascade'],
  ['valuations_409a', 'p', 'cascade'],
  ['vc_funds', 'c', 'company'],
  ['venture_git_installations', 'pc', 'cascade'],
  ['venture_outreach_settings', 'p', 'cascade'],
  ['venture_risk_overrides', 'p', 'cascade'],
  ['venture_risks', 'p', 'cascade'],
  ['venture_score_corrections', 'p', 'cascade'],
  ['venture_score_reviews', 'p', 'cascade'],
  ['venture_score_sharing', 'p', 'cascade'],
  ['venture_scorecards', 'p', 'cascade'],
  ['venture_suppressions', 'p', 'cascade'],
  ['vercel_company_facts', 'p', 'left'],
  ['vercel_company_proposals', 'p', 'left'],
  ['vercel_deployments', 'p', 'left'],
  ['vercel_health_events', 'p', 'cascade'],
  ['vercel_projects', 'p', 'left'],
  ['waitlist_signups', 'p', 'left'],
  ['watchlist_items', 'pc', 'left'],
  ['whatsapp_captures', 'p', 'left'],
  ['whatsapp_link_settings', 'p', 'set_null'],
  ['work_capacity', 'p', 'cascade'],
  ['work_graph_assets', 'pc', 'left'],
  ['work_graph_blobs', 'c', 'company'],
  ['work_graph_edges', 'c', 'company'],
  ['work_graph_effects', 'c', 'company'],
  ['work_graph_events', 'pc', 'left'],
  ['work_graph_holds', 'c', 'company'],
  ['work_graph_integrity_events', 'c', 'company'],
  ['work_graph_lease_events', 'pc', 'left'],
  ['work_graph_release_attestations', 'c', 'company'],
  ['work_graph_release_authority_events', 'c', 'company'],
  ['work_graph_release_decisions', 'pc', 'left'],
  ['work_graph_release_deliveries', 'c', 'company'],
  ['work_graph_release_lines', 'pc', 'left'],
  ['work_graph_release_manifests', 'pc', 'left'],
  ['work_graph_release_takedowns', 'pc', 'left'],
  ['work_graph_revision_flags', 'c', 'company'],
  ['work_graph_revisions', 'pc', 'left'],
  ['workflows', 'p', 'left'],
];

const HARD_DELETE: Record<HardDelete, Answer> = {
  cleanup: { is: 'removed', by: 'hardDeleteProject' },
  cascade: { is: 'removed', by: 'ON DELETE CASCADE from projects' },
  kept_audit: { is: 'kept', reason: 'the audit trail: hardDeleteProject keeps each entry with project_id set to NULL' },
  kept_receipts: { is: 'kept', reason: 'financial records: a call with receipts is kept with project_id set to NULL; one without is removed' },
  set_null: unspecified('Q5', 'unlinked'),
  refuses: unspecified('Q4', 'refuses'),
  left: unspecified('Q3', 'untouched'),
  company: COMPANY_DATA,
};

/** Account erasure: the agent memory is the only venture data `eraseAccountAgents` touches. */
const ERASURE: Record<string, Answer> = {
  agent_memory_notes: { is: 'removed', by: 'eraseAccountAgents (the notes of the agents the account sponsors, and its own)' },
  scope_tasks: unspecified('Q1', 'changed'), // an open task assigned to the account's agent is cancelled, not removed
};

/** A move that rewrites a venture's row on purpose. D8535 (#8535): the grants were given under the company the
 *  venture leaves, so the move's batch (`projectMoveStatements`) sets the active ones to `revoked`; the owner shares
 *  the room again from the new company. */
const MOVE: Record<string, Answer> = {
  data_room_grants: { is: 'changed', by: "projectMoveStatements (an active grant becomes 'revoked', D8535)" },
};

function d1Store([name, keyed, hard]: readonly [string, Keyed, HardDelete]): Store {
  const venture = keyed !== 'c';
  return {
    id: `d1:${name}`,
    kind: 'd1_table',
    name,
    keyed_by: keyed === 'p' ? 'project' : keyed === 'c' ? 'company' : 'project_and_company',
    answers: {
      move: MOVE[name] ?? (!venture ? COMPANY_DATA : keyed === 'pc' ? unspecified('Q2', 'untouched') : FOLLOWS),
      archive: venture ? FOLLOWS : COMPANY_DATA,
      restore: venture ? FOLLOWS : COMPANY_DATA,
      hard_delete: HARD_DELETE[hard],
      account_erasure: ERASURE[name] ?? unspecified('Q1', 'untouched'),
    },
  };
}

/** The venture itself. Its row moves, goes to Trash and comes back; the hard delete removes it. */
const PROJECTS: Store = {
  id: 'd1:projects',
  kind: 'd1_table',
  name: 'projects',
  keyed_by: 'project_and_company',
  answers: {
    move: FOLLOWS, archive: FOLLOWS, restore: FOLLOWS,
    hard_delete: { is: 'removed', by: 'hardDeleteProject' },
    account_erasure: unspecified('Q1', 'untouched'),
  },
};

/**
 * R2 key templates under a venture's or a company's id (bucket binding, then the key's prefix). Every one is a
 * `record` or `replaceable` class of `documentation/operations/R2_INVENTORY.json`.
 */
const R2_PREFIXES: ReadonlyArray<readonly [string, 'project' | 'company', Answer]> = [
  ['FILES/build-proof/{project_id}/', 'project', unspecified('Q6', 'untouched')],
  ['FILES/company-documents/{company_uid}/', 'company', COMPANY_DATA],
  ['FILES/data-room/{project_uid}/', 'project', unspecified('Q6', 'untouched')],
  ['FILES/deck-images/{project_id}/', 'project', { is: 'removed', by: 'hardDeleteProject (purgeDeckImages, retried by the trash sweep)' }],
  ['FILES/deck-rehearsals/{project_id}/', 'project', unspecified('Q6', 'untouched')],
  ['FILES/grow-minutes/{project_id}/', 'project', unspecified('Q6', 'untouched')],
  ['FILES/grow-voice/{project_id}/', 'project', unspecified('Q6', 'untouched')],
  ['FILES/reports/{project_uid}/', 'project', unspecified('Q6', 'untouched')],
];

function r2Store([template, keyed, hard]: readonly [string, 'project' | 'company', Answer]): Store {
  const venture = keyed === 'project';
  return {
    id: `r2:${template}`,
    kind: 'r2_prefix',
    name: template.slice(template.indexOf('/') + 1),
    keyed_by: keyed,
    answers: {
      move: venture ? FOLLOWS : COMPANY_DATA,
      archive: venture ? FOLLOWS : COMPANY_DATA,
      restore: venture ? FOLLOWS : COMPANY_DATA,
      hard_delete: hard,
      account_erasure: unspecified('Q1', 'untouched'),
    },
  };
}

const UNKNOWN: Answer = unspecified('Q7', 'unknown');
/** Stores outside D1 and R2 that hold something of a venture. No KV namespace does (the coverage test checks). */
const OTHER: Store[] = [
  {
    id: 'other:VECTORIZE', kind: 'other', name: 'axal-search vectors, id project:{id}', keyed_by: 'project',
    answers: { move: UNKNOWN, archive: UNKNOWN, restore: UNKNOWN, hard_delete: { is: 'removed', by: 'an embed_delete job queued by the hard delete route' }, account_erasure: UNKNOWN },
  },
  {
    id: 'other:DECK_QUOTES', kind: 'other', name: 'axal-deck-quotes vectors, metadata project_id', keyed_by: 'project',
    answers: { move: UNKNOWN, archive: UNKNOWN, restore: UNKNOWN, hard_delete: UNKNOWN, account_erasure: UNKNOWN },
  },
  {
    id: 'other:AGENT_SCOPE', kind: 'other', name: 'the venture\'s agent scope object (eraseScopeRuntime empties it, best effort, on a hard delete)', keyed_by: 'project',
    answers: { move: UNKNOWN, archive: UNKNOWN, restore: UNKNOWN, hard_delete: UNKNOWN, account_erasure: UNKNOWN },
  },
  {
    id: 'other:JOB_QUEUE', kind: 'other', name: 'job messages naming a venture\'s rows', keyed_by: 'project',
    answers: { move: UNKNOWN, archive: UNKNOWN, restore: UNKNOWN, hard_delete: UNKNOWN, account_erasure: UNKNOWN },
  },
  {
    id: 'other:AGENT_QUEUE', kind: 'other', name: 'agent run messages (a run uid)', keyed_by: 'project',
    answers: { move: UNKNOWN, archive: UNKNOWN, restore: UNKNOWN, hard_delete: UNKNOWN, account_erasure: UNKNOWN },
  },
];

/** The inventory: every store, in a fixed order (D1, R2, other). */
export const VENTURE_SPACE_STORES: readonly Store[] = Object.freeze([PROJECTS, ...D1_TABLES.map(d1Store), ...R2_PREFIXES.map(r2Store), ...OTHER]);

/**
 * Key templates the coverage scan finds that are not stores: `refused/{project_id}/` is the `r2_key` a refused image
 * draw records on its `deck_images` row (`services/decks/imageDraw.ts`); no object is ever written under it.
 */
export const NOT_STORES: Readonly<Record<string, string>> = Object.freeze({
  'refused/': 'a key name recorded on a refused draw; no object is written under it',
});

/** The D1 tables a schema says must be listed (a `project_id` or `company_id` column) that the inventory lacks. */
export function unlistedTables(schema: ReadonlyArray<{ name: string; columns: readonly string[] }>, stores: readonly Store[] = VENTURE_SPACE_STORES): string[] {
  const listed = new Set(stores.filter((s) => s.kind === 'd1_table').map((s) => s.name));
  return schema.filter((t) => (t.columns.includes('project_id') || t.columns.includes('company_id')) && !listed.has(t.name)).map((t) => t.name);
}

/** Every answer still waiting for the owner, as `[store id, event, question]`. */
export function unspecifiedAnswers(stores: readonly Store[] = VENTURE_SPACE_STORES): Array<[string, LifecycleEvent, QuestionId]> {
  const out: Array<[string, LifecycleEvent, QuestionId]> = [];
  for (const s of stores) for (const e of LIFECYCLE_EVENTS) { const a = s.answers[e]; if (a.is === 'unspecified') out.push([s.id, e, a.question]); }
  return out;
}
