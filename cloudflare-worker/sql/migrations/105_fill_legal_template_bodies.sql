-- Task #29 — Fill the 21 previously-blank legal_templates with authored v1 bodies.
-- Source: scripts/gen-legal-templates-seed.py (FULL_BODY_V1) — DO NOT hand-edit.
-- Stub-gated upsert: existing rows are only overwritten when still a stub
-- (is_stub = 1), so admin-edited (is_stub = 0) rows are never clobbered.
-- Bodies are v1 drafts pending legal review.

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('carried_interest', 'Carried Interest / Partnership Agreement', 'gp', '# Carried Interest Allocation Agreement — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Allocating entity:** Axal VC GP LLC, the general partner of Axal VC Fund I, LP ("Axal GP")
**Recipient:** {{partner.legal_name}}, a {{partner.entity_type}} ("Recipient"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

WHEREAS, Axal GP serves as the general partner of Axal VC Fund I, LP (the "Fund") and is entitled to receive carried interest distributions in respect of the Fund''s investment proceeds; and

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC GP LLC on the date(s) appearing below.
', '["cap_table.vesting_schedule", "effective_date", "governing_law", "partner.carry_pct", "partner.contact_name", "partner.email", "partner.entity_type", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('cofounder_agreement', 'Co-Founder Agreement', 'portfolio', '# Co-Founder Agreement — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** {{company.legal_name}}, a {{company.entity_type}} ("Company")
**Founder:** {{founder.legal_name}}, {{founder.title}} ({{founder.email}})
**Co-Founder:** {{cofounder.legal_name}}, {{cofounder.title}} ({{cofounder.email}})

## Recitals

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

---

Signed electronically by {{founder.legal_name}} and {{cofounder.legal_name}} on the date(s) appearing below.
', '["cap_table.cofounder_shares", "cap_table.founder_pct", "cap_table.founder_shares", "cap_table.option_pool_pct", "cap_table.par_value", "cap_table.vesting_schedule", "cofounder.email", "cofounder.equity_pct", "cofounder.legal_name", "cofounder.title", "company.business_purpose", "company.entity_type", "company.legal_name", "company.short_name", "effective_date", "founder.email", "founder.legal_name", "founder.title", "governing_law"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Engagement Letter (Spin-Out Package)', 'Engagement Letter (Legal Counsel)', 'gp', '# Engagement Letter — Spin-Out Legal Package

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Client:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Counsel:** {{counterparty.legal_name}}, a {{counterparty.entity_type}} ("Counsel"), acting through {{counterparty.signatory_name}}, {{counterparty.signatory_title}} ({{counterparty.email}})

## Recitals

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

---

Signed electronically by {{counterparty.signatory_name}}, for and on behalf of {{counterparty.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["cap_table.option_pool_pct", "cofounder.legal_name", "company.entity_type", "company.legal_name", "counterparty.email", "counterparty.entity_type", "counterparty.legal_name", "counterparty.signatory_name", "counterparty.signatory_title", "effective_date", "founder.legal_name", "governing_law"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('finders_fee_intro_agreement', 'Finder''s Fee / Intro Agreement', 'gp', '# Finder''s Fee / Introduction Agreement — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Finder:** {{counterparty.legal_name}}, a {{counterparty.entity_type}} ("Finder"), acting through {{counterparty.signatory_name}}, {{counterparty.signatory_title}} ({{counterparty.email}})

## Recitals

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

---

Signed electronically by {{counterparty.signatory_name}}, for and on behalf of {{counterparty.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["counterparty.email", "counterparty.entity_type", "counterparty.fee_pct", "counterparty.legal_name", "counterparty.signatory_name", "counterparty.signatory_title", "effective_date", "governing_law"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('sg_first_directors_resolution', 'First Directors'' Resolution (Singapore)', 'gp', '# First Directors'' Resolution (Singapore Pte. Ltd.)

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** {{company.legal_name}}, a private company limited by shares incorporated in the {{company.jurisdiction}} (UEN {{company.registration_number}}) (the "Company")
**Registered office:** {{company.registered_address}}

## Written Resolution of the First Director(s) in Lieu of the First Meeting

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

---

Signed electronically by {{founder.legal_name}}, first director, for and on behalf of {{company.legal_name}}, on the date appearing below.
', '["cap_table.cofounder_shares", "cap_table.founder_shares", "cofounder.legal_name", "cofounder.title", "company.jurisdiction", "company.legal_name", "company.registered_address", "company.registration_number", "effective_date", "founder.legal_name"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ee_founding_resolution', 'Founding Resolution (Estonia OÜ)', 'gp', '# Founding Resolution (Estonia OÜ)

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** {{company.legal_name}}, a private limited company (osaühing) registered in the {{company.jurisdiction}} (registry code {{company.registration_number}}) (the "Company")
**Registered address:** {{company.registered_address}}

## Resolution of the Founder(s) (Asutamisotsus)

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

---

Signed electronically by {{founder.legal_name}}, founder, for and on behalf of {{company.legal_name}}, on the date appearing below.
', '["cap_table.founder_pct", "cofounder.equity_pct", "cofounder.legal_name", "company.business_purpose", "company.jurisdiction", "company.legal_name", "company.registered_address", "company.registration_number", "effective_date", "founder.legal_name"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('member_consent', 'Initial Member Written Consent', 'gp', '# Initial Member Written Consent — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** {{company.legal_name}}, a {{company.entity_type}} (the "Company")
**Registered office:** {{company.registered_address}}

## Action by Written Consent of the Initial Member(s) in Lieu of an Organizational Meeting

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

---

Signed electronically by {{founder.legal_name}}, initial member, for and on behalf of {{company.legal_name}}, on the date appearing below.
', '["cap_table.founder_pct", "cofounder.equity_pct", "cofounder.legal_name", "cofounder.title", "company.entity_type", "company.jurisdiction", "company.legal_name", "company.registered_address", "company.registration_number", "effective_date", "founder.legal_name", "founder.title"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ic_charter', 'Investment Committee Charter', 'gp', '# Investment Committee Charter — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Adopted by:** Axal VC GP LLC, the general partner of Axal VC Fund I, LP ("Axal GP")

## 1. Purpose

This Charter governs the Investment Committee (the "Committee") of Axal GP. The Committee is responsible for approving, declining, and overseeing investments made by Axal VC Fund I, LP (the "Fund") consistent with the Fund''s limited partnership agreement and investment mandate.

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
', '["effective_date", "governing_law", "partner.contact_name", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('MSA + Equity-for-Services', 'MSA + Equity-for-Services (Operating Partner)', 'gp', '# Master Services Agreement — Equity-for-Services

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Operating Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["cap_table.par_value", "cap_table.vesting_schedule", "effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.entity_type", "partner.equity_pct", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('mentor_engagement_disclaimer', 'Mentor Engagement Disclaimer v1', 'gp', '# Mentor Engagement Disclaimer — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Platform operator:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Mentor:** {{partner.legal_name}}, acting through {{partner.contact_name}} ({{partner.email}}), engaged in the capacity of {{partner.role}}

## 1. Nature of the Engagement

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
', '["effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('mentor_nda_axal', 'Mentor NDA (Axal) v1', 'gp', '# Mentor Mutual NDA (Axal) — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Counterparty:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Mentor:** {{partner.legal_name}}, acting through {{partner.contact_name}} ({{partner.email}}), engaged in the capacity of {{partner.role}}

## 1. Purpose

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('operating_agreement', 'Operating Agreement (LLC)', 'gp', '# Operating Agreement (LLC) — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** {{company.legal_name}}, a {{company.entity_type}} (the "Company")
**Registered office:** {{company.registered_address}}

## Article I — Formation

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

---

Signed electronically by {{founder.legal_name}} and {{cofounder.legal_name}} on the date(s) appearing below.
', '["cap_table.founder_pct", "cap_table.option_pool_pct", "cofounder.equity_pct", "cofounder.legal_name", "cofounder.title", "company.business_purpose", "company.entity_type", "company.jurisdiction", "company.legal_name", "company.registered_address", "company.registration_number", "company.short_name", "effective_date", "founder.legal_name", "founder.title", "governing_law"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_capital', 'Partner Capital Deal', 'gp', '# Partner Capital Deal — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

WHEREAS, Partner wishes to participate in Axal''s venture activities by committing capital alongside Axal in the capacity of {{partner.role}}; and

WHEREAS, the parties wish to record the terms of that capital commitment;

NOW, THEREFORE, the parties agree as follows.

## 1. Capital Commitment

1.1 Partner commits to contribute {{partner.capital_commitment}} (the "Commitment") to be deployed across investments selected by Axal in accordance with this Agreement.

1.2 The Commitment is drawn down by Axal through written capital calls, each payable within ten (10) business days of notice.

## 2. Deployment and Co-Investment

2.1 Axal shall deploy the Commitment alongside Axal VC Fund I, LP or its affiliated vehicles on a pro-rata basis, subject to availability and any allocation policy.

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["effective_date", "governing_law", "partner.capital_commitment", "partner.carry_pct", "partner.contact_name", "partner.email", "partner.entity_type", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_custom', 'Partner Custom Deal', 'gp', '# Partner Custom Deal — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release. The economic terms in Section 2 are
> placeholders to be tailored per deal and confirmed in the accompanying
> term schedule.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["cap_table.vesting_schedule", "effective_date", "governing_law", "partner.capital_commitment", "partner.carry_pct", "partner.contact_name", "partner.email", "partner.entity_type", "partner.equity_pct", "partner.legal_name", "partner.revenue_share_pct", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_equity', 'Partner Equity Deal', 'gp', '# Partner Equity Deal — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["cap_table.par_value", "cap_table.vesting_schedule", "effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.entity_type", "partner.equity_pct", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_nda_nonsolicit', 'Partner NDA + Non-Solicit', 'gp', '# Partner NDA + Non-Solicit — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Counterparty:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## 1. Purpose

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.entity_type", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_revshare', 'Partner Revenue-Share Deal', 'gp', '# Partner Revenue-Share Deal — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.entity_type", "partner.legal_name", "partner.revenue_share_pct", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_services', 'Partner Services / MSA v1', 'gp', '# Partner Services Agreement (MSA) — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release. Deal-specific terms (fees, scope, SLAs)
> seeded by the Partner Deal flow override the defaults below where they
> conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}}), engaged in the capacity of {{partner.role}}

## 1. Scope

1.1 This Master Services Agreement governs the supply of services by Partner to Axal and/or the portfolio companies of Axal VC Fund I, LP. Specific engagements are documented in Statements of Work ("SOWs") that reference this Agreement.

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["cap_table.vesting_schedule", "effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.entity_type", "partner.equity_pct", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('service_agreement', 'Partner Service Agreement', 'gp', '# Partner Service Agreement — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Service Provider:** {{counterparty.legal_name}}, a {{counterparty.entity_type}} ("Service Provider"), acting through {{counterparty.signatory_name}}, {{counterparty.signatory_title}} ({{counterparty.email}})

## Recitals

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

---

Signed electronically by {{counterparty.signatory_name}}, for and on behalf of {{counterparty.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["counterparty.email", "counterparty.entity_type", "counterparty.legal_name", "counterparty.signatory_name", "counterparty.signatory_title", "effective_date", "governing_law"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Venture Share Agreement (FAST)', 'Venture Share Agreement / FAST (Advisor)', 'gp', '# Venture Share Agreement (FAST) — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release. It is adapted from the Founder/Advisor
> Standard Template (FAST) concept and is not affiliated with or
> endorsed by its originators.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** {{company.legal_name}}, a {{company.entity_type}} (the "Company")
**Advisor:** {{partner.legal_name}}, acting through {{partner.contact_name}} ({{partner.email}}), serving in the capacity of {{partner.role}}

## Recitals

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by {{company.legal_name}} on the date(s) appearing below.
', '["cap_table.par_value", "cap_table.vesting_schedule", "company.entity_type", "company.legal_name", "effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.equity_pct", "partner.legal_name", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;

INSERT INTO legal_templates
  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('White-Label Service Agreement', 'White-Label Service Agreement (Technical Partner)', 'gp', '# White-Label Service Agreement — Axal StudioOS

> **v1 draft — subject to legal review.** This template is a working
> draft and must be reviewed and approved by qualified counsel before
> execution or public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Company:** Axal VC Management LLC, a Delaware limited liability company ("Axal")
**Technical Partner:** {{partner.legal_name}}, a {{partner.entity_type}} ("Partner"), acting through {{partner.contact_name}} ({{partner.email}})

## Recitals

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

---

Signed electronically by {{partner.contact_name}}, for and on behalf of {{partner.legal_name}}, and by Axal VC Management LLC on the date(s) appearing below.
', '["effective_date", "governing_law", "partner.contact_name", "partner.email", "partner.entity_type", "partner.legal_name", "partner.revenue_share_pct", "partner.role"]', 1, 1, 0)
ON CONFLICT(slug) DO UPDATE SET
  title        = excluded.title,
  category     = excluded.category,
  body_md      = excluded.body_md,
  merge_fields = excluded.merge_fields,
  is_stub      = 0,
  version      = legal_templates.version + 1,
  updated_at   = CURRENT_TIMESTAMP
WHERE legal_templates.is_stub = 1;
