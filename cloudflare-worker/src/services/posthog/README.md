# services/posthog

D1385 (#3731, #2409): a founder's own PostHog, read only, through PostHog's
hosted MCP server.

- `reads.ts` — the only file that opens a PostHog MCP session
  (`posthog_connection.test.ts` holds the tree to that). One typed read per
  tool on `MCP_PROVIDERS.posthog.read_tools`, 19 in all: organisations and
  projects, saved insights and their results, trends, funnel, retention and
  lifecycle queries of their own kind only, the web overview, experiments,
  surveys and their answers, and feature flags.

The rules for adding to this folder:

- **Read only.** Every request carries the record's
  `x-posthog-read-only: true` and `x-posthog-mcp-mode: tools`; a tool off
  the record is refused before any request. No person list, no `exec`, no
  SQL or HogQL is ever on the record or called here.
- **One project.** A venture's linked project is pinned with the
  connection's own `x-posthog-project-id` header, digits only.
- **No person leaves this folder.** Every answer goes through `scrub`:
  `distinct_id`, `session_id`, person and actor fields, emails and IP
  addresses are dropped at any depth before anything is returned.
- **Ids and queries are checked before they are sent.** A bad id is
  `bad_id`, a query of another kind or one carrying HogQL is `bad_query`,
  and nothing is requested.
- **Nothing is logged** but codes and counts.

- `metrics.ts` — D1604 (#3731 part 2): the metrics foundation. A tracked
  metric is a saved insight the founder picked and gave a role and a module;
  its `uid` names the venture's KPI `posthog-<uid>` (`growKpis.ts`).
  `landFact` writes one aggregate and its `connector_fed_items` row, and a
  fact the founder deleted stays deleted. `proposeOnce` keeps one proposal
  per kind and source, and a decided one is never proposed again. Accept runs
  the kind's acceptor (`registerAcceptor`), which parts 3–6 add. `fromPosthog`
  is a module's read. Nothing here calls PostHog or writes `project_metrics`
  or `custom_kpi_values`.

- `validate.ts` — D1605 (#3731 part 3): Validate's sync (tracked metrics,
  the web overview beside the waitlist, experiment results, survey counts),
  survey marks (`posthog_survey_marks`: what a question means is the
  founder's), and the acceptors for `experiment_evidence` (the founder's
  hypothesis and direction, through `addExperiment` and `addEvidence`) and
  `survey_signal` (through `writeDemandSignal`). It registers itself on import.

- `build.ts` — D1606 (#3731 part 4): Build's sync (tracked metrics, each
  flag's daily state), the `flag_link` acceptor (the founder's must-have) and
  the `flag_shipped` acceptor (Done after 14 days active at 100%), the roadmap
  KPI words, the linked flags' chips and Operating systems' Tools line.

- `raise.ts` — D1607 (#3731 part 5): Raise's sync (tracked metrics in its
  three modules) and `posthogFigure`, the latest figure of a metric the
  founder said measures a role, read by Traction proof's lines and the
  consistency check's `active_users`. It never moves a score.

PostHog part 6 (#3731) adds its sync and acceptor beside these files
and read PostHog through `reads.ts` alone.
