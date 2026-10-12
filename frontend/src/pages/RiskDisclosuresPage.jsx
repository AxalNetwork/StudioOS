import React from 'react';
import LegalDocument from './site/LegalDocument';

/**
 * `/risk-disclosures` — the Risk Disclosures & Disclaimers, in the owner's
 * canvas legal layout (D680).
 *
 * The text is the page's own, as it read before D680 (option A on #1554): the
 * warning and the opening paragraph as the intro, sections 1 to 8 with their
 * headings in sentence case, and its date as "Last updated". The page printed
 * no address of its own, so the questions line names the canvas's,
 * legal@axal.vc, the address the Terms already give. The canvas's disclosures
 * wait on the owner and counsel; see LegalDocument.
 */
export const RISK_UPDATED = 'March 31, 2026';
export const RISK_EMAIL = 'legal@axal.vc';

const INTRO = (
  <>
    <p className="ax-legal-warn">
      <strong>Investment in startups involves a high degree of risk and may result in the loss of your entire investment.</strong>
    </p>
    <p>Investment in private, early-stage companies (the "Securities") involves a high degree of risk and is suitable only for sophisticated investors who can afford the loss of their entire investment. By using the Axal.vc platform (the "Platform"), you acknowledge and accept the following risks:</p>
  </>
);

const SECTIONS = [
  {
    n: '01',
    h: 'Loss of principal',
    body: (
      <>
        <p>Statistically, most startup companies fail. Investments in the Securities are highly speculative. There is no guarantee of any return on your capital, and you should not invest any funds that you cannot afford to lose entirely.</p>
      </>
    ),
  },
  {
    n: '02',
    h: 'Illiquidity and lack of resale',
    body: (
      <>
        <p>Unlike stocks traded on a public exchange (like the NYSE or NASDAQ), the Securities are "restricted" and highly illiquid.</p>
        <ul>
          <li><strong>No Secondary Market:</strong> There is currently no active public market for the Securities.</li>
          <li><strong>Holding Period:</strong> You should expect to hold your investment for an indefinite period, often 7 to 10 years or more, until a "liquidity event" (such as an IPO or acquisition) occurs.</li>
          <li><strong>Transfer Restrictions:</strong> The Securities are subject to legal and contractual restrictions on resale. You may be prohibited from selling your interest without the express consent of the Issuer or Axal VC.</li>
        </ul>
      </>
    ),
  },
  {
    n: '03',
    h: 'Dilution',
    body: (
      <>
        <p>Startup companies typically require multiple rounds of funding. Each time a company raises additional capital, it issues new shares. This will likely "dilute" your percentage of ownership and may involve the issuance of new shares with rights superior to those of your Securities (e.g., liquidation preferences).</p>
      </>
    ),
  },
  {
    n: '04',
    h: 'Lack of operating history',
    body: (
      <>
        <p>Many companies featured on the Platform are in the "seed" or "early stage" of development. They may have little or no track record of revenue or profitability. Their success depends heavily on the management team's ability to execute a business plan in a competitive market.</p>
      </>
    ),
  },
  {
    n: '05',
    h: 'Valuation subjectivity',
    body: (
      <>
        <p>The "valuation" of a private company is not based on public market data. It is often a negotiation between the company and lead investors. There is no assurance that the valuation reflected on the Platform accurately represents the intrinsic value of the company or the price at which the Securities could be sold to a third party.</p>
      </>
    ),
  },
  {
    n: '06',
    h: 'No reliance on Axal.vc data',
    body: (
      <>
        <p>While <strong>Axal VC Management LLC</strong> performs certain due diligence as platform operator and <strong>Axal VC GP LLC</strong> performs investment diligence as general partner of Axal VC Fund I, LP, neither entity guarantees the accuracy or completeness of the information provided by the companies (the "Issuers").</p>
        <ul>
          <li><strong>Forward-Looking Statements:</strong> Pitch decks and financial projections are "forward-looking statements" and are inherently unreliable. Actual results may differ materially from those projected.</li>
          <li><strong>Third-Party Info:</strong> No Axal VC entity is responsible for the truthfulness of information provided by founders or third-party data providers.</li>
        </ul>
      </>
    ),
  },
  {
    n: '07',
    h: 'Minority rights & control',
    body: (
      <>
        <p>As a minority investor, you will generally have no power to influence the management or decisions of the companies in which you invest. You will be relying entirely on the company's officers and directors.</p>
      </>
    ),
  },
  {
    n: '08',
    h: 'Tax consequences',
    body: (
      <>
        <p>The federal, state, and local tax consequences of private equity investments are complex. You should consult with your own tax professional regarding the implications of holding these Securities, including the timing of K-1 distributions.</p>
      </>
    ),
  },
];

export default function RiskDisclosuresPage() {
  return (
    <LegalDocument
      title="Risk Disclosures & Disclaimers"
      updated={RISK_UPDATED}
      intro={INTRO}
      sections={SECTIONS}
      email={RISK_EMAIL}
    />
  );
}
