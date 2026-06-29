import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from backend.app.database import get_session
from backend.app.models.entities import Document, Entity, Project, DocumentType, DocumentStatus, User, Section83bTracker, Incorporation
from backend.app.schemas.scoring import DocumentCreate
from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import require_role, ensure_founder_access, is_privileged
from backend.app.services.access_policy import require_contract_view
from datetime import datetime, date
import time

logger = logging.getLogger(__name__)

# Phase 0.1 split — both service-provider partners (e.g. lawyers) and
# investors may view contracts depending on context; route-level access
# stays permissive and per-document predicates in services.access_policy
# narrow as needed.
require_partner = require_role("partner", "investor")

router = APIRouter(prefix="/legal", tags=["Legal & Compliance"])

TEMPLATE_LAYERS = {
    "gp": {
        "label": "Internal Management (GP Level)",
        "description": "Governance, partner economics, and decision-making framework",
    },
    "fund": {
        "label": "Fund Formation (LP Level)",
        "description": "Capital raising, investor agreements, and fund structure",
    },
    "portfolio": {
        "label": "Investment Execution (Portfolio Level)",
        "description": "Templates used when investing into startups",
    },
    "compliance": {
        "label": "Compliance & Regulatory",
        "description": "SEC filings, AML/KYC, and tax elections",
    },
}

TEMPLATES = {
    "operating_agreement": {
        "title": "Operating Agreement (LLC)",
        "layer": "gp",
        "content": """OPERATING AGREEMENT OF AXAL VENTURES LLC

A Delaware Limited Liability Company

Effective Date: ____________________

ARTICLE I — FORMATION
1.1 The Company is organized as a Delaware LLC under the Delaware LLC Act.
1.2 Company Name: {company_name}

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
Date: ____________________""",
    },
    "carried_interest": {
        "title": "Carried Interest / Partnership Agreement",
        "layer": "gp",
        "content": """CARRIED INTEREST VESTING AGREEMENT

Company: {company_name}
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
Date: ____________________""",
    },
    "ic_charter": {
        "title": "Investment Committee Charter",
        "layer": "gp",
        "content": """INVESTMENT COMMITTEE CHARTER

Organization: {company_name}
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
Date: ____________________""",
    },
    "service_agreement": {
        "title": "Partner Service Agreement",
        "layer": "gp",
        "content": """PARTNER SERVICE AGREEMENT

Between: {company_name} (the "Company")
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
    (b) Solicit the Company's LPs or portfolio companies.

SECTION 4 — TERM & TERMINATION
4.1 This Agreement continues until terminated by either party with 90 days written notice.
4.2 For-cause termination is immediate upon material breach, fraud, or felony conviction.

Signed: ____________________
Date: ____________________""",
    },
    "lpa": {
        "title": "Limited Partnership Agreement (LPA)",
        "layer": "fund",
        "content": """LIMITED PARTNERSHIP AGREEMENT

{company_name} VENTURE FUND I, L.P.

SECTION 1 — FORMATION
1.1 The Partnership is formed as a Delaware Limited Partnership.
1.2 General Partner: {company_name} Management LLC
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
Date: ____________________""",
    },
    "ppm": {
        "title": "Private Placement Memorandum (PPM)",
        "layer": "fund",
        "content": """CONFIDENTIAL PRIVATE PLACEMENT MEMORANDUM

{company_name} VENTURE FUND I, L.P.
Date: ____________________

NOTICE: This memorandum is confidential and is provided solely for the purpose of evaluating an investment in the Fund. Distribution to unauthorized persons is prohibited.

SECTION 1 — EXECUTIVE SUMMARY
1.1 Fund: {company_name} Venture Fund I, L.P.
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
Date: ____________________""",
    },
    "subscription": {
        "title": "Subscription Agreement",
        "layer": "fund",
        "content": """SUBSCRIPTION AGREEMENT

{company_name} VENTURE FUND I, L.P.

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
2.5 The Subscriber's commitment does not exceed 10% of the Subscriber's total net worth (recommended).

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
Date: ____________________""",
    },
    "mgmt_company": {
        "title": "Management Company Agreement",
        "layer": "fund",
        "content": """MANAGEMENT COMPANY AGREEMENT

Between: {company_name} Venture Fund I, L.P. (the "Fund")
And: {company_name} Management LLC (the "Manager")

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
4.1 This Agreement is coterminous with the Fund's existence.
4.2 Terminates upon removal of the General Partner as provided in the LPA.

Signed: ____________________
Date: ____________________""",
    },
    "safe": {
        "title": "SAFE Agreement",
        "layer": "portfolio",
        "content": """SIMPLE AGREEMENT FOR FUTURE EQUITY (SAFE)

Company: {company_name}
Investor: ____________________
Purchase Amount: $____________________

This SAFE certifies that in exchange for the payment by the Investor of the Purchase Amount
on or about the date of this SAFE, the Company hereby issues to the Investor the right to
certain shares of the Company's capital stock, subject to the terms set forth below.

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
Date: ____________________""",
    },
    "term_sheet": {
        "title": "Term Sheet",
        "layer": "portfolio",
        "content": """TERM SHEET — NON-BINDING

Company: {company_name}
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
Date: ____________________""",
    },
    "bylaws": {
        "title": "Corporate Bylaws",
        "layer": "portfolio",
        "content": """BYLAWS OF {company_name}
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

Adopted: ____________________""",
    },
    "equity_split": {
        "title": "Equity Split Agreement",
        "layer": "portfolio",
        "content": """EQUITY ALLOCATION AGREEMENT

Company: {company_name}
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
3.1 All shares subject to the Company's Right of First Refusal.
3.2 Founders must execute 83(b) elections within 30 days of grant.

Signed: ____________________
Date: ____________________""",
    },
    "ip_license": {
        "title": "IP License Agreement",
        "layer": "portfolio",
        "content": """INTELLECTUAL PROPERTY LICENSE AGREEMENT

Licensor: Axal VC HoldCo
Licensee: {company_name}

GRANT OF LICENSE: Licensor grants Licensee a non-exclusive, worldwide license
to use, modify, and commercialize the Licensed IP for the purpose of operating
the Licensee's business.

CONSIDERATION: In exchange for this license, Licensee agrees to the equity
allocation as specified in the Equity Split Agreement.

TERM: Perpetual, subject to the terms herein.

Signed: ____________________""",
    },
    "spa": {
        "title": "Stock Purchase Agreement (SPA)",
        "layer": "portfolio",
        "content": """STOCK PURCHASE AGREEMENT

Between: {company_name} (the "Company")
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
5.1 Execution of Investors' Rights Agreement.
5.2 Execution of Voting Agreement.
5.3 Updated Certificate of Incorporation filed with Delaware.

SECTION 6 — MISCELLANEOUS
6.1 Governing Law: Delaware
6.2 Entire Agreement: This SPA and related agreements constitute the full agreement.

Signed: ____________________
Date: ____________________""",
    },
    "voting_rights": {
        "title": "Voting & Investors' Rights Agreement",
        "layer": "portfolio",
        "content": """INVESTORS' RIGHTS AGREEMENT

Company: {company_name}
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
Date: ____________________""",
    },
    "form_adv": {
        "title": "Form ADV / ERA Registration",
        "layer": "compliance",
        "content": """FORM ADV — EXEMPT REPORTING ADVISER (ERA) FILING GUIDE

Organization: {company_name}

SECTION 1 — OVERVIEW
1.1 If {company_name} manages a fund with less than $150M in AUM, it likely qualifies
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
Date: ____________________""",
    },
    "aml_kyc": {
        "title": "AML/KYC Policy",
        "layer": "compliance",
        "content": """ANTI-MONEY LAUNDERING & KNOW YOUR CUSTOMER POLICY

Organization: {company_name}
Effective Date: ____________________
Compliance Officer: ____________________

SECTION 1 — PURPOSE
1.1 This policy establishes procedures to prevent money laundering and terrorist financing
    through the Fund's operations, in compliance with the Bank Secrecy Act and USA PATRIOT Act.

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
Date: ____________________""",
    },
    "cofounder_agreement": {
        "title": "Co-Founder Agreement",
        "layer": "gp",
        "content": """CO-FOUNDER AGREEMENT

This Co-Founder Agreement (the "Agreement") is entered into as of {effective_date} by
and between the founders of {company_name} (the "Company"):

{founders_block}

1. EQUITY SPLIT
   The founders agree to the following initial equity allocation, subject to the
   vesting schedule below:

{equity_block}

2. VESTING SCHEDULE
   2.1 Vesting Period: {vesting_years} years from each founder's start date.
   2.2 Cliff: {cliff_months} months — no equity vests before the cliff date; on the
       cliff date, {cliff_pct}% of the founder's grant vests in a single tranche.
   2.3 Monthly Vesting: The remainder vests in equal monthly installments over the
       remaining vesting period.
   2.4 Acceleration: {acceleration_clause}

3. INTELLECTUAL PROPERTY ASSIGNMENT
   3.1 Each founder hereby assigns to the Company all right, title, and interest in
       any work product, inventions, code, designs, trademarks, copyrights, trade
       secrets, and other intellectual property (collectively, "IP") created by the
       founder (a) prior to the date of this Agreement that is related to the
       Company's business, or (b) during the founder's involvement with the Company.
   3.2 Each founder represents that no third party (employer, university, prior
       company, government grant) holds claims to such IP, and will execute the
       Company's standard Proprietary Information & Inventions Assignment (PIIA)
       upon request.
   3.3 Pre-existing IP exclusions: {ip_exclusions}

4. DECISION RIGHTS & GOVERNANCE
   4.1 Day-to-day operating decisions are made by {decision_day_to_day}.
   4.2 The following matters require unanimous founder consent:
{unanimous_block}
   4.3 All other strategic matters require a {decision_threshold} vote of the
       founders.
   4.4 Deadlock resolution: {deadlock_clause}

5. ROLES & RESPONSIBILITIES
{roles_block}

6. COMMITMENT
   6.1 Each founder agrees to devote {commitment_level} working time and best
       efforts to the Company.
   6.2 Outside activities (board seats, advisory roles, side projects) must be
       disclosed in writing to the other founders and approved by majority vote.

7. DEPARTURE, BUYOUT & EXIT
   7.1 Voluntary Departure: A departing founder forfeits all unvested equity. The
       Company has a right of first refusal on the founder's vested shares,
       exercisable within 90 days of departure at fair market value.
   7.2 Termination for Cause: A founder terminated for cause (fraud, breach of
       fiduciary duty, conviction of a felony, material breach of this Agreement)
       forfeits both vested and unvested equity, subject to a payment of par
       value for vested shares.
   7.3 Termination without Cause / Good Reason: The departing founder retains
       vested equity. Acceleration per Section 2.4 may apply.
   7.4 Buyout Right: Upon a Change of Control, all unvested equity accelerates per
       Section 2.4. Pre-Change-of-Control buyouts require {decision_threshold}
       founder consent.
   7.5 Right of First Refusal: Founders may not transfer shares to third parties
       without first offering them to the Company and the other founders on the
       same terms.

8. CONFIDENTIALITY & NON-COMPETE
   8.1 Each founder agrees to keep all Company information confidential during and
       for {confidentiality_years} years after their involvement.
   8.2 During involvement and for 12 months thereafter, no founder shall directly
       compete with the Company or solicit Company employees, customers, or
       investors.

9. SECTION 83(b) ELECTION
   Each founder is strongly advised to file a Section 83(b) election with the IRS
   within 30 days of receiving restricted stock. Failure to file results in
   significantly higher tax liability and is a common, avoidable disaster. The
   Company will provide a template; the filing is the founder's personal
   responsibility.

10. DISPUTE RESOLUTION
    10.1 Governing Law: {governing_law}.
    10.2 Disputes shall first be resolved by good-faith negotiation, then by
         mediation, then by binding arbitration in {arbitration_venue}.

11. ENTIRE AGREEMENT
    This Agreement constitutes the entire agreement among the founders with respect
    to the subject matter and supersedes all prior discussions. It may be amended
    only in writing signed by all founders.

SIGNATURES

{signature_block}
""",
    },
    "section_83b": {
        "title": "Section 83(b) Election",
        "layer": "compliance",
        "content": """SECTION 83(b) ELECTION UNDER THE INTERNAL REVENUE CODE

Taxpayer: ____________________
SSN: ____________________
Tax Year: ____________________

To: Internal Revenue Service
    [Appropriate IRS Service Center based on taxpayer address]

The undersigned taxpayer hereby makes an election under Section 83(b) of the Internal
Revenue Code with respect to the property described below:

1. PROPERTY DESCRIPTION
   Shares of carried interest / membership units in {company_name}

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
   (b) {company_name} (employer/partnership)
   (c) Taxpayer's personal records

CRITICAL DEADLINE: This election must be filed with the IRS within 30 days of the
transfer date. Failure to file timely results in taxation at ordinary income rates
as the property vests, which can result in significantly higher tax liability.

Signed: ____________________
Date: ____________________""",
    },
}


@router.get("/templates")
def list_templates(user: User = Depends(get_current_user)):
    result = []
    for k, v in TEMPLATES.items():
        result.append({
            "key": k,
            "title": v["title"],
            "layer": v["layer"],
            "layer_label": TEMPLATE_LAYERS[v["layer"]]["label"],
        })
    return result


@router.get("/templates/{template_key}")
def get_template_content(template_key: str, user: User = Depends(get_current_user)):
    template = TEMPLATES.get(template_key)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return {
        "key": template_key,
        "title": template["title"],
        "layer": template["layer"],
        "layer_label": TEMPLATE_LAYERS[template["layer"]]["label"],
        "content": template["content"].replace("{company_name}", "[Company Name]"),
    }


@router.get("/template-layers")
def list_template_layers(user: User = Depends(get_current_user)):
    return [
        {"key": k, "label": v["label"], "description": v["description"]}
        for k, v in TEMPLATE_LAYERS.items()
    ]


@router.post("/documents/generate")
def generate_document(data: DocumentCreate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    # IDOR guard: founders may only generate docs against their own project.
    if data.project_id:
        project = session.get(Project, data.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ensure_founder_access(user, project.founder_id)
    elif not is_privileged(user):
        raise HTTPException(status_code=403, detail="Founders cannot create unattached documents")
    template = TEMPLATES.get(data.doc_type)
    content = data.content
    if template and not content:
        company_name = "NewCo"
        if data.project_id:
            project = session.get(Project, data.project_id)
            if project:
                company_name = project.name
        content = template["content"].replace("{company_name}", company_name)

    from backend.app.services.audit import log_audit, AuditAction
    doc = Document(
        project_id=data.project_id,
        title=data.title or (template["title"] if template else "Untitled"),
        doc_type=data.doc_type,
        status=DocumentStatus.GENERATED,
        content=content,  # kept temporarily so legacy readers still work
        template_name=data.template_name,
    )
    session.add(doc)
    # Flush (not commit) so we can populate uid for the audit row while
    # keeping the contract creation + audit insert in one atomic transaction.
    session.flush()
    log_audit(
        session,
        action=AuditAction.CONTRACT_CREATED,
        actor=user,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"{user.email} generated contract '{doc.title}'",
        meta={"doc_type": data.doc_type, "template": data.template_name, "size": len(content or "")},
    )
    session.commit()
    session.refresh(doc)

    # Persist the rendered body to object storage and clear the inline copy
    # so PII / contract bodies no longer sit in the primary database. This is
    # a *follow-up* migration — the contract row + audit row are already
    # durable above, so a storage failure here is non-fatal.
    if content:
        try:
            from backend.app.services.file_storage import store_contract_bytes
            content_type = "text/html" if ("<html" in content.lower() or "<div" in content.lower() or "<p>" in content.lower()) else "text/plain"
            obj = store_contract_bytes(doc.uid, content.encode("utf-8"), content_type)
            doc.file_key = obj.file_key
            doc.file_size = obj.size
            doc.file_sha256 = obj.sha256
            doc.file_content_type = obj.content_type
            doc.content = None  # canonical copy lives in storage now
            session.add(doc)
            session.commit()
            session.refresh(doc)
        except Exception:  # noqa: BLE001
            # Storage failure must not break legal flows — the inline content
            # remains as a fallback that the download endpoint will migrate
            # on next read.
            pass
    # Route through the redactor for policy consistency: even though a freshly
    # generated doc has no signature data yet, going through `_hydrate_doc_content`
    # guarantees no future field on Document leaks unexpectedly.
    return _hydrate_doc_content(doc, viewer=user, session=session)


def _doc_owner_founder_id(session: Session, doc: Document):
    if not doc.project_id:
        return None
    p = session.get(Project, doc.project_id)
    return p.founder_id if p else None


_DOWNLOAD_URL_TTL_SECONDS = 300  # 5 minutes — short enough to limit replay


def _hydrate_doc_content(
    doc: Document,
    viewer: Optional[User] = None,
    session: Optional[Session] = None,
    *,
    embed_content: bool = False,
) -> dict:
    """Build the wire-shape for a Document.

    Security Item #8 — storage cleanup
    -----------------------------------
    The full contract body is **never** returned inline in HTTP responses.
    Instead we emit:

        * `file_key`             — opaque object-storage key (already there)
        * `content_url`          — short-lived (5 min) HMAC-signed URL the
                                   browser can hit to download the body via
                                   `/api/files/contracts/{token}`
        * `content_url_expires_at` (epoch seconds)

    The download endpoint forces `Content-Disposition: attachment` and
    `Cache-Control: no-store` so the body never persists in browser
    cache or page memory beyond the active download.

    `embed_content=True` is reserved for **in-process** callers (e.g.
    PDF rendering) that need the raw text. Route handlers must keep the
    default (False) so the body never crosses the wire as JSON.

    `file_sha256` (legal-proof integrity hash) is also dropped — it's
    admin-only material; admins can fetch the canonical file via the
    download URL and recompute if needed.

    When `viewer` is supplied, the result is also passed through the
    signature redactor so admin-only proof fields (`signed_ip`) are stripped
    and `signed_by` is masked for non-privileged callers.
    """
    data = doc.dict() if hasattr(doc, "dict") else doc.model_dump()

    # Always strip the inline body and integrity hash from JSON responses.
    # `file_size` stays so the UI can render "12 KB" badges.
    data.pop("content", None)
    data.pop("file_sha256", None)

    # Mint a short-lived download URL when storage has the file.
    if doc.file_key:
        try:
            from backend.app.services.file_storage import (
                get_storage,
                mint_signed_token,
            )
            actor = getattr(viewer, "email", None)
            token = mint_signed_token(
                doc.file_key,
                ttl_seconds=_DOWNLOAD_URL_TTL_SECONDS,
                actor=actor,
            )
            data["content_url"] = f"/api/files/contracts/{token}"
            data["content_url_expires_at"] = int(time.time()) + _DOWNLOAD_URL_TTL_SECONDS
            data["content_url_ttl_seconds"] = _DOWNLOAD_URL_TTL_SECONDS

            # In-process callers (PDF render, etc.) opt-in to raw bytes.
            if embed_content:
                try:
                    data["content"] = get_storage().get(doc.file_key).decode(
                        "utf-8", errors="replace"
                    )
                except Exception:  # noqa: BLE001
                    data["content"] = ""
        except Exception:  # noqa: BLE001
            # Storage/token issuance failure must not break the JSON
            # response — frontend just won't render a download link.
            data.setdefault("content_url", None)

    if viewer is not None:
        from backend.app.services.signatures import redact_signature_for_viewer
        # Resolve owner founder so the redactor can recognise founder owners
        # and not mask their own signature email. Requires `session` because
        # ownership lives on the parent Project row.
        owner_founder_id = None
        if session is not None and doc.project_id:
            try:
                owner_founder_id = _doc_owner_founder_id(session, doc)
            except Exception:  # noqa: BLE001
                owner_founder_id = None
        redact_signature_for_viewer(
            data,
            viewer=viewer,
            owner_founder_id=owner_founder_id,
        )
    return data


@router.get("/documents")
def list_documents(project_id: int = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Document).order_by(Document.created_at.desc())
    # IDOR guard: founders only see documents tied to their own projects.
    if not is_privileged(user):
        if not user.founder_id:
            return []
        stmt = stmt.join(Project, Project.id == Document.project_id).where(Project.founder_id == user.founder_id)
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)
    docs = session.exec(stmt).all()
    # List view: omit the full document body and integrity hash. Callers
    # fetch /documents/{id} for the full record.
    return [
        _hydrate_doc_content(d, viewer=user, session=session)
        for d in docs
    ]


@router.get("/documents/{doc_id}")
def get_document(
    doc: Document = Depends(require_contract_view),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Access control enforced by `require_contract_view` (Rule 1, see
    # backend/app/services/access_policy.py).
    from backend.app.services.audit import log_audit, AuditAction
    # Mirror the admin-side viewed event so founder/user reads of contract
    # content are also auditable. commit=True because GET has no own txn.
    log_audit(
        session,
        action=AuditAction.CONTRACT_VIEWED,
        actor=user,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"{user.email} viewed contract '{doc.title}'",
        meta={"status": str(doc.status), "doc_type": doc.doc_type, "via": "legal.get_document"},
        commit=True,
    )
    return _hydrate_doc_content(doc, viewer=user, session=session)


# ---------------------------------------------------------------------------
# Task #44 — Dev stub for the Cloudflare Worker route
# `POST /api/legal/esign/send`. The admin "+ New envelope" wizard
# (frontend NewEnvelopeWizard) calls this to mint an envelope. In
# production it lives on the worker against `esign_envelopes` + R2; the
# dev FastAPI backend doesn't host that machinery, so we persist a
# `documents` row instead so the new envelope shows up in the unified
# Admin > Contracts list (`GET /admin/contracts`).
#
# We store the actual document_type (e.g. `investor_nda_axal`) in
# `template_name` because `Document.doc_type` is a strict enum that
# doesn't (and shouldn't) include the Y/X/W extension types. The admin
# list endpoint resolves the logical kind via `template_name` first when
# applying party-role / doc-type filters (see admin_contracts._doc_kind).
# ---------------------------------------------------------------------------
import uuid as _esign_uuid

# Friendly titles for the legal-template catalog. Mirrors
# `cloudflare-worker/src/routes/admin_contracts.ts` TEMPLATES.
_LEGAL_TEMPLATE_TITLES: dict[str, str] = {
    "tos_v1": "Terms of Service",
    "privacy_v1": "Privacy Policy",
    "founder_nda_v1": "Founder Mutual NDA",
    "investor_nda_axal": "Investor NDA (Axal)",
    "mentor_nda_axal": "Mentor NDA (Axal)",
    "mentor_engagement_disclaimer": "Mentor Engagement Disclaimer",
    "accreditation_v1": "Accreditation Attestation",
    "partner_services": "Partner Services Agreement",
    "nda_3way_founder_investor_axal": "3-Way NDA (Founder ↔ Investor ↔ Axal)",
}


class _EsignSendRequest(BaseModel):
    document_type: str
    recipient_email: str
    recipient_name: Optional[str] = None
    recipient_user_id: Optional[int] = None
    deal_id: Optional[int] = None
    merge_fields: Optional[dict] = None
    provider: Optional[str] = "native"
    via_provider: Optional[str] = None  # legacy alias accepted by the worker


@router.post("/esign/send")
def esign_send(
    body: _EsignSendRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Dev stub for the worker's `/legal/esign/send` route.

    Creates a `documents` row representing the envelope so the unified
    Admin > Contracts list picks it up. Never actually sends an email —
    the dev backend has no transactional-email integration. Returns the
    same shape as the worker for frontend parity.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admins only")

    document_type = (body.document_type or "").strip()
    if not document_type:
        raise HTTPException(status_code=400, detail="document_type is required")

    recipient_email = (body.recipient_email or "").strip().lower()
    import re as _re
    if not recipient_email or not _re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", recipient_email):
        raise HTTPException(status_code=400, detail="valid recipient_email is required")

    provider = (body.provider or body.via_provider or "native").lower()
    if provider not in ("native", "docusign"):
        provider = "native"
    if provider == "docusign":
        # Studio-tier feature with no dev backend equivalent — surface
        # explicitly rather than silently downgrading.
        raise HTTPException(status_code=412, detail="docusign_not_connected")

    title = _LEGAL_TEMPLATE_TITLES.get(document_type, document_type)
    envelope_uuid = _esign_uuid.uuid4().hex

    # `Document.project_id` has a FK to projects.id — only carry deal_id
    # forward when it actually points at a real project, otherwise the
    # commit raises IntegrityError and surfaces as a confusing 500.
    project_id = None
    if body.deal_id:
        if session.get(Project, body.deal_id):
            project_id = body.deal_id

    doc = Document(
        title=title,
        # Strict enum doesn't carry the Y/X/W extension types; use OTHER
        # and stash the real key in `template_name` (admin list resolves
        # the logical kind from there).
        doc_type=DocumentType.OTHER,
        status=DocumentStatus.SENT,
        template_name=document_type,
        signed_by=recipient_email,  # `_recipient_email` reads this for the row
        project_id=project_id,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    try:
        from backend.app.services.audit import log_audit, AuditAction
        log_audit(
            session,
            action=AuditAction.CONTRACT_SENT,
            actor=user,
            target_uid=doc.uid,
            project_id=doc.project_id,
            summary=f"Admin {user.email} sent envelope '{title}' to {recipient_email}",
            meta={"document_type": document_type, "provider": provider, "envelope_uuid": envelope_uuid},
            commit=True,
        )
    except Exception:  # noqa: BLE001
        session.rollback()

    return {
        "envelope_id": doc.id,
        "envelope_uuid": envelope_uuid,
        "signing_url": None,  # dev backend has no native-signing UI
        "email_sent": False,  # dev backend has no transactional email
        "provider": "native",
    }


@router.post("/documents/{doc_id}/send")
def send_document(
    doc: Document = Depends(require_contract_view),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Access control enforced by `require_contract_view` (Rule 1).
    from backend.app.services.audit import log_audit, AuditAction
    prev_status = str(doc.status)
    doc.status = DocumentStatus.SENT
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    log_audit(
        session,
        action=AuditAction.CONTRACT_SENT,
        actor=user,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"{user.email} sent contract '{doc.title}'",
        meta={"prev_status": prev_status, "new_status": "sent", "doc_type": doc.doc_type},
    )
    session.commit()
    session.refresh(doc)
    return {"status": "sent", "document": _hydrate_doc_content(doc, viewer=user, session=session)}


class SignDocumentRequest(BaseModel):
    """Body for the sign endpoint.

    `on_behalf_of` is *only* honoured for admins / partners. For everyone
    else, the signer is unconditionally the authenticated user — preventing
    an authenticated founder from signing a contract under someone else's
    name."""
    on_behalf_of: Optional[str] = None


@router.post("/documents/{doc_id}/sign")
def sign_document(
    body: Optional[SignDocumentRequest] = None,
    request: Request = None,
    doc: Document = Depends(require_contract_view),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Access control enforced by `require_contract_view` (Rule 1) — loads
    # doc and asserts founder ownership / privileged role before this body.
    from backend.app.services.audit import log_audit, AuditAction
    from backend.app.services.signatures import derive_signer_email
    # Limited-access gate: a user with access_level='limited' can browse
    # but is explicitly NOT permitted to sign binding agreements until
    # KYC is approved. Admins always pass through. Mirrors the worker
    # gate on /api/legal/esign/sign/:token and /api/funds/lps/.../sign-lpa.
    if (
        getattr(user, "role", None) != "admin"
        and getattr(user, "access_level", None) == "limited"
        and getattr(user, "kyc_status", None) != "approved"
    ):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Limited access — please complete KYC verification before signing legal agreements.",
                "code": "kyc_required_for_signing",
            },
        )
    # Reject re-signing or signing voided contracts — signatures must be
    # immutable once recorded.
    if doc.status == DocumentStatus.SIGNED:
        raise HTTPException(status_code=409, detail="Document is already signed")
    if doc.status == DocumentStatus.VOID:
        raise HTTPException(status_code=409, detail="Cannot sign a voided document")

    # Resolve the legal signer. Non-privileged callers always sign as
    # themselves regardless of any `on_behalf_of` they try to set.
    requested_obo = (body.on_behalf_of if body else None)
    signer_email = derive_signer_email(
        actor=user,
        requested_on_behalf_of=requested_obo,
        actor_is_privileged=is_privileged(user),
    )

    # Capture client IP as legal-proof evidence (admin-only-visible field).
    client_ip = None
    if request is not None and request.client is not None:
        client_ip = request.client.host

    prev_status = str(doc.status)
    doc.status = DocumentStatus.SIGNED
    doc.signed_by = signer_email
    doc.signed_at = datetime.utcnow()
    doc.signed_ip = client_ip
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    log_audit(
        session,
        action=AuditAction.CONTRACT_SIGNED,
        actor=user,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"{user.email} signed contract '{doc.title}' as {signer_email}",
        meta={
            "prev_status": prev_status,
            "signer_email": signer_email,
            "actor_email": user.email,
            "on_behalf_of": bool(requested_obo) and is_privileged(user),
            "doc_type": doc.doc_type,
            "ip": client_ip,
        },
    )
    session.commit()
    session.refresh(doc)
    return {"status": "signed", "document": _hydrate_doc_content(doc, viewer=user, session=session)}


# --------------------------------------------------------------------------
# Task #30 — Jurisdiction Wizard + Incorporation Flow
# --------------------------------------------------------------------------
# Static catalogue of supported jurisdictions. Each entry drives both the
# `/jurisdictions` API (UI explainer) and the `/incorporate/wizard` doc
# generator (which template keys to fill). Costs are typical 2025 ranges
# in USD; precise quotes belong in the partner-facing surface, not here.
JURISDICTIONS = {
    "us_de_ccorp": {
        "id": "us_de_ccorp",
        "label": "Delaware C-Corp",
        "country": "United States",
        "country_code": "US",
        "entity_type": "C Corporation",
        "summary": "The default for VC-backed startups. Mature case law, frictionless preferred-stock rounds, and accepted by every US institutional investor.",
        "est_cost_usd": [500, 1500],
        "time_to_form_days": [1, 7],
        "fundraising_friendly": True,
        "atlas_supported": True,
        "best_for": ["VC-backed software", "Stock options for global team", "Future US listing"],
        "pros": [
            "Stripe Atlas / Clerky one-click incorporation",
            "Universally accepted by US VCs (preferred stock, SAFEs, convertibles)",
            "Predictable Delaware Chancery Court for disputes",
        ],
        "cons": [
            "21% federal corporate tax + Delaware franchise tax (min ~$450/yr)",
            "Annual filings + registered agent (~$100/yr)",
            "Double taxation on dividends",
        ],
        "tax_summary": "21% federal corporate income tax. State tax depends on where you operate. Delaware franchise tax: $400–$1,750 typical for early-stage.",
        "templates": ["certificate_of_incorporation_de", "bylaws", "stock_purchase_agreement", "section_83b"],
    },
    "us_de_llc": {
        "id": "us_de_llc",
        "label": "Delaware LLC",
        "country": "United States",
        "country_code": "US",
        "entity_type": "Limited Liability Company",
        "summary": "Pass-through taxation, simple operating agreement. Great for bootstrapped/cash-flow businesses; harder to take VC.",
        "est_cost_usd": [300, 800],
        "time_to_form_days": [1, 5],
        "fundraising_friendly": False,
        "atlas_supported": False,
        "best_for": ["Cash-flow / agency businesses", "Holding companies", "Solo founders not raising VC"],
        "pros": [
            "Pass-through taxation — no entity-level tax",
            "Flexible operating agreement (any economics you want)",
            "Lower compliance burden than C-Corp",
        ],
        "cons": [
            "Most institutional VCs cannot invest in LLCs",
            "Self-employment tax on member distributions",
            "Converting to C-Corp later is taxable + costly",
        ],
        "tax_summary": "Pass-through to members' personal returns. No entity-level federal tax. DE franchise tax flat $300/yr.",
        "templates": ["operating_agreement", "ein_application_kit", "member_consent"],
    },
    "uk_ltd": {
        "id": "uk_ltd",
        "label": "UK Private Limited (Ltd)",
        "country": "United Kingdom",
        "country_code": "GB",
        "entity_type": "Private Limited Company",
        "summary": "Fast (often same-day), cheap, and credible for European VCs. SEIS/EIS tax incentives are a major pull for UK angel investors.",
        "est_cost_usd": [50, 250],
        "time_to_form_days": [1, 3],
        "fundraising_friendly": True,
        "atlas_supported": False,
        "best_for": ["UK / EU customer base", "SEIS/EIS-eligible angel rounds", "Founders based in UK"],
        "pros": [
            "Companies House filing fee ~£50; same-day incorporation possible",
            "SEIS (50%) + EIS (30%) income-tax relief unlocks UK angel capital",
            "25% corporation tax (lower for small profits)",
        ],
        "cons": [
            "US institutional VCs may insist on a US flip later",
            "Public director/PSC register (limited privacy)",
            "Confirmation statement + accounts every year",
        ],
        "tax_summary": "Corporation tax 25% (19% small-profits rate up to £50k). VAT registration required above £90k turnover.",
        "templates": ["uk_memorandum_of_association", "uk_articles_of_association", "uk_form_in01_kit"],
    },
    "sg_pte": {
        "id": "sg_pte",
        "label": "Singapore Pte Ltd",
        "country": "Singapore",
        "country_code": "SG",
        "entity_type": "Private Limited (Pte. Ltd.)",
        "summary": "Asia's hub for cross-border venture. Strong rule of law, English-language filings, attractive territorial tax with startup tax exemption.",
        "est_cost_usd": [600, 1500],
        "time_to_form_days": [1, 5],
        "fundraising_friendly": True,
        "atlas_supported": False,
        "best_for": ["APAC market entry", "Cross-border SaaS / fintech", "Holding co for regional ops"],
        "pros": [
            "Startup Tax Exemption: 75% off first S$100k profits for 3 years",
            "17% headline corporate tax — among the lowest in developed Asia",
            "Strong IP regime + extensive tax treaties",
        ],
        "cons": [
            "Requires at least one Singapore-resident director (nominee director ~$2k/yr)",
            "Annual ACRA + IRAS filings",
            "Bank account opening can take 2–4 weeks",
        ],
        "tax_summary": "17% corporate tax with effective rate ~4–8% in years 1–3 due to startup exemptions. Territorial — foreign-sourced income often not taxed.",
        "templates": ["sg_constitution", "sg_acra_form_45_kit", "sg_first_directors_resolution"],
    },
    "ee_oy": {
        "id": "ee_oy",
        "label": "Estonia OÜ (e-Residency)",
        "country": "Estonia",
        "country_code": "EE",
        "entity_type": "Osaühing (Private Limited)",
        "summary": "Fully remote incorporation via e-Residency. Famously simple: 0% corporate tax on retained earnings, only taxed when distributed.",
        "est_cost_usd": [200, 500],
        "time_to_form_days": [3, 14],
        "fundraising_friendly": False,
        "atlas_supported": False,
        "best_for": ["Distributed / remote-first teams", "Bootstrapped EU SaaS", "Crypto / digital-product companies"],
        "pros": [
            "0% corporate tax on retained / reinvested earnings",
            "100% online: incorporate, sign, file taxes from anywhere with the e-Residency card",
            "EU-member status — single market access",
        ],
        "cons": [
            "20% distribution tax when paying dividends (14% for regular distributions)",
            "Most US/EU institutional VCs prefer DE C-Corp or UK Ltd",
            "Must apply for e-Residency first (6–8 weeks, ~€100)",
        ],
        "tax_summary": "0% on retained earnings. 20/80 distribution tax (effectively 20%) on dividends. 14/86 reduced rate for regular dividends.",
        "templates": ["ee_articles_of_association", "ee_e_residency_application_kit", "ee_founding_resolution"],
    },
}


# Jurisdiction-specific document template stubs. These are intentionally
# concise placeholders — operators replace with vetted counsel-reviewed
# text per jurisdiction. The {company_name} / {jurisdiction} placeholders
# are filled at generation time below.
_JURISDICTION_TEMPLATES = {
    "certificate_of_incorporation_de": {
        "title": "Certificate of Incorporation (Delaware C-Corp)",
        "layer": "portfolio",
        "content": """CERTIFICATE OF INCORPORATION OF {company_name}

A Delaware Corporation

FIRST. The name of the corporation is {company_name}.

SECOND. The Registered Office in Delaware is c/o {registered_agent_name},
        located at {registered_agent_address}, County of New Castle, Delaware.

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
{incorporation_date}.

____________________________
Incorporator""",
    },
    "stock_purchase_agreement": {
        "title": "Founders' Restricted Stock Purchase Agreement",
        "layer": "portfolio",
        "content": """RESTRICTED STOCK PURCHASE AGREEMENT — {company_name}

This Restricted Stock Purchase Agreement (the "Agreement") is entered
into on {incorporation_date} between {company_name}, a Delaware
corporation (the "Company"), and the Founder identified on Exhibit A
(the "Purchaser").

1. PURCHASE OF SHARES.
   Purchaser hereby purchases _______ shares of the Company's Common
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
{company_name}                   Founder""",
    },
    "ein_application_kit": {
        "title": "IRS EIN Application Kit (Form SS-4)",
        "layer": "compliance",
        "content": """EIN APPLICATION KIT — {company_name}

This kit walks you through obtaining an Employer Identification
Number (EIN) for {company_name} from the Internal Revenue Service.

1. ELIGIBILITY
   Form SS-4 may be filed online at irs.gov/EIN if the responsible
   party has a US SSN or ITIN. Otherwise, fax/mail Form SS-4.

2. REQUIRED INFORMATION
   - Legal name: {company_name}
   - Trade name (DBA): _______________
   - Mailing address: _______________
   - Responsible party (full legal name + SSN/ITIN): _______________
   - Reason for applying: Started a new business
   - Date business started: {incorporation_date}
   - Closing month of accounting year: December
   - Highest number of employees expected in next 12 months: _______

3. NEXT STEPS AFTER RECEIVING EIN
   - Open a US business bank account
   - Apply for state tax IDs where you will operate
   - Register for sales tax / payroll tax as applicable""",
    },
    "member_consent": {
        "title": "Initial Member Written Consent",
        "layer": "gp",
        "content": """WRITTEN CONSENT OF THE INITIAL MEMBERS OF {company_name}

The undersigned, being all the initial members of {company_name},
a {jurisdiction} limited liability company, hereby consent to the
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

Effective: {incorporation_date}

____________________________
Initial Member(s)""",
    },
    "uk_memorandum_of_association": {
        "title": "Memorandum of Association (UK Ltd)",
        "layer": "portfolio",
        "content": """MEMORANDUM OF ASSOCIATION OF {company_name} LIMITED

Each subscriber to this memorandum of association wishes to form
a company under the Companies Act 2006 and agrees to become a
member of the company and to take at least one share.

Name of each subscriber                 Signature
________________________                ________________________
________________________                ________________________

Date: {incorporation_date}

This memorandum is in the prescribed form for companies limited
by shares per the Companies (Registration) Regulations 2008.""",
    },
    "uk_articles_of_association": {
        "title": "Articles of Association (UK Ltd) — Model Articles",
        "layer": "portfolio",
        "content": """ARTICLES OF ASSOCIATION OF {company_name} LIMITED

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

Adopted: {incorporation_date}""",
    },
    "uk_form_in01_kit": {
        "title": "UK IN01 Filing Kit (Companies House)",
        "layer": "compliance",
        "content": """COMPANIES HOUSE IN01 FILING KIT — {company_name} LIMITED

Filing fee: £50 standard (24h) or £78 same-day.

REQUIRED INFORMATION
1. Proposed company name: {company_name} Limited
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
- Set up PAYE if employing staff; consider VAT registration.""",
    },
    "sg_constitution": {
        "title": "Company Constitution (Singapore Pte Ltd)",
        "layer": "portfolio",
        "content": """CONSTITUTION OF {company_name} PTE. LTD.

Adopted in accordance with Section 32 of the Companies Act 1967.

1. NAME. The name of the Company is {company_name} PTE. LTD.

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

Adopted: {incorporation_date}""",
    },
    "sg_acra_form_45_kit": {
        "title": "ACRA Filing Kit — BizFile Incorporation Pack",
        "layer": "compliance",
        "content": """ACRA BIZFILE INCORPORATION KIT — {company_name} PTE. LTD.

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
- Apply for sector-specific licenses if regulated activity""",
    },
    "sg_first_directors_resolution": {
        "title": "First Directors' Resolution (Singapore)",
        "layer": "gp",
        "content": """RESOLUTIONS OF THE FIRST DIRECTORS OF {company_name} PTE. LTD.

Date: {incorporation_date}

The undersigned, being all the directors of {company_name} PTE.
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
   _______________ in the Company's name.

____________________________
Director(s)""",
    },
    "ee_articles_of_association": {
        "title": "Articles of Association (Estonia OÜ)",
        "layer": "portfolio",
        "content": """ARTICLES OF ASSOCIATION OF {company_name} OÜ

Adopted in accordance with the Estonian Commercial Code.

§1. BUSINESS NAME. The business name is "{company_name} OÜ".

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

Adopted: {incorporation_date}""",
    },
    "ee_e_residency_application_kit": {
        "title": "Estonia e-Residency Application Kit",
        "layer": "compliance",
        "content": """E-RESIDENCY APPLICATION KIT — for {company_name} founders

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
   - File monthly VAT and annual tax returns via e-Tax Board""",
    },
    "ee_founding_resolution": {
        "title": "Founding Resolution (Estonia OÜ)",
        "layer": "gp",
        "content": """FOUNDING RESOLUTION OF {company_name} OÜ

Date: {incorporation_date}

The founder(s) of {company_name} OÜ resolve as follows:

1. ESTABLISHMENT.
   {company_name} OÜ is established under the Estonian Commercial
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
Founder(s)""",
    },
}

# Merge into the master TEMPLATES dict so all existing endpoints
# (templates listing, single-template fetch, generate_document, document
# rendering) just work.
TEMPLATES.update(_JURISDICTION_TEMPLATES)


@router.get("/jurisdictions")
def list_jurisdictions(user: User = Depends(get_current_user)):
    """Static catalogue powering the /incorporate wizard's compare table."""
    return {"jurisdictions": list(JURISDICTIONS.values())}


class IncorporateWizardRequest(BaseModel):
    project_id: int
    jurisdiction_id: str
    company_name: str
    registered_agent_name: Optional[str] = None
    registered_agent_address: Optional[str] = None
    intent_notes: Optional[str] = None


@router.post("/incorporate/wizard")
def incorporate_wizard(
    body: IncorporateWizardRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Task #30 / Task #11 — Jurisdiction-aware incorporation hand-off.

    NOTE: This endpoint is now admin-only. The founder-facing paid flow
    is via POST /incorporate/checkout (Stripe Checkout). The free wizard
    is retained for doc-gen reuse by the downstream packet pipeline.

    1. Validates the chosen jurisdiction and admin access.
    2. Creates an `Entity` row with the right jurisdiction + status.
    3. Generates the jurisdiction-specific document set into Documents.
    4. For Delaware C-Corp, returns a `stripe_atlas` hand-off block.
    """
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role != "admin":
        raise HTTPException(status_code=403, detail="This endpoint is now admin-only. Founders must use the paid checkout flow.")
    j = JURISDICTIONS.get(body.jurisdiction_id)
    if not j:
        raise HTTPException(status_code=400, detail=f"Unknown jurisdiction: {body.jurisdiction_id}")
    if not body.company_name or not body.company_name.strip():
        raise HTTPException(status_code=400, detail="company_name is required")

    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Access: admin/partner OR the founder bound to this specific project.
    # Investors are NOT permitted to mutate entity/legal state for projects
    # they don't own. We deliberately bypass `ensure_founder_access` here
    # because its `is_privileged` helper still treats investors as
    # privileged for read-path back-compat — that would be a cross-project
    # IDOR on this write path.
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role not in ("admin", "partner"):
        owns_project = (
            project.founder_id is not None
            and getattr(user, "founder_id", None) == project.founder_id
        )
        if not owns_project:
            raise HTTPException(status_code=403, detail="Forbidden: you do not own this project")

    # Idempotency: if the project is already incorporated in this
    # jurisdiction, return the existing entity + docs rather than
    # double-billing the documents table.
    existing_entity = session.get(Entity, project.entity_id) if project.entity_id else None
    reused_entity = bool(existing_entity and (existing_entity.jurisdiction or "").lower() == j["label"].lower())

    if reused_entity:
        entity = existing_entity
    else:
        entity = Entity(
            name=body.company_name.strip(),
            entity_type="subsidiary",
            jurisdiction=j["label"],
            incorporation_date=datetime.utcnow().date(),
            status="forming",
        )
        session.add(entity)
        session.commit()
        session.refresh(entity)
        project.entity_id = entity.id
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()

    # Generate jurisdiction-specific documents.
    from backend.app.services.file_storage import store_contract_bytes
    fill = {
        "company_name": body.company_name.strip(),
        "jurisdiction": j["label"],
        "incorporation_date": datetime.utcnow().date().isoformat(),
        "registered_agent_name": body.registered_agent_name or "[Registered Agent]",
        "registered_agent_address": body.registered_agent_address or "[Registered Agent Address]",
    }
    # Map jurisdiction template keys → DocumentType enum (which is a
    # Postgres enum and must match an existing value). Anything not in
    # the enum stores as DocumentType.OTHER and the actual template key
    # is preserved in `template_name` for dedup + display.
    _ALLOWED_DT = {dt.value for dt in DocumentType}
    generated: list[dict] = []
    for tkey in j["templates"]:
        template = TEMPLATES.get(tkey)
        if not template:
            continue
        doc_type_value = tkey if tkey in _ALLOWED_DT else DocumentType.OTHER.value

        # Dedup by `template_name` (the real key), since multiple
        # jurisdiction docs share doc_type=OTHER.
        already = session.exec(
            select(Document).where(
                Document.project_id == project.id,
                Document.template_name == tkey,
            )
        ).first()
        if already:
            generated.append({"id": already.id, "title": template["title"], "doc_type": tkey, "reused": True})
            continue

        body_text = template["content"]
        for k, v in fill.items():
            body_text = body_text.replace("{" + k + "}", str(v))

        doc = Document(
            project_id=project.id,
            title=template["title"],
            doc_type=doc_type_value,
            template_name=tkey,
            status=DocumentStatus.GENERATED,
            content=body_text,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)
        try:
            ct = "text/plain"
            obj = store_contract_bytes(doc.uid, body_text.encode("utf-8"), ct)
            doc.file_key = obj.file_key
            doc.file_size = obj.size
            doc.file_sha256 = obj.sha256
            doc.file_content_type = obj.content_type
            doc.content = None
            session.add(doc)
            session.commit()
        except Exception:  # noqa: BLE001
            pass
        generated.append({"id": doc.id, "title": template["title"], "doc_type": tkey, "reused": False})

    # Hand-off block for Delaware C-Corp via Stripe Atlas. Other
    # jurisdictions get a "next steps" block listing the per-country
    # filing portal — filing itself is out of scope.
    handoff: dict = {"type": "documents_only", "next_steps": []}
    if j["atlas_supported"]:
        from urllib.parse import urlencode
        handoff = {
            "type": "stripe_atlas",
            "provider": "Stripe Atlas",
            "url": "https://atlas.stripe.com/start?" + urlencode({
                "company": body.company_name.strip(),
                "ref": f"axal-studioos-p{project.id}",
            }),
            "summary": "Continue incorporation on Stripe Atlas — your company name is pre-filled.",
        }
    elif j["id"] == "uk_ltd":
        handoff["next_steps"] = [
            "File IN01 on Companies House (https://www.gov.uk/limited-company-formation)",
            "Register for Corporation Tax with HMRC within 3 months",
            "Open a UK business bank account",
        ]
    elif j["id"] == "sg_pte":
        handoff["next_steps"] = [
            "Submit incorporation via ACRA BizFile+ (https://www.bizfile.gov.sg)",
            "Engage a Singapore-resident director (or nominee director service)",
            "Appoint a company secretary within 6 months",
        ]
    elif j["id"] == "ee_oy":
        handoff["next_steps"] = [
            "Apply for e-Residency (https://e-resident.gov.ee) if you don't already have it",
            "Engage a Company Service Provider for the registered address",
            "File the OÜ via the Estonian Business Register e-portal",
        ]
    elif j["id"] == "us_de_llc":
        handoff["next_steps"] = [
            "File the Certificate of Formation with the Delaware Division of Corporations",
            "Apply for an EIN via IRS Form SS-4 (kit included)",
            "Open a US business bank account",
        ]

    # Task #32 — auto-populate the compliance calendar with the standard
    # recurring deadlines for this jurisdiction (annual report, franchise
    # tax, registered agent, board meetings). Idempotent via a unique
    # index on (project_id, event_type, due_date) — re-running the wizard
    # is a no-op. Failures here must NOT break incorporation.
    seeded_compliance: list[dict] = []
    try:
        from backend.app.api.routes.compliance import seed_standard_events_for_jurisdiction
        seeded = seed_standard_events_for_jurisdiction(
            session=session,
            project_id=project.id,
            entity=entity,
            jurisdiction_id=j["id"],
            jurisdiction_label=j["label"],
            user_id=user.id,
            incorporation_date=entity.incorporation_date,
        )
        seeded_compliance = [
            {
                "id": ev.id,
                "event_type": ev.event_type,
                "title": ev.title,
                "due_date": ev.due_date.isoformat(),
            }
            for ev in seeded
        ]
    except Exception as exc:  # noqa: BLE001
        logger.warning("incorporate_wizard: compliance seed failed: %s", exc)

    return {
        "ok": True,
        "jurisdiction": j,
        "entity": {
            "id": entity.id,
            "uid": entity.uid,
            "name": entity.name,
            "jurisdiction": entity.jurisdiction,
            "status": entity.status,
            "reused": reused_entity,
        },
        "documents": generated,
        "handoff": handoff,
        "compliance_events": seeded_compliance,
    }


# Task #11 — FastAPI parity stubs for the paid incorporation Stripe Checkout flow.
# The real implementation lives on the Cloudflare Worker (prod). In dev, the frontend
# calls these FastAPI endpoints because the Vite proxy sends /api/* to the backend.

class _IncorporateCheckoutReq(BaseModel):
    project_id: int
    jurisdiction_id: str
    company_name: str
    registered_agent_name: Optional[str] = None
    registered_agent_address: Optional[str] = None


@router.post("/incorporate/checkout")
def _incorporate_checkout(
    body: _IncorporateCheckoutReq,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Dev parity: create a pending Incorporation row and return a dev-complete URL."""
    j = JURISDICTIONS.get(body.jurisdiction_id)
    if not j:
        raise HTTPException(status_code=400, detail=f"Unknown jurisdiction: {body.jurisdiction_id}")
    if not body.company_name or not body.company_name.strip():
        raise HTTPException(status_code=400, detail="company_name is required")
    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role not in ("admin", "partner"):
        owns_project = (
            project.founder_id is not None
            and getattr(user, "founder_id", None) == project.founder_id
        )
        if not owns_project:
            raise HTTPException(status_code=403, detail="Forbidden: you do not own this project")

    # Dev fallback: create a pending row and return a URL to the dev-complete endpoint.
    import uuid as _uuid
    dev_session_id = f"dev_session_{user.id}_{_uuid.uuid4().hex[:12]}"
    inc = Incorporation(
        user_id=user.id,
        project_id=project.id,
        jurisdiction_id=body.jurisdiction_id,
        company_name=body.company_name.strip(),
        registered_agent_name=body.registered_agent_name or None,
        registered_agent_address=body.registered_agent_address or None,
        amount_cents=50000,
        currency="usd",
        stripe_session_id=dev_session_id,
    )
    session.add(inc)
    session.commit()
    session.refresh(inc)
    return {
        "url": f"/api/legal/incorporate/dev-complete?id={inc.id}",
        "incorporation_id": inc.id,
        "dev": True,
    }


@router.get("/incorporate/status")
def _incorporate_status(
    id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Dev parity: owner-scoped incorporation status poll."""
    inc = session.get(Incorporation, id)
    if not inc or inc.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    return {
        "id": inc.id,
        "status": inc.status,
        "jurisdiction_id": inc.jurisdiction_id,
        "company_name": inc.company_name,
        "amount_cents": inc.amount_cents,
        "currency": inc.currency,
        "stripe_session_id": inc.stripe_session_id,
        "paid_at": inc.paid_at.isoformat() if inc.paid_at else None,
        "created_at": inc.created_at.isoformat() if inc.created_at else None,
    }


@router.post("/incorporate/dev-complete")
def _incorporate_dev_complete(
    id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Dev parity: simulate paid and return success. No real Stripe webhook here."""
    import os
    env_name = os.environ.get("ENVIRONMENT", "development").lower()
    if env_name not in ("development", "dev", "test", "local", "preview"):
        raise HTTPException(status_code=403, detail="dev_only")
    inc = session.get(Incorporation, id)
    if not inc or inc.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    if inc.status != "pending_payment":
        raise HTTPException(status_code=409, detail="not_pending")
    inc.status = "paid"
    inc.paid_at = datetime.utcnow()
    inc.updated_at = datetime.utcnow()
    session.add(inc)
    session.commit()
    return {"ok": True, "incorporation_id": inc.id, "status": "paid"}


@router.post("/incorporate")
def incorporate_project(project_id: int, jurisdiction: str = "Delaware", session: Session = Depends(get_session), user: User = Depends(require_partner)):
    # Incorporation is a partner/admin action — never founder-self-service.
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    entity = Entity(
        name=f"{project.name} Inc.",
        entity_type="subsidiary",
        jurisdiction=jurisdiction,
        incorporation_date=datetime.utcnow().date(),
        status="incorporated",
    )
    session.add(entity)
    session.commit()
    session.refresh(entity)

    project.entity_id = entity.id
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()

    from backend.app.services.file_storage import store_contract_bytes
    for doc_type in ["bylaws", "equity_split", "ip_license"]:
        template = TEMPLATES[doc_type]
        body = template["content"].replace("{company_name}", entity.name)
        doc = Document(
            project_id=project.id,
            title=template["title"],
            doc_type=doc_type,
            status=DocumentStatus.GENERATED,
            content=body,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)
        try:
            ct = "text/html" if ("<html" in body.lower() or "<div" in body.lower() or "<p>" in body.lower()) else "text/plain"
            obj = store_contract_bytes(doc.uid, body.encode("utf-8"), ct)
            doc.file_key = obj.file_key
            doc.file_size = obj.size
            doc.file_sha256 = obj.sha256
            doc.file_content_type = obj.content_type
            doc.content = None
            session.add(doc)
        except Exception:  # noqa: BLE001
            pass
    session.commit()

    return {
        "entity": entity,
        "message": f"Incorporated {entity.name} in {jurisdiction}. Auto-generated bylaws, equity split, and IP license.",
    }


@router.get("/entities")
def list_entities(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return session.exec(select(Entity).order_by(Entity.created_at.desc())).all()


@router.post("/spinout/{project_id}")
def spinout_project(project_id: int, session: Session = Depends(get_session), user: User = Depends(require_partner)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status not in ["tier_1", "tier_2"]:
        raise HTTPException(status_code=400, detail="Project must pass scoring before spinout")

    if not project.entity_id:
        raise HTTPException(status_code=400, detail="Project must be incorporated first")

    project.status = "spinout"
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)

    return {"message": f"Project '{project.name}' has been spun out successfully.", "project": project}


# ---------------------------------------------------------------------------
# Task #31 — Co-founder agreement wizard + 83(b) tracker
# ---------------------------------------------------------------------------

class CoFounderInput(BaseModel):
    name: str
    email: Optional[str] = None
    role: Optional[str] = None
    equity_pct: float = 0.0
    start_date: Optional[str] = None


class CoFounderAgreementRequest(BaseModel):
    project_id: int
    company_name: str
    effective_date: Optional[str] = None
    founders: list[CoFounderInput]
    vesting_years: int = 4
    cliff_months: int = 12
    cliff_pct: int = 25
    acceleration: str = "single_trigger"  # none | single_trigger | double_trigger
    ip_exclusions: Optional[str] = None
    decision_day_to_day: str = "the CEO"
    decision_threshold: str = "majority"  # majority | supermajority | unanimous
    unanimous_matters: list[str] = []
    deadlock_clause: Optional[str] = None
    commitment_level: str = "full-time"  # full-time | part-time
    confidentiality_years: int = 3
    governing_law: str = "Delaware, USA"
    arbitration_venue: str = "Wilmington, Delaware"
    roles: Optional[str] = None  # free-form roles description


def _check_project_write_access(user: User, project: Project) -> None:
    """Same write-path guard used by /incorporate/wizard. Investors are NOT
    privileged here — only admin / partner / the project's own founder."""
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role in ("admin", "partner"):
        return
    if (
        project.founder_id is not None
        and getattr(user, "founder_id", None) == project.founder_id
    ):
        return
    raise HTTPException(status_code=403, detail="Forbidden: you do not own this project")


@router.post("/cofounder-agreement")
def cofounder_agreement(
    body: CoFounderAgreementRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Task #31 — Generate a filled Co-Founder Agreement and persist it as
    a Document on the project. The wizard captures vesting cliffs, IP
    assignment, decision rights, and exit/buyout terms; we feed those
    into the existing legal template generator and return the new Document.
    """
    if not body.company_name.strip():
        raise HTTPException(status_code=400, detail="company_name is required")
    if not body.founders or len(body.founders) < 2:
        raise HTTPException(status_code=400, detail="At least two founders are required")
    total_equity = sum(f.equity_pct or 0 for f in body.founders)
    if total_equity > 100.001:
        raise HTTPException(status_code=400, detail=f"Equity totals {total_equity:.2f}% — must be ≤ 100")

    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _check_project_write_access(user, project)

    # Render structured blocks the template expects.
    eff = body.effective_date or datetime.utcnow().date().isoformat()
    founders_lines = []
    equity_lines = []
    roles_lines = []
    sig_lines = []
    for i, f in enumerate(body.founders, 1):
        founders_lines.append(
            f"  ({chr(64+i)}) {f.name}"
            + (f" <{f.email}>" if f.email else "")
            + (f", {f.role}" if f.role else "")
        )
        equity_lines.append(
            f"   {chr(64+i)}. {f.name}: {f.equity_pct:.2f}%"
            + (f" (start: {f.start_date})" if f.start_date else "")
        )
        roles_lines.append(f"   {chr(64+i)}. {f.name} — {f.role or 'TBD'}")
        sig_lines.append(f"  ____________________     {f.name}\n  Date: ____________________\n")

    accel_text = {
        "none": "No acceleration on Change of Control.",
        "single_trigger": "Single-trigger — 100% of unvested equity accelerates on Change of Control.",
        "double_trigger": "Double-trigger — unvested equity accelerates only if the founder is terminated without cause within 12 months of a Change of Control.",
    }.get(body.acceleration, body.acceleration)

    unanimous = body.unanimous_matters or [
        "Sale or merger of the Company",
        "Issuance of new equity above 10% dilution",
        "Removal of a founder",
        "Material change to this Agreement",
    ]
    unanimous_block = "\n".join(f"       - {m}" for m in unanimous)

    fill = {
        "company_name": body.company_name.strip(),
        "effective_date": eff,
        "founders_block": "\n".join(founders_lines),
        "equity_block": "\n".join(equity_lines),
        "vesting_years": str(body.vesting_years),
        "cliff_months": str(body.cliff_months),
        "cliff_pct": str(body.cliff_pct),
        "acceleration_clause": accel_text,
        "ip_exclusions": body.ip_exclusions or "None.",
        "decision_day_to_day": body.decision_day_to_day,
        "decision_threshold": body.decision_threshold,
        "unanimous_block": unanimous_block,
        "deadlock_clause": body.deadlock_clause or "Mediation followed by binding arbitration.",
        "roles_block": body.roles or "\n".join(roles_lines),
        "commitment_level": body.commitment_level,
        "confidentiality_years": str(body.confidentiality_years),
        "governing_law": body.governing_law,
        "arbitration_venue": body.arbitration_venue,
        "signature_block": "\n".join(sig_lines),
    }
    template = TEMPLATES["cofounder_agreement"]
    rendered = template["content"]
    for k, v in fill.items():
        rendered = rendered.replace("{" + k + "}", str(v))

    doc = Document(
        project_id=project.id,
        title=f"Co-Founder Agreement — {body.company_name.strip()}",
        doc_type=DocumentType.OTHER,
        template_name="cofounder_agreement",
        status=DocumentStatus.GENERATED,
        content=rendered,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    # Persist to object storage (consistent with /incorporate/wizard).
    try:
        from backend.app.services.file_storage import store_contract_bytes
        obj = store_contract_bytes(doc.uid, rendered.encode("utf-8"), "text/plain")
        doc.file_key = obj.file_key
        doc.file_size = obj.size
        doc.file_sha256 = obj.sha256
        doc.file_content_type = obj.content_type
        doc.content = None
        session.add(doc)
        session.commit()
    except Exception:
        pass

    return {
        "ok": True,
        "document": {
            "id": doc.id,
            "uid": doc.uid,
            "title": doc.title,
            "template_name": doc.template_name,
        },
        "summary": {
            "founders": len(body.founders),
            "total_equity_pct": round(total_equity, 2),
            "vesting_years": body.vesting_years,
            "cliff_months": body.cliff_months,
            "acceleration": body.acceleration,
        },
    }


# ----------------------- 83(b) tracker --------------------------------------

class Section83bCreate(BaseModel):
    project_id: int
    taxpayer_name: str
    grant_date: str  # ISO date


class Section83bUpdate(BaseModel):
    mailed_at: Optional[str] = None  # ISO datetime
    receipt_doc_id: Optional[int] = None
    status: Optional[str] = None     # pending | mailed | confirmed | missed
    notes: Optional[str] = None


def _tracker_dto(t: Section83bTracker) -> dict:
    today = date.today()
    days_left = (t.deadline_date - today).days
    overdue = days_left < 0 and t.status not in ("mailed", "confirmed")
    return {
        "id": t.id,
        "uid": t.uid,
        "project_id": t.project_id,
        "user_id": t.user_id,
        "taxpayer_name": t.taxpayer_name,
        "grant_date": t.grant_date.isoformat(),
        "deadline_date": t.deadline_date.isoformat(),
        "days_left": days_left,
        "overdue": overdue,
        "mailed_at": t.mailed_at.isoformat() if t.mailed_at else None,
        "receipt_doc_id": t.receipt_doc_id,
        "election_doc_id": t.election_doc_id,
        "status": t.status,
        "notes": t.notes,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
        "checklist": [
            {"key": "draft", "label": "Generate the 83(b) election", "done": t.election_doc_id is not None},
            {"key": "sign", "label": "Print, sign, and date the election", "done": t.status in ("mailed", "confirmed")},
            {"key": "mail", "label": "Mail to the IRS service center via USPS Certified Mail", "done": t.mailed_at is not None},
            {"key": "receipt", "label": "Upload your certified-mail receipt (PS Form 3800)", "done": t.receipt_doc_id is not None},
            {"key": "copy_company", "label": "Send a signed copy to the Company", "done": t.status == "confirmed"},
            {"key": "personal_records", "label": "Keep a copy in your personal tax records", "done": t.status == "confirmed"},
        ],
        "irs_mailing_steps": [
            "Fill in your name, SSN, taxpayer address, and the property details.",
            "Sign and date the election in two places.",
            "Make 3 copies (IRS, Company, personal records).",
            "Mail the original to the IRS Service Center for your state of residence via USPS Certified Mail with Return Receipt Requested.",
            "Save the green PS Form 3800 receipt — that is your filing-date proof.",
            "Upload the receipt here and mark the tracker 'confirmed' once you receive the green card back.",
        ],
    }


@router.get("/83b/trackers")
def list_83b_trackers(
    project_id: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List 83(b) trackers visible to the caller. Founders see their own;
    admin/partner see all (optionally filtered by project)."""
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    q = select(Section83bTracker).order_by(Section83bTracker.deadline_date.asc())
    if project_id:
        q = q.where(Section83bTracker.project_id == project_id)
    if role not in ("admin", "partner"):
        q = q.where(Section83bTracker.user_id == user.id)
    rows = session.exec(q).all()
    return {"trackers": [_tracker_dto(r) for r in rows]}


@router.post("/83b/trackers")
def create_83b_tracker(
    body: Section83bCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Create a new 83(b) tracker. Auto-generates a pre-filled Section 83(b)
    election Document, computes the 30-day deadline, and fires an in-app +
    email reminder so the founder has the deadline on their calendar."""
    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _check_project_write_access(user, project)
    try:
        grant = date.fromisoformat(body.grant_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="grant_date must be ISO format (YYYY-MM-DD)")

    from datetime import timedelta
    deadline = grant + timedelta(days=30)

    # Idempotency: same project + user + grant_date → reuse. The DB has a
    # unique index on (project_id, user_id, grant_date) (see
    # ensure_section_83b_tracker_table) so concurrent POSTs cannot race past
    # this app-level check.
    existing = session.exec(
        select(Section83bTracker).where(
            Section83bTracker.project_id == project.id,
            Section83bTracker.user_id == user.id,
            Section83bTracker.grant_date == grant,
        )
    ).first()
    if existing:
        return {"ok": True, "reused": True, "tracker": _tracker_dto(existing)}

    # Generate the pre-filled election document.
    company = project.name
    if project.entity_id:
        ent = session.get(Entity, project.entity_id)
        if ent:
            company = ent.name
    rendered = TEMPLATES["section_83b"]["content"].replace("{company_name}", company)
    rendered = rendered.replace("Taxpayer: ____________________", f"Taxpayer: {body.taxpayer_name}")
    rendered = rendered.replace("Tax Year: ____________________", f"Tax Year: {grant.year}")
    rendered = rendered.replace("2. DATE OF TRANSFER: ____________________", f"2. DATE OF TRANSFER: {grant.isoformat()}")

    doc = Document(
        project_id=project.id,
        title=f"83(b) Election — {body.taxpayer_name} ({grant.isoformat()})",
        doc_type=DocumentType.SECTION_83B,
        template_name="section_83b",
        status=DocumentStatus.GENERATED,
        content=rendered,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    try:
        from backend.app.services.file_storage import store_contract_bytes
        obj = store_contract_bytes(doc.uid, rendered.encode("utf-8"), "text/plain")
        doc.file_key = obj.file_key
        doc.file_size = obj.size
        doc.file_sha256 = obj.sha256
        doc.file_content_type = obj.content_type
        doc.content = None
        session.add(doc)
        session.commit()
    except Exception:
        pass

    tracker = Section83bTracker(
        project_id=project.id,
        user_id=user.id,
        taxpayer_name=body.taxpayer_name,
        grant_date=grant,
        deadline_date=deadline,
        election_doc_id=doc.id,
        status="pending",
    )
    session.add(tracker)
    try:
        session.commit()
        session.refresh(tracker)
    except IntegrityError:
        # Lost the race against the unique index — return the now-existing
        # row instead of a 500.
        session.rollback()
        existing = session.exec(
            select(Section83bTracker).where(
                Section83bTracker.project_id == project.id,
                Section83bTracker.user_id == user.id,
                Section83bTracker.grant_date == grant,
            )
        ).first()
        if existing:
            return {"ok": True, "reused": True, "tracker": _tracker_dto(existing)}
        raise

    # Calendar/notification ping (Task 0.2 notify subsystem).
    try:
        from backend.app.services.notify import notify
        notify(
            user_id=user.id,
            type="section_83b_tracker_created",
            title="83(b) deadline: {0}".format(deadline.isoformat()),
            body=(
                f"You have 30 days from {grant.isoformat()} to mail your 83(b) election to the IRS. "
                f"Use USPS Certified Mail with Return Receipt Requested and upload the PS Form 3800 receipt."
            ),
            link="/incorporate/83b",
            payload={
                "tracker_id": tracker.id,
                "project_id": project.id,
                "grant_date": grant.isoformat(),
                "deadline_date": deadline.isoformat(),
            },
            channels=("in_app", "email"),
        )
    except Exception:
        pass

    return {"ok": True, "reused": False, "tracker": _tracker_dto(tracker), "election_document_id": doc.id}


@router.patch("/83b/trackers/{tracker_id}")
def update_83b_tracker(
    tracker_id: int,
    body: Section83bUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    t = session.get(Section83bTracker, tracker_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tracker not found")
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role not in ("admin", "partner") and t.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden: not your tracker")

    if body.mailed_at is not None:
        try:
            t.mailed_at = datetime.fromisoformat(body.mailed_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="mailed_at must be ISO datetime")
        if t.status == "pending":
            t.status = "mailed"
    if body.receipt_doc_id is not None:
        # Verify the doc exists + belongs to the same project.
        d = session.get(Document, body.receipt_doc_id)
        if not d or d.project_id != t.project_id:
            raise HTTPException(status_code=400, detail="receipt_doc_id is not a document on this project")
        t.receipt_doc_id = body.receipt_doc_id
    if body.status is not None:
        if body.status not in ("pending", "mailed", "confirmed", "missed"):
            raise HTTPException(status_code=400, detail="Invalid status")
        t.status = body.status
    if body.notes is not None:
        t.notes = body.notes
    t.updated_at = datetime.utcnow()
    session.add(t)
    session.commit()
    session.refresh(t)
    return {"ok": True, "tracker": _tracker_dto(t)}


@router.post("/83b/trackers/{tracker_id}/receipt")
async def upload_83b_receipt(
    tracker_id: int,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Upload a certified-mail receipt (PS Form 3800 scan) for a 83(b)
    tracker. Stored as a Document on the same project; receipt_doc_id is
    linked back on the tracker."""
    from starlette.datastructures import UploadFile as _UF

    t = session.get(Section83bTracker, tracker_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tracker not found")
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role not in ("admin", "partner") and t.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden: not your tracker")

    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, _UF):
        raise HTTPException(status_code=400, detail="file is required (multipart/form-data)")
    data = await upload.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    # Server-side MIME allowlist + magic-byte sniff. Receipts are scans of
    # PS Form 3800 (the green certified-mail slip) so PDF / JPEG / PNG cover
    # 100% of legitimate uploads. We don't trust the client-supplied
    # Content-Type header (architect review for Task #31).
    declared = (upload.content_type or "").lower().split(";")[0].strip()
    allowed_types = {"application/pdf", "image/jpeg", "image/jpg", "image/png"}
    head = data[:8]
    sniffed = None
    if head.startswith(b"%PDF-"):
        sniffed = "application/pdf"
    elif head.startswith(b"\xff\xd8\xff"):
        sniffed = "image/jpeg"
    elif head.startswith(b"\x89PNG\r\n\x1a\n"):
        sniffed = "image/png"
    if sniffed is None:
        raise HTTPException(status_code=400, detail="Receipt must be a PDF, JPEG, or PNG file")
    if declared and declared not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {declared}")
    content_type = sniffed

    # Storage first — only persist the Document + link the tracker if bytes
    # actually landed. If storage fails we surface a 5xx and leave both the
    # tracker state and document table untouched.
    try:
        from backend.app.services.file_storage import store_contract_bytes
        import uuid as _uuid
        placeholder_uid = str(_uuid.uuid4())
        obj = store_contract_bytes(placeholder_uid, data, content_type)
    except Exception as exc:
        logger.exception("83b receipt storage failed for tracker %s", tracker_id)
        raise HTTPException(status_code=502, detail="Receipt storage failed; please retry.") from exc

    doc = Document(
        uid=placeholder_uid,
        project_id=t.project_id,
        title=f"83(b) Certified-Mail Receipt — {t.taxpayer_name}",
        doc_type=DocumentType.OTHER,
        template_name="83b_certified_receipt",
        status=DocumentStatus.GENERATED,
        file_key=obj.file_key,
        file_size=obj.size,
        file_sha256=obj.sha256,
        file_content_type=obj.content_type,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    t.receipt_doc_id = doc.id
    if t.status == "pending":
        t.status = "mailed"
    if t.mailed_at is None:
        t.mailed_at = datetime.utcnow()
    t.updated_at = datetime.utcnow()
    session.add(t)
    session.commit()
    session.refresh(t)
    return {"ok": True, "tracker": _tracker_dto(t), "receipt_document_id": doc.id}
