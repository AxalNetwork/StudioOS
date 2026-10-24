/**
 * D774 (#2100) — the Admin's boards and the options they offer, as the AIRail
 * canvas names them (`design/incoming/airail-every-page-data/canvas.json`,
 * profile `Admin`, boards S1–S39 in the canvas's own order: each section's own
 * page, then its modules).
 *
 * This is the input D764 PR 3 (#2089) reads to give each option the models
 * that fit its work, and the list the per-section PRs wire `useRailOption`
 * from. `frontend/test/rail_options_admin_d774.test.mjs` checks it against the
 * code both ways: every listed board and option exists, and every upload,
 * draft or report control in a board's files is listed.
 *
 * BOARDS. `id`, `section` and `module` are the canvas's (`module` is null on a
 * section's own page). `route` is where the board is drawn today. `files` are
 * the components the board renders, the board's own first. `rail` is the file
 * that mounts the board's `<WorkerRail>`, which may be a parent's, or null with
 * `noRail` saying why the board has none. `host` is the page that draws the
 * frame around a board's files when they are a tab of it (`/admin`'s, in
 * `AdminPage.jsx`). `alias` names the board that owns a shared route (D720
 * §11: the board the canvas lists first), whose rail and name this one shows.
 *
 * OPTIONS are the controls that run a model, in #2097's shape (`page`, `key`
 * as `<verb>:<object>`, `label`, one of the canvas's fourteen `kind`s,
 * `handler`, plus the `file` it is in and an `anchor` unique to it there).
 * An option that runs no model is not a row (`railOptions/README.md`).
 *
 * No control on these 38 active boards runs a model today, so `ADMIN_OPTIONS` is
 * empty. The upload and report controls the boards do have are
 * `ADMIN_QUIET_CONTROLS`, each with why it runs none, so the test can still
 * hold every control in the boards' files to one list or the other.
 */

export const ADMIN_PROFILE = 'Admin';

const SPINOUT = 'A Spin-Out Lab page: D317 keeps Eadwyn out of the Lab (workspace_frame_contract.test.mjs), and NO_RAIL_ROUTES says so.';

const FRAME = 'pages/admin/AdminBoardFrame.jsx';
const HELD = 'pages/admin/HeldZone.jsx';
const CONTRACTS = 'pages/admin/contracts/ContractsDesk.jsx';
const ADMIN_PAGE = 'pages/AdminPage.jsx';

export const ADMIN_BOARDS = [
  { id: 'S1', section: 'Accounts', module: null, route: '/admin/held/accounts', files: ['pages/admin/HeldAccounts.jsx'], rail: HELD },
  { id: 'S2', section: 'Accounts', module: 'Users', route: '/admin?tab=users', files: ['pages/admin/consoles/UsersConsole.jsx'], rail: FRAME, host: ADMIN_PAGE },
  { id: 'S3', section: 'Accounts', module: 'Exploring members', route: '/admin/exploring', files: ['pages/admin/AdminExploring.jsx'], rail: FRAME },
  { id: 'S4', section: 'Accounts', module: 'Trash', route: '/admin/trash', files: ['pages/AdminTrashPage.jsx'], rail: FRAME },
  { id: 'S5', section: 'Approvals', module: null, route: '/admin/held/approvals', files: ['pages/admin/HeldApprovals.jsx'], rail: HELD },
  { id: 'S6', section: 'Approvals', module: 'Identity checks', route: '/admin?tab=kyc', files: ['pages/admin/consoles/KycConsole.jsx'], rail: FRAME, host: ADMIN_PAGE },
  { id: 'S7', section: 'Approvals', module: 'Entity profiles', route: '/admin?tab=profiles', files: ['pages/admin/consoles/PartnerProfilesConsole.jsx'], rail: FRAME, host: ADMIN_PAGE },
  { id: 'S8', section: 'Approvals', module: 'LP applications', route: '/admin/lp-applications', files: ['pages/admin/AdminLpApplications.jsx'], rail: FRAME },
  { id: 'S9', section: 'Approvals', module: 'Referrals', route: '/admin/refer-earn', files: ['pages/admin/ReferralReview.jsx'], rail: FRAME },
  { id: 'S10', section: 'Approvals', module: 'Best fit', route: '/admin/best-fit', files: ['pages/admin/AdminBestFitPage.jsx'], rail: FRAME },
  { id: 'S11', section: 'Approvals', module: 'Due diligence', route: '/admin/due-diligence', files: ['pages/AdminDueDiligencePage.jsx', 'pages/AdminDueDiligenceCasePage.jsx'], rail: FRAME },
  { id: 'S12', section: 'Approvals', module: 'Spin-Out applications', route: '/admin/spinout-lab', files: ['pages/admin/AdminSpinoutLab.jsx'], rail: null, noRail: SPINOUT },
  { id: 'S13', section: 'Approvals', module: 'Spin-Out moderation', route: '/admin/spinout-moderation', files: ['pages/admin/SpinoutModerationPage.jsx'], rail: null, noRail: SPINOUT },
  { id: 'S14', section: 'Approvals', module: 'Exploring members', route: '/admin/exploring', files: ['pages/admin/AdminExploring.jsx'], rail: FRAME, alias: 'S3' },
  { id: 'S15', section: 'Approvals', module: 'Events', route: '/admin/events', files: ['pages/admin/AdminEventsPage.jsx'], rail: FRAME },
  { id: 'S16', section: 'Approvals', module: 'Jobs', route: '/admin/jobs', files: ['pages/admin/AdminJobsPage.jsx'], rail: FRAME },
  { id: 'S17', section: 'Approvals', module: 'Communities', route: '/admin/circles', files: ['pages/admin/AdminCirclesPage.jsx'], rail: FRAME },
  { id: 'S18', section: 'Approvals', module: 'Advisor cohort access', route: '/admin/advisor-cohorts', files: ['pages/admin/AdvisorCohortAssignments.jsx'], rail: FRAME },
  { id: 'S19', section: 'Programs', module: null, route: '/admin/held/programs', files: ['pages/admin/HeldPrograms.jsx'], rail: HELD },
  { id: 'S20', section: 'Programs', module: 'Spin-Out Lab', route: '/admin/spinout-lab', files: ['pages/admin/AdminSpinoutLab.jsx'], rail: null, noRail: SPINOUT, alias: 'S12' },
  { id: 'S21', section: 'Programs', module: 'Advisor cohorts', route: '/admin/advisor-cohorts', files: ['pages/admin/AdvisorCohortAssignments.jsx'], rail: FRAME, alias: 'S18' },
  // S22: Assessment Studio was removed at the owner's request (2026-10-21); its ID stays retired.
  { id: 'S23', section: 'Programs', module: 'Profiling trends', route: '/admin/profiling-trends', files: ['pages/admin/AdminProfilingTrends.jsx'], rail: FRAME },
  { id: 'S24', section: 'Community', module: null, route: '/admin/community', files: ['pages/admin/community/AdminCommunity.jsx', 'pages/admin/community/communityModel.js'], rail: 'pages/admin/community/AdminCommunity.jsx' },
  { id: 'S25', section: 'Community', module: 'Events', route: '/admin/events', files: ['pages/admin/AdminEventsPage.jsx'], rail: FRAME, alias: 'S15' },
  { id: 'S26', section: 'Community', module: 'Jobs', route: '/admin/jobs', files: ['pages/admin/AdminJobsPage.jsx'], rail: FRAME, alias: 'S16' },
  { id: 'S27', section: 'Community', module: 'Communities', route: '/admin/circles', files: ['pages/admin/AdminCirclesPage.jsx'], rail: FRAME, alias: 'S17' },
  { id: 'S28', section: 'Community', module: 'Wellbeing experts', route: '/admin?tab=wellbeing', files: ['pages/admin/consoles/WellbeingConsole.jsx'], rail: FRAME, host: ADMIN_PAGE },
  { id: 'S29', section: 'Community', module: 'Advisors and partners', route: '/admin?tab=network-profiles', files: ['pages/admin/AdminNetworkProfiles.jsx'], rail: FRAME, host: ADMIN_PAGE },
  { id: 'S30', section: 'Community', module: 'Directory', route: '/admin?tab=directory', files: ['pages/admin/consoles/DirectoryConsole.jsx'], rail: FRAME, host: ADMIN_PAGE },
  { id: 'S31', section: 'Community', module: 'Partner invitations', route: '/admin/partner-invitations', files: ['pages/admin/PartnerInvitations.jsx'], rail: FRAME },
  { id: 'S32', section: 'Contracts', module: null, route: '/admin/contracts', files: [CONTRACTS], rail: CONTRACTS },
  { id: 'S33', section: 'Contracts', module: 'Agreements', route: '/admin/contracts', files: ['pages/admin/contracts/AgreementList.jsx', 'pages/admin/contracts/AgreementDetail.jsx'], rail: CONTRACTS },
  { id: 'S34', section: 'Contracts', module: 'NDAs', route: '/admin/contracts?tab=ndas', files: ['pages/admin/contracts/RelatedLists.jsx'], rail: CONTRACTS },
  { id: 'S35', section: 'Contracts', module: 'Partner deals', route: '/admin/contracts?tab=partner-deals', files: ['pages/admin/contracts/RelatedLists.jsx'], rail: CONTRACTS },
  { id: 'S36', section: 'Contracts', module: 'Templates', route: '/admin/contracts?tab=templates', files: ['pages/admin/AdminTemplates.jsx', 'pages/admin/contracts/TemplateEditor.jsx', 'pages/admin/contracts/TemplateCatalog.jsx'], rail: CONTRACTS },
  { id: 'S37', section: 'Contracts', module: 'Forms', route: '/admin/contracts?tab=forms', files: ['pages/admin/AdminForms.jsx'], rail: CONTRACTS },
  { id: 'S38', section: 'Insights', module: null, route: '/admin/insights', files: ['pages/admin/insights/AdminInsights.jsx', 'pages/admin/insights/insightsModel.js', 'ui/Charts.jsx'], rail: 'pages/admin/insights/AdminInsights.jsx' },
  { id: 'S39', section: 'Licences', module: null, route: '/admin/my-licence', files: ['pages/subsidiary/MyLicencePage.jsx'], rail: FRAME },
];

export const ADMIN_OPTIONS = [];

export const ADMIN_QUIET_CONTROLS = [
  { page: 'S11', label: 'Upload signed NDA', file: 'pages/AdminDueDiligenceCasePage.jsx', anchor: 'accept="application/pdf,image/*"', why: 'Stores the reviewer\'s signed NDA; no model reads it.' },
  { page: 'S11', label: 'Generate report', file: 'pages/AdminDueDiligenceCasePage.jsx', anchor: 'await dd.generateReport(uid)', why: 'The Worker assembles the report from the case\'s recorded sections and findings (routes/dd.ts, POST /cases/:uid/report); no model writes it.' },
  { page: 'S29', label: 'Upload photo', file: 'pages/admin/AdminNetworkProfiles.jsx', anchor: 'onChange={(e) => submitPhoto(e.target.files?.[0])}', why: 'Stores the profile photo; no model reads it.' },
];

/** The options the rail lists on a board. */
export function railOptionsFor(boardId) {
  return ADMIN_OPTIONS.filter((o) => o.page === boardId);
}
