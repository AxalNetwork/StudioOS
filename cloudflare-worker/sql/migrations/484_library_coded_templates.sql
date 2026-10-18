-- 484 — every library row with no text takes its coded template (D758, #1861).
-- Source: scripts/gen-legal-templates-seed.py (gen_484) — DO NOT hand-edit.
--
-- WHAT IT FILLS. Every catalog row that has a file under
-- `src/templates/legal/`: the 42 `.md`-backed rows of all_md_bodies() and the
-- 24 seed skeletons of SEED_SKELETON_V1. Each body below is copied from the
-- repo file named above its statements; no text is written here.
--
-- THE GATE. `is_active = 1 AND length(trim(body_md)) = 0`. A row with any
-- text is never touched, so an admin's edit and every body production
-- already holds stay as they are. A soft-deleted row is never touched.
--
-- A NEW VERSION, NEVER AN IN-PLACE EDIT, as 469 and the template editor do:
--   1. the row as it stands is copied into `legal_template_versions`
--      (INSERT OR IGNORE on (template_id, version); `created_by` is the row's
--      `updated_by`, and `doc_kind` and `axal_party` are kept);
--   2. `body_md`, `merge_fields` (the body's tokens, sorted), `is_stub = 0`,
--      `version + 1` and `updated_at` change. Nothing else does: not the
--      title, category, kind, party or `updated_by`. No person made this.
--
-- RE-RUNNABLE. After a run no row matches the gate, so a second run changes
-- nothing.
--
-- PRODUCTION. D706 read production with SELECT only: 25 active rows with a
-- file held `is_stub = 1` and an empty body (D706.md). This fill is correct
-- whatever production holds: it fills those 25, and finds nothing to do on a
-- row that has text.
--
-- THE FUND'S NAME. Where a mapped file prints the old name, D705's successor
-- fills the row instead: for the 25 that is partner_capital_v2.md and
-- investor_subscription_inst_v2.md. The generator refuses to write a body
-- that prints the old name.
--
-- THE NEW STUB. The Operating Partner Agreement (Spin-Out Lab) gets a catalog
-- row as a counsel stub (no body), inserted only when its slug is absent.
--
-- Data only. Nothing here can move money, call a provider or send anything.
--
-- No BEGIN/COMMIT.

-- carried_interest <- carried_interest_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'carried_interest' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal GP serves as the general partner of Axal VC Spin-Out Lab Fund I LP (the "Fund") and is entitled to receive carried interest distributions in respect of the Fund''s investment proceeds; and

WHEREAS, Recipient serves Axal GP in the capacity of {{partner.role}} and Axal GP wishes to allocate to Recipient a portion of such carried interest as incentive compensation;

NOW, THEREFORE, in consideration of the mutual covenants set out below, the parties agree as follows.

## 1. Carried Interest Allocation

1.1 Axal GP hereby allocates to Recipient a carried interest equal to {{partner.carry_pct}} of the carried interest actually received by Axal GP from the Fund (the "Allocated Carry"), subject to the vesting and forfeiture terms below.

1.2 The Allocated Carry is calculated after return of contributed capital and any preferred return owed to the limited partners of the Fund, in accordance with the distribution waterfall set out in the Fund''s limited partnership agreement.

## 2. Vesting

2.1 The Allocated Carry vests over {{cap_table.vesting_schedule}}, measured from the Effective Date, subject to Recipient''s continued service to Axal GP.

2.2 Unvested Allocated Carry is forfeited automatically upon termination of Recipient''s service for cause or upon Recipient''s voluntary withdrawal prior to a vesting date.

## 3. Distributions

3.1 Distributions in respect of vested Allocated Carry are made at the same time, and only to the extent, that Axal GP receives the corresponding carried interest from the Fund.

3.2 Recipient bears its proportionate share of any clawback, giveback, or indemnification obligation imposed on Axal GP by the Fund''s limited partnership agreement, capped at the aggregate distributions received by Recipient hereunder.

## 4. No Partnership Interest

Nothing in this Agreement grants Recipient any limited or general partnership interest in the Fund, any management or voting rights, or any interest in the management fees of Axal GP. The Allocated Carry is a contractual right to a share of distributions only.

## 5. Transfer Restrictions

Recipient shall not assign, pledge, or otherwise transfer the Allocated Carry without the prior written consent of Axal GP, which may be withheld in its sole discretion.

## 6. Confidentiality

Recipient shall keep confidential the terms of this Agreement and all non-public information concerning the Fund and its portfolio companies.

## 7. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.vesting_schedule", "governing_law", "partner.carry_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'carried_interest' AND is_active = 1 AND length(trim(body_md)) = 0;

-- cofounder_agreement <- cofounder_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'cofounder_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, {{founder.legal_name}} and {{cofounder.legal_name}} (each a "Founder" and together the "Founders") have agreed to establish and build {{company.short_name}} for the purpose of {{company.business_purpose}}; and

WHEREAS, the Founders wish to record their respective roles, equity, vesting, and intellectual-property commitments in this Agreement;

NOW, THEREFORE, the Founders agree as follows.

## 1. Roles and Responsibilities

1.1 {{founder.legal_name}} shall serve as {{founder.title}}, with primary responsibility for overall strategy, fundraising, and external relationships.

1.2 {{cofounder.legal_name}} shall serve as {{cofounder.title}}, with primary responsibility for product and technology.

1.3 Each Founder shall devote substantially all of their professional time and attention to the Company and shall not engage in any competing venture without the written consent of the other Founder.

## 2. Equity Ownership

2.1 Subject to the Company''s governing documents, the Founders shall hold the following interests on a fully diluted basis: {{founder.legal_name}} — {{cap_table.founder_pct}} ({{cap_table.founder_shares}}); {{cofounder.legal_name}} — {{cofounder.equity_pct}} ({{cap_table.cofounder_shares}}).

2.2 The Company shall reserve {{cap_table.option_pool_pct}} of its fully diluted capitalization as an employee equity incentive pool.

2.3 All shares are issued at a par value of {{cap_table.par_value}}.

## 3. Vesting

3.1 Each Founder''s shares vest over {{cap_table.vesting_schedule}}, measured from the Effective Date.

3.2 Upon a Founder''s departure, all unvested shares are subject to repurchase by the Company at the lower of cost or fair market value.

## 4. Intellectual Property

Each Founder hereby irrevocably assigns to the Company all right, title, and interest in any intellectual property created in connection with the business of the Company, and shall execute any further documents reasonably required to perfect such assignment.

## 5. Confidentiality and Non-Solicitation

Each Founder shall keep the Company''s confidential information secret and, for twelve (12) months following departure, shall not solicit any employee, contractor, or customer of the Company.

## 6. Decision-Making and Deadlock

Material decisions require the unanimous consent of the Founders. In the event of a deadlock, the Founders shall first attempt good-faith mediation before pursuing any other remedy.

## 7. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.cofounder_shares", "cap_table.founder_pct", "cap_table.founder_shares", "cap_table.option_pool_pct", "cap_table.par_value", "cap_table.vesting_schedule", "cofounder.equity_pct", "cofounder.legal_name", "cofounder.title", "company.business_purpose", "company.short_name", "founder.legal_name", "founder.title", "governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'cofounder_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Engagement Letter (Spin-Out Package) <- engagement_letter_spin_out_package_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Engagement Letter (Spin-Out Package)' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal operates a venture studio and from time to time forms spin-out companies; and

WHEREAS, Axal wishes to engage Counsel to deliver the standard spin-out legal package described below, and Counsel is willing to provide such services on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Scope of Engagement

1.1 Counsel shall provide legal services in connection with the formation and initial financing of the spin-out company {{company.legal_name}} (the "Spin-Out"), including:

(a) formation of the Spin-Out as a {{company.entity_type}} and preparation of its charter, bylaws, and organizational consents;

(b) preparation of founder restricted stock purchase agreements, intellectual-property assignments, and the co-founder agreement;

(c) preparation of the initial option pool documentation reserving {{cap_table.option_pool_pct}} of the fully diluted capitalization; and

(d) preparation of the initial financing documents (SAFE or priced round, as instructed).

1.2 Services outside the scope above are subject to a separate written engagement or change order.

## 2. Fees

2.1 Counsel shall provide the spin-out package as a fixed-fee engagement, with fees and any disbursement caps recorded in the accompanying fee schedule.

2.2 Invoices are payable within thirty (30) days of receipt.

## 3. Conflicts and Representation

3.1 Counsel represents Axal in this engagement. Counsel does not represent the Spin-Out''s founders, {{founder.legal_name}} or {{cofounder.legal_name}}, individually, and each founder is advised to seek independent counsel.

3.2 Counsel shall maintain a conflicts-of-interest screen consistent with applicable rules of professional conduct.

## 4. Confidentiality

Counsel shall hold in confidence all non-public information of Axal and the Spin-Out and shall use it solely for the purposes of this engagement.

## 5. Term and Termination

Either party may terminate this engagement on written notice. Axal shall pay for services rendered and disbursements incurred through the effective date of termination.

## 6. Governing Law

This Engagement Letter is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.option_pool_pct", "cofounder.legal_name", "company.entity_type", "company.legal_name", "founder.legal_name", "governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Engagement Letter (Spin-Out Package)' AND is_active = 1 AND length(trim(body_md)) = 0;

-- finders_fee_intro_agreement <- finders_fee_intro_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'finders_fee_intro_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Finder is in a position to introduce Axal to prospective investors, partners, or acquisition opportunities; and

WHEREAS, Axal is willing to pay a finder''s fee for qualifying introductions on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Introductions

1.1 Finder may from time to time introduce to Axal one or more prospective counterparties (each an "Introduced Party"). Finder shall identify each Introduced Party in writing before or at the time of introduction.

1.2 An introduction qualifies for a fee only if the Introduced Party was not already known to Axal or in Axal''s pipeline at the time of introduction.

## 2. Finder''s Fee

2.1 If a transaction closes with an Introduced Party within twelve (12) months of the introduction, Axal shall pay Finder a fee equal to {{counterparty.fee_pct}} of the gross consideration received by Axal in that transaction.

2.2 Fees are payable within thirty (30) days after Axal''s receipt of the corresponding consideration.

## 3. Finder Status

3.1 Finder acts solely as an introducer. Finder shall not negotiate terms, make representations on behalf of Axal, or hold itself out as Axal''s agent.

3.2 Finder is not a registered broker-dealer and shall not perform any activity that would require such registration. Where any introduction could implicate securities-brokerage regulation, the parties shall restructure or suspend the arrangement as required by law.

## 4. Non-Circumvention

For twelve (12) months following each introduction, neither party shall circumvent the other to deal directly with an Introduced Party in a manner that deprives the other of the benefit of this Agreement.

## 5. Confidentiality

Each party shall keep confidential the identity of Introduced Parties and the terms of any resulting transaction.

## 6. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Fee obligations accrued before termination survive.

## 7. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["counterparty.fee_pct", "governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'finders_fee_intro_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- sg_first_directors_resolution <- sg_first_directors_resolution_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'sg_first_directors_resolution' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Written Resolution of the First Director(s) in Lieu of the First Meeting

The undersigned, being the first director(s) of the Company, hereby pass the following resolutions by written means pursuant to the Constitution of the Company and the Companies Act 1967 of Singapore.

## 1. Incorporation and Constitution

RESOLVED, that the incorporation of the Company on {{effective_date}} be and is hereby noted, and that the Constitution adopted on incorporation be confirmed as the constitution of the Company.

## 2. Appointment of Officers

RESOLVED, that {{founder.legal_name}} be appointed as a director of the Company, and that {{cofounder.legal_name}} be appointed as {{cofounder.title}}, in each case effective from the date of incorporation.

## 3. Registered Office

RESOLVED, that the registered office of the Company be situated at {{company.registered_address}}.

## 4. Allotment and Issue of Shares

RESOLVED, that the Company allot and issue shares as follows, credited as fully paid: {{cap_table.founder_shares}} to {{founder.legal_name}} and {{cap_table.cofounder_shares}} to {{cofounder.legal_name}}, and that the directors be authorised to enter the allottees in the register of members and issue share certificates accordingly.

## 5. Banking

RESOLVED, that the Company open a corporate bank account with a bank to be determined by the directors, and that the directors be authorised to execute the bank''s account-opening mandate on behalf of the Company.

## 6. Financial Year and Auditors

RESOLVED, that the first financial year of the Company be determined by the directors, and that the appointment of auditors (if required) be deferred to a subsequent resolution.

## 7. General Authority

RESOLVED, that the directors be and are hereby authorised to do all such acts and things as may be necessary or expedient to give effect to the foregoing resolutions.
',
       merge_fields = '["cap_table.cofounder_shares", "cap_table.founder_shares", "cofounder.legal_name", "cofounder.title", "company.registered_address", "effective_date", "founder.legal_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'sg_first_directors_resolution' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ee_founding_resolution <- ee_founding_resolution_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ee_founding_resolution' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Resolution of the Founder(s) (Asutamisotsus)

The undersigned founder(s) hereby adopt the following founding resolutions in respect of the Company, pursuant to the Estonian Commercial Code.

## 1. Establishment

RESOLVED, that the Company be established as a private limited company under the name {{company.legal_name}}, with its registered seat in the {{company.jurisdiction}} and registered address at {{company.registered_address}}.

## 2. Share Capital

RESOLVED, that the share capital of the Company and the contributions of the founder(s) be recorded as follows: {{founder.legal_name}} holding a share corresponding to {{cap_table.founder_pct}} and {{cofounder.legal_name}} holding a share corresponding to {{cofounder.equity_pct}}, each contribution to be paid in accordance with the Articles of Association.

## 3. Management Board

RESOLVED, that {{founder.legal_name}} be appointed as a member of the management board (juhatuse liige) of the Company, authorised to represent the Company, effective from registration.

## 4. Articles of Association

RESOLVED, that the Articles of Association presented to the founder(s) be adopted as the articles of the Company.

## 5. Business Activity

RESOLVED, that the principal field of activity of the Company be {{company.business_purpose}}.

## 6. Authority

RESOLVED, that the management board be authorised to take all actions necessary to complete the registration of the Company in the Estonian Commercial Register and to open the Company''s bank or payment-institution account.
',
       merge_fields = '["cap_table.founder_pct", "cofounder.equity_pct", "cofounder.legal_name", "company.business_purpose", "company.jurisdiction", "company.legal_name", "company.registered_address", "founder.legal_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ee_founding_resolution' AND is_active = 1 AND length(trim(body_md)) = 0;

-- member_consent <- member_consent_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'member_consent' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Action by Written Consent of the Initial Member(s) in Lieu of an Organizational Meeting

The undersigned, being the initial member(s) of the Company, hereby adopt the following resolutions by written consent, effective as of {{effective_date}}, in lieu of an organizational meeting.

## 1. Formation

RESOLVED, that the formation of the Company in the {{company.jurisdiction}} under file number {{company.registration_number}} be ratified and approved in all respects.

## 2. Operating Agreement

RESOLVED, that the Operating Agreement presented to the member(s) be adopted as the operating agreement of the Company, and that the member(s) and officers be authorized to execute it.

## 3. Appointment of Officers

RESOLVED, that {{founder.legal_name}} be appointed {{founder.title}} and {{cofounder.legal_name}} be appointed {{cofounder.title}} of the Company, each to serve until a successor is appointed or until resignation or removal.

## 4. Membership Interests

RESOLVED, that the Company issue membership interests in the following percentages: {{founder.legal_name}} — {{cap_table.founder_pct}}; {{cofounder.legal_name}} — {{cofounder.equity_pct}}; with the balance reserved for future issuance, and that the officers update the Company''s membership ledger accordingly.

## 5. Banking and EIN

RESOLVED, that the officers be authorized to obtain a federal Employer Identification Number for the Company and to open one or more bank accounts on its behalf, and to execute the related mandates.

## 6. General Authority

RESOLVED, that the officers be authorized to take all further actions and execute all further documents reasonably necessary to carry out the purpose and intent of these resolutions.
',
       merge_fields = '["cap_table.founder_pct", "cofounder.equity_pct", "cofounder.legal_name", "cofounder.title", "company.jurisdiction", "company.registration_number", "effective_date", "founder.legal_name", "founder.title"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'member_consent' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ic_charter <- ic_charter_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ic_charter' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## 1. Purpose

This Charter governs the Investment Committee (the "Committee") of Axal GP. The Committee is responsible for approving, declining, and overseeing investments made by Axal VC Spin-Out Lab Fund I LP (the "Fund") consistent with the Fund''s limited partnership agreement and investment mandate.

## 2. Authority

2.1 The Committee has authority to approve new investments, follow-on investments, and material dispositions, in each case within the limits set by the Fund''s governing documents.

2.2 Any investment exceeding the per-deal concentration limit set in the Fund''s limited partnership agreement requires, in addition to Committee approval, any consent specified therein.

## 3. Composition

3.1 The Committee comprises the voting members designated by Axal GP from time to time. {{partner.legal_name}}, acting through {{partner.contact_name}}, serves as a non-voting observer in the capacity of {{partner.role}} unless and until designated a voting member.

3.2 The Committee shall have no fewer than three voting members. A member may be removed and replaced by Axal GP at any time.

## 4. Meetings and Quorum

4.1 The Committee meets as often as required and not less than quarterly. Meetings may be held by video or telephone conference.

4.2 A quorum is a majority of the voting members. Approval of an investment requires the affirmative vote of a majority of the voting members present.

## 5. Conflicts of Interest

5.1 A member with a personal, financial, or fiduciary interest in a proposed investment shall disclose that interest and recuse themselves from the vote.

5.2 All conflicts and recusals shall be recorded in the minutes.

## 6. Records

The Committee shall keep written minutes of its decisions, including the rationale for each approval or decline, and shall make them available to Axal GP and, on request, to the Fund''s auditors.

## 7. Confidentiality

All Committee deliberations and materials are confidential and may be disclosed only as required by the Fund''s governing documents or applicable law.

## 8. Amendment

This Charter may be amended by Axal GP at any time, with notice to the Committee members.

## 9. Governing Law

This Charter is governed by {{governing_law}}.

---

Adopted electronically on behalf of Axal VC GP LLC on the date appearing below.
',
       merge_fields = '["governing_law", "partner.contact_name", "partner.legal_name", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ic_charter' AND is_active = 1 AND length(trim(body_md)) = 0;

-- MSA + Equity-for-Services <- msa_equity_for_services_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'MSA + Equity-for-Services' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Partner provides operating services in the capacity of {{partner.role}}; and

WHEREAS, Axal wishes to engage Partner on an equity-for-services basis, with compensation paid partially in equity of designated portfolio companies;

NOW, THEREFORE, the parties agree as follows.

## 1. Services

1.1 Partner shall provide the operating services described in one or more Statements of Work ("SOWs") referencing this Agreement. Each SOW sets out deliverables, timelines, and any cash component.

1.2 Partner shall perform the services as an independent contractor and not as an employee, agent, or joint venturer of Axal.

## 2. Equity Compensation

2.1 In consideration of the services, Axal shall procure the grant to Partner of equity equal to {{partner.equity_pct}} of the fully diluted capitalization of the designated portfolio company identified in the applicable SOW.

2.2 Equity vests over {{cap_table.vesting_schedule}}, subject to Partner''s continued provision of services, and is issued at a par value of {{cap_table.par_value}} under the relevant company''s equity plan.

2.3 Any cash fees are stated in the applicable SOW and are payable within thirty (30) days of invoice.

## 3. Intellectual Property

Unless an SOW provides otherwise, all work product created by Partner in performing the services is owned by the engaging portfolio company. Partner retains its pre-existing tools and methodologies and grants the company a non-exclusive license to use them as embedded in the deliverables.

## 4. Confidentiality

Partner shall keep confidential all non-public information of Axal and the portfolio companies and use it solely to perform the services.

## 5. Representations

Partner represents that, where it receives equity, it qualifies as an accredited investor or is otherwise eligible to receive the securities under applicable law, and acknowledges that the equity is acquired for investment and not with a view to distribution.

## 6. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Vested equity survives termination; unvested equity is forfeited.

## 7. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.par_value", "cap_table.vesting_schedule", "governing_law", "partner.equity_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'MSA + Equity-for-Services' AND is_active = 1 AND length(trim(body_md)) = 0;

-- mentor_engagement_disclaimer <- mentor_engagement_disclaimer_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'mentor_engagement_disclaimer' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## 1. Nature of the Engagement

Mentor provides guidance, feedback, and introductions to founders and portfolio companies through the Axal StudioOS platform on a voluntary, non-fiduciary basis. This document records the disclaimers governing that engagement.

## 2. No Advice Relationship

2.1 Mentor''s input is general in nature and is **not** legal, tax, accounting, investment, or other professional advice. Founders should obtain their own qualified advisers before acting on any guidance.

2.2 Nothing said or shared in a mentorship interaction constitutes an offer, solicitation, or recommendation to buy or sell any security.

## 3. No Guarantee of Outcomes

Mentor makes no representation or warranty as to the results any founder or company may achieve. Mentorship is provided "as is," and Mentor disclaims all implied warranties to the maximum extent permitted by law.

## 4. Conflicts and Independence

4.1 Mentor may have interests in, or relationships with, other companies, including potential competitors of a mentee. Mentor shall disclose any material conflict before providing guidance on a matter to which it relates.

4.2 Mentor is an independent contractor and not an employee, partner, or agent of Axal. No compensation is implied unless agreed in a separate written instrument.

## 5. Confidentiality

Mentor shall treat non-public information disclosed by founders or Axal as confidential and shall not use it for any purpose other than the mentorship, consistent with any separate non-disclosure agreement.

## 6. Limitation of Liability

To the maximum extent permitted by law, neither Mentor nor Axal is liable to any founder or company for indirect, incidental, or consequential losses arising from the mentorship.

## 7. Governing Law

This disclaimer is governed by {{governing_law}}.

---

Acknowledged electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, on the date appearing below.
',
       merge_fields = '["governing_law", "partner.contact_name", "partner.legal_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'mentor_engagement_disclaimer' AND is_active = 1 AND length(trim(body_md)) = 0;

-- mentor_nda_axal <- mentor_nda_axal_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'mentor_nda_axal' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## 1. Purpose

To enable Mentor to provide guidance, advice, and feedback to founders and Axal personnel through the Axal StudioOS platform (office hours, mentor matching, and deep-dive reviews).

## 2. Confidential Information

"Confidential Information" means any non-public business, technical, financial, or strategic information disclosed by founders, portfolio companies, or Axal to Mentor in the course of mentorship, whether disclosed orally, in writing, or by access to the platform.

## 3. Obligations

Mentor shall (a) use Confidential Information solely to provide mentorship, (b) not disclose it to any third party without prior written consent, and (c) protect it using at least the same degree of care Mentor uses for its own confidential information, and no less than reasonable care.

## 4. Exclusions

Confidential Information does not include information that is or becomes public through no fault of Mentor, was lawfully known to Mentor before disclosure, or is independently developed by Mentor without use of the Confidential Information.

## 5. No Solicitation

For twelve (12) months following the last mentorship interaction, Mentor shall not solicit any founder or portfolio company introduced through the platform for a non-mentorship engagement without Axal''s prior written consent.

## 6. Independent Contractor

Mentor is an independent contractor and not an employee, partner, or agent of Axal. No remuneration is implied unless agreed in a separate written instrument.

## 7. Term

This NDA expires twenty-four (24) months after the Effective Date. Trade-secret information remains protected for as long as it qualifies as a trade secret under applicable law.

## 8. Remedies

Mentor acknowledges that monetary damages may be inadequate for a breach and that Axal is entitled to seek injunctive relief in addition to any other remedy.

## 9. Governing Law

This NDA is governed by {{governing_law}}.
',
       merge_fields = '["governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'mentor_nda_axal' AND is_active = 1 AND length(trim(body_md)) = 0;

-- operating_agreement <- operating_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'operating_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Article I — Formation

1.1 The Company is organized as a limited liability company under the laws of the {{company.jurisdiction}}, with file number {{company.registration_number}}.

1.2 The name of the Company is {{company.legal_name}}, and it may also be referred to as {{company.short_name}}.

## Article II — Purpose

2.1 The purpose of the Company is {{company.business_purpose}}, and any other lawful business.

## Article III — Members and Interests

3.1 The initial members and their percentage membership interests are: {{founder.legal_name}} — {{cap_table.founder_pct}}; {{cofounder.legal_name}} — {{cofounder.equity_pct}}.

3.2 The Company may admit additional members and reserve up to {{cap_table.option_pool_pct}} of its interests for incentive grants, in each case as approved by the members.

## Article IV — Capital Contributions

4.1 Each member''s initial capital contribution is recorded in the Company''s books. No member is obligated to make additional contributions except as unanimously agreed in writing.

## Article V — Management

5.1 The Company is member-managed. {{founder.legal_name}} shall serve as {{founder.title}} and {{cofounder.legal_name}} as {{cofounder.title}}, with authority to conduct the ordinary business of the Company.

5.2 Major decisions — including any merger, sale of substantially all assets, admission of a member, or incurrence of material indebtedness — require the approval of members holding a majority of the membership interests.

## Article VI — Distributions

6.1 Distributions are made to the members in proportion to their membership interests, at such times as the members determine, after providing for the Company''s reasonable needs and liabilities.

## Article VII — Transfers

7.1 No member may transfer its interest without the prior written consent of the other members and compliance with applicable securities laws. The Company has a right of first refusal over any proposed transfer.

## Article VIII — Dissociation and Dissolution

8.1 Upon a member''s withdrawal, death, or dissolution, the Company may purchase that member''s interest at fair value. The Company dissolves upon the unanimous agreement of the members or as required by law.

## Article IX — Indemnification

9.1 The Company shall indemnify its members and officers to the fullest extent permitted by the law of the {{company.jurisdiction}} for actions taken in good faith on behalf of the Company.

## Article X — Governing Law

10.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.founder_pct", "cap_table.option_pool_pct", "cofounder.equity_pct", "cofounder.legal_name", "cofounder.title", "company.business_purpose", "company.jurisdiction", "company.legal_name", "company.registration_number", "company.short_name", "founder.legal_name", "founder.title", "governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'operating_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- partner_capital <- partner_capital_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'partner_capital' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Partner wishes to participate in Axal''s venture activities by committing capital alongside Axal in the capacity of {{partner.role}}; and

WHEREAS, the parties wish to record the terms of that capital commitment;

NOW, THEREFORE, the parties agree as follows.

## 1. Capital Commitment

1.1 Partner commits to contribute {{partner.capital_commitment}} (the "Commitment") to be deployed across investments selected by Axal in accordance with this Agreement.

1.2 The Commitment is drawn down by Axal through written capital calls, each payable within ten (10) business days of notice.

## 2. Deployment and Co-Investment

2.1 Axal shall deploy the Commitment alongside Axal VC Spin-Out Lab Fund I LP or its affiliated vehicles on a pro-rata basis, subject to availability and any allocation policy.

2.2 Partner''s participation in any single investment is subject to Axal''s confirmation of available allocation.

## 3. Economics

3.1 Partner is entitled to its pro-rata share of distributions from investments funded by the Commitment, net of a carried interest of {{partner.carry_pct}} payable to Axal and any management fee agreed in the accompanying fee schedule.

3.2 Distributions are made after return of called capital attributable to the relevant investment.

## 4. Reporting

Axal shall provide Partner with quarterly reporting on the status and valuation of investments funded by the Commitment.

## 5. Transfer Restrictions

Partner shall not transfer its rights under this Agreement without Axal''s prior written consent and compliance with applicable securities laws.

## 6. Representations

Partner represents that it qualifies as an accredited investor and that the Commitment is made for investment and not with a view to distribution.

## 7. Term

This Agreement continues until the final investment funded by the Commitment is realized or written off, unless terminated earlier by mutual agreement.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["governing_law", "partner.capital_commitment", "partner.carry_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'partner_capital' AND is_active = 1 AND length(trim(body_md)) = 0;

-- partner_custom <- partner_custom_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'partner_custom' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal and Partner wish to enter into a bespoke partnership arrangement that does not fit the standard equity, revenue-share, or capital templates; and

WHEREAS, the parties wish to record a framework within which the specific commercial terms are set out in an accompanying term schedule;

NOW, THEREFORE, the parties agree as follows.

## 1. Engagement

1.1 Partner is engaged by Axal in the capacity of {{partner.role}} to perform the activities described in the accompanying term schedule (the "Term Schedule"), which forms part of this Agreement.

1.2 Where the Term Schedule conflicts with this framework, the Term Schedule controls for the matters it addresses.

## 2. Custom Economics

2.1 The consideration payable to or by Partner is as set out in the Term Schedule and may include any combination of: an equity grant of {{partner.equity_pct}}, a revenue share of {{partner.revenue_share_pct}}, a carried interest of {{partner.carry_pct}}, or a capital commitment of {{partner.capital_commitment}}.

2.2 Any equity component vests over {{cap_table.vesting_schedule}} unless the Term Schedule provides otherwise.

## 3. Independent Contractor

Partner acts as an independent contractor. Nothing in this Agreement creates a partnership, joint venture, or employment relationship between the parties for any purpose other than as expressly stated.

## 4. Intellectual Property

Unless the Term Schedule provides otherwise, work product created by Partner for Axal is owned by Axal, and Partner retains its pre-existing tools and methodologies.

## 5. Confidentiality

Each party shall keep the other''s non-public information confidential and use it solely to perform this Agreement.

## 6. Term and Termination

This Agreement continues until the completion of the activities in the Term Schedule, unless terminated earlier by either party on thirty (30) days'' written notice. Accrued rights survive termination.

## 7. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.vesting_schedule", "governing_law", "partner.capital_commitment", "partner.carry_pct", "partner.equity_pct", "partner.revenue_share_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'partner_custom' AND is_active = 1 AND length(trim(body_md)) = 0;

-- partner_equity <- partner_equity_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'partner_equity' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Partner shall provide services to Axal and/or its portfolio companies in the capacity of {{partner.role}}; and

WHEREAS, Axal wishes to compensate Partner primarily through an equity grant on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Services

1.1 Partner shall provide the services described in one or more Statements of Work referencing this Agreement, performed as an independent contractor.

## 2. Equity Grant

2.1 In consideration of the services, Axal shall procure the grant to Partner of equity equal to {{partner.equity_pct}} of the fully diluted capitalization of the designated entity, issued at a par value of {{cap_table.par_value}}.

2.2 The equity vests over {{cap_table.vesting_schedule}}, subject to Partner''s continued provision of services. Unvested equity is forfeited on termination; vested equity survives.

2.3 The equity is subject to the designated entity''s equity plan, stockholders'' agreement, and any transfer restrictions and rights of first refusal therein.

## 3. No Cash Compensation

Except as expressly stated in a Statement of Work, Partner''s sole compensation under this Agreement is the equity grant, and Partner shall bear its own costs of performance.

## 4. Securities Representations

Partner represents that it qualifies as an accredited investor or is otherwise eligible to receive the equity under applicable law, and that it acquires the equity for investment and not with a view to distribution.

## 5. Intellectual Property

All work product created by Partner in performing the services is owned by the engaging entity. Partner retains its pre-existing tools and methodologies.

## 6. Confidentiality

Partner shall keep Axal''s non-public information confidential and use it solely to perform the services.

## 7. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Sections 2 (as to vested equity), 4, 5, and 6 survive termination.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.par_value", "cap_table.vesting_schedule", "governing_law", "partner.equity_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'partner_equity' AND is_active = 1 AND length(trim(body_md)) = 0;

-- partner_nda_nonsolicit <- partner_nda_nonsolicit_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'partner_nda_nonsolicit' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## 1. Purpose

To protect non-public information exchanged between Axal and Partner in connection with Partner''s engagement in the capacity of {{partner.role}}, and to record the parties'' non-solicitation commitments.

## 2. Confidential Information

"Confidential Information" means any non-public business, technical, financial, or strategic information disclosed by one party to the other, including information concerning Axal''s portfolio companies, deal pipeline, and platform.

## 3. Obligations

The receiving party shall (a) use Confidential Information solely for the engagement, (b) not disclose it to any third party without prior written consent except to advisers bound by equivalent obligations, and (c) protect it with at least reasonable care.

## 4. Exclusions

Confidential Information excludes information that is or becomes public through no fault of the receiving party, was lawfully known before disclosure, or is independently developed without use of the Confidential Information.

## 5. Non-Solicitation

5.1 For twelve (12) months following the end of the engagement, Partner shall not directly or indirectly solicit for employment or engagement any employee, contractor, founder, or portfolio-company personnel introduced through Axal.

5.2 For the same period, Partner shall not solicit any client, investor, or counterparty introduced by Axal for a purpose that competes with Axal''s business, without Axal''s prior written consent.

## 6. Non-Circumvention

Partner shall not use Confidential Information to circumvent Axal in any transaction originated or facilitated by Axal.

## 7. Term and Remedies

7.1 The confidentiality obligations survive for twenty-four (24) months after disclosure; trade secrets remain protected for as long as they qualify under applicable law.

7.2 The parties acknowledge that monetary damages may be inadequate for a breach and that the non-breaching party may seek injunctive relief.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["governing_law", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'partner_nda_nonsolicit' AND is_active = 1 AND length(trim(body_md)) = 0;

-- partner_revshare <- partner_revshare_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'partner_revshare' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Partner shall provide services or distribution in the capacity of {{partner.role}}; and

WHEREAS, Axal wishes to compensate Partner through a share of attributable revenue on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Services

1.1 Partner shall perform the activities described in the accompanying scope schedule, as an independent contractor.

## 2. Revenue Share

2.1 Axal shall pay Partner a revenue share equal to {{partner.revenue_share_pct}} of the Net Revenue actually received by Axal that is directly attributable to Partner''s activities (the "Attributable Revenue").

2.2 "Net Revenue" means gross amounts received by Axal from the relevant customer, less refunds, chargebacks, taxes, and third-party payment-processing fees.

2.3 Revenue-share payments are made within thirty (30) days after the end of each calendar quarter, accompanied by a statement showing the calculation.

## 3. Attribution and Records

3.1 Revenue is attributable to Partner only where Partner is the originating or servicing party under the scope schedule.

3.2 Axal shall keep records sufficient to verify the calculation and shall make summary records available to Partner on reasonable request.

## 4. No Equity or Capital

This Agreement grants Partner no equity, ownership, or capital interest in Axal or any portfolio company. Partner''s sole compensation is the revenue share.

## 5. Confidentiality

Each party shall keep the other''s non-public information confidential and use it solely to perform this Agreement.

## 6. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Revenue-share obligations accrued before termination, and for revenue received within ninety (90) days after termination from customers originated by Partner, survive.

## 7. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["governing_law", "partner.revenue_share_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'partner_revshare' AND is_active = 1 AND length(trim(body_md)) = 0;

-- partner_services <- partner_services_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'partner_services' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## 1. Scope

1.1 This Master Services Agreement governs the supply of services by Partner to Axal and/or the portfolio companies of Axal VC Spin-Out Lab Fund I LP. Specific engagements are documented in Statements of Work ("SOWs") that reference this Agreement.

1.2 Each SOW sets out the deliverables, timeline, service levels, and fees for that engagement. Where an SOW conflicts with this Agreement, the SOW controls for the matters it addresses.

## 2. Fees and Equity

2.1 Compensation per engagement is set in the applicable SOW. Cash fees are payable within thirty (30) days of invoice.

2.2 Where an SOW provides for equity compensation, the grant — typically {{partner.equity_pct}} of the relevant entity''s fully diluted capitalization — vests over {{cap_table.vesting_schedule}} and is governed by that entity''s equity plan documents.

## 3. Intellectual Property

3.1 Unless an SOW provides otherwise, work product created by Partner during an engagement is owned by the engaging entity (Axal or the relevant portfolio company).

3.2 Platform-level work product (contributions to the Axal StudioOS codebase, brand assets, or core platform IP) vests in Axal VC Holdings LLC and is licensed back to Axal for operation of the platform. Partner retains its pre-existing tools and methodologies.

## 4. Confidentiality

Partner shall keep Axal''s and the portfolio companies'' non-public information confidential and use it solely to perform the services, consistent with any separate non-disclosure agreement.

## 5. Independent Contractor

Partner is an independent contractor and not an employee, partner, or agent of Axal. Partner is responsible for its own taxes and for any personnel it uses.

## 6. Insurance and Compliance

Partner shall maintain commercially reasonable professional-liability insurance for each engagement and comply with all applicable laws, including export controls and anti-bribery rules.

## 7. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Active SOWs survive termination of this Agreement according to their own terms.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.vesting_schedule", "governing_law", "partner.equity_pct"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'partner_services' AND is_active = 1 AND length(trim(body_md)) = 0;

-- service_agreement <- service_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'service_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal wishes to retain Service Provider to provide certain professional services; and

WHEREAS, Service Provider is willing to provide those services on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Services

1.1 Service Provider shall provide the services described in the accompanying scope schedule (the "Services"), exercising reasonable skill and care consistent with applicable professional standards.

1.2 Service Provider shall provide the personnel, equipment, and materials necessary to perform the Services unless the scope schedule provides otherwise.

## 2. Fees and Expenses

2.1 Axal shall pay the fees set out in the scope schedule. Unless stated otherwise, fees are exclusive of applicable taxes and pre-approved out-of-pocket expenses.

2.2 Invoices are payable within thirty (30) days of receipt. Axal may withhold payment of any amount disputed in good faith pending resolution.

## 3. Independent Contractor

Service Provider is an independent contractor and not an employee, partner, or agent of Axal. Service Provider is responsible for its own taxes and benefits.

## 4. Intellectual Property

All deliverables created specifically for Axal under this Agreement are owned by Axal upon payment. Service Provider retains its pre-existing tools and methodologies and grants Axal a non-exclusive license to use them as embedded in the deliverables.

## 5. Confidentiality

Each party shall keep the other''s non-public information confidential and use it solely to perform this Agreement.

## 6. Warranties and Liability

6.1 Service Provider warrants that the Services will be performed in a professional and workmanlike manner and that the deliverables will not knowingly infringe the intellectual-property rights of any third party.

6.2 Except for breaches of confidentiality or indemnification obligations, neither party is liable for indirect or consequential losses, and each party''s aggregate liability is limited to the fees paid under this Agreement in the twelve (12) months preceding the claim.

## 7. Term and Termination

This Agreement continues until the Services are completed, unless terminated earlier by either party on thirty (30) days'' written notice. Axal shall pay for Services performed through the date of termination.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'service_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Venture Share Agreement (FAST) <- venture_share_agreement_fast_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Venture Share Agreement (FAST)' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, the Company wishes to receive strategic advice from Advisor; and

WHEREAS, the Company wishes to compensate Advisor with equity on a standard, lightweight basis;

NOW, THEREFORE, the parties agree as follows.

## 1. Advisory Services

1.1 Advisor shall provide mentoring, strategic guidance, and introductions consistent with the agreed engagement level, exercising reasonable skill and care.

1.2 Advisor performs as an independent contractor and not as an employee, officer, or agent of the Company.

## 2. Equity Compensation

2.1 In consideration of the advisory services, the Company shall grant Advisor equity equal to {{partner.equity_pct}} of its fully diluted capitalization, issued at a par value of {{cap_table.par_value}} under the Company''s equity plan.

2.2 The equity vests monthly over {{cap_table.vesting_schedule}}, subject to Advisor''s continued service, with no cliff unless otherwise stated.

2.3 On a change of control, vesting of the then-unvested equity accelerates in full.

## 3. Expenses

The Company shall reimburse Advisor''s reasonable pre-approved expenses incurred in performing the services.

## 4. Confidentiality

Advisor shall keep the Company''s non-public information confidential and use it solely to perform the advisory services.

## 5. No Conflict

Advisor represents that the advisory services do not conflict with any other obligation and shall disclose any material conflict that arises.

## 6. Securities Representations

Advisor represents that it qualifies to receive the equity under applicable law and acquires it for investment and not with a view to distribution.

## 7. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Vested equity survives; unvested equity is forfeited on termination.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.par_value", "cap_table.vesting_schedule", "governing_law", "partner.equity_pct"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Venture Share Agreement (FAST)' AND is_active = 1 AND length(trim(body_md)) = 0;

-- White-Label Service Agreement <- white_label_service_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'White-Label Service Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Partner provides technical services and is willing to provide them on a white-label basis; and

WHEREAS, Axal wishes to offer those services to its portfolio companies under the Axal brand in the capacity of {{partner.role}};

NOW, THEREFORE, the parties agree as follows.

## 1. White-Label Services

1.1 Partner shall provide the technical services described in one or more work orders referencing this Agreement (the "Services"), delivered under the Axal brand to Axal''s portfolio companies as end customers.

1.2 Partner shall not market to, contract directly with, or disclose its role to the end customers without Axal''s prior written consent.

## 2. Branding and Non-Circumvention

2.1 Partner shall present all deliverables under the Axal brand and follow Axal''s brand guidelines. Partner acquires no rights in the Axal brand beyond this limited use.

2.2 For twelve (12) months after the end of an engagement, Partner shall not solicit or contract directly with any end customer introduced through this Agreement.

## 3. Service Levels and Fees

3.1 Each work order sets out the deliverables, service levels, and fees. Cash fees are payable within thirty (30) days of invoice.

3.2 Where a work order provides for revenue sharing, Partner is entitled to {{partner.revenue_share_pct}} of the Net Revenue attributable to its Services.

## 4. Intellectual Property

4.1 Deliverables created for Axal under this Agreement are owned by Axal upon payment. Partner retains its pre-existing tools, platforms, and methodologies and grants Axal a license to use them as embedded in the deliverables for the benefit of the end customers.

## 5. Confidentiality

Each party shall keep the other''s non-public information confidential and use it solely to perform this Agreement.

## 6. Warranties and Liability

6.1 Partner warrants that the Services will be performed in a professional and workmanlike manner and will not knowingly infringe any third-party rights.

6.2 Except for confidentiality or indemnification breaches, neither party is liable for indirect or consequential losses, and each party''s aggregate liability is limited to the fees paid in the twelve (12) months preceding the claim.

## 7. Term and Termination

This Agreement continues until terminated by either party on thirty (30) days'' written notice. Active work orders survive according to their terms.

## 8. Governing Law

This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["governing_law", "partner.revenue_share_pct", "partner.role"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'White-Label Service Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Subscription Booklet & LPA <- subscription_booklet_lpa_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Subscription Booklet & LPA' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Article I — Subscription and Commitment

1.1 The undersigned ("Limited Partner") irrevocably subscribes for a limited partnership interest in {{fund.name}} (the "Fund"), a Delaware limited partnership managed by its general partner {{fund.gp_name}} (the "General Partner"), and commits capital in the aggregate amount of {{commitment_amount}} (the "Capital Commitment").

1.2 This subscription is made on the terms of the Fund''s limited partnership agreement (the "LPA"), which the Limited Partner adopts and agrees to be bound by upon acceptance of this subscription by the General Partner. Acceptance is effective as of {{effective_date}}.

## Article II — Drawdowns and Capital Calls

2.1 The Capital Commitment is payable in one or more installments as called by the General Partner upon not less than ten (10) business days'' written notice (each, a "Capital Call"), to fund investments, fees, and Fund expenses.

2.2 A Limited Partner that fails to fund a Capital Call when due is a "Defaulting Partner" and may be subject to remedies including interest on the unpaid amount, forfeiture of up to {{default_forfeiture_pct}} of its interest, and forced sale of its interest, as set out in the LPA.

## Article III — Management Fee

3.1 The Fund shall pay the General Partner an annual management fee equal to two percent (2%) of aggregate Capital Commitments during the investment period, and thereafter 2% of net invested capital, payable quarterly in advance.

## Article IV — Carried Interest

4.1 After return of contributed capital to the Limited Partners, the General Partner is entitled to a carried interest equal to twenty percent (20%) of net profits, subject to the distribution waterfall in Article V.

## Article V — Distribution Waterfall

5.1 Distributions of investment proceeds are made in the following order: (a) first, to each Limited Partner until it has received a return of its contributed capital; (b) second, to each Limited Partner until it has received a preferred return of {{preferred_return_pct}} per annum on contributed capital; (c) third, to the General Partner as a catch-up; and (d) thereafter, eighty percent (80%) to the Limited Partners and twenty percent (20%) to the General Partner as carried interest.

5.2 The General Partner may withhold from distributions amounts reasonably required for Fund reserves, liabilities, and taxes.

## Article VI — Transfer Restrictions

6.1 A Limited Partner may not transfer, pledge, or encumber its interest without the prior written consent of the General Partner, which may be withheld in its sole discretion, and without compliance with applicable securities laws.

6.2 Any purported transfer in violation of this Article is void. The General Partner may condition any consent on receipt of an opinion of counsel and the transferee''s execution of a joinder to the LPA.

## Article VII — Accredited Investor Representations

7.1 The Limited Partner represents that it is an "accredited investor" as defined in Rule 501(a) of Regulation D under the Securities Act of 1933, and that it is acquiring its interest for its own account for investment and not with a view to distribution.

7.2 The Limited Partner represents that it has such knowledge and experience in financial and business matters that it is capable of evaluating the merits and risks of this investment, can bear the economic risk of a complete loss, and has had the opportunity to ask questions of the General Partner.

## Article VIII — Governing Law

8.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["commitment_amount", "default_forfeiture_pct", "effective_date", "fund.gp_name", "fund.name", "governing_law", "preferred_return_pct"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Subscription Booklet & LPA' AND is_active = 1 AND length(trim(body_md)) = 0;

-- SPV Joinder Agreement <- spv_joinder_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'SPV Joinder Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Article I — Adoption of the Operating Agreement

1.1 The undersigned ("Member") joins {{spv.name}} (the "SPV"), a Delaware limited liability company formed by {{fund.gp_name}} (the "Manager") for the purpose of making a single investment in {{portfolio_company}} (the "Investment").

1.2 By executing this Joinder, the Member adopts, accedes to, and agrees to be bound by the SPV''s operating agreement (the "Operating Agreement") as a member, with effect from {{effective_date}}, with the same force as if the Member were an original party to it.

## Article II — Capital Commitment and Call

2.1 The Member commits capital to the SPV in the amount of {{commitment_amount}} (the "Commitment"), representing the Member''s pro-rata participation in the Investment.

2.2 The Manager shall call the Commitment, in whole or in part, upon not less than five (5) business days'' written notice. The Member''s failure to fund when due entitles the Manager to the default remedies set out in the Operating Agreement.

## Article III — Membership Interest

3.1 Upon funding, the Member is admitted to the SPV and holds a membership interest proportionate to its funded capital relative to total funded capital of all members.

## Article IV — Management

4.1 The SPV is manager-managed. The Manager has sole authority to make, hold, and dispose of the Investment and to conduct the business of the SPV. The Member has no right to participate in the day-to-day management of the SPV.

## Article V — Distributions

5.1 Proceeds from the Investment are distributed to the members pro rata in proportion to their funded capital, after payment of SPV expenses and reserves and subject to the carried interest in Article VI.

## Article VI — Carried Interest

6.1 After return of each member''s funded capital, the Manager is entitled to a carried interest equal to {{carry_pct}} (default twenty percent (20%)) of net profits of the SPV, payable from distributions otherwise allocable to the members.

## Article VII — Transfer Restrictions

7.1 The Member may not transfer or encumber its interest in the SPV without the prior written consent of the Manager and compliance with applicable securities laws. Any purported transfer in violation of this Article is void.

## Article VIII — Investor Representations

8.1 The Member represents that it is an "accredited investor" within the meaning of Rule 501(a) of Regulation D, is acquiring its interest for investment and not with a view to distribution, and can bear the economic risk of a complete loss of its Commitment.

## Article IX — Governing Law

9.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["carry_pct", "commitment_amount", "effective_date", "fund.gp_name", "governing_law", "portfolio_company", "spv.name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'SPV Joinder Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Co-Investment Side Letter <- co_investment_side_letter_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Co-Investment Side Letter' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Article I — Relationship to the LPA

1.1 This Side Letter supplements and, to the extent of any conflict, modifies the limited partnership agreement (the "LPA") of {{fund.name}} as between {{fund.gp_name}} (the "General Partner") and {{investor_name}} (the "Investor"), with effect from {{effective_date}}.

1.2 Except as expressly modified by this Side Letter, the LPA remains in full force and effect, and capitalized terms used but not defined here have the meanings given in the LPA.

## Article II — Co-Investment Rights

2.1 The General Partner shall offer the Investor the opportunity to co-invest alongside the Fund in portfolio investments, on a basis no less favorable than offered to other co-investors, up to an aggregate of {{coinvest_allocation}} per investment, subject to availability and the General Partner''s allocation policy.

2.2 Co-investments are offered without management fee or carried interest unless otherwise agreed in writing for a particular opportunity.

## Article III — Fee Offset

3.1 The Investor''s share of the management fee otherwise payable under the LPA shall be reduced by {{fee_offset_pct}} of any transaction, monitoring, director, or break-up fees received by the General Partner or its affiliates that are attributable to the Investor''s interest.

## Article IV — Information Rights

4.1 The General Partner shall provide the Investor with quarterly unaudited and annual audited financial statements of the Fund, portfolio valuations, and such additional information regarding the Fund and its investments as the Investor may reasonably request, subject to confidentiality.

4.2 The Investor may, on reasonable notice, consult with the General Partner regarding the Fund''s performance and strategy.

## Article V — Most Favored Nation

5.1 If the General Partner grants any other limited partner with a capital commitment equal to or less than the Investor''s commitment more favorable economic or governance terms by side letter, the General Partner shall promptly disclose those terms and offer the Investor the right to elect the benefit of them.

5.2 The MFN right does not extend to terms granted to a limited partner on the basis of legal, regulatory, or tax status not shared by the Investor.

## Article VI — Confidentiality

6.1 The Investor shall keep the terms of this Side Letter and all non-public Fund information confidential, except as required by law or to its professional advisers bound by confidentiality.

## Article VII — Governing Law

7.1 This Side Letter is governed by {{governing_law}}.
',
       merge_fields = '["coinvest_allocation", "effective_date", "fee_offset_pct", "fund.gp_name", "fund.name", "governing_law", "investor_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Co-Investment Side Letter' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Strategic Side Letter / Focused SPV <- strategic_side_letter_focused_spv_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Strategic Side Letter / Focused SPV' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Article I — Purpose and Strategic Relationship

1.1 This Strategic Side Letter establishes the terms on which {{investor_name}} (the "Strategic LP") participates in a dedicated, sector-focused special-purpose vehicle established and managed by {{fund.gp_name}} (the "Manager"), with effect from {{effective_date}}.

1.2 The Manager shall form a dedicated vehicle, {{spv.name}} (the "Focused SPV"), through which the Strategic LP''s capital is deployed in accordance with the sector mandate in Article II.

## Article II — Sector Mandate

2.1 The Focused SPV shall invest solely in opportunities within the {{sector_mandate}} sector (the "Mandate"). Investments outside the Mandate require the prior written consent of the Strategic LP.

2.2 The Manager shall use commercially reasonable efforts to source, evaluate, and present Mandate opportunities to the Focused SPV consistent with the Strategic LP''s stated objectives.

## Article III — Capital Commitment

3.1 The Strategic LP commits capital to the Focused SPV in the amount of {{commitment_amount}}, callable by the Manager upon not less than ten (10) business days'' written notice for Mandate investments and Focused SPV expenses.

## Article IV — Negotiated Economics

4.1 In consideration of the Strategic LP''s anchor commitment, the management fee for the Focused SPV is {{strategic_mgmt_fee_pct}} per annum (reduced from the standard 2%), and the carried interest is {{strategic_carry_pct}} of net profits (reduced from the standard 20%), each payable as set out in the Focused SPV''s operating agreement.

4.2 No placement, transaction, or similar fee is payable by the Strategic LP except as expressly agreed in writing.

## Article V — Reporting Cadence

5.1 The Manager shall provide the Strategic LP with monthly portfolio updates, quarterly financial statements and valuations, and an annual audited report for the Focused SPV.

5.2 The Manager shall make personnel reasonably available for a quarterly strategic review with the Strategic LP regarding pipeline, performance, and Mandate developments.

## Article VI — Advisory Participation

6.1 The Strategic LP may designate one representative to a non-voting advisory role for the Focused SPV, to consult on Mandate strategy and review potential conflicts, without thereby assuming management authority or liability for the Focused SPV.

## Article VII — Transfer and Confidentiality

7.1 The Strategic LP may not transfer its interest in the Focused SPV without the Manager''s prior written consent and compliance with applicable securities laws.

7.2 Each party shall keep the terms of this Side Letter and all non-public information regarding the Focused SPV confidential, except as required by law or disclosed to advisers bound by confidentiality.

## Article VIII — Governing Law

8.1 This Side Letter is governed by {{governing_law}}.
',
       merge_fields = '["commitment_amount", "effective_date", "fund.gp_name", "governing_law", "investor_name", "sector_mandate", "spv.name", "strategic_carry_pct", "strategic_mgmt_fee_pct"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Strategic Side Letter / Focused SPV' AND is_active = 1 AND length(trim(body_md)) = 0;

-- investor_subscription_pro <- investor_subscription_pro_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'investor_subscription_pro' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Article I — Subscription

1.1 The undersigned individual investor ("Investor") subscribes for an interest in {{fund.name}} (the "Fund"), managed by its general partner {{fund.gp_name}} (the "General Partner"), under the Fund''s Pro tier, with effect from {{effective_date}} upon acceptance by the General Partner.

1.2 The Investor agrees to be bound by the Fund''s limited partnership agreement (the "LPA") upon acceptance of this subscription.

## Article II — Commitment Range

2.1 The Investor commits capital in the amount of {{commitment_amount}}, which must be within the Pro tier range of {{pro_min_commitment}} to {{pro_max_commitment}}.

2.2 The Commitment is payable in full upon acceptance, or in installments upon written notice from the General Partner if the General Partner so elects.

## Article III — Eligibility

3.1 Participation in the Pro tier is limited to individual accredited investors and is subject to the General Partner''s verification of eligibility and completion of applicable anti-money-laundering and know-your-customer checks.

3.2 The General Partner may decline or limit any subscription in its sole discretion, including to comply with investor-count or regulatory limits.

## Article IV — Investor Representations

4.1 The Investor represents that it is an "accredited investor" as defined in Rule 501(a) of Regulation D under the Securities Act of 1933 and qualifies under at least one applicable income or net-worth threshold.

4.2 The Investor represents that it is acquiring its interest for its own account for investment and not with a view to resale or distribution, and that all information provided to the General Partner is true and complete.

## Article V — Acknowledgment of Risk

5.1 The Investor acknowledges that an investment in the Fund is speculative, illiquid, and involves a high degree of risk, including the risk of loss of the entire Commitment, and that there is no public market for the interests and none is expected to develop.

5.2 The Investor acknowledges that distributions and returns are not guaranteed, that past performance is not indicative of future results, and that the Investor has not relied on any representation by the General Partner other than those in the LPA and the Fund''s offering materials.

## Article VI — Transfer Restrictions

6.1 The Investor may not transfer or encumber its interest without the prior written consent of the General Partner and compliance with applicable securities laws. Any purported transfer in violation of this Article is void.

## Article VII — Governing Law

7.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["commitment_amount", "effective_date", "fund.gp_name", "fund.name", "governing_law", "pro_max_commitment", "pro_min_commitment"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'investor_subscription_pro' AND is_active = 1 AND length(trim(body_md)) = 0;

-- investor_subscription_inst <- investor_subscription_inst_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'investor_subscription_inst' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Section 1 — Subscription

1.1 The undersigned ("Investor") irrevocably subscribes for a limited partnership interest in Axal VC Spin-Out Lab Fund I LP (the "Fund") and commits capital in the amount of {{commitment_amount}} (the "Capital Commitment"), payable in response to capital calls issued by Axal VC GP LLC (the "General Partner").

1.2 This subscription is subject to acceptance by the General Partner, which may accept or reject it in whole or in part in its discretion.

## Section 2 — Institutional Eligibility

2.1 The Investor represents that it qualifies as an institutional "accredited investor" under Rule 501(a) of Regulation D and as a "qualified purchaser" under Section 2(a)(51) of the Investment Company Act of 1940, in each case as amended.

2.2 The Investor was not formed or recapitalized for the specific purpose of acquiring an interest in the Fund, and its subscription does not cause the Fund to exceed any applicable holder limit.

## Section 3 — Institutional Representations

3.1 The Investor represents that it has full power and authority to enter into this subscription, that doing so has been duly authorized, and that this subscription does not conflict with its organizational documents or any agreement binding on it.

3.2 The Investor has such knowledge and experience in financial and business matters that it is capable of evaluating the merits and risks of the investment and can bear the complete loss of its Capital Commitment.

## Section 4 — Investment Intent

4.1 The Investor is acquiring its interest for its own account for investment and not with a view to distribution, and understands that the interest is not registered under the Securities Act of 1933 and is subject to transfer restrictions in the Fund''s governing documents.

## Section 5 — ERISA and Plan Assets

5.1 The Investor shall notify the General Partner whether it is, or is acting on behalf of, a "benefit plan investor" within the meaning of Section 3(42) of ERISA. The Investor acknowledges that the General Partner may limit or condition its participation to avoid the Fund''s assets being treated as "plan assets" under ERISA.

## Section 6 — Side Letter and Most Favored Nation

6.1 The General Partner may enter into side letters with the Investor and with other limited partners. Subject to the terms and any minimum-commitment thresholds disclosed by the General Partner, the Investor shall be offered most favored nation election rights with respect to side-letter terms granted to limited partners of comparable or lesser commitment.

## Section 7 — Acknowledgments

7.1 The Investor acknowledges that it has received and reviewed the Fund''s limited partnership agreement and offering materials, that an investment in the Fund involves substantial risk and illiquidity, and that no governmental authority has approved the interest or passed on the adequacy of the disclosure.

## Section 8 — Governing Law

8.1 This subscription is governed by {{governing_law}}.
',
       merge_fields = '["commitment_amount", "governing_law"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'investor_subscription_inst' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Founder Collaboration Agreement <- founder_collaboration_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Founder Collaboration Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal VC Management LLC ("Axal") and {{founder.legal_name}} ("Founder") wish to collaborate to form and operate a new venture (the "Venture"); and

WHEREAS, Founder will contribute intellectual property, time, and expertise, and Axal will contribute capital, operational support, and resources on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Scope of Collaboration

1.1 The parties shall collaborate in good faith to develop, capitalize, and operate the Venture, which shall pursue {{company.business_purpose}}.

1.2 The Venture is expected to be organized as {{company.legal_name}} on or about {{effective_date}}, at which time the equity, governance, and assignment terms of this Agreement shall be reflected in the Venture''s constitutional documents.

## 2. Founder Contributions and Time Commitment

2.1 Founder shall devote {{founder.time_commitment}} of Founder''s professional working time to the Venture and shall not, during the collaboration, engage in any competing business without Axal''s prior written consent.

2.2 Founder shall contribute to the Venture the pre-existing intellectual property, know-how, and materials identified in the accompanying contribution schedule (the "Contributed IP").

## 3. Intellectual Property

3.1 Effective upon formation of the Venture, Founder hereby assigns the Contributed IP, and all intellectual property created in connection with the Venture, to the Venture.

3.2 Until such assignment is effective, Founder grants Axal and the Venture a non-exclusive, royalty-free license to use the Contributed IP for the purposes of the collaboration. Matters concerning the Axal brand are reserved to Axal VC Holdings LLC.

## 4. Equity and Vesting

4.1 Founder shall receive {{equity_pct}} of the fully diluted equity of the Venture, and Axal (or its affiliate) shall receive {{cap_table.founder_pct}}, with the balance reserved as set out in the cap table schedule.

4.2 Founder''s equity vests over {{vesting.years}} years with a {{vesting.cliff}} cliff, subject to Founder''s continued engagement. Unvested equity is subject to repurchase at cost upon cessation of engagement.

## 5. Decision-Making

5.1 Day-to-day operations are managed by Founder as {{founder.title}}. Major decisions — including any financing, sale, change of business, or budget exceeding {{governance.spend_threshold}} — require the mutual approval of Founder and Axal.

## 6. Confidentiality

6.1 Each party shall keep the other''s non-public information confidential and use it solely to advance the Venture, both during and after the term of this Agreement.

## 7. Term and Termination

7.1 This Agreement continues until superseded by the Venture''s constitutional documents or terminated by either party on {{notice_period}} written notice. Vesting, intellectual-property, and confidentiality provisions survive termination.

## 8. Governing Law

8.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.founder_pct", "company.business_purpose", "company.legal_name", "effective_date", "equity_pct", "founder.legal_name", "founder.time_commitment", "founder.title", "governance.spend_threshold", "governing_law", "notice_period", "vesting.cliff", "vesting.years"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Founder Collaboration Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Spin-Out Subsidiary SPA + IP Transfer <- spin_out_subsidiary_spa_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Spin-Out Subsidiary SPA + IP Transfer' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal VC Management LLC ("Axal") and {{founder.legal_name}} ("Founder") wish to form a subsidiary to commercialize certain technology; and

WHEREAS, the parties wish to provide for the transfer of relevant intellectual property to the subsidiary and the issuance of founder shares on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Formation of the Subsidiary

1.1 The parties shall cause {{company.legal_name}} (the "Subsidiary") to be organized under the laws of {{company.jurisdiction}} on or about {{effective_date}} to pursue {{company.business_purpose}}.

## 2. IP Transfer and License

2.1 At closing, the contributing party shall assign to the Subsidiary the intellectual property identified in the accompanying IP schedule (the "Transferred IP"), free of liens, by executed assignment.

2.2 Any intellectual property required by the Subsidiary but retained by Axal VC Holdings LLC, including Axal brand assets, is licensed to the Subsidiary on a non-exclusive, royalty-free basis for use in the Subsidiary''s business.

## 3. Purchase and Issuance of Shares

3.1 At closing, the Subsidiary shall issue {{founder.shares}} shares of common stock to Founder at a purchase price of {{share.price}} per share, and {{cap_table.founder_pct}} of its fully diluted equity to Axal (or its affiliate) in consideration of the contributions described herein.

3.2 The shares issued to Founder are subject to the vesting and repurchase terms in Section 4.

## 4. Vesting

4.1 Founder''s shares vest over {{vesting.years}} years with a {{vesting.cliff}} cliff, subject to Founder''s continued service. Unvested shares are subject to repurchase by the Subsidiary at the lower of cost or fair value upon cessation of service.

## 5. Representations and Warranties

5.1 Each party represents that it has the authority to enter into this Agreement and that its execution does not breach any other agreement.

5.2 The party transferring the Transferred IP represents that it owns the Transferred IP, that it has the right to assign it, and that, to its knowledge, the Transferred IP does not infringe the rights of any third party.

## 6. Securities Compliance

6.1 The shares are issued in reliance on exemptions from registration. Founder represents that the shares are acquired for investment and not with a view to distribution, and agrees to the transfer restrictions in the Subsidiary''s governing documents.

## 7. Conditions to Closing

7.1 Closing is conditioned on the organization of the Subsidiary, execution of the IP assignment, and adoption of the Subsidiary''s governing documents reflecting the terms of this Agreement.

## 8. Governing Law

8.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["cap_table.founder_pct", "company.business_purpose", "company.jurisdiction", "company.legal_name", "effective_date", "founder.legal_name", "founder.shares", "governing_law", "share.price", "vesting.cliff", "vesting.years"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Spin-Out Subsidiary SPA + IP Transfer' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Strategic Scale Partnership Agreement <- strategic_scale_partnership_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Strategic Scale Partnership Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal VC Management LLC ("Axal") provides go-to-market acceleration, financing support, and operational resources to portfolio companies; and

WHEREAS, {{company.legal_name}} (the "Company") wishes to engage Axal to accelerate its growth on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Acceleration Services

1.1 Axal shall provide the Company with go-to-market acceleration, including introductions, channel development, and commercial strategy, as described in the accompanying engagement schedule.

1.2 Axal shall make available operational resources — including talent, marketing, and shared services — on a reasonable-efforts basis consistent with Axal''s standard practices.

## 2. Follow-On Financing Support

2.1 Axal shall use commercially reasonable efforts to support the Company''s follow-on financing, including investor introductions and assistance with materials. Axal does not guarantee that any financing will be completed.

2.2 Axal may, at its election, participate in a future financing of the Company on the same terms offered to other investors in that round.

## 3. Consideration

3.1 In consideration of the services, the Company shall grant Axal (or its affiliate) {{equity_pct}} of its fully diluted equity, and/or pay the fees set out in the engagement schedule.

3.2 Equity granted under this Agreement vests over {{vesting.years}} years tied to Axal''s continued provision of services, subject to acceleration on a change of control of the Company.

## 4. Exclusivity

4.1 During the term, Axal shall be the Company''s preferred partner for the services described herein, and the Company shall not engage a competing accelerator for the same scope without Axal''s prior written consent.

## 5. Intellectual Property and Brand

5.1 Each party retains ownership of its pre-existing intellectual property. The Company may reference its relationship with Axal subject to Axal VC Holdings LLC''s brand guidelines and prior written approval of any public use of the Axal name.

## 6. Confidentiality

6.1 Each party shall keep the other''s non-public information confidential and use it solely to perform this Agreement.

## 7. Term and Termination

7.1 This Agreement continues for {{term.length}} and renews automatically unless either party gives {{notice_period}} written notice. Vested equity, confidentiality, and accrued payment obligations survive termination.

## 8. Limitation of Liability

8.1 Neither party is liable for indirect or consequential losses, and Axal''s aggregate liability is limited to the fees paid under this Agreement in the twelve (12) months preceding the claim.

## 9. Governing Law

9.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["company.legal_name", "equity_pct", "governing_law", "notice_period", "term.length", "vesting.years"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Strategic Scale Partnership Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Technology Integration / JV Agreement <- technology_integration_jv_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Technology Integration / JV Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal VC Management LLC ("Axal") has developed the Axal StudioOS artificial-intelligence technology (the "Axal Technology"); and

WHEREAS, {{counterparty_name}} (the "Counterparty") wishes to integrate the Axal Technology into its product through a joint venture on the terms set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. The Joint Venture

1.1 The parties shall establish a joint venture (the "JV") to integrate the Axal Technology into the Counterparty''s product and to commercialize the combined offering (the "Integrated Product").

1.2 The JV may be operated through {{company.legal_name}} or as a contractual arrangement between the parties, as the parties agree in writing.

## 2. Technology Contribution and License

2.1 Axal grants the JV a non-exclusive, non-transferable license to the Axal Technology solely for incorporation into the Integrated Product during the term. Axal VC Holdings LLC retains all rights in the Axal Technology and the Axal brand.

2.2 The Counterparty grants the JV a license to its product and materials to the extent required to create and operate the Integrated Product.

## 3. Shared and Background IP

3.1 Each party retains ownership of its background intellectual property. Improvements to a party''s background intellectual property remain owned by that party.

3.2 Intellectual property created jointly and specifically for the Integrated Product (the "Foreground IP") is owned jointly by the parties, each free to exploit it subject to the exclusivity and confidentiality terms herein.

## 4. Revenue Allocation

4.1 Net revenue from the Integrated Product is allocated {{revenue_share_pct}} to Axal and the balance to the Counterparty, after deduction of agreed direct costs.

4.2 Allocations are reconciled and paid quarterly, and each party may audit the relevant records on reasonable notice no more than once per year.

## 5. Governance

5.1 The JV is overseen by a steering committee with equal representation from each party. Major decisions — including pricing, roadmap, additional investment, and use of the Axal name — require the approval of both parties.

5.2 Day-to-day operational responsibilities are allocated in the accompanying operating plan.

## 6. Confidentiality

6.1 Each party shall keep the other''s non-public information confidential and use it solely for the JV, both during and after the term.

## 7. Term and Termination

7.1 This Agreement continues for {{term.length}} and renews by mutual agreement. Either party may terminate on {{notice_period}} written notice for material uncured breach, or immediately on the other party''s insolvency.

7.2 On termination, the licenses in Section 2 cease, each party ceases use of the other''s technology, and the Foreground IP and confidentiality provisions survive.

## 8. Governing Law

8.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["company.legal_name", "counterparty_name", "governing_law", "notice_period", "revenue_share_pct", "term.length"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Technology Integration / JV Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Referral / Agency Agreement <- referral_agency_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Referral / Agency Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Recitals

WHEREAS, Axal VC Management LLC ("Axal") wishes to receive referrals of qualified opportunities; and

WHEREAS, {{counterparty_name}} (the "Referrer") wishes to refer such opportunities to Axal in exchange for the consideration set out herein;

NOW, THEREFORE, the parties agree as follows.

## 1. Referral Activity

1.1 The Referrer may refer to Axal qualified opportunities — including prospective portfolio companies, customers, and distribution partners — by submitting the opportunity''s details to Axal for acceptance.

1.2 An opportunity is "Qualified" only if accepted by Axal in writing and not already known to or in discussion with Axal at the time of referral.

## 2. Independent Contractor; No Authority

2.1 The Referrer is an independent contractor and not an employee, partner, or agent of Axal. The Referrer has no authority to bind Axal, make representations on its behalf, or negotiate terms, and shall not hold itself out as doing so.

## 3. Referral Fees and Revenue Share

3.1 For each Qualified opportunity that results in a closed transaction, Axal shall pay the Referrer a referral fee equal to {{revenue_share_pct}} of the net revenue or consideration attributable to that transaction, or the fixed fee set out in the accompanying fee schedule.

3.2 Fees are payable within thirty (30) days after Axal''s receipt of the corresponding amounts, and accrue only while the underlying relationship remains active, up to a maximum of {{fee.tail_period}} from acceptance.

## 4. Non-Circumvention

4.1 During the term and for {{noncircumvention.period}} thereafter, neither party shall circumvent the other to deal directly with a Qualified opportunity in a manner that deprives the other of the benefit of this Agreement.

## 5. Distribution and Go-to-Market

5.1 Where the parties agree in writing, the Referrer may market or distribute Axal offerings within an agreed territory, using only approved materials and complying with Axal VC Holdings LLC''s brand guidelines.

## 6. Confidentiality

6.1 Each party shall keep the other''s non-public information confidential, including the identity of referred opportunities and the terms of any resulting transaction, and use it solely to perform this Agreement.

## 7. Compliance

7.1 The Referrer shall comply with applicable law in performing its activities, including anti-bribery, data-protection, and securities laws, and shall not make any payment or representation that would cause Axal to violate such laws.

## 8. Term and Termination

8.1 This Agreement continues until terminated by either party on {{notice_period}} written notice. Fees accrued before termination, non-circumvention, and confidentiality provisions survive.

## 9. Governing Law

9.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["counterparty_name", "fee.tail_period", "governing_law", "noncircumvention.period", "notice_period", "revenue_share_pct"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Referral / Agency Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- M&A Advisory Mandate <- ma_advisory_mandate_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'M&A Advisory Mandate' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Section 1 — Engagement and Exclusivity

1.1 The Client engages Axal VC Management LLC ("Advisor") as its exclusive financial advisor in connection with a possible merger, sale, recapitalization, or other strategic transaction involving {{company.legal_name}} (a "Transaction").

1.2 The engagement is exclusive for the period beginning on {{effective_date}} and continuing for {{engagement_term_months}} months (the "Term"), unless extended in writing or terminated under Section 7. During the Term the Client shall refer all inquiries regarding a Transaction to the Advisor.

## Section 2 — Scope of Services

2.1 The Advisor shall: (a) advise on transaction structure, strategy, and valuation; (b) prepare marketing and diligence materials; (c) identify and contact prospective counterparties; (d) coordinate the diligence process; and (e) assist in negotiating the definitive agreements.

2.2 The Advisor does not provide legal, tax, or accounting advice, and renders no fairness opinion unless separately engaged in writing.

## Section 3 — Retainer

3.1 The Client shall pay the Advisor a non-refundable retainer of {{retainer_amount}}, due on the {{effective_date}}. The retainer shall be credited against any Success Fee payable under Section 4.

## Section 4 — Success Fee

4.1 Upon the closing of a Transaction, the Client shall pay the Advisor a success fee equal to {{success_fee_pct}} of the aggregate Transaction value, calculated on a fully diluted basis and including cash, securities, assumed indebtedness, and contingent or deferred consideration.

4.2 The Success Fee is earned at closing and payable from the proceeds, in immediately available funds, concurrently with the consideration received by the Client or its equityholders.

## Section 5 — Tail Period

5.1 If a Transaction closes with any counterparty introduced to the Client by the Advisor, or otherwise engaged during the Term, within {{tail_period_months}} months after expiration or termination of this mandate, the Success Fee under Section 4 remains fully payable.

## Section 6 — Expenses and Indemnification

6.1 The Client shall reimburse the Advisor for reasonable, documented out-of-pocket expenses incurred in the engagement.

6.2 The Client shall indemnify the Advisor against losses arising from the engagement, except to the extent resulting from the Advisor''s gross negligence or willful misconduct.

## Section 7 — Termination

7.1 Either party may terminate this mandate on {{notice_period_days}} days'' written notice. Accrued fees, the retainer, expense reimbursement, and the tail provision of Section 5 survive termination.

## Section 8 — Confidentiality

8.1 Each party shall keep confidential all non-public information received in connection with the engagement and use it solely for the purposes of a Transaction. This obligation survives for {{confidentiality_years}} years after termination.

## Section 9 — Governing Law

9.1 This mandate is governed by {{governing_law}}.
',
       merge_fields = '["company.legal_name", "confidentiality_years", "effective_date", "engagement_term_months", "governing_law", "notice_period_days", "retainer_amount", "success_fee_pct", "tail_period_months"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'M&A Advisory Mandate' AND is_active = 1 AND length(trim(body_md)) = 0;

-- Secondary Purchase Agreement <- secondary_purchase_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'Secondary Purchase Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Section 1 — Sale and Purchase

1.1 Subject to the terms below, the Seller agrees to sell, and the Buyer agrees to purchase, {{secondary.units}} units of {{secondary.security_type}} of {{company.legal_name}} (the "Interests"), constituting {{secondary.ownership_pct}} of the Company on a fully diluted basis (the "Transferred Interests").

## Section 2 — Purchase Price

2.1 The aggregate purchase price for the Transferred Interests is {{purchase_price}}, equal to {{price_per_unit}} per unit (the "Purchase Price").

2.2 The Buyer shall pay the Purchase Price in immediately available funds at Closing against delivery of the instruments of transfer described in Section 3.

## Section 3 — Transfer Mechanics

3.1 At Closing the Seller shall deliver duly executed assignment and transfer instruments and any certificates representing the Transferred Interests, free and clear of all liens.

3.2 The transfer is effective only upon entry in the Company''s books and register of holders. Each party shall execute such further instruments as the Company reasonably requires to record the transfer.

## Section 4 — Right of First Refusal and Consents

4.1 The Closing is conditioned on the waiver or lapse of any right of first refusal, co-sale, or preemptive right applicable to the Transferred Interests.

4.2 The Closing is further conditioned on the Company''s and any required board or investor consent to the transfer under the Company''s governing documents. Each party shall use reasonable efforts to obtain such waivers and consents.

## Section 5 — Seller Representations and Warranties

5.1 The Seller represents and warrants that it owns the Transferred Interests free and clear of all liens, has full authority to sell them, and that the sale will not breach any agreement or right binding on the Seller or the Interests.

## Section 6 — Buyer Representations and Warranties

6.1 The Buyer represents and warrants that it is acquiring the Transferred Interests for its own account for investment, is an accredited investor, and has conducted its own independent review of the Company and the Interests.

## Section 7 — Information Rights

7.1 To the extent assignable, the Seller assigns to the Buyer any information, inspection, and reporting rights attaching to the Transferred Interests, effective from Closing and subject to the Company''s governing documents.

## Section 8 — Confidentiality

8.1 The existence and terms of this Agreement, and all non-public Company information disclosed in connection with it, are confidential and may be used only to evaluate and complete the transaction.

## Section 9 — Governing Law

9.1 This Agreement is governed by {{governing_law}}.
',
       merge_fields = '["company.legal_name", "governing_law", "price_per_unit", "purchase_price", "secondary.ownership_pct", "secondary.security_type", "secondary.units"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'Secondary Purchase Agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ip_background_schedule <- ip_background_schedule_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ip_background_schedule' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Section 1 — Purpose of Schedule

1.1 This Schedule enumerates the background intellectual property contributed, made available, or otherwise relied upon by {{contributor.legal_name}} in connection with the business of {{company.legal_name}} (the "Background IP"). Background IP is distinct from intellectual property created in the course of, and assigned under, the parties'' principal agreement.

## Section 2 — Schedule of Background IP

2.1 The Background IP consists of the following items:

- {{background_ip.item_1}}
- {{background_ip.item_2}}
- {{background_ip.item_3}}

2.2 Each item is identified by title, form (e.g. software, patent, trademark, copyright, know-how, or data), and date of creation or acquisition where known.

## Section 3 — Ownership

3.1 Except as stated in Section 5, the Contributor represents that it is the sole and exclusive owner of each item of Background IP listed in Section 2, or holds sufficient rights to grant the license in Section 4.

## Section 4 — License Granted

4.1 The Contributor grants the Company a {{license_scope}}, royalty-free, worldwide license to use, reproduce, modify, and exploit the Background IP solely as necessary to operate the Company''s business and to use the products and services that incorporate it.

4.2 The license is {{license_exclusivity}} and {{license_transferability}}, and survives for the duration of the Company''s use of the relevant Background IP.

## Section 5 — Retained Rights

5.1 The Contributor retains all right, title, and interest in the Background IP not expressly licensed under Section 4, and may continue to use and license the Background IP for purposes unrelated to the Company.

## Section 6 — Third-Party Rights

6.1 Where any item of Background IP incorporates or depends on third-party or open-source materials, those materials and their applicable license terms are identified in {{third_party_rights}}. The Company''s use of such items is subject to those third-party terms.

## Section 7 — Encumbrances

7.1 The Contributor discloses the following liens, security interests, prior licenses, or other encumbrances affecting the Background IP: {{ip_encumbrances}}. Except as so disclosed, the Background IP is free of encumbrances that would impair the license granted in Section 4.

## Section 8 — Governing Law

8.1 This Schedule is governed by {{governing_law}}.
',
       merge_fields = '["background_ip.item_1", "background_ip.item_2", "background_ip.item_3", "company.legal_name", "contributor.legal_name", "governing_law", "ip_encumbrances", "license_exclusivity", "license_scope", "license_transferability", "third_party_rights"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ip_background_schedule' AND is_active = 1 AND length(trim(body_md)) = 0;

-- data_access_acknowledgment_admin <- data_access_acknowledgment_admin_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'data_access_acknowledgment_admin' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '## Section 1 — Scope of Access

1.1 The undersigned administrator ("Administrator"), {{admin_name}} ({{admin_email}}), is granted access to platform user data and systems operated by Axal VC Management LLC (the "Platform") solely in the Administrator''s role as {{admin_role}} and solely for the duration of that role.

## Section 2 — Confidentiality

2.1 The Administrator shall hold all user data and other non-public Platform information in strict confidence, shall not disclose it to any person without authorization, and shall continue to do so after the role ends.

## Section 3 — Least Privilege

3.1 The Administrator shall access only the data and systems required for an assigned task, shall not use shared or elevated credentials beyond the access granted, and shall request the minimum privileges necessary to perform that task.

## Section 4 — Permitted Purposes

4.1 The Administrator may access user data only to operate, support, secure, and maintain the Platform, to respond to user requests, and to comply with law. Any access for personal, commercial, or other unrelated purpose is prohibited.

## Section 5 — Prohibition on Exfiltration

5.1 The Administrator shall not copy, download, export, transmit, or remove user data from the Platform''s authorized environment, except as expressly required for a permitted purpose under Section 4 and through approved channels. The Administrator shall not retain user data on personal devices or accounts.

## Section 6 — Audit Logging

6.1 The Administrator acknowledges that access to user data is logged and monitored, consents to such logging, and shall not disable, circumvent, or tamper with any audit, logging, or access-control mechanism.

## Section 7 — Reporting

7.1 The Administrator shall promptly report to {{security_contact}} any actual or suspected unauthorized access, loss, or disclosure of user data, and any violation of this Acknowledgment.

## Section 8 — Consequences of Breach

8.1 The Administrator acknowledges that a breach of this Acknowledgment may result in immediate revocation of access, disciplinary or employment action, and civil or criminal liability, and that Axal VC Management LLC may pursue all remedies available at law or in equity.

## Section 9 — Governing Law

9.1 This Acknowledgment is governed by {{governing_law}}.
',
       merge_fields = '["admin_email", "admin_name", "admin_role", "governing_law", "security_contact"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'data_access_acknowledgment_admin' AND is_active = 1 AND length(trim(body_md)) = 0;

-- tos_v1 <- tos_v3.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'tos_v1' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'company ("Axal VC Management" or the "Company")
**Counterparty:** {{counterparty_name}} ({{counterparty_email}})

## 1. Acceptance

By accessing or using the Axal StudioOS platform (the "Service"),
operated by Axal VC Management LLC, you agree to be bound by these
Terms of Service ("Terms"). If you do not agree, do not use the
Service.

## 2. Eligibility

You represent that you are at least 18 years old and have the legal
capacity to enter into binding agreements in your jurisdiction.

## 3. Account & Conduct

You are responsible for maintaining the confidentiality of your account
credentials and for all activity under your account. You agree not to
misuse the Service, including by attempting unauthorised access or
disrupting other users.

## 4. Confidentiality

Information labelled "Confidential" or that should reasonably be
understood as confidential remains the property of the disclosing
party and may not be disclosed to third parties without written consent.

## 4A. Intellectual Property Ownership

All trademarks, service marks, brand identifiers ("Axal", "Axal VC",
"StudioOS"), platform software, designs, copyrighted content, and
domain names (including `axal.vc`) are owned by **Axal VC Holdings
LLC**, a Delaware limited liability company, and licensed to Axal VC
Management LLC for operation of the Service. No rights in this
intellectual property are granted to you except a limited, revocable,
non-transferable licence to access and use the Service for its
intended purpose.

## 4B. Fund-Related Activities

Where the Service surfaces opportunities or information relating to
**Axal VC Spin-Out Lab Fund I LP** (the "Fund"), the Fund is managed exclusively
by **Axal VC GP LLC** as its general partner. Axal VC Management LLC
operates the Service but is not the general partner of the Fund and
does not, through these Terms, make any offer or solicitation to
invest in the Fund. Any investment in the Fund is governed by the
Fund''s separate subscription documents and limited partnership
agreement.

## 5. Limitation of Liability

To the maximum extent permitted by law, neither Axal VC Management LLC
nor any of its affiliates (including Axal VC Holdings LLC and Axal VC
GP LLC) is liable for indirect, consequential, or special damages
arising out of your use of the Service.

## 6. Termination

We may suspend or terminate your access for material breach of these
Terms. You may close your account at any time via Settings → Account.

## 7. Governing Law

These Terms are governed by the laws of the State of Delaware, USA,
without regard to conflict-of-laws principles.
',
       merge_fields = '["counterparty_email", "counterparty_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'tos_v1' AND is_active = 1 AND length(trim(body_md)) = 0;

-- privacy_v1 <- privacy_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'privacy_v1' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'liability company ("Axal VC Management" or "we")
**Counterparty:** {{counterparty_name}} ({{counterparty_email}})

## 1. Data we collect

We collect (a) account data you provide (name, email, role, optional
identity & tax fields), (b) usage telemetry (pages viewed, actions
taken), and (c) any artefacts you upload (decks, financial models,
contracts) for the purpose of running the Service.

## 2. Why we use it

To operate the Service, match founders with capital and partners,
generate scoring and analytics, and meet our legal and compliance
obligations.

## 3. How we share it

We share data only with: (a) other Axal users you explicitly opt to
share with (e.g. an investor you accept an intro from after a signed
NDA), (b) service providers under written confidentiality, and (c)
authorities when required by law. Where data is shared with our
affiliates — including Axal VC Holdings LLC (IP and brand owner) or
Axal VC GP LLC (general partner of Axal VC Spin-Out Lab Fund I LP) — sharing is
limited to what is reasonably necessary to operate the Service and
manage the fund relationship.

## 4. Encryption & retention

Sensitive identifiers (tax IDs, phone numbers, OAuth refresh tokens,
DD reports) are encrypted at rest with AES-GCM. Account data is kept
for as long as your account is active; you can request deletion via
Settings → Account → Delete account.

## 5. Your rights

Subject to applicable law (including GDPR/CCPA where relevant), you
may request access, correction, portability, or deletion of your data
by contacting privacy@axal.vc (Axal VC Management LLC, attn: Privacy
Officer, 16192 Coastal Hwy, Lewes, DE 19958, United States).
',
       merge_fields = '["counterparty_email", "counterparty_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'privacy_v1' AND is_active = 1 AND length(trim(body_md)) = 0;

-- founder_nda_v1 <- founder_nda_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'founder_nda_v1' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'company ("Axal")

## 1. Purpose

To enable evaluation of a potential venture-studio engagement,
including ideation, market validation, scoring, and possible
incorporation through the Axal StudioOS platform.

## 2. Confidential Information

"Confidential Information" means any non-public business, technical,
financial, or product information disclosed by either party in the
course of the Purpose, whether oral, written, or electronic.

## 3. Obligations

Each party shall (a) use Confidential Information solely for the
Purpose, (b) protect it with at least the same degree of care it uses
for its own confidential information (and never less than reasonable
care), and (c) limit access to personnel with a need to know who are
bound by equivalent confidentiality obligations.

## 4. Exclusions

Information that is or becomes public without breach of this NDA, was
already in the receiving party''s possession, is independently
developed without use of Confidential Information, or is rightfully
received from a third party without restriction.

## 5. Term

This NDA expires 24 months after the Effective Date. Confidentiality
obligations with respect to trade secrets continue for as long as the
information remains a trade secret under applicable law.

## 6. No License or Obligation

Nothing in this NDA grants either party rights in the other''s
intellectual property or obliges either party to enter into any
further transaction.
',
       merge_fields = '[]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'founder_nda_v1' AND is_active = 1 AND length(trim(body_md)) = 0;

-- investor_nda_axal <- investor_nda_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'investor_nda_axal' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Spin-Out Lab Fund I LP)

## 1. Purpose

To enable evaluation of investment opportunities surfaced through the
Axal StudioOS platform, including but not limited to deal screening,
diligence materials, capital-stack data, and pipeline reporting in
respect of portfolio companies and Axal VC Spin-Out Lab Fund I LP.

## 2. Confidential Information

"Confidential Information" means any non-public information disclosed
by Axal, Axal VC GP LLC, Axal VC Spin-Out Lab Fund I LP, or any of their
portfolio companies in connection with the Purpose, including pitch
materials, financial models, scoring outputs, deal terms, and
capital-call schedules.

## 3. Obligations

Investor shall (a) use Confidential Information solely for the
Purpose, (b) not disclose it to any third party without prior written
consent, except to advisors bound by equivalent confidentiality, and
(c) destroy or return all materials upon written request.

## 4. No Front-Running

Investor agrees not to use Confidential Information to compete with,
or front-run, any portfolio company or transaction described therein.

## 5. Term

This NDA expires 24 months after the Effective Date. Trade-secret
information remains protected for as long as it qualifies as a trade
secret under applicable law.

## 6. Remedies

Investor acknowledges that monetary damages may be inadequate for a
breach of this NDA and that Axal is entitled to seek injunctive
relief in addition to any other remedy.
',
       merge_fields = '[]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'investor_nda_axal' AND is_active = 1 AND length(trim(body_md)) = 0;

-- accreditation_v1 <- accreditation_v2.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'accreditation_v1' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'The undersigned ("Investor") certifies, under penalties of perjury,
that they qualify as an "Accredited Investor" as that term is defined
in Rule 501(a) of Regulation D under the U.S. Securities Act of 1933,
as amended (or the equivalent classification in their home
jurisdiction). Investor selects **at least one** basis below:

- [ ] Individual income exceeding USD 200,000 in each of the two most
      recent years (or USD 300,000 jointly with spouse) and a
      reasonable expectation of the same income level in the current
      year.
- [ ] Individual net worth exceeding USD 1,000,000, excluding the
      value of the primary residence.
- [ ] Holds in good standing one of the professional certifications
      designated by the U.S. Securities and Exchange Commission for
      this purpose (e.g. Series 7, Series 65, or Series 82).
- [ ] An entity with total assets exceeding USD 5,000,000, not formed
      for the specific purpose of acquiring the securities offered.
- [ ] An entity in which all equity owners are accredited investors.
- [ ] Other (specify): {{accreditation_other}}

Investor agrees to promptly notify Axal VC Management LLC (as
platform operator) and, where this certification is delivered in
connection with an investment in Axal VC Spin-Out Lab Fund I LP, Axal VC GP LLC
(as the Fund''s general partner) in writing if any of the foregoing
ceases to be true. Each such entity is entitled to rely on this
certification and is under no obligation to independently verify
Investor''s status, except as required by Rule 506(c) (in which case
additional documentation may be requested).
',
       merge_fields = '["accreditation_other"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'accreditation_v1' AND is_active = 1 AND length(trim(body_md)) = 0;

-- nda_3way_founder_investor_axal <- nda_3way_founder_investor_axal_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'nda_3way_founder_investor_axal' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = '- **Founder:** {{founder_name}} ({{founder_email}})
- **Investor:** {{investor_name}} ({{investor_email}})
- **Intermediary / Counter-signer:** Axal VC Management LLC, a
  Delaware limited liability company ("Axal"), as operator of the
  Axal StudioOS platform (signed by {{axal_signer_email}})

## 1. Purpose

To enable a structured introduction between Founder and Investor via
the Axal StudioOS platform, including disclosure of business plans,
financial information, scoring outputs, capital-stack details, and
related diligence materials.

## 2. Confidential Information

"Confidential Information" means any non-public information disclosed
by any party in furtherance of the Purpose, regardless of medium.
Confidential Information of Founder includes (without limitation)
business plans, customer lists, financial projections, technology,
trade secrets, and the existence and terms of any potential
investment discussions.

## 3. Mutual Obligations

Each party agrees to (a) use Confidential Information solely for the
Purpose, (b) hold it in strict confidence using at least reasonable
care, (c) limit disclosure to its representatives with a need to
know, who are themselves bound by equivalent confidentiality
obligations, and (d) not reverse-engineer, decompile, or copy
Confidential Information except as expressly permitted in writing.

## 4. Restrictions on Investor

Until the parties enter into a definitive investment agreement,
Investor shall not (a) make any direct contact with Founder''s
customers, employees, or suppliers regarding the matters disclosed,
(b) front-run or compete with Founder using Confidential Information,
or (c) syndicate or share Confidential Information with co-investors
without Founder''s prior written consent.

## 5. Role of Axal

Axal VC Management LLC acts as intermediary to facilitate the
introduction in its capacity as platform operator. Axal does not
warrant the accuracy of any information passed between Founder and
Investor and is not party to any subsequent investment transaction
except as separately agreed. Any investment in or through Axal VC
Fund I, LP is governed exclusively by the Fund''s subscription
documents and is managed by Axal VC GP LLC (the Fund''s general
partner) — not by Axal VC Management LLC under this NDA.

## 6. Term

This NDA is effective for **12 months** from the Effective Date,
after which it automatically expires unless extended in writing by
all parties. Confidentiality obligations with respect to trade
secrets survive expiration for as long as the information qualifies
as a trade secret under applicable law.

## 7. No License, No Obligation

Nothing herein grants any party rights in another party''s
intellectual property or obliges any party to enter into any further
transaction. Each party may discontinue discussions at any time.

## 8. Governing Law & Venue

This NDA is governed by the laws of the State of Delaware, USA,
without regard to conflict-of-laws principles. The parties consent
to the exclusive jurisdiction of the state and federal courts located
in Wilmington, Delaware.
',
       merge_fields = '["axal_signer_email", "founder_email", "founder_name", "investor_email", "investor_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'nda_3way_founder_investor_axal' AND is_active = 1 AND length(trim(body_md)) = 0;

-- aml_kyc <- aml_kyc_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'aml_kyc' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'ANTI-MONEY LAUNDERING & KNOW YOUR CUSTOMER POLICY

Organization: {{company_name}}
Effective Date: ____________________
Compliance Officer: ____________________

SECTION 1 — PURPOSE
1.1 This policy establishes procedures to prevent money laundering and terrorist financing
    through the Fund''s operations, in compliance with the Bank Secrecy Act and USA PATRIOT Act.

SECTION 2 — CUSTOMER IDENTIFICATION PROGRAM (CIP)
2.1 All prospective investors must provide:
    Individuals: Government-issued photo ID, proof of address, SSN/TIN
    Entities: Formation documents, beneficial ownership disclosure (25%+ owners), EIN
2.2 Verification must be completed BEFORE accepting subscription agreements.

SECTION 3 — ENHANCED DUE DILIGENCE (EDD)
3.1 Required for:
    (a) Investors from high-risk jurisdictions (per FATF list)
    (b) Politically Exposed Persons (PEPs)
    (c) Investments exceeding $__________
3.2 EDD includes source of funds verification and enhanced ongoing monitoring.

SECTION 4 — SCREENING
4.1 All investors screened against OFAC SDN List, UN Sanctions, EU Sanctions, and PEP databases.
4.2 Screening performed at onboarding and periodically (at least annually).

SECTION 5 — SUSPICIOUS ACTIVITY REPORTING
5.1 Any employee identifying suspicious activity must report to the Compliance Officer within 24 hours.
5.2 The Compliance Officer evaluates and files SARs with FinCEN as required.

SECTION 6 — RECORD RETENTION
6.1 CIP records: Maintained for 5 years after account closure.
6.2 Transaction records: Maintained for 5 years from date of transaction.

Approved: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'aml_kyc' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ee_e_residency_application_kit <- ee_e_residency_application_kit_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ee_e_residency_application_kit' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'E-RESIDENCY APPLICATION KIT — for {{company_name}} founders

e-Residency lets you incorporate and run an Estonian OÜ entirely
online from anywhere in the world.

1. APPLY FOR e-RESIDENCY (do this FIRST, ~6–8 weeks)
   - Apply at https://e-resident.gov.ee/become-an-e-resident
   - Government fee: €100–€120 + €30 courier
   - Required: passport, photo, motivation statement, criminal record check
   - Pick up the digital ID card at the chosen embassy / pickup point

2. INCORPORATE THE OÜ (after receiving e-Residency, same day)
   - Use a Company Service Provider (CSP) — required for non-residents
     for the registered address. Typical cost: €200–€500/yr.
   - File via the Estonian Business Register portal using the digital ID.
   - State fee: €265.
   - Share capital: EUR 0.01 minimum (since 2023; pay-up flexible).

3. POST-INCORPORATION
   - Open a business bank account (Wise, LHV, Payoneer, Revolut Business)
   - Register for VAT if EU turnover will exceed €40k/year
   - File monthly VAT and annual tax returns via e-Tax Board',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ee_e_residency_application_kit' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ein_application_kit <- ein_application_kit_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ein_application_kit' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'EIN APPLICATION KIT — {{company_name}}

This kit walks you through obtaining an Employer Identification
Number (EIN) for {{company_name}} from the Internal Revenue Service.

1. ELIGIBILITY
   Form SS-4 may be filed online at irs.gov/EIN if the responsible
   party has a US SSN or ITIN. Otherwise, fax/mail Form SS-4.

2. REQUIRED INFORMATION
   - Legal name: {{company_name}}
   - Trade name (DBA): _______________
   - Mailing address: _______________
   - Responsible party (full legal name + SSN/ITIN): _______________
   - Reason for applying: Started a new business
   - Date business started: {{incorporation_date}}
   - Closing month of accounting year: December
   - Highest number of employees expected in next 12 months: _______

3. NEXT STEPS AFTER RECEIVING EIN
   - Open a US business bank account
   - Apply for state tax IDs where you will operate
   - Register for sales tax / payroll tax as applicable',
       merge_fields = '["company_name", "incorporation_date"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ein_application_kit' AND is_active = 1 AND length(trim(body_md)) = 0;

-- form_adv <- form_adv_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'form_adv' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'FORM ADV — EXEMPT REPORTING ADVISER (ERA) FILING GUIDE

Organization: {{company_name}}

SECTION 1 — OVERVIEW
1.1 If {{company_name}} manages a fund with less than $150M in AUM, it likely qualifies
    as an Exempt Reporting Adviser (ERA) under the Investment Advisers Act.
1.2 ERAs must file Form ADV Parts 1 and 2 with the SEC via the IARD system.

SECTION 2 — FILING REQUIREMENTS
2.1 Initial Filing: Within 60 days of fund launch.
2.2 Annual Amendment: Due within 90 days of fiscal year-end.
2.3 Material Changes: Promptly file amendments for material changes.

SECTION 3 — KEY DISCLOSURES
3.1 Part 1: Identification, business practices, clients, and AUM.
3.2 Part 2A (Brochure): Investment strategy, fees, conflicts of interest, disciplinary history.
3.3 Part 2B (Supplement): Background of key investment personnel.

SECTION 4 — STATE REGISTRATION
4.1 Check if state "blue sky" filings are required based on office location and LP domicile.

SECTION 5 — ONGOING OBLIGATIONS
5.1 Maintain books and records for 5 years.
5.2 Adopt and enforce written compliance policies.
5.3 Designate a Chief Compliance Officer.

Filed by: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'form_adv' AND is_active = 1 AND length(trim(body_md)) = 0;

-- section_83b <- section_83b_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'section_83b' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'SECTION 83(b) ELECTION UNDER THE INTERNAL REVENUE CODE

Taxpayer: ____________________
SSN: ____________________
Tax Year: ____________________

To: Internal Revenue Service
    [Appropriate IRS Service Center based on taxpayer address]

The undersigned taxpayer hereby makes an election under Section 83(b) of the Internal
Revenue Code with respect to the property described below:

1. PROPERTY DESCRIPTION
   Shares of carried interest / membership units in {{company_name}}

2. DATE OF TRANSFER: ____________________

3. TAXABLE YEAR: Calendar Year ____

4. PROPERTY DETAILS
   (a) Number of units/shares: __________
   (b) Fair market value at time of transfer: $__________
   (c) Amount paid for the property: $__________
   (d) Amount to include in gross income: $__________

5. RESTRICTIONS
   The property is subject to a vesting schedule of __ years with a __-year cliff.
   The property is subject to forfeiture if the taxpayer ceases service before fully vesting.

6. COPIES FURNISHED TO:
   (a) IRS (this filing)
   (b) {{company_name}} (employer/partnership)
   (c) Taxpayer''s personal records

CRITICAL DEADLINE: This election must be filed with the IRS within 30 days of the
transfer date. Failure to file timely results in taxation at ordinary income rates
as the property vests, which can result in significantly higher tax liability.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'section_83b' AND is_active = 1 AND length(trim(body_md)) = 0;

-- sg_acra_form_45_kit <- sg_acra_form_45_kit_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'sg_acra_form_45_kit' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'ACRA BIZFILE INCORPORATION KIT — {{company_name}} PTE. LTD.

Filing channel: ACRA BizFile+ (https://www.bizfile.gov.sg)
Government fee: S$315 (S$15 name application + S$300 incorporation)

REQUIRED PARTIES
- At least 1 director ordinarily resident in Singapore (citizen, PR,
  or EP/EntrePass holder). Most foreign founders use a nominee
  director service for the first year (~S$2,500/yr).
- 1 company secretary (must be Singapore-resident; appointed within
  6 months).
- 1–50 shareholders (individuals or corporations; foreigners allowed).

REQUIRED INFORMATION
1. Proposed company name (with ACRA name check)
2. Principal business activity and SSIC code
3. Registered office address (must be in Singapore; no PO box)
4. Share capital (any currency; minimum S$1)
5. Constitution (use Model Constitution or upload custom)
6. Director(s), Secretary, Shareholder(s) particulars

POST-INCORPORATION
- Open corporate bank account (DBS, OCBC, UOB, or digital banks like Aspire)
- Register for GST if turnover will exceed S$1m/year
- Apply for sector-specific licenses if regulated activity',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'sg_acra_form_45_kit' AND is_active = 1 AND length(trim(body_md)) = 0;

-- uk_form_in01_kit <- uk_form_in01_kit_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'uk_form_in01_kit' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'COMPANIES HOUSE IN01 FILING KIT — {{company_name}} LIMITED

Filing fee: £50 standard (24h) or £78 same-day.

REQUIRED INFORMATION
1. Proposed company name: {{company_name}} Limited
2. Registered office address (must be in UK): _______________
3. Director(s) — full name, DOB, nationality, occupation, residential
   address (kept private), service address (public).
4. Shareholder(s) — initial subscriber details.
5. People with significant control (PSC) — anyone holding >25% shares
   or voting rights.
6. SIC code(s) — choose up to 4 from the official list.
7. Statement of capital — number, nominal value, currency.

SUBMISSION
- Online via Companies House WebFiling (recommended).
- Paper IN01 by post to Cardiff or Edinburgh registry.

POST-INCORPORATION
- Register for Corporation Tax with HMRC within 3 months.
- Set up PAYE if employing staff; consider VAT registration.',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'uk_form_in01_kit' AND is_active = 1 AND length(trim(body_md)) = 0;

-- lpa <- lpa_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'lpa' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'LIMITED PARTNERSHIP AGREEMENT

{{company_name}} VENTURE FUND I, L.P.

SECTION 1 — FORMATION
1.1 The Partnership is formed as a Delaware Limited Partnership.
1.2 General Partner: {{company_name}} Management LLC
1.3 Purpose: To make venture capital investments in early-stage technology companies.

SECTION 2 — FUND TERMS
2.1 Target Fund Size: $__________
2.2 Fund Life: 10 years from Final Close, with two 1-year extensions at GP discretion.
2.3 Investment Period: First 5 years from Final Close.
2.4 Minimum LP Commitment: $__________

SECTION 3 — ECONOMICS
3.1 Management Fee: 2.0% of committed capital during Investment Period; 2.0% of invested capital thereafter.
3.2 Carried Interest: 20% of net profits.
3.3 Preferred Return (Hurdle): 8% annual return to LPs before carry accrues.
3.4 GP Commitment: General Partner shall commit at least 1% of total fund commitments.

SECTION 4 — CAPITAL CALLS & DISTRIBUTIONS
4.1 Capital calls require 10 business days notice.
4.2 Failure to fund: Defaulting LP forfeits 50% of existing capital account.
4.3 Distribution Waterfall:
    (a) Return of contributed capital to LPs
    (b) Preferred return (8%) to LPs
    (c) GP catch-up to 20%
    (d) 80/20 split (LP/GP) thereafter

SECTION 5 — GOVERNANCE
5.1 LP Advisory Committee: 3-5 LP representatives.
5.2 LPAC approves: Related-party transactions, valuation disputes, fund extensions.
5.3 Key Person: If [Partner Names] cease active involvement, Investment Period suspends.

SECTION 6 — REPORTING
6.1 Quarterly: NAV statements, portfolio updates.
6.2 Annual: Audited financial statements (Big 4 or equivalent).
6.3 Tax: K-1 schedules delivered by March 15 annually.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'lpa' AND is_active = 1 AND length(trim(body_md)) = 0;

-- mgmt_company <- mgmt_company_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'mgmt_company' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'MANAGEMENT COMPANY AGREEMENT

Between: {{company_name}} Venture Fund I, L.P. (the "Fund")
And: {{company_name}} Management LLC (the "Manager")

Effective Date: ____________________

SECTION 1 — APPOINTMENT
1.1 The Fund hereby retains the Manager to provide day-to-day investment management and administrative services.

SECTION 2 — SERVICES
2.1 The Manager shall provide:
    (a) Deal sourcing and evaluation
    (b) Due diligence and investment execution
    (c) Portfolio company monitoring and support
    (d) LP reporting and communications
    (e) Regulatory compliance and filings

SECTION 3 — COMPENSATION
3.1 Management Fee: The Fund shall pay the Manager the Management Fee as defined in the LPA.
3.2 The Manager is responsible for all overhead costs from the Management Fee, including:
    (a) Salaries and benefits of the investment team
    (b) Office rent and operational expenses
    (c) Travel and entertainment

SECTION 4 — TERM
4.1 This Agreement is coterminous with the Fund''s existence.
4.2 Terminates upon removal of the General Partner as provided in the LPA.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'mgmt_company' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ppm <- ppm_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ppm' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'CONFIDENTIAL PRIVATE PLACEMENT MEMORANDUM

{{company_name}} VENTURE FUND I, L.P.
Date: ____________________

NOTICE: This memorandum is confidential and is provided solely for the purpose of evaluating an investment in the Fund. Distribution to unauthorized persons is prohibited.

SECTION 1 — EXECUTIVE SUMMARY
1.1 Fund: {{company_name}} Venture Fund I, L.P.
1.2 Strategy: Early-stage venture capital investments in technology-driven startups.
1.3 Target Fund Size: $__________
1.4 Minimum Investment: $__________

SECTION 2 — INVESTMENT STRATEGY
2.1 Stage Focus: Pre-Seed to Series A
2.2 Sector Focus: AI/ML, SaaS, FinTech, HealthTech, Developer Tools
2.3 Check Size: $__________ to $__________ initial investment
2.4 Target Portfolio: 20-30 companies over the Investment Period
2.5 Geographic Focus: North America, with selective international opportunities

SECTION 3 — RISK FACTORS
3.1 Venture capital investments carry a high degree of risk including total loss of capital.
3.2 Investments are illiquid with no established secondary market.
3.3 Past performance of the General Partner does not guarantee future results.
3.4 The Fund may make concentrated investments, increasing portfolio risk.
3.5 Regulatory changes may adversely affect portfolio companies.

SECTION 4 — FEES & EXPENSES
4.1 Management Fee: 2% per annum
4.2 Carried Interest: 20% above 8% hurdle
4.3 Fund Expenses: Legal, audit, administration, and broken-deal costs borne by the Fund.
4.4 Organizational Expenses: Capped at $__________.

SECTION 5 — TAX CONSIDERATIONS
5.1 The Fund is treated as a partnership for US federal income tax purposes.
5.2 LPs receive Schedule K-1 reflecting their allocable share of income, gains, and losses.
5.3 Non-US investors should consult tax advisors regarding withholding and reporting.

IMPORTANT: This PPM does not constitute an offer in any jurisdiction where such offer is unlawful.

Prepared by: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ppm' AND is_active = 1 AND length(trim(body_md)) = 0;

-- subscription <- subscription_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'subscription' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'SUBSCRIPTION AGREEMENT

{{company_name}} VENTURE FUND I, L.P.

The undersigned (the "Subscriber") hereby subscribes for a limited partnership interest in the Fund.

SECTION 1 — SUBSCRIPTION
1.1 Capital Commitment: $____________________
1.2 The Subscriber has received and reviewed the Private Placement Memorandum and Limited Partnership Agreement.

SECTION 2 — REPRESENTATIONS & WARRANTIES
The Subscriber represents and warrants that:
2.1 The Subscriber is an "accredited investor" as defined in Regulation D of the Securities Act.
2.2 The Subscriber has sufficient financial resources and liquidity to bear the economic risk of this investment.
2.3 The Subscriber is acquiring the Interest for investment purposes only, not for resale.
2.4 The Subscriber has had opportunity to ask questions and receive answers from the General Partner.
2.5 The Subscriber''s commitment does not exceed 10% of the Subscriber''s total net worth (recommended).

SECTION 3 — INVESTOR INFORMATION
Name: ____________________
Type: [ ] Individual [ ] Trust [ ] Corporation [ ] Partnership [ ] Other
Address: ____________________
Tax ID / SSN: ____________________
Accreditation Basis: [ ] Income [ ] Net Worth [ ] Entity [ ] Knowledgeable Employee

SECTION 4 — ACKNOWLEDGMENTS
4.1 The Subscriber acknowledges that this investment is illiquid and high-risk.
4.2 The General Partner may reject this Subscription in whole or in part.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'subscription' AND is_active = 1 AND length(trim(body_md)) = 0;

-- bylaws <- bylaws_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'bylaws' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'BYLAWS OF {{company_name}}
A Delaware Corporation

ARTICLE I — OFFICES
1.1 Registered Office: State of Delaware
1.2 Principal Office: ____________________

ARTICLE II — STOCKHOLDERS
2.1 Annual Meeting: Within 13 months of last annual meeting.
2.2 Special Meetings: May be called by the Board or holders of 25% of outstanding shares.
2.3 Quorum: A majority of outstanding shares entitled to vote.
2.4 Voting: Each share entitled to one vote. Cumulative voting is not permitted.

ARTICLE III — DIRECTORS
3.1 Number: The Board shall consist of ___ directors.
3.2 Election: Directors elected at each annual meeting for one-year terms.
3.3 Vacancies: May be filled by majority vote of remaining directors.
3.4 Quorum: A majority of the total number of directors.

ARTICLE IV — OFFICERS
4.1 Required Officers: Chief Executive Officer, Secretary, Treasurer.
4.2 Officers serve at the pleasure of the Board and may be removed at any time.

ARTICLE V — STOCK
5.1 Certificates may be issued in uncertificated form.
5.2 Transfers subject to applicable securities law restrictions.

ARTICLE VI — INDEMNIFICATION
6.1 The Corporation shall indemnify directors and officers to the fullest extent permitted by Delaware law.

ARTICLE VII — AMENDMENTS
7.1 These Bylaws may be amended by the Board or by a majority vote of stockholders.

Adopted: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'bylaws' AND is_active = 1 AND length(trim(body_md)) = 0;

-- certificate_of_incorporation_de <- certificate_of_incorporation_de_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'certificate_of_incorporation_de' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'CERTIFICATE OF INCORPORATION OF {{company_name}}

A Delaware Corporation

FIRST. The name of the corporation is {{company_name}}.

SECOND. The Registered Office in Delaware is c/o {{registered_agent_name}},
        located at {{registered_agent_address}}, County of New Castle, Delaware.

THIRD. The purpose of the Corporation is to engage in any lawful act or
       activity for which corporations may be organized under the General
       Corporation Law of Delaware.

FOURTH. The total number of shares of stock the Corporation is authorized
        to issue is 10,000,000 shares of Common Stock, par value $0.00001
        per share.

FIFTH. The Corporation reserves the right to amend, alter, change, or
       repeal any provision contained in this Certificate.

SIXTH. The directors shall have power to make and to alter or amend the
       Bylaws of the Corporation.

SEVENTH. To the fullest extent permitted by the DGCL, no director shall
         be personally liable for monetary damages for breach of fiduciary
         duty.

IN WITNESS WHEREOF, the undersigned has executed this Certificate on
{{incorporation_date}}.

____________________________
Incorporator',
       merge_fields = '["company_name", "incorporation_date", "registered_agent_address", "registered_agent_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'certificate_of_incorporation_de' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ee_articles_of_association <- ee_articles_of_association_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ee_articles_of_association' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'ARTICLES OF ASSOCIATION OF {{company_name}} OÜ

Adopted in accordance with the Estonian Commercial Code.

§1. BUSINESS NAME. The business name is "{{company_name}} OÜ".

§2. REGISTERED OFFICE. The registered office is in Estonia.

§3. AREA OF ACTIVITY. The company may engage in any lawful
    economic activity not requiring a special licence.

§4. SHARE CAPITAL. The share capital is EUR 0.01, divided into
    one share of EUR 0.01. (Minimum since 2023 reform.)

§5. MANAGEMENT BOARD. The Management Board has 1 to 5 members
    appointed for an unspecified term.

§6. SUPERVISORY BOARD. No supervisory board is established.

§7. REPRESENTATION. Each Management Board member may represent
    the company solely.

§8. SHAREHOLDER RESOLUTIONS. Resolutions are adopted by majority
    of votes represented unless the law requires a higher quorum.

§9. PROFIT DISTRIBUTION. Profit may be distributed only after the
    annual report is approved.

Adopted: {{incorporation_date}}',
       merge_fields = '["company_name", "incorporation_date"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ee_articles_of_association' AND is_active = 1 AND length(trim(body_md)) = 0;

-- equity_split <- equity_split_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'equity_split' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'EQUITY ALLOCATION AGREEMENT

Company: {{company_name}}
Effective Date: ____________________

SECTION 1 — ALLOCATION
Founder 1: ___% — Vesting over 4 years, 1-year cliff
Founder 2: ___% — Vesting over 4 years, 1-year cliff
Option Pool: 10% — Reserved for future employees
Axal VC Studio Equity: ___% — Fully vested at incorporation

SECTION 2 — VESTING SCHEDULE
2.1 Standard 4-year vesting with 1-year cliff.
2.2 Monthly vesting after cliff (1/48th per month).
2.3 Single-trigger acceleration: 25% upon Change of Control.
2.4 Double-trigger acceleration: 100% upon termination within 12 months of Change of Control.

SECTION 3 — RESTRICTIONS
3.1 All shares subject to the Company''s Right of First Refusal.
3.2 Founders must execute 83(b) elections within 30 days of grant.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'equity_split' AND is_active = 1 AND length(trim(body_md)) = 0;

-- ip_license <- ip_license_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'ip_license' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'INTELLECTUAL PROPERTY LICENSE AGREEMENT

Licensor: Axal VC HoldCo
Licensee: {{company_name}}

GRANT OF LICENSE: Licensor grants Licensee a non-exclusive, worldwide license
to use, modify, and commercialize the Licensed IP for the purpose of operating
the Licensee''s business.

CONSIDERATION: In exchange for this license, Licensee agrees to the equity
allocation as specified in the Equity Split Agreement.

TERM: Perpetual, subject to the terms herein.

Signed: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'ip_license' AND is_active = 1 AND length(trim(body_md)) = 0;

-- safe <- safe_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'safe' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'SIMPLE AGREEMENT FOR FUTURE EQUITY (SAFE)

Company: {{company_name}}
Investor: ____________________
Purchase Amount: $____________________

This SAFE certifies that in exchange for the payment by the Investor of the Purchase Amount
on or about the date of this SAFE, the Company hereby issues to the Investor the right to
certain shares of the Company''s capital stock, subject to the terms set forth below.

1. EVENTS
(a) Equity Financing: If the Company issues shares in a bona fide equity financing of at
    least $__________ (a "Qualified Financing"), the SAFE converts into shares at the lower of:
    - The Valuation Cap: $____________________
    - A ___% discount to the price per share paid by new investors
(b) Liquidity Event: If a Change of Control or IPO occurs before conversion, the Investor
    receives the greater of: (i) the Purchase Amount, or (ii) the number of shares the
    Purchase Amount would buy at the Valuation Cap.
(c) Dissolution Event: The Investor receives the Purchase Amount.

2. DEFINITIONS
"Valuation Cap" means $____________________.
"Discount Rate" means ___%
"Liquidity Event" means a Change of Control or IPO.

3. COMPANY REPRESENTATIONS
The Company is duly organized, validly existing, and in good standing.
The Company has the authority to issue this SAFE.

4. INVESTOR REPRESENTATIONS
The Investor is an accredited investor.
The Investor is acquiring this SAFE for investment purposes only.

5. MISCELLANEOUS
Governing Law: State of Delaware
Pro Rata Rights: [Yes/No]
MFN Provision: [Yes/No]

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'safe' AND is_active = 1 AND length(trim(body_md)) = 0;

-- sg_constitution <- sg_constitution_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'sg_constitution' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'CONSTITUTION OF {{company_name}} PTE. LTD.

Adopted in accordance with Section 32 of the Companies Act 1967.

1. NAME. The name of the Company is {{company_name}} PTE. LTD.

2. REGISTERED OFFICE. The registered office of the Company shall
   be in Singapore.

3. OBJECTS. The Company has full capacity to carry on or undertake
   any business or activity, do any act or enter into any
   transaction.

4. LIABILITY. The liability of the members is limited to the
   amount unpaid on their shares.

5. SHARE CAPITAL. The share capital of the Company at incorporation
   is S$1.00 divided into 1 ordinary share of S$1.00. Additional
   shares may be issued as the Directors determine.

6. DIRECTORS. The Company shall have not fewer than one director
   ordinarily resident in Singapore.

7. TRANSFER OF SHARES. Shares are transferable by instrument in
   writing in the form approved by the Directors, subject to
   pre-emption rights.

Adopted: {{incorporation_date}}',
       merge_fields = '["company_name", "incorporation_date"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'sg_constitution' AND is_active = 1 AND length(trim(body_md)) = 0;

-- spa <- spa_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'spa' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'STOCK PURCHASE AGREEMENT

Between: {{company_name}} (the "Company")
And: Axal Ventures (the "Purchaser")
Date: ____________________

SECTION 1 — PURCHASE AND SALE
1.1 The Company agrees to sell, and the Purchaser agrees to purchase, __________ shares
    of Series ___ Preferred Stock at a price of $__________ per share.
1.2 Aggregate Purchase Price: $____________________

SECTION 2 — CLOSING
2.1 Closing Date: ____________________
2.2 Deliverables at Closing:
    (a) Stock certificates or book-entry confirmation
    (b) Legal opinion of Company counsel
    (c) Compliance certificate from the Company
    (d) Updated cap table

SECTION 3 — REPRESENTATIONS OF THE COMPANY
3.1 The Company is duly organized and in good standing.
3.2 The shares are duly authorized, validly issued, fully paid, and non-assessable.
3.3 No litigation pending that would materially affect the Company.
3.4 Financial statements provided are accurate in all material respects.
3.5 The Company owns or has rights to all intellectual property used in its business.

SECTION 4 — REPRESENTATIONS OF THE PURCHASER
4.1 The Purchaser is an accredited investor.
4.2 The Purchaser is acquiring shares for investment purposes only.

SECTION 5 — CONDITIONS TO CLOSING
5.1 Execution of Investors'' Rights Agreement.
5.2 Execution of Voting Agreement.
5.3 Updated Certificate of Incorporation filed with Delaware.

SECTION 6 — MISCELLANEOUS
6.1 Governing Law: Delaware
6.2 Entire Agreement: This SPA and related agreements constitute the full agreement.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'spa' AND is_active = 1 AND length(trim(body_md)) = 0;

-- stock_purchase_agreement <- stock_purchase_agreement_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'stock_purchase_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'RESTRICTED STOCK PURCHASE AGREEMENT — {{company_name}}

This Restricted Stock Purchase Agreement (the "Agreement") is entered
into on {{incorporation_date}} between {{company_name}}, a Delaware
corporation (the "Company"), and the Founder identified on Exhibit A
(the "Purchaser").

1. PURCHASE OF SHARES.
   Purchaser hereby purchases _______ shares of the Company''s Common
   Stock (the "Shares") at $0.0001 per share, for total consideration
   of $_______.

2. VESTING.
   The Shares vest 25% on the one-year anniversary of the Vesting
   Commencement Date, and 1/48th monthly thereafter, subject to
   continuous service.

3. RIGHT OF REPURCHASE.
   Upon termination of service, the Company may repurchase any
   unvested Shares at the Original Purchase Price.

4. SECTION 83(b) ELECTION.
   Purchaser is strongly advised to file a Section 83(b) election
   with the IRS within 30 days of this Agreement.

5. RIGHT OF FIRST REFUSAL.
   The Company has a right of first refusal on any proposed transfer
   of vested Shares.

____________________________     ____________________________
{{company_name}}                   Founder',
       merge_fields = '["company_name", "incorporation_date"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'stock_purchase_agreement' AND is_active = 1 AND length(trim(body_md)) = 0;

-- term_sheet <- term_sheet_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'term_sheet' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'TERM SHEET — NON-BINDING

Company: {{company_name}}
Lead Investor: Axal Ventures
Date: ____________________

This Term Sheet is non-binding and is intended solely as a basis for further discussion.

SECTION 1 — OFFERING TERMS
Type of Security: Series ___ Preferred Stock
Pre-Money Valuation: $____________________
Amount of Investment: $____________________
Price Per Share: $____________________

SECTION 2 — INVESTOR RIGHTS
2.1 Board Seat: Axal Ventures receives one board seat.
2.2 Information Rights: Monthly financial reports, annual audited financials, and budget.
2.3 Pro-Rata Rights: Right to participate in future financing rounds to maintain ownership.
2.4 Protective Provisions: Investor consent required for:
    (a) Changes to charter or bylaws
    (b) Issuance of new equity or debt above $__________
    (c) Sale of company or substantially all assets
    (d) Changes to board size

SECTION 3 — ECONOMIC TERMS
3.1 Liquidation Preference: 1x non-participating
3.2 Anti-Dilution: Broad-based weighted average
3.3 Dividends: Non-cumulative, when and if declared by the Board

SECTION 4 — OTHER TERMS
4.1 Vesting: Founders subject to 4-year vesting, 1-year cliff
4.2 ESOP: __% reserved for employee option pool (post-money)
4.3 No-Shop Period: ___ days from execution of this Term Sheet
4.4 Governing Law: Delaware

THIS TERM SHEET IS NON-BINDING except for the No-Shop, Confidentiality, and Governing Law provisions.

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'term_sheet' AND is_active = 1 AND length(trim(body_md)) = 0;

-- uk_articles_of_association <- uk_articles_of_association_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'uk_articles_of_association' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'ARTICLES OF ASSOCIATION OF {{company_name}} LIMITED

The Company adopts the Model Articles for private companies
limited by shares contained in Schedule 1 of the Companies (Model
Articles) Regulations 2008, with the following amendments:

PART 1 — INTERPRETATION AND LIMITATION OF LIABILITY
1. Defined terms apply as in the Model Articles.

PART 2 — DIRECTORS
2. Decisions to be taken by the directors by majority vote.
3. Number of directors: minimum 1, maximum 7.

PART 3 — SHARES AND DISTRIBUTIONS
4. Authorised share capital: 10,000 Ordinary Shares of £0.0001 each.
5. Pre-emption rights apply on the issue and transfer of shares.

PART 4 — DECISION-MAKING BY MEMBERS
6. Written resolutions permitted in lieu of meetings.

Adopted: {{incorporation_date}}',
       merge_fields = '["company_name", "incorporation_date"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'uk_articles_of_association' AND is_active = 1 AND length(trim(body_md)) = 0;

-- uk_memorandum_of_association <- uk_memorandum_of_association_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'uk_memorandum_of_association' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'MEMORANDUM OF ASSOCIATION OF {{company_name}} LIMITED

Each subscriber to this memorandum of association wishes to form
a company under the Companies Act 2006 and agrees to become a
member of the company and to take at least one share.

Name of each subscriber                 Signature
________________________                ________________________
________________________                ________________________

Date: {{incorporation_date}}

This memorandum is in the prescribed form for companies limited
by shares per the Companies (Registration) Regulations 2008.',
       merge_fields = '["company_name", "incorporation_date"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'uk_memorandum_of_association' AND is_active = 1 AND length(trim(body_md)) = 0;

-- voting_rights <- voting_rights_v1.md
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by, doc_kind, axal_party)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by, doc_kind, axal_party
  FROM legal_templates
 WHERE slug = 'voting_rights' AND is_active = 1 AND length(trim(body_md)) = 0;
UPDATE legal_templates
   SET body_md = 'INVESTORS'' RIGHTS AGREEMENT

Company: {{company_name}}
Date: ____________________

SECTION 1 — INFORMATION RIGHTS
1.1 Major Investors (holding ___% or more) shall receive:
    (a) Monthly: Unaudited financial statements within 30 days of month-end
    (b) Quarterly: Board-approved financial statements and KPI report
    (c) Annually: Audited financial statements within 120 days of fiscal year-end
    (d) Annual budget at least 30 days before fiscal year

SECTION 2 — REGISTRATION RIGHTS
2.1 Demand Registration: Major Investors may demand registration after ___ years or IPO.
2.2 Piggyback Registration: Investors may participate in any Company-initiated registration.
2.3 S-3 Registration: Available once the Company qualifies for Form S-3.

SECTION 3 — RIGHT OF FIRST REFUSAL & CO-SALE
3.1 The Company and Investors have a right of first refusal on founder share transfers.
3.2 Co-Sale: If founders sell, Investors may sell pro-rata on the same terms.

SECTION 4 — PROTECTIVE PROVISIONS (VOTING)
4.1 Consent of holders of ___% of Preferred Stock required for:
    (a) Amending the Certificate of Incorporation or Bylaws
    (b) Issuing shares senior to or pari passu with Preferred Stock
    (c) Declaring dividends
    (d) Incurring debt above $__________
    (e) Selling the Company or substantially all assets
    (f) Changing board size
    (g) Entering transactions with related parties exceeding $__________

SECTION 5 — BOARD COMPOSITION
5.1 Board shall consist of ___ members:
    (a) ___ designated by holders of Preferred Stock
    (b) ___ designated by holders of Common Stock
    (c) ___ independent members mutually agreed

Signed: ____________________
Date: ____________________',
       merge_fields = '["company_name"]',
       is_stub = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE slug = 'voting_rights' AND is_active = 1 AND length(trim(body_md)) = 0;

-- D758 decision 4: the Operating Partner Agreement (Spin-Out Lab), a counsel stub.
INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
SELECT 'operating_partner_agreement_spin_out_lab', 'Operating Partner Agreement (Spin-Out Lab)', 'gp', '', '[]', 1, 1, 1
 WHERE NOT EXISTS (SELECT 1 FROM legal_templates WHERE slug = 'operating_partner_agreement_spin_out_lab');
