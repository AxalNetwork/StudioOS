/**
 * D775 (#2101) — the Super Admin's boards and the options they offer, as the
 * AIRail canvas names them (`design/incoming/airail-every-page-data/canvas.json`,
 * profile `Super Admin`, boards H1–H37 in the canvas's own order).
 *
 * This is the input D764 PR 3 (#2089) reads to give each option the models
 * that fit its work, and the list the per-section PRs wire `useRailOption`
 * from. `frontend/test/rail_options_super_admin_d775.test.mjs` checks it
 * against the code both ways: every listed board and option exists, and every
 * model-running control in a board's files is a row.
 *
 * BOARDS. `id`, `section` and `module` are the canvas's (`module` is null on a
 * section board). `route` is where the board is drawn today; D720 §11's table
 * places H11 on the Users tab of `/admin` and H13 on H12's page. `files` are
 * the components the board renders, the board's own first. `rail` is the file
 * that mounts the board's `<WorkerRail>`, which may be a parent's, or null with
 * `railPending` saying why there is none yet.
 *
 * OPTIONS follow this folder's rules (`README.md`): one row per control that
 * runs a model, in the siblings' shape: `page` (the canvas board, "Super
 * Admin · <section>[ · <module>]"), `key` (`<verb>:<object>`), `label`, `kind`
 * (one of the canvas's fourteen) and `handler`. `source` is `file` (under
 * `frontend/src/`) and `match`, the call the parity test finds.
 *
 * One control on these 37 boards runs a model: H20's "Draft with AI". The
 * uploads (H1's brand mark, the photos on H23 and H25, H34's post media, H37's
 * headshot and LinkedIn PDF, which a deterministic parser reads) only store a
 * file, so they are not rows. Monitoring's anomaly panel (H33) calls a model on
 * mount, not on a member's press, so it is not an option; D780 (#2105) moves
 * it onto the run path.
 */

export const SUPER_ADMIN_PROFILE = 'Super Admin';

const ADMIN_PAGE_PENDING = 'An /admin tab; AdminPage.jsx also hosts the Admin profile\'s boards (#2100), so its frame waits on S1\'s answer on #2101.';

export const SUPER_ADMIN_BOARDS = [
  { id: 'H1', section: 'Licences', module: null, route: '/admin/licences', files: ['pages/admin/AdminLicences.jsx'], rail: 'pages/admin/AdminLicences.jsx' },
  { id: 'H2', section: 'Funds', module: null, route: '/admin/funds', files: ['pages/hq/HqFundsPage.jsx'], rail: 'pages/hq/HqFundsPage.jsx' },
  { id: 'H3', section: 'Contracts', module: null, route: '/admin/contracts', files: ['pages/admin/contracts/ContractsDesk.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H4', section: 'Contracts', module: 'Agreements', route: '/admin/contracts', files: ['pages/admin/contracts/AgreementList.jsx', 'pages/admin/contracts/AgreementDetail.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H5', section: 'Contracts', module: 'NDAs', route: '/admin/contracts?tab=ndas', files: ['pages/admin/contracts/RelatedLists.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H6', section: 'Contracts', module: 'Partner deals', route: '/admin/contracts?tab=partner-deals', files: ['pages/admin/contracts/RelatedLists.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H7', section: 'Contracts', module: 'Templates', route: '/admin/contracts?tab=templates', files: ['pages/admin/AdminTemplates.jsx', 'pages/admin/contracts/TemplateEditor.jsx', 'pages/admin/contracts/TemplateCatalog.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H8', section: 'Contracts', module: 'Forms', route: '/admin/contracts?tab=forms', files: ['pages/admin/AdminForms.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H9', section: 'Contracts', module: 'Document types', route: '/admin/contracts?tab=document-types', files: ['pages/hq/ContractRegistry.jsx'], rail: 'pages/admin/contracts/ContractsDesk.jsx' },
  { id: 'H10', section: 'Team', module: null, route: '/admin/accounts', files: ['pages/hq/AccountsPage.jsx'], rail: 'pages/hq/AccountsPage.jsx' },
  { id: 'H11', section: 'Team', module: 'Users', route: '/admin?tab=users', files: ['pages/admin/consoles/UsersConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H12', section: 'Revenue', module: null, route: '/admin/revenue', files: ['pages/hq/RevenuePage.jsx'], rail: 'pages/hq/RevenuePage.jsx' },
  { id: 'H13', section: 'Revenue', module: 'Overview', route: '/admin/revenue', files: ['pages/hq/RevenuePage.jsx'], rail: 'pages/hq/RevenuePage.jsx' },
  { id: 'H14', section: 'Revenue', module: 'Disputes', route: '/admin/revenue#disputes', files: ['pages/hq/RevenuePage.jsx', 'pages/hq/DisputePage.jsx'], rail: 'pages/hq/RevenuePage.jsx' },
  { id: 'H15', section: 'Revenue', module: 'Refunds', route: '/admin/revenue#refunds', files: ['pages/hq/RevenuePage.jsx'], rail: 'pages/hq/RevenuePage.jsx' },
  { id: 'H16', section: 'Revenue', module: 'Statements', route: '/admin/revenue#statements', files: ['pages/hq/RevenuePage.jsx'], rail: 'pages/hq/RevenuePage.jsx' },
  { id: 'H17', section: 'Revenue', module: 'Promotions', route: '/admin/revenue#promotions', files: ['pages/hq/RevenuePage.jsx'], rail: 'pages/hq/RevenuePage.jsx' },
  { id: 'H18', section: 'Content', module: null, route: '/admin/content', files: ['pages/hq/ContentPage.jsx'], rail: 'pages/hq/ContentPage.jsx' },
  { id: 'H19', section: 'Content', module: 'Content queue', route: '/admin/articles', files: ['pages/admin/ArticlesQueuePage.jsx'], rail: 'pages/admin/ArticlesQueuePage.jsx' },
  { id: 'H20', section: 'Content', module: 'Publications', route: '/admin/publications', files: ['pages/admin/Publications.jsx', 'pages/admin/PublicationNew.jsx', 'pages/admin/PublicationDetail.jsx'], rail: 'pages/admin/PublicationsFrame.jsx' },
  { id: 'H21', section: 'Content', module: 'Assessment Studio', route: '/admin/assessment', files: ['pages/admin/assessment/AdminAssessmentPage.jsx'], rail: null, railPending: 'Shared with the Admin profile\'s Assessment runs (#2100), which the canvas lists first, so the route is S09\'s.' },
  { id: 'H22', section: 'Content', module: 'Personas', route: '/admin?tab=personas', files: ['pages/admin/consoles/PersonasConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H23', section: 'Content', module: 'Advisors and partners', route: '/admin?tab=network-profiles', files: ['pages/admin/AdminNetworkProfiles.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H24', section: 'Content', module: 'Directory', route: '/admin?tab=directory', files: ['pages/admin/consoles/DirectoryConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H25', section: 'Content', module: 'Public team page', route: '/admin/team', files: ['pages/admin/AdminTeam.jsx'], rail: 'pages/admin/AdminTeam.jsx' },
  { id: 'H26', section: 'Platform', module: null, route: '/admin/platform', files: ['pages/hq/PlatformPage.jsx'], rail: 'pages/hq/PlatformPage.jsx' },
  { id: 'H27', section: 'Platform', module: 'Integration keys', route: '/admin?tab=integration-keys', files: ['pages/admin/consoles/IntegrationKeysConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H28', section: 'Platform', module: 'GitHub sync', route: '/admin?tab=github', files: ['pages/admin/consoles/GithubSyncConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H29', section: 'Platform', module: 'Payments catalogue', route: '/admin?tab=payments', files: ['pages/admin/consoles/PaymentsConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H30', section: 'Platform', module: 'Promo codes', route: '/admin?tab=promos', files: ['pages/admin/consoles/PromoCodesConsole.jsx'], rail: null, railPending: ADMIN_PAGE_PENDING },
  { id: 'H31', section: 'Platform', module: 'Credit rules', route: '/admin/credit-rules', files: ['pages/hq/CreditRulesRegistryPage.jsx'], rail: 'pages/hq/CreditRulesRegistryPage.jsx' },
  { id: 'H32', section: 'Platform', module: 'AI allowances', route: '/admin/platform/allowances', files: ['pages/hq/PlatformAllowancesPage.jsx'], rail: 'pages/hq/PlatformAllowancesPage.jsx' },
  { id: 'H33', section: 'Platform', module: 'Monitoring', route: '/monitoring', files: ['pages/MonitoringPage.jsx'], rail: 'pages/MonitoringPage.jsx' },
  { id: 'H34', section: 'Platform', module: 'Telegram channels', route: '/admin/telegram', files: ['pages/admin/AdminTelegram.jsx'], rail: 'pages/admin/AdminTelegram.jsx' },
  { id: 'H35', section: 'Support', module: null, route: '/admin/hq-support', files: ['pages/hq/HqSupportPage.jsx'], rail: 'pages/hq/HqSupportPage.jsx' },
  { id: 'H36', section: 'Security', module: null, route: '/admin/security', files: ['pages/hq/SecurityPage.jsx'], rail: 'pages/hq/SecurityPage.jsx' },
  { id: 'H37', section: 'Settings', module: null, route: '/account', files: ['pages/SettingsPage.jsx'], rail: 'pages/SettingsPage.jsx' },
];

/** The canvas board name a row's `page` carries. */
export function boardPage(board) {
  return [SUPER_ADMIN_PROFILE, board.section, board.module].filter(Boolean).join(' · ');
}

export const SUPER_ADMIN_RAIL_OPTIONS = Object.freeze([
  { page: 'Super Admin · Content · Publications', key: 'draft:publication-summary', label: 'Draft with AI', kind: 'write', handler: 'draft',
    source: { file: 'pages/admin/PublicationNew.jsx', match: 'publications.draft(' } },
]);
