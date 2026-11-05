# D4526 — 70 newly authored HQ skill drafts

These definitions are new implementations authored by Codex s36 on 2026-11-05.
Only the proposal identities and category intentions were recovered. Purposes,
procedures, tools, role mappings, proficiency levels and cases are newly authored,
not restored originals. The manifest preserves the exact proposed display names
and underscore slugs beside their new kebab-case names.

## Stages and boundaries

1. **Authoring:** 70 complete definition files and 70 synthetic cases, grouped as
   20 Design, 15 GTM, 19 Marketing and 16 Legal. Definition revision is 1; intended
   database current_version is 0, scope hq and status draft.
2. **Validation:** run the supported checkLibrary/checkDraft/checkCase validators
   through scripts/validate-hq-drafts-4526.mjs. Predicate mutation checks verify
   that missing evidence and forbidden claims fail. No paid model evaluation is
   run; schema validity does not establish model quality or publication readiness.
3. **Import:** NOT performed. This directory is outside the deployable skill
   catalogue and its generated module. Existing production drafts remain untouched.
   Before import, run duplicate-check.sql against the intended D1 database as a
   read-only aggregate query, refresh taxonomy validation against its active skills,
   and reconcile every collision without overwriting anything. D1 remains unchecked.

Use the existing validated seed pathway for a separately reviewed import, retaining
per-skill provenance in the import audit and preserving the manifest display names.
Do not bulk insert hand-built SQL or automatically add these files to the deployed
catalogue. Preserve a pre-import snapshot/count and verify only intended new drafts
were created. No publishing, agent assignment or existing-draft enrichment is authorized
in this stage. Do not use the seed's cases_added behavior on any existing draft.

## Grow Distribution

GTM and Marketing skills prepare audiences, social variants, offers, newsletters,
lifecycle specifications, launch assets and performance reports. Sources are read-only.
Posting, scheduling, sending, paid placement and audience changes must be separate
human-approved product actions with recipient/channel checks and suppression rules.
A draft never claims content was sent. No Distribution integration is shipped here.

## Validation and evaluation

Run from the repository root with Node 22:

```sh
node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs scripts/validate-hq-drafts-4526.mjs
```

Every case has a concrete synthetic scenario, expected output kind, required findings,
missing-evidence checks, a forbidden unsupported conclusion and human review criteria.
The predicate_witness checks the substring judge only; it is not a model answer.
A reviewer must also verify semantic correctness, arithmetic, grounded citations,
completeness and absence of unapproved actions. The current substring judge cannot
prove those qualities. Legal skills request current authoritative evidence and counsel
review; these files contain no purported current-law determinations.

All tags are existing specialist slugs from migration 090 at proficient level. This is
a newly authored task-complexity classification, not a certification of model ability.
Tool sources correspond to catalogue READ_KEYS. Extra frontmatter records provenance
and intended lifecycle metadata; the current seed parser does not persist those extra
keys automatically, so import must explicitly preserve them through the audit/manifest.

## Contents

| File | Purpose |
| --- | --- |
| `manifest.json` | Exact identities, newly authored assignments and intended draft lifecycle. |
| `cases/` | Synthetic cases, scoring criteria and predicate-only witnesses. |
| `duplicate-check.sql` | Read-only D1 collision counts for normalized and original slugs. |
| `validation.json` | Local validator result; production check and model runs remain pending. |
| `ux-research-interview-synthesis.md` | UX Research Interview Synthesis; newly authored design draft. |
| `usability-test-protocol-design.md` | Usability Test Protocol Design; newly authored design draft. |
| `ux-flow-architecture.md` | UX Flow Architecture; newly authored design draft. |
| `design-system-token-architecture.md` | Design System Token Architecture; newly authored design draft. |
| `component-library-specification.md` | Component Library Specification; newly authored design draft. |
| `interaction-state-specification.md` | Interaction State Specification; newly authored design draft. |
| `high-fidelity-prototype-validation.md` | High-Fidelity Prototype Validation; newly authored design draft. |
| `wcag-interface-audit.md` | WCAG Interface Audit; newly authored design draft. |
| `responsive-breakpoint-specification.md` | Responsive Breakpoint Specification; newly authored design draft. |
| `dashboard-information-hierarchy.md` | Dashboard Information Hierarchy; newly authored design draft. |
| `data-visualization-encoding-review.md` | Data Visualization Encoding Review; newly authored design draft. |
| `saas-onboarding-journey-design.md` | SaaS Onboarding Journey Design; newly authored design draft. |
| `design-implementation-qa.md` | Design Implementation QA; newly authored design draft. |
| `conversion-landing-page-wireframing.md` | Conversion Landing Page Wireframing; newly authored design draft. |
| `brand-identity-system-spec.md` | Brand Identity System Specification; newly authored design draft. |
| `logo-identity-critique.md` | Logo and Identity Critique; newly authored design draft. |
| `typography-color-system-review.md` | Typography and Color System Review; newly authored design draft. |
| `pitch-deck-visual-storytelling.md` | Pitch Deck Visual Storytelling; newly authored design draft. |
| `mobile-product-experience-review.md` | Mobile Product Experience Review; newly authored design draft. |
| `design-development-handoff.md` | Design-to-Development Handoff Specification; newly authored design draft. |
| `icp-buyer-persona-definition.md` | ICP and Buyer Persona Definition; newly authored gtm_sales draft. |
| `gtm-motion-architecture.md` | GTM Motion Architecture; newly authored gtm_sales draft. |
| `sales-playbook-generation.md` | Sales Playbook Generation; newly authored gtm_sales draft. |
| `enterprise-account-plan.md` | Enterprise Account Planning; newly authored gtm_sales draft. |
| `lead-qualification-scoring.md` | Lead Qualification and Scoring; newly authored gtm_sales draft. |
| `outbound-prospecting-design.md` | Outbound Prospecting Strategy; newly authored gtm_sales draft. |
| `sales-sequence-optimization.md` | Sales Sequence Optimization; newly authored gtm_sales draft. |
| `discovery-call-preparation.md` | Discovery Call Preparation; newly authored gtm_sales draft. |
| `sales-objection-response-design.md` | Sales Objection Response Design; newly authored gtm_sales draft. |
| `pipeline-health-diagnostics.md` | Pipeline Health Diagnostics; newly authored gtm_sales draft. |
| `crm-pipeline-hygiene-audit.md` | CRM Pipeline Hygiene Audit; newly authored gtm_sales draft. |
| `revenue-operations-design.md` | Revenue Operations Process Design; newly authored gtm_sales draft. |
| `channel-partner-strategy.md` | Channel and Partnership Strategy; newly authored gtm_sales draft. |
| `sales-forecast-scenario-review.md` | Sales Forecast Scenario Review; newly authored gtm_sales draft. |
| `customer-expansion-opportunity.md` | Customer Expansion Opportunity Analysis; newly authored gtm_sales draft. |
| `brand-positioning-messaging.md` | Brand Positioning and Messaging Architecture; newly authored marketing_brand draft. |
| `brand-voice-governance.md` | Brand Voice Governance; newly authored marketing_brand draft. |
| `content-editorial-strategy.md` | Content Strategy and Editorial Planning; newly authored marketing_brand draft. |
| `seo-search-intent-mapping.md` | SEO Search Intent Mapping; newly authored marketing_brand draft. |
| `technical-seo-crawl-audit.md` | Technical SEO Crawl Audit; newly authored marketing_brand draft. |
| `linkedin-company-growth.md` | LinkedIn Company Page Growth Strategy; newly authored marketing_brand draft. |
| `social-content-channel-adaptation.md` | Social Content Channel Adaptation; newly authored marketing_brand draft. |
| `newsletter-program-design.md` | Newsletter Program Design; newly authored marketing_brand draft. |
| `email-lifecycle-automation.md` | Email Lifecycle Automation Design; newly authored marketing_brand draft. |
| `paid-acquisition-experiment.md` | Paid Acquisition Experiment Design; newly authored marketing_brand draft. |
| `campaign-attribution-diagnostics.md` | Campaign Attribution Diagnostics; newly authored marketing_brand draft. |
| `conversion-rate-experiment-design.md` | Conversion Rate Optimization Experiment Design; newly authored marketing_brand draft. |
| `marketing-funnel-cohort-analysis.md` | Marketing Funnel and Cohort Analysis; newly authored marketing_brand draft. |
| `community-growth-program.md` | Community Growth Program Design; newly authored marketing_brand draft. |
| `influencer-partner-evaluation.md` | Influencer Partnership Evaluation; newly authored marketing_brand draft. |
| `pr-media-outreach-planning.md` | PR and Media Outreach Planning; newly authored marketing_brand draft. |
| `product-launch-campaign.md` | Product Launch Campaign Design; newly authored marketing_brand draft. |
| `marketing-competitive-intelligence.md` | Marketing Competitive Intelligence; newly authored marketing_brand draft. |
| `marketing-performance-reporting.md` | Marketing Performance Reporting; newly authored marketing_brand draft. |
| `entity-structure-governance-review.md` | Corporate Structure and Entity Governance Review; newly authored legal_compliance draft. |
| `shareholder-agreement-issue-analysis.md` | Shareholder Agreement Issue Analysis; newly authored legal_compliance draft. |
| `investment-agreement-clause-review.md` | Investment Agreement Clause Review; newly authored legal_compliance draft. |
| `safe-convertible-instrument-review.md` | SAFE and Convertible Instrument Review; newly authored legal_compliance draft. |
| `fund-formation-document-checklist.md` | Fund Formation Documentation Checklist; newly authored legal_compliance draft. |
| `gp-lp-agreement-provision-analysis.md` | GP and LP Agreement Provision Analysis; newly authored legal_compliance draft. |
| `contract-clause-extraction.md` | Contract Clause Extraction and Indexing; newly authored legal_compliance draft. |
| `contract-risk-issue-spotting.md` | Contract Risk Issue Spotting; newly authored legal_compliance draft. |
| `nda-confidentiality-review.md` | NDA Confidentiality Review; newly authored legal_compliance draft. |
| `ip-assignment-chain-of-title.md` | IP Ownership and Assignment Chain Review; newly authored legal_compliance draft. |
| `software-license-obligation-audit.md` | Software Licensing Obligation Audit; newly authored legal_compliance draft. |
| `privacy-data-protection-assessment.md` | Data Protection and Privacy Assessment; newly authored legal_compliance draft. |
| `ai-regulatory-risk-screen.md` | AI Regulatory Risk Screening; newly authored legal_compliance draft. |
| `kyc-aml-evidence-completeness.md` | KYC and AML Evidence Completeness Check; newly authored legal_compliance draft. |
| `regulatory-jurisdiction-research.md` | Regulatory Jurisdiction Research Brief; newly authored legal_compliance draft. |
| `legal-due-diligence-coordination.md` | Legal Due Diligence Coordination; newly authored legal_compliance draft. |
