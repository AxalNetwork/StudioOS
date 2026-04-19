from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Document, Entity, Project, DocumentType, DocumentStatus, User
from backend.app.schemas.scoring import DocumentCreate
from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import require_role, ensure_founder_access, is_privileged
from backend.app.services.access_policy import require_contract_view
from datetime import datetime

require_partner = require_role("partner")

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


def _hydrate_doc_content(
    doc: Document,
    viewer: Optional[User] = None,
    session: Optional[Session] = None,
    *,
    include_content: bool = True,
) -> dict:
    """Return a dict copy of `doc` with `content` rehydrated from storage if
    the inline copy was cleared during the storage migration.

    Pass `include_content=False` for **list** endpoints — list views must
    never return the full body of every document (Security Item #5: separate
    public-vs-private DTOs). Detail endpoints continue to default to True
    for wire-compat.

    When `viewer` is supplied, the result is also passed through the
    signature redactor so admin-only proof fields (`signed_ip`) are stripped
    and `signed_by` is masked for non-privileged callers."""
    data = doc.dict() if hasattr(doc, "dict") else doc.model_dump()
    if include_content:
        if not data.get("content") and doc.file_key:
            try:
                from backend.app.services.file_storage import get_storage
                data["content"] = get_storage().get(doc.file_key).decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                data["content"] = ""
    else:
        # Drop body + integrity hash from list summaries. `file_size` stays
        # so the UI can show "12 KB" badges; `file_sha256` is admin-only
        # legal-proof material.
        data.pop("content", None)
        data.pop("file_sha256", None)
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
        _hydrate_doc_content(d, viewer=user, session=session, include_content=False)
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
