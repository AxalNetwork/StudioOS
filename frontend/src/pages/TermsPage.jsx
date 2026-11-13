import React from 'react';
import { Link } from 'react-router-dom';
import LegalDocument from './site/LegalDocument';

/**
 * `/terms` — the Terms of Service, in the owner's canvas legal layout (D680).
 *
 * The text is the page's own, as it read before D680 (option A on #1554): the
 * twenty numbered sections and the closing acknowledgment, their headings in
 * sentence case, and the effective date as "Last updated". The canvas's Terms
 * of Use wait on the owner and counsel; see LegalDocument.
 */
export const TERMS_UPDATED = 'July 8, 2026';
export const TERMS_EMAIL = 'legal@axal.vc';

const INTRO = (
  <p>
    <strong>Operated by</strong> Axal VC Management LLC, a Delaware limited liability company.
    <br />
    <strong>Platform & IP owned by</strong> Axal VC Holdings LLC.
    <br />
    <strong>Fund managed by</strong> Axal VC GP LLC, the general partner of Axal VC Spin-Out Lab Fund I LP.
  </p>
);

const SECTIONS = [
  {
    n: '01',
    h: 'Definitions & parties',
    body: (
      <>
        <ul>
          <li><strong>"Platform"</strong> means the Axal VC StudioOS web application and associated services (including all dashboards, deal rooms, deal flow, portfolio analytics, event platforms, job boards, advisory network, articles, legal document generators, compliance tools, and related features) accessible at <code>axal.vc</code> and its subdomains.</li>
          <li><strong>"We," "Us," "Our"</strong> refers to Axal VC Management LLC, the operator of the Platform, and collectively to the Axal VC corporate family (Axal VC Holdings LLC, Axal VC GP LLC, and their officers, directors, employees, agents, and contractors).</li>
          <li><strong>"You," "Your"</strong> means any person or entity accessing or using the Platform, including founders, investors, advisors, partners, service providers, consultants, and other users.</li>
          <li><strong>"Services"</strong> includes all features, content, data, analytics, communications, integrations, and functionality provided through the Platform.</li>
          <li><strong>"Confidential Information"</strong> means all proprietary data, pitch decks, cap tables, financial statements, deal materials, performance data, user contact information, and other sensitive materials shared on the Platform.</li>
        </ul>
      </>
    ),
  },
  {
    n: '02',
    h: 'Acceptance & acknowledgments',
    body: (
      <>
        <p>By accessing or using the Platform, you represent and warrant that:</p>
        <ul>
          <li>You are of legal age and have the legal capacity to enter into binding agreements.</li>
          <li>You are not subject to sanctions or restrictions by the U.S. government, FinCEN, OFAC, or equivalent international bodies.</li>
          <li>All information you provide during registration and ongoing use is accurate, current, and truthful.</li>
          <li>You understand that venture capital investments are highly speculative, illiquid, and carry substantial risk of total loss.</li>
          <li>You accept full responsibility for your account security and all activities under your credentials.</li>
          <li>You have reviewed and understand this entire agreement before using the Platform.</li>
        </ul>
      </>
    ),
  },
  {
    n: '03',
    h: 'Platform purpose & scope',
    body: (
      <>
        <ul>
          <li><strong>Professional Tool:</strong> The Platform is a proprietary technology and information system designed for venture capital operations, portfolio management, investor relations, deal flow analysis, founder sourcing, advisory networking, and professional networking within the startup ecosystem.</li>
          <li><strong>Multi-Stakeholder Network:</strong> The Platform connects founders, investors (LPs and co-investors), advisors, service partners, fund managers, and ecosystem participants in a curated professional network.</li>
          <li><strong>Administrative & Informational:</strong> The Platform provides deal rooms, pipeline management, cap table collaboration, legal document templates, compliance tooling, event hosting, job board functionality, content publishing, research and insights, and advisory matching — all for administrative, due diligence, and informational purposes only.</li>
          <li><strong>No Investment Advice:</strong> No content, data, analysis, or materials on the Platform constitute investment advice, a recommendation to buy or sell securities, or an offer to invest. Axal VC Management LLC is not a registered investment adviser or broker-dealer.</li>
          <li><strong>Fund Offerings:</strong> Investment opportunities in Axal VC Spin-Out Lab Fund I LP are offered exclusively through Axal VC GP LLC's separate, definitive subscription documents (the Fund Agreement). The Platform does not constitute an offering document for the Fund.</li>
        </ul>
      </>
    ),
  },
  {
    n: '04',
    h: 'Eligibility, verification & compliance',
    body: (
      <>
        <ul>
          <li><strong>Investor Accreditation:</strong> Users seeking access to deal rooms, LP portfolios, capital allocation tools, or other investor-restricted features must qualify as "Accredited Investors" under SEC Regulation D, Rule 501, or equivalent in their jurisdiction. You represent that all financial information you provide is accurate and verified.</li>
          <li><strong>KYC/AML Screening:</strong> You agree to complete and maintain current Identity Verification (KYC) and Anti-Money Laundering (AML) screening as required by FinCEN regulations for Exempt Reporting Advisers (ERAs), the Bank Secrecy Act (BSA), and applicable state/federal law. Failure to complete KYC may result in account suspension or termination.</li>
          <li><strong>Beneficial Ownership Disclosure:</strong> If you represent an entity (fund, corporation, partnership, trust), you agree to disclose all beneficial owners and authorized representatives and to verify their identity and accreditation status.</li>
          <li><strong>Bad Actor Certification:</strong> You certify that you and any beneficial owners are not disqualified by Rule 506(d) or any equivalent "bad actor" provision under federal or state securities law.</li>
          <li><strong>Jurisdiction Compliance:</strong> You represent that your use of the Platform and participation in any transactions does not violate the laws or regulations of your jurisdiction of residence or the jurisdiction in which the Platform is accessed.</li>
          <li><strong>Ongoing Compliance:</strong> You agree to notify Axal VC Management LLC immediately if your eligibility status changes (e.g., loss of accreditation, change of address, disqualification event).</li>
        </ul>
      </>
    ),
  },
  {
    n: '05',
    h: 'User roles & feature access',
    body: (
      <>
        <p>The Platform offers role-based access tailored to different ecosystem participants:</p>
        <ul>
          <li><strong>Founders:</strong> Can build profiles, manage pitch decks, submit deal information, access advisory network, track investor meetings, participate in events, and post jobs.</li>
          <li><strong>Investors (LPs/Co-Investors):</strong> Can access curated deal flow, manage portfolios, view cap tables, monitor fund performance, engage with portfolio companies, and participate in governance.</li>
          <li><strong>Advisors:</strong> Can build advisory profiles, engage with founders, provide strategic guidance, and access to network directory.</li>
          <li><strong>Service Partners:</strong> Can advertise services, connect with founders and investors, and access partnership directories.</li>
          <li><strong>Fund Managers:</strong> Can manage fund portfolios, track performance, generate reports, and interface with LPs.</li>
          <li><strong>Admin/Team Members:</strong> Can manage platform content, vet users, oversee deal rooms, and administer compliance workflows.</li>
          <li>Access to certain premium features (tier-based subscriptions) may be limited based on subscription level, accreditation status, or eligibility determinations made by Axal VC Management LLC at its sole discretion.</li>
        </ul>
      </>
    ),
  },
  {
    n: '06',
    h: 'Confidentiality, data protection & non-disclosure',
    body: (
      <>
        <ul>
          <li><strong>Confidential Information Obligations:</strong> All information shared on the Platform (pitch decks, cap tables, financial statements, performance data, advisor bios, deal terms, and LP/investor contact information) is confidential. You agree to maintain strict confidentiality and use it solely for evaluating investment opportunities, providing advisory services, or managing your portfolio within the Axal VC network.</li>
          <li><strong>Permitted Disclosures:</strong> You may disclose Confidential Information only to your employees, advisors, attorneys, and accountants who have a need to know and are bound by written confidentiality obligations at least as restrictive as these Terms.</li>
          <li><strong>Non-Solicitation:</strong> You agree not to solicit Axal VC users (founders, investors, advisors) for competing funds, services, or opportunities without Axal VC Management LLC's prior written consent. This includes recruiting portfolio companies, redirecting deal flow, or soliciting relationships formed through the Platform.</li>
          <li><strong>Audit Rights:</strong> Axal VC Management LLC retains the right to audit compliance with confidentiality and non-solicitation obligations.</li>
          <li><strong>Data Privacy:</strong> Your personal data is processed in accordance with our <Link to="/privacy" className="ax-link">Privacy Policy</Link> and applicable data protection law, including GDPR, CCPA, and Regulation S-P (2026).</li>
        </ul>
      </>
    ),
  },
  {
    n: '07',
    h: 'Intellectual property & license',
    body: (
      <>
        <ul>
          <li><strong>Platform Ownership:</strong> All software, code, design, layout, graphics, text, tutorials, templates, documentation, trademarks ("Axal VC," "StudioOS"), domain names (<code>axal.vc</code>), and other Platform intellectual property are exclusively owned by Axal VC Holdings LLC and protected by U.S. and international copyright, trademark, and patent law.</li>
          <li><strong>License Grant:</strong> Axal VC Management LLC grants you a limited, revocable, non-exclusive, non-transferable, non-sublicensable license to access and use the Platform solely for your personal or professional purposes as permitted by these Terms.</li>
          <li><strong>Restrictions on Use:</strong> You may not: (a) scrape, crawl, or systematically download Platform data; (b) reverse-engineer, decompile, or attempt to discover source code; (c) create derivative works or deep-link to Platform content; (d) resell, rent, or lease Platform access; (e) use the Platform to build competing services; or (f) remove or obscure any copyright or proprietary notices.</li>
          <li><strong>User-Generated Content:</strong> By posting content (profiles, messages, documents, comments) on the Platform, you grant Axal VC Management LLC a worldwide, royalty-free license to use, display, modify, and store such content for operating and improving the Platform. You retain ownership but acknowledge that Axal VC Management LLC may archive or republish your content as needed for compliance, disputes, or historical records.</li>
        </ul>
      </>
    ),
  },
  {
    n: '08',
    h: 'User conduct & prohibitions',
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>Share, transfer, or permit access to your account or credentials.</li>
          <li>Impersonate another user, misrepresent your identity or affiliation, or create false or misleading profiles.</li>
          <li>Harass, threaten, abuse, or discriminate against any Platform user.</li>
          <li>Upload malware, viruses, scripts, or any code designed to disrupt, damage, or interfere with the Platform or user devices.</li>
          <li>Attempt to gain unauthorized access to Platform systems, databases, or user accounts.</li>
          <li>Violate any applicable laws or regulations, including securities laws, tax law, and sanctions requirements.</li>
          <li>Distribute spam, unsolicited communications, or engage in phishing or social engineering.</li>
          <li>Use automated tools (bots, scrapers, API calls) without written permission.</li>
          <li>Bypass security controls or access restricted areas or features you are not authorized to use.</li>
          <li>Falsify investment credentials, misrepresent accreditation status, or provide false KYC information.</li>
          <li>Engage in market manipulation, insider trading, or securities fraud.</li>
          <li>Use the Platform to infringe third-party intellectual property rights.</li>
          <li>Compete with Axal VC's business or use the Platform to develop rival services.</li>
        </ul>
      </>
    ),
  },
  {
    n: '09',
    h: 'Deal rooms, transactions & investment disclaimers',
    body: (
      <>
        <ul>
          <li><strong>Deal Room Access:</strong> Access to deal-specific deal rooms and materials is restricted to pre-approved accredited investors and is granted solely for due diligence and investment evaluation purposes.</li>
          <li><strong>Investment Disclaimers:</strong> All investment materials (term sheets, pitch decks, financial projections, cap tables) are provided "as-is" without verification of accuracy. Axal VC Management LLC does not audit, endorse, or guarantee the completeness or correctness of any materials.</li>
          <li><strong>No Recommendation:</strong> Axal VC Management LLC does not recommend any specific investment and is not responsible for investment decisions or outcomes.</li>
          <li><strong>Direct Negotiations:</strong> Any investment terms, conditions, governance rights, or information rights are negotiated directly between you and the issuing entity (startup, fund, or SPV). Axal VC Management LLC is not a party to such negotiations and bears no liability for disputes over terms.</li>
          <li><strong>Legal & Tax Advice:</strong> You should consult your own attorneys, accountants, and financial advisors regarding all investment decisions.</li>
        </ul>
      </>
    ),
  },
  {
    n: '10',
    h: 'Events, jobs board & user community',
    body: (
      <>
        <ul>
          <li><strong>Events:</strong> The Platform hosts networking events, webinars, and conferences. Attendance is subject to the event's specific terms. Axal VC Management LLC is not liable for event cancellations, security incidents, or third-party conduct.</li>
          <li><strong>Jobs Board:</strong> The Platform provides a job posting and application service. Job postings are submitted by employers and Axal VC Management LLC does not verify employer legitimacy or job authenticity. Axal VC Management LLC is not a party to employment relationships.</li>
          <li><strong>User Directory & Networking:</strong> The Platform may publish user profiles and facilitate introductions. You consent to your profile being visible to other Platform users unless you restrict visibility in settings.</li>
          <li><strong>Third-Party Content:</strong> The Platform may host content from third parties (articles, research, legal templates, webinars). Axal VC Management LLC does not endorse or warrant third-party content.</li>
        </ul>
      </>
    ),
  },
  {
    n: '11',
    h: 'Fees, billing & payment',
    body: (
      <>
        <ul>
          <li><strong>Subscription Tiers:</strong> Access to premium features may require payment of subscription fees, performance fees, or transaction-based fees depending on your tier (Growth, Professional, Institutional, or custom arrangements).</li>
          <li><strong>Billing:</strong> Fees are billed in advance and are non-refundable except as required by law. Your subscription automatically renews unless cancelled in writing before the renewal date.</li>
          <li><strong>Late Payment:</strong> If you fail to pay fees when due, Axal VC Management LLC may suspend your access and pursue collection remedies, including interest and attorney fees.</li>
          <li><strong>Fund Investor Fees:</strong> If you are an LP in Axal VC Spin-Out Lab Fund I LP, you are subject to the Fund's management fees, carried interest, and expenses as defined in the Fund Agreement. Such fees are separate from and in addition to any Platform subscription fees.</li>
        </ul>
      </>
    ),
  },
  {
    n: '12',
    h: 'Limitation of liability & disclaimers',
    body: (
      <>
        <ul>
          <li><strong>"As-Is" Provision:</strong> The Platform is provided on an "as-is," "as-available" basis without representations or warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, or accuracy.</li>
          <li><strong>Data Accuracy:</strong> Axal VC Management LLC does not guarantee the accuracy, completeness, or timeliness of any data, content, or materials provided by third parties (founders, investors, service providers). You rely on such materials at your own risk.</li>
          <li><strong>Availability:</strong> Axal VC Management LLC does not warrant uninterrupted or error-free access to the Platform. The Platform may be temporarily unavailable for maintenance, updates, or unforeseen technical issues.</li>
          <li><strong>Liability Cap:</strong> To the fullest extent permitted by law, the total aggregate liability of Axal VC Management LLC, Axal VC Holdings LLC, Axal VC GP LLC, and their respective officers, directors, employees, and agents arising from or related to your use of the Platform shall not exceed the lesser of: (a) the fees paid by you to Axal VC Management LLC in the twelve (12) months preceding the claim, or (b) $100.</li>
          <li><strong>Excluded Damages:</strong> In no event shall Axal VC Management LLC be liable for indirect, incidental, consequential, special, or punitive damages, including lost profits, lost data, lost business opportunity, or reputational harm, even if advised of the possibility of such damages.</li>
          <li><strong>Investment Loss:</strong> Axal VC Management LLC is not liable for any investment losses, poor performance, failed transactions, or unfavorable outcomes resulting from your investment decisions or reliance on Platform materials.</li>
        </ul>
      </>
    ),
  },
  {
    n: '13',
    h: 'Indemnification',
    body: (
      <>
        <p>You agree to indemnify and hold harmless Axal VC Management LLC, Axal VC Holdings LLC, Axal VC GP LLC, and their respective officers, directors, employees, agents, and advisors from any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to:</p>
        <ul>
          <li>Your use of or inability to use the Platform.</li>
          <li>Your breach of these Terms or any representations and warranties you have made.</li>
          <li>Your misrepresentation of accreditation status, investor qualification, or identity.</li>
          <li>Your violation of any law or third-party rights.</li>
          <li>Your investment decisions or participation in transactions.</li>
          <li>Disputes with other Platform users or third parties.</li>
          <li>Content you post, upload, or transmit through the Platform.</li>
        </ul>
      </>
    ),
  },
  {
    n: '14',
    h: 'Termination & suspension',
    body: (
      <>
        <ul>
          <li><strong>Account Termination:</strong> You may request account termination at any time. Axal VC Management LLC may suspend or terminate your account and access to the Platform immediately and without notice if you: (a) breach these Terms; (b) fail compliance or KYC verification; (c) are sanctioned or disqualified; (d) engage in illegal activity; or (e) pose a risk to the Platform or other users.</li>
          <li><strong>Effect of Termination:</strong> Upon termination, your license to use the Platform ceases immediately. Your access to Confidential Information and deal materials ends. Provisions regarding confidentiality, indemnification, liability, governing law, and dispute resolution survive termination indefinitely.</li>
          <li><strong>Data Retention:</strong> Axal VC Management LLC may retain copies of your data, account information, and transaction records as required by law or for historical and compliance purposes.</li>
        </ul>
      </>
    ),
  },
  {
    n: '15',
    h: 'Corporate structure & legal entities',
    body: (
      <>
        <p>The Axal VC ecosystem operates through three distinct entities, each with specific roles and responsibilities:</p>
        <ul>
          <li><strong>Axal VC Holdings LLC</strong> (Delaware LLC) — Passive holding company and intellectual property owner. Holds ownership of the "Axal VC" brand, "StudioOS" trademark, domain names (<code>axal.vc</code>), software copyrights, and all platform IP. Licenses these assets to Axal VC Management LLC. Holds equity interests in subsidiaries, SPVs, and portfolio companies, and maintains treasury reserves. Not a party to these Terms and does not operate the Platform. Not liable for Platform disputes.</li>
          <li><strong>Axal VC Management LLC</strong> (Delaware LLC) — Operating company and your contractual counterparty. Operates the Platform, employs team members and contractors, executes customer and vendor agreements, collects subscription fees, manages user data, and performs all day-to-day platform functions. Designated data controller under applicable privacy laws. This entity is the party bound by and responsible for these Terms.</li>
          <li><strong>Axal VC GP LLC</strong> (Delaware LLC) — General partner of Axal VC Spin-Out Lab Fund I LP, a private venture capital fund. Manages the Fund's operations, makes investment decisions, oversees portfolio companies, approves exits, and owes fiduciary duties to Fund limited partners. Not a party to these Terms. Does not operate the Platform and bears no liability for Platform disputes. Fund offerings are governed by separate Fund documents, not these Terms.</li>
        </ul>
      </>
    ),
  },
  {
    n: '16',
    h: 'Dispute resolution & governing law',
    body: (
      <>
        <ul>
          <li><strong>Governing Law:</strong> These Terms and your use of the Platform are governed by the laws of the State of Delaware, without regard to conflict-of-law principles. You irrevocably submit to Delaware jurisdiction.</li>
          <li><strong>Arbitration Clause:</strong> Any dispute, claim, or controversy arising from or relating to these Terms or your use of the Platform (including contract formation, breach, tort claims, securities claims, and intellectual property disputes) shall be settled by final, binding arbitration under the Commercial Arbitration Rules of the American Arbitration Association (AAA), except that: (a) claims for injunctive relief may be brought in court; (b) small claims (under $10,000) may be litigated in small claims court in San Francisco County; and (c) either party may bring enforcement actions in any court of competent jurisdiction.</li>
          <li><strong>Arbitration Procedures:</strong> Arbitration shall be conducted by a single neutral arbitrator in San Francisco, California, or remotely if both parties consent. Discovery shall be limited to what is necessary to resolve the dispute. The arbitrator shall issue a written decision and award. Costs of arbitration shall be split equally unless the arbitrator awards costs to the prevailing party as permitted by law.</li>
          <li><strong>Class Action Waiver:</strong> You agree that any arbitration or court proceeding shall be conducted on an individual basis and not as a class action, class arbitration, or representative action. You waive any right to participate in class proceedings against Axal VC Management LLC.</li>
          <li><strong>Equitable Relief:</strong> Nothing herein prevents either party from seeking injunctive or equitable relief in court to prevent irreparable harm or enforce intellectual property rights.</li>
        </ul>
      </>
    ),
  },
  {
    n: '17',
    h: 'Modifications & amendments',
    body: (
      <>
        <ul>
          <li><strong>Right to Modify:</strong> Axal VC Management LLC reserves the right to modify these Terms at any time. Material modifications will be posted on the Platform and you will be notified by email. Your continued use of the Platform after modification constitutes acceptance of the revised Terms.</li>
          <li><strong>Material Changes:</strong> If a modification materially restricts your rights or increases your obligations, and you do not accept the revised Terms, you may terminate your account by written notice within thirty (30) days of the modification announcement.</li>
        </ul>
      </>
    ),
  },
  {
    n: '18',
    h: 'Severability & interpretation',
    body: (
      <>
        <ul>
          <li><strong>Severability:</strong> If any provision of these Terms is found invalid, unenforceable, or void, that provision shall be severed, and the remaining provisions shall remain in full force and effect.</li>
          <li><strong>No Waiver:</strong> Failure by Axal VC Management LLC to enforce any provision does not constitute waiver of that provision or any other right.</li>
          <li><strong>Entire Agreement:</strong> These Terms, together with the Privacy Policy and any other agreements incorporated by reference, constitute the entire agreement between you and Axal VC Management LLC and supersede all prior understandings and agreements, whether written or oral.</li>
        </ul>
      </>
    ),
  },
  {
    n: '19',
    h: 'Contact & notices',
    body: (
      <>
        <p>For questions about these Terms or to provide notice of a dispute, contact:</p>
        <p>
          <strong>Axal VC Management LLC</strong><br />
          Legal Department<br />
          Email: legal@axal.vc<br />
          Website: <code>axal.vc</code>
        </p>
        <p>All notices must be in writing and shall be deemed received upon email delivery or fifteen (15) days after mailing via registered mail.</p>
      </>
    ),
  },
  {
    n: '20',
    h: 'Additional disclosures',
    body: (
      <>
        <ul>
          <li><strong>No Broker-Dealer Status:</strong> Axal VC Management LLC is not a registered broker-dealer, investment adviser, or financial institution. It does not provide brokerage services, execute trades, or hold user funds.</li>
          <li><strong>Emerging Manager Status:</strong> Axal VC GP LLC, as general partner of Axal VC Spin-Out Lab Fund I LP, may be a private, emerging venture capital manager and may not be registered with the SEC. LPs should conduct independent due diligence on the Fund and its general partner.</li>
          <li><strong>Risk Acknowledgment:</strong> Venture capital investments are highly illiquid, speculative, and carry a substantial risk of total loss of principal. No investor should allocate capital to venture investments beyond their ability to sustain complete loss without financial hardship.</li>
          <li><strong>No Audit:</strong> Axal VC Management LLC does not audit, verify, or guarantee the financial or operational accuracy of any company, fund, or investment opportunity presented on the Platform. All due diligence is your sole responsibility.</li>
          <li><strong>Tax Implications:</strong> You acknowledge that investments in venture funds and startups have complex tax implications, including carried interest tax consequences for investors and employees. Consult your tax advisor.</li>
        </ul>
      </>
    ),
  },
  {
    n: null,
    h: 'Acknowledgment',
    body: (
      <>
        <p>
          By accessing and using the Axal VC Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service in their entirety, including all disclaimers, limitations, and acknowledgments. If you do not agree to any part of these Terms, you may not use the Platform.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      updated={TERMS_UPDATED}
      intro={INTRO}
      sections={SECTIONS}
      email={TERMS_EMAIL}
    />
  );
}
