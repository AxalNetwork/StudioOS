-- Task #8 — Seed the D1 legal_templates store (generated).
-- Source: scripts/gen-legal-templates-seed.py — DO NOT hand-edit; re-run the
-- generator after changing backend legal.py templates or worker .md bodies.
-- INSERT OR IGNORE keeps this idempotent and safe to re-apply.

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('operating_agreement', 'Operating Agreement (LLC)', 'gp', 'OPERATING AGREEMENT OF AXAL VENTURES LLC

A Delaware Limited Liability Company

Effective Date: ____________________

ARTICLE I — FORMATION
1.1 The Company is organized as a Delaware LLC under the Delaware LLC Act.
1.2 Company Name: {{company_name}}

ARTICLE II — PURPOSE
2.1 To engage in venture capital investment activities, fund management, and related advisory services.

ARTICLE III — MEMBERS & CAPITAL CONTRIBUTIONS
3.1 Managing Members:
    - Member A: ___% Ownership | Capital Contribution: $__________
    - Member B: ___% Ownership | Capital Contribution: $__________
3.2 Additional capital calls require unanimous consent of Managing Members.

ARTICLE IV — MANAGEMENT & VOTING
4.1 The Company shall be managed by its Managing Members.
4.2 Major Decisions (requiring unanimous vote):
    (a) Admission of new members
    (b) Sale or dissolution of the Company
    (c) Incurrence of debt exceeding $__________
4.3 Ordinary Decisions require simple majority by ownership percentage.

ARTICLE V — DISTRIBUTIONS & CARRIED INTEREST
5.1 Management Fee: 2% of committed capital, paid quarterly.
5.2 Carried Interest: 20% of net profits above the hurdle rate.
5.3 Carried Interest Allocation:
    - Partner A: ___%
    - Partner B: ___%
5.4 Hurdle Rate: 8% preferred return to LPs before carry accrues.

ARTICLE VI — BUY-SELL PROVISIONS
6.1 Right of First Refusal: If a Member wishes to sell, other Members have 30 days to match.
6.2 Drag-Along Rights: Members holding 75% may compel a sale.
6.3 Tag-Along Rights: Minority Members may join any approved sale on the same terms.

ARTICLE VII — DISSOLUTION
7.1 The Company dissolves upon: (a) unanimous vote, (b) judicial decree, or (c) bankruptcy of the Company.

Signed: ____________________
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('carried_interest', 'Carried Interest / Partnership Agreement', 'gp', 'CARRIED INTEREST VESTING AGREEMENT

Company: {{company_name}}
Effective Date: ____________________

SECTION 1 — CARRY POOL ALLOCATION
1.1 Total Carry Pool: 20% of Fund Net Profits
1.2 Allocation among Partners:
    - Partner A: ___% of carry pool
    - Partner B: ___% of carry pool
    - Reserved Pool: ___% (for future partners/key hires)

SECTION 2 — VESTING SCHEDULE
2.1 Vesting Period: 4 years from the Effective Date.
2.2 Cliff: 25% vests after Year 1.
2.3 Monthly Vesting: Remaining 75% vests monthly over Years 2-4.
2.4 Full Acceleration upon Change of Control of the management entity.

SECTION 3 — FORFEITURE & CLAWBACK
3.1 Unvested carry is forfeited upon voluntary departure.
3.2 For-cause termination results in forfeiture of all carry (vested and unvested).
3.3 Clawback: Partners must return excess carry distributions if fund losses exceed a threshold on final wind-down.

SECTION 4 — GOOD LEAVER / BAD LEAVER
4.1 Good Leaver (death, disability, retirement after 5+ years): Retains all vested carry.
4.2 Bad Leaver (resignation before cliff, cause termination): Forfeits all carry.
4.3 Neutral Leaver (resignation after cliff, no cause): Retains vested, forfeits unvested.

Signed: ____________________
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ic_charter', 'Investment Committee Charter', 'gp', 'INVESTMENT COMMITTEE CHARTER

Organization: {{company_name}}
Adopted: ____________________

SECTION 1 — PURPOSE
1.1 The Investment Committee (IC) governs all investment decisions for the Fund.

SECTION 2 — COMPOSITION
2.1 The IC consists of all General Partners.
2.2 A quorum requires the presence of at least ___% of IC members.

SECTION 3 — AUTHORITY & SCOPE
3.1 All investments exceeding $__________ require IC approval.
3.2 Follow-on investments up to $__________ may be approved by the deal lead alone.

SECTION 4 — DECISION PROCESS
4.1 Deal Presentation: The sponsoring partner presents the deal memo, scoring data, and diligence findings.
4.2 Discussion Period: Minimum 48-hour review period for all members.
4.3 Voting: Simple majority approves. Unanimous consent required for investments exceeding $__________.
4.4 Conflicts: Any member with a personal interest in the target must recuse.

SECTION 5 — DOCUMENTATION
5.1 All IC decisions shall be recorded in the meeting minutes.
5.2 Approved deal terms are binding and form the basis for term sheet issuance.

Approved: ____________________
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('service_agreement', 'Partner Service Agreement', 'gp', 'PARTNER SERVICE AGREEMENT

Between: {{company_name}} (the "Company")
And: ____________________ (the "Partner")

Effective Date: ____________________

SECTION 1 — ROLE & RESPONSIBILITIES
1.1 Title: Managing Partner / General Partner
1.2 Duties: Deal sourcing, portfolio management, fundraising, LP relations, and governance.
1.3 Time Commitment: Full-time / Part-time (minimum __ hours/week).

SECTION 2 — COMPENSATION
2.1 Base Salary: $__________ per year, paid from Management Company fees.
2.2 Carried Interest: As specified in the Carried Interest Agreement.
2.3 Expense Reimbursement: Reasonable business expenses reimbursed monthly.

SECTION 3 — NON-COMPETE & NON-SOLICIT
3.1 During the term and for __ months after departure, the Partner shall not:
    (a) Manage or invest through a competing fund.
    (b) Solicit the Company''s LPs or portfolio companies.

SECTION 4 — TERM & TERMINATION
4.1 This Agreement continues until terminated by either party with 90 days written notice.
4.2 For-cause termination is immediate upon material breach, fraud, or felony conviction.

Signed: ____________________
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('lpa', 'Limited Partnership Agreement (LPA)', 'fund', 'LIMITED PARTNERSHIP AGREEMENT

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ppm', 'Private Placement Memorandum (PPM)', 'fund', 'CONFIDENTIAL PRIVATE PLACEMENT MEMORANDUM

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('subscription', 'Subscription Agreement', 'fund', 'SUBSCRIPTION AGREEMENT

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('mgmt_company', 'Management Company Agreement', 'fund', 'MANAGEMENT COMPANY AGREEMENT

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('safe', 'SAFE Agreement', 'portfolio', 'SIMPLE AGREEMENT FOR FUTURE EQUITY (SAFE)

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('term_sheet', 'Term Sheet', 'portfolio', 'TERM SHEET — NON-BINDING

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('bylaws', 'Corporate Bylaws', 'portfolio', 'BYLAWS OF {{company_name}}
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

Adopted: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('equity_split', 'Equity Split Agreement', 'portfolio', 'EQUITY ALLOCATION AGREEMENT

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ip_license', 'IP License Agreement', 'portfolio', 'INTELLECTUAL PROPERTY LICENSE AGREEMENT

Licensor: Axal VC HoldCo
Licensee: {{company_name}}

GRANT OF LICENSE: Licensor grants Licensee a non-exclusive, worldwide license
to use, modify, and commercialize the Licensed IP for the purpose of operating
the Licensee''s business.

CONSIDERATION: In exchange for this license, Licensee agrees to the equity
allocation as specified in the Equity Split Agreement.

TERM: Perpetual, subject to the terms herein.

Signed: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('spa', 'Stock Purchase Agreement (SPA)', 'portfolio', 'STOCK PURCHASE AGREEMENT

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('voting_rights', 'Voting & Investors'' Rights Agreement', 'portfolio', 'INVESTORS'' RIGHTS AGREEMENT

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('form_adv', 'Form ADV / ERA Registration', 'compliance', 'FORM ADV — EXEMPT REPORTING ADVISER (ERA) FILING GUIDE

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('aml_kyc', 'AML/KYC Policy', 'compliance', 'ANTI-MONEY LAUNDERING & KNOW YOUR CUSTOMER POLICY

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('cofounder_agreement', 'Co-Founder Agreement', 'gp', 'CO-FOUNDER AGREEMENT

This Co-Founder Agreement (the "Agreement") is entered into as of {{effective_date}} by
and between the founders of {{company_name}} (the "Company"):

{{founders_block}}

1. EQUITY SPLIT
   The founders agree to the following initial equity allocation, subject to the
   vesting schedule below:

{{equity_block}}

2. VESTING SCHEDULE
   2.1 Vesting Period: {{vesting_years}} years from each founder''s start date.
   2.2 Cliff: {{cliff_months}} months — no equity vests before the cliff date; on the
       cliff date, {{cliff_pct}}% of the founder''s grant vests in a single tranche.
   2.3 Monthly Vesting: The remainder vests in equal monthly installments over the
       remaining vesting period.
   2.4 Acceleration: {{acceleration_clause}}

3. INTELLECTUAL PROPERTY ASSIGNMENT
   3.1 Each founder hereby assigns to the Company all right, title, and interest in
       any work product, inventions, code, designs, trademarks, copyrights, trade
       secrets, and other intellectual property (collectively, "IP") created by the
       founder (a) prior to the date of this Agreement that is related to the
       Company''s business, or (b) during the founder''s involvement with the Company.
   3.2 Each founder represents that no third party (employer, university, prior
       company, government grant) holds claims to such IP, and will execute the
       Company''s standard Proprietary Information & Inventions Assignment (PIIA)
       upon request.
   3.3 Pre-existing IP exclusions: {{ip_exclusions}}

4. DECISION RIGHTS & GOVERNANCE
   4.1 Day-to-day operating decisions are made by {{decision_day_to_day}}.
   4.2 The following matters require unanimous founder consent:
{{unanimous_block}}
   4.3 All other strategic matters require a {{decision_threshold}} vote of the
       founders.
   4.4 Deadlock resolution: {{deadlock_clause}}

5. ROLES & RESPONSIBILITIES
{{roles_block}}

6. COMMITMENT
   6.1 Each founder agrees to devote {{commitment_level}} working time and best
       efforts to the Company.
   6.2 Outside activities (board seats, advisory roles, side projects) must be
       disclosed in writing to the other founders and approved by majority vote.

7. DEPARTURE, BUYOUT & EXIT
   7.1 Voluntary Departure: A departing founder forfeits all unvested equity. The
       Company has a right of first refusal on the founder''s vested shares,
       exercisable within 90 days of departure at fair market value.
   7.2 Termination for Cause: A founder terminated for cause (fraud, breach of
       fiduciary duty, conviction of a felony, material breach of this Agreement)
       forfeits both vested and unvested equity, subject to a payment of par
       value for vested shares.
   7.3 Termination without Cause / Good Reason: The departing founder retains
       vested equity. Acceleration per Section 2.4 may apply.
   7.4 Buyout Right: Upon a Change of Control, all unvested equity accelerates per
       Section 2.4. Pre-Change-of-Control buyouts require {{decision_threshold}}
       founder consent.
   7.5 Right of First Refusal: Founders may not transfer shares to third parties
       without first offering them to the Company and the other founders on the
       same terms.

8. CONFIDENTIALITY & NON-COMPETE
   8.1 Each founder agrees to keep all Company information confidential during and
       for {{confidentiality_years}} years after their involvement.
   8.2 During involvement and for 12 months thereafter, no founder shall directly
       compete with the Company or solicit Company employees, customers, or
       investors.

9. SECTION 83(b) ELECTION
   Each founder is strongly advised to file a Section 83(b) election with the IRS
   within 30 days of receiving restricted stock. Failure to file results in
   significantly higher tax liability and is a common, avoidable disaster. The
   Company will provide a template; the filing is the founder''s personal
   responsibility.

10. DISPUTE RESOLUTION
    10.1 Governing Law: {{governing_law}}.
    10.2 Disputes shall first be resolved by good-faith negotiation, then by
         mediation, then by binding arbitration in {{arbitration_venue}}.

11. ENTIRE AGREEMENT
    This Agreement constitutes the entire agreement among the founders with respect
    to the subject matter and supersedes all prior discussions. It may be amended
    only in writing signed by all founders.

SIGNATURES

{{signature_block}}
', '["acceleration_clause", "arbitration_venue", "cliff_months", "cliff_pct", "commitment_level", "company_name", "confidentiality_years", "deadlock_clause", "decision_day_to_day", "decision_threshold", "effective_date", "equity_block", "founders_block", "governing_law", "ip_exclusions", "roles_block", "signature_block", "unanimous_block", "vesting_years"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('section_83b', 'Section 83(b) Election', 'compliance', 'SECTION 83(b) ELECTION UNDER THE INTERNAL REVENUE CODE

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
Date: ____________________', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('certificate_of_incorporation_de', 'Certificate of Incorporation (Delaware C-Corp)', 'portfolio', 'CERTIFICATE OF INCORPORATION OF {{company_name}}

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
Incorporator', '["company_name", "incorporation_date", "registered_agent_address", "registered_agent_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('stock_purchase_agreement', 'Founders'' Restricted Stock Purchase Agreement', 'portfolio', 'RESTRICTED STOCK PURCHASE AGREEMENT — {{company_name}}

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
{{company_name}}                   Founder', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ein_application_kit', 'IRS EIN Application Kit (Form SS-4)', 'compliance', 'EIN APPLICATION KIT — {{company_name}}

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
   - Register for sales tax / payroll tax as applicable', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('member_consent', 'Initial Member Written Consent', 'gp', 'WRITTEN CONSENT OF THE INITIAL MEMBERS OF {{company_name}}

The undersigned, being all the initial members of {{company_name}},
a {{jurisdiction}} limited liability company, hereby consent to the
following actions:

1. ADOPTION OF OPERATING AGREEMENT.
   The Operating Agreement attached as Exhibit A is hereby adopted.

2. APPOINTMENT OF MANAGER.
   _______________ is appointed as the initial Manager.

3. AUTHORIZATION OF BANK ACCOUNT.
   The Manager is authorized to open bank accounts in the name of
   the Company at any FDIC-insured institution.

4. ISSUANCE OF MEMBERSHIP INTERESTS.
   Membership interests are issued per the schedule on Exhibit B.

Effective: {{incorporation_date}}

____________________________
Initial Member(s)', '["company_name", "incorporation_date", "jurisdiction"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('uk_memorandum_of_association', 'Memorandum of Association (UK Ltd)', 'portfolio', 'MEMORANDUM OF ASSOCIATION OF {{company_name}} LIMITED

Each subscriber to this memorandum of association wishes to form
a company under the Companies Act 2006 and agrees to become a
member of the company and to take at least one share.

Name of each subscriber                 Signature
________________________                ________________________
________________________                ________________________

Date: {{incorporation_date}}

This memorandum is in the prescribed form for companies limited
by shares per the Companies (Registration) Regulations 2008.', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('uk_articles_of_association', 'Articles of Association (UK Ltd) — Model Articles', 'portfolio', 'ARTICLES OF ASSOCIATION OF {{company_name}} LIMITED

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

Adopted: {{incorporation_date}}', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('uk_form_in01_kit', 'UK IN01 Filing Kit (Companies House)', 'compliance', 'COMPANIES HOUSE IN01 FILING KIT — {{company_name}} LIMITED

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
- Set up PAYE if employing staff; consider VAT registration.', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('sg_constitution', 'Company Constitution (Singapore Pte Ltd)', 'portfolio', 'CONSTITUTION OF {{company_name}} PTE. LTD.

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

Adopted: {{incorporation_date}}', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('sg_acra_form_45_kit', 'ACRA Filing Kit — BizFile Incorporation Pack', 'compliance', 'ACRA BIZFILE INCORPORATION KIT — {{company_name}} PTE. LTD.

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
- Apply for sector-specific licenses if regulated activity', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('sg_first_directors_resolution', 'First Directors'' Resolution (Singapore)', 'gp', 'RESOLUTIONS OF THE FIRST DIRECTORS OF {{company_name}} PTE. LTD.

Date: {{incorporation_date}}

The undersigned, being all the directors of {{company_name}} PTE.
LTD. (the "Company"), pass the following written resolutions:

1. ADOPTION OF CONSTITUTION.
   The Constitution lodged with ACRA on incorporation is adopted.

2. APPOINTMENT OF COMPANY SECRETARY.
   _______________ is appointed Company Secretary effective today.

3. REGISTERED OFFICE.
   The registered office is fixed at _______________, Singapore.

4. FINANCIAL YEAR END.
   The financial year end is 31 December.

5. AUDITOR.
   The Company is exempt from audit (small company exemption) and
   no auditor is appointed at this time.

6. BANK ACCOUNT.
   Directors are authorised to open and operate bank accounts at
   _______________ in the Company''s name.

____________________________
Director(s)', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ee_articles_of_association', 'Articles of Association (Estonia OÜ)', 'portfolio', 'ARTICLES OF ASSOCIATION OF {{company_name}} OÜ

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

Adopted: {{incorporation_date}}', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ee_e_residency_application_kit', 'Estonia e-Residency Application Kit', 'compliance', 'E-RESIDENCY APPLICATION KIT — for {{company_name}} founders

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
   - File monthly VAT and annual tax returns via e-Tax Board', '["company_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ee_founding_resolution', 'Founding Resolution (Estonia OÜ)', 'gp', 'FOUNDING RESOLUTION OF {{company_name}} OÜ

Date: {{incorporation_date}}

The founder(s) of {{company_name}} OÜ resolve as follows:

1. ESTABLISHMENT.
   {{company_name}} OÜ is established under the Estonian Commercial
   Code with share capital of EUR 0.01.

2. ARTICLES OF ASSOCIATION.
   The Articles of Association attached as Annex 1 are approved.

3. MANAGEMENT BOARD.
   The following person(s) are appointed to the Management Board:
   _______________

4. CONTRIBUTION.
   The share capital contribution of EUR 0.01 is paid in full / is
   deferred per § 140¹ of the Commercial Code.

5. REGISTERED OFFICE.
   The registered office is _______________, Estonia.

____________________________
Founder(s)', '["company_name", "incorporation_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('tos_v1', 'Terms of Service v1', 'compliance', '# Terms of Service — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Operator:** Axal VC Management LLC, a Delaware limited liability
company ("Axal VC Management" or the "Company")
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
**Axal VC Fund I, LP** (the "Fund"), the Fund is managed exclusively
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

---

By signing electronically below, {{counterparty_name}} acknowledges
having read and agreed to these Terms of Service with Axal VC
Management LLC.
', '["counterparty_email", "counterparty_name", "effective_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('privacy_v1', 'Privacy Policy v1', 'compliance', '# Privacy Notice — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Data Controller:** Axal VC Management LLC, a Delaware limited
liability company ("Axal VC Management" or "we")
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
Axal VC GP LLC (general partner of Axal VC Fund I, LP) — sharing is
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
Officer).

---

By signing electronically below, {{counterparty_name}} acknowledges
having read this Privacy Notice and consents to the processing
described herein by Axal VC Management LLC.
', '["counterparty_email", "counterparty_name", "effective_date"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('founder_nda_v1', 'Founder Mutual NDA v1', 'portfolio', '# Founder Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Founder:** {{founder_name}} ({{founder_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

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

---

Signed electronically by {{founder_name}} and Axal VC Management LLC
on the date(s) appearing below.
', '["effective_date", "founder_email", "founder_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('investor_nda_axal', 'Investor NDA (Axal) v1', 'fund', '# Investor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Fund I, LP)

## 1. Purpose

To enable evaluation of investment opportunities surfaced through the
Axal StudioOS platform, including but not limited to deal screening,
diligence materials, capital-stack data, and pipeline reporting in
respect of portfolio companies and Axal VC Fund I, LP.

## 2. Confidential Information

"Confidential Information" means any non-public information disclosed
by Axal, Axal VC GP LLC, Axal VC Fund I, LP, or any of their
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

---

Signed electronically by {{investor_name}} and Axal VC Management LLC
on the date(s) appearing below.
', '["effective_date", "investor_email", "investor_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('mentor_nda_axal', 'Mentor NDA (Axal) v1', 'gp', '# Mentor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

## 1. Purpose

To enable Mentor to provide guidance, advice, and feedback to founders
and Axal personnel via the StudioOS platform (office hours, mentor
matching, deep-dive reviews).

## 2. Confidentiality

Mentor shall treat as confidential any non-public business, technical,
or strategic information disclosed by founders, portfolio companies,
or Axal in the course of mentorship.

## 3. No Solicitation

For 12 months following the last mentorship interaction, Mentor shall
not solicit any founder or portfolio company introduced through the
platform for non-mentorship engagements without Axal''s written
consent.

## 4. Independent Contractor

Mentor is an independent contractor and not an employee, partner, or
agent of Axal. No remuneration is implied unless agreed in a separate
written instrument.

## 5. Term

This NDA expires 24 months after the Effective Date.

---

Signed electronically by {{mentor_name}} and Axal VC Management LLC
on the date(s) appearing below.
', '["effective_date", "mentor_email", "mentor_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('mentor_engagement_disclaimer', 'Mentor Engagement Disclaimer v1', 'gp', '# Mentor Disclaimer & Acknowledgement

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})

## 1. No professional advice

Guidance provided by Mentor through the Axal StudioOS platform is
informational only and does **not** constitute legal, tax,
accounting, financial, investment, or medical advice. Founders should
consult appropriately licensed professionals before acting on any
suggestion received from a Mentor.

## 2. No fiduciary duty

Mentor''s participation does not create a fiduciary, agency, or
employment relationship between Mentor and any founder, portfolio
company, Axal VC Management LLC, Axal VC Holdings LLC, Axal VC GP
LLC, or Axal VC Fund I, LP.

## 3. No solicitation of securities

Mentorship interactions are not intended to, and shall not be
construed as, an offer to sell or a solicitation to buy any security.

## 4. Mentor representations

Mentor represents that statements made in mentorship sessions are
their personal opinions and not the opinions of any current or former
employer, fund, or board on which Mentor serves.

---

Acknowledged electronically by {{mentor_name}} on the date appearing
below.
', '["effective_date", "mentor_email", "mentor_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('accreditation_v1', 'Accreditation Attestation v1', 'fund', '# Accredited Investor Self-Certification

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})

The undersigned ("Investor") certifies, under penalties of perjury,
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
connection with an investment in Axal VC Fund I, LP, Axal VC GP LLC
(as the Fund''s general partner) in writing if any of the foregoing
ceases to be true. Each such entity is entitled to rely on this
certification and is under no obligation to independently verify
Investor''s status, except as required by Rule 506(c) (in which case
additional documentation may be requested).

---

Signed electronically by {{investor_name}} on the date appearing
below.
', '["accreditation_other", "effective_date", "investor_email", "investor_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_services', 'Partner Services / MSA v1', 'gp', '# Partner Master Services Agreement — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release. **Note:** Deal-specific terms (fees, scope,
> SLAs) are seeded by the Partner Deal flow (X-1) and override the
> defaults below where they conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Partner:** {{partner_name}} ({{partner_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

## 1. Scope

This MSA governs the supply of services by Partner to Axal VC
Management LLC and/or portfolio companies of Axal VC Fund I, LP.
Specific engagements are documented in Statements of Work ("SOWs")
referencing this MSA.

## 2. Fees & Equity

Compensation per engagement is set in the applicable SOW. Equity
compensation, where offered, vests over the schedule defined in the
SOW and is governed by the relevant company''s equity plan documents.
Where the SOW provides for equity in Axal VC Management LLC itself
(e.g., venture-partner equity grants), that equity is issued under
the operating agreement of Axal VC Management LLC. Equity in any
portfolio company is issued by that portfolio company directly.

## 3. IP Ownership

Unless explicitly assigned in the SOW, IP created by Partner during
an engagement is owned by the engaging Axal entity (or portfolio
company). For platform-level work product (i.e., contributions to
the Axal StudioOS codebase, brand assets, or core platform IP),
ownership vests in **Axal VC Holdings LLC** — the entity that holds
the platform''s intellectual property — and is licensed back to Axal
VC Management LLC for operation of the Service. Partner retains
ownership of pre-existing tools and methodologies.

## 4. Confidentiality

Partner is bound by the confidentiality obligations in the Investor
NDA template, incorporated by reference.

## 5. Insurance & Compliance

Partner shall maintain commercially reasonable professional liability
insurance for the engagement and comply with all applicable laws,
including export controls and anti-bribery rules.

## 6. Term & Termination

This MSA continues until terminated by either party on 30 days''
written notice. Active SOWs survive termination of the MSA according
to their own terms.

---

Signed electronically by {{partner_name}} and Axal VC Management LLC
on the date(s) appearing below.
', '["effective_date", "partner_email", "partner_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('nda_3way_founder_investor_axal', '3-Way NDA (Founder ↔ Investor ↔ Axal) v1', 'portfolio', '# Three-Way Mutual NDA — Founder · Investor · Axal

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}

**Parties:**

- **Founder:** {{founder_name}} ({{founder_email}})
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

---

By signing electronically below, each party acknowledges having read,
understood, and agreed to be bound by the terms of this Three-Way
Mutual NDA. The NDA becomes binding only when **all three** parties
have signed.
', '["axal_signer_email", "effective_date", "founder_email", "founder_name", "investor_email", "investor_name"]', 1, 1, 0);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_nda_nonsolicit', 'Partner NDA + Non-Solicit', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_equity', 'Partner Equity Deal', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_revshare', 'Partner Revenue-Share Deal', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_capital', 'Partner Capital Deal', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('partner_custom', 'Partner Custom Deal', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('finders_fee_intro_agreement', 'Finder''s Fee / Intro Agreement', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('ip_background_schedule', 'IP Background Schedule', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('data_access_acknowledgment_admin', 'Data Access Acknowledgment (Admin)', 'compliance', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('investor_subscription_pro', 'Investor Subscription — Pro Tier', 'fund', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('investor_subscription_inst', 'Investor Subscription — Institutional Tier', 'fund', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Subscription Booklet & LPA', 'Subscription Booklet & LPA (LP)', 'fund', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('SPV Joinder Agreement', 'SPV Joinder Agreement (Syndicate)', 'fund', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Co-Investment Side Letter', 'Co-Investment Side Letter', 'fund', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Strategic Side Letter / Focused SPV', 'Strategic Side Letter / Focused SPV (Sector LP)', 'fund', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Founder Collaboration Agreement', 'Founder Collaboration Agreement', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Spin-Out Subsidiary SPA + IP Transfer', 'Spin-Out Subsidiary SPA (Founder)', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Strategic Scale Partnership Agreement', 'Strategic Scale Partnership Agreement', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Technology Integration / JV Agreement', 'Technology Integration / JV (StudioOS AI)', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Referral / Agency Agreement', 'Referral / Agency Agreement (Distribution / GTM)', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('M&A Advisory Mandate', 'M&A Advisory Mandate', 'portfolio', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Venture Share Agreement (FAST)', 'Venture Share Agreement / FAST (Advisor)', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('MSA + Equity-for-Services', 'MSA + Equity-for-Services (Operating Partner)', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Engagement Letter (Spin-Out Package)', 'Engagement Letter (Legal Counsel)', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('White-Label Service Agreement', 'White-Label Service Agreement (Technical Partner)', 'gp', '', '[]', 1, 1, 1);

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES
  ('Secondary Purchase Agreement', 'Secondary Purchase Agreement (Liquidity)', 'portfolio', '', '[]', 1, 1, 1);
