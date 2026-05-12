import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// NOTE FOR INTERNAL USE — REMOVE BEFORE PRODUCTION:
// This Privacy Policy is a comprehensive working draft tailored to the
// current StudioOS feature set (Spin-Out Lab, KYC/KYB/Accreditation,
// e-sign, DD, integrations, Personal Advisor, paywalls, Cloudflare
// production stack). It MUST be reviewed by qualified legal counsel
// in every jurisdiction where Axal VC offers services before going
// live. Areas particularly requiring counsel review are flagged inline
// with [LEGAL REVIEW].

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8">
          <ArrowLeft size={16} /> Back to Axal Ventures
        </Link>

        <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-gray-600 mb-2">Last Updated: May 12, 2026</p>
        <p className="text-sm text-gray-500 mb-8">
          This Privacy Policy explains what personal information Axal VC
          (&quot;Axal,&quot; &quot;we,&quot; &quot;us&quot;) collects when you use
          studioos.axal.vc and the related Cloudflare-hosted services
          (collectively, the &quot;Platform&quot;), how we use it, who we share
          it with, and the rights you have over it.
        </p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-8">

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">1. Who we are</h2>
            <p>
              Axal VC is a venture studio and venture capital firm. The
              Platform is operated by Axal VC and its affiliates. For the
              purposes of EU and UK data protection law we act as the
              <strong> data controller</strong> for the personal information
              described in this policy, except where we expressly act as a
              processor on behalf of a Customer (for example, when a partner
              firm uses the Platform under a contracted-services agreement).
            </p>
            <p>
              Contact: <a href="mailto:privacy@axal.vc" className="text-violet-700 underline">privacy@axal.vc</a>.
              Data-protection inquiries: <a href="mailto:dpo@axal.vc" className="text-violet-700 underline">dpo@axal.vc</a>.
              Registered office: [LEGAL REVIEW — confirmed registered address].
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">2. The five roles we serve</h2>
            <p>
              Different parts of the Platform collect different information.
              What we collect from you depends on the role you hold:
            </p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Founders</strong> — building or running a venture.</li>
              <li><strong>Investors</strong> — sourcing, diligencing, or backing ventures.</li>
              <li><strong>Mentors</strong> — providing advice to founders.</li>
              <li><strong>Operating Partners</strong> — providing services, deal flow, or capital to Axal under a partnership agreement.</li>
              <li><strong>Administrators</strong> — Axal staff and authorized operators.</li>
            </ul>
            <p>
              The data we require scales with the role and the risk of the
              activity. Founders running the 30-day Spin-Out Lab provide
              minimal information; investors and capital partners go
              through identity verification and accreditation.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">3. Information we collect</h2>

            <h3 className="text-lg font-semibold text-gray-900 mt-4">3.1 Information you give us</h3>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Account &amp; identity:</strong> name, email, password (hashed with bcrypt/Argon2), phone (for SMS 2FA), profile photo, pronouns, time zone, locale, profile slug.</li>
              <li><strong>Professional profile:</strong> firm/company, role/title, headline, bio, sectors, geographies, stages, links to professional or social profiles.</li>
              <li><strong>Venture data (founders):</strong> project name, problem statement, solution description, target customer, market sizing, traction metrics, customer-discovery interviews, OKRs, roadmap, financial figures (MRR, ARR, burn, runway), cap table, deck content, brand assets.</li>
              <li><strong>Investor data (investors):</strong> firm/fund name, AUM, ticket sizes, stage focus, sectors, thesis, allergies, deployment targets, lead/follow preferences, watchlist, conflicts disclosures.</li>
              <li><strong>Partner data (operating partners):</strong> services offered, capacity, rate cards, capital capacity, deal preferences, references, conflicts, insurance coverage.</li>
              <li><strong>Mentor data:</strong> expertise tags, sectors, capacity, comp preference, references, calendar provider.</li>
              <li><strong>Identity verification (when required):</strong> full legal name, date of birth, nationality, government-issued ID (passport, national ID, driver&apos;s license), residential address, tax identification number, photographs and short video for liveness check (collected by our KYC vendor — Persona or Sumsub — under their certified processes).</li>
              <li><strong>Corporate / entity (when required):</strong> legal entity name, entity type, country and state of incorporation, registration number, business tax ID, registered and operating addresses, directors and ultimate beneficial owners, organizing documents, board resolutions, insurance certificates.</li>
              <li><strong>Accreditation evidence (investors and capital partners):</strong> income or net-worth attestations, financial-institution letters, or third-party verifier confirmations, depending on jurisdiction.</li>
              <li><strong>Financial connectivity (optional):</strong> tokens issued by Stripe Connect, Plaid, Carta, Affinity, HubSpot, Salesforce, Calendly, Crunchbase, Slack, DocuSign — and the data those providers expose to us when you authorize the connection.</li>
              <li><strong>Communications:</strong> messages you send through the Platform, content you submit to Personal Advisor and Customer Discovery, support tickets, e-signature flows, NDAs, contracts, attestations.</li>
              <li><strong>Billing:</strong> handled by Stripe; we receive metadata (customer ID, subscription tier, renewal date, invoice IDs) but never your full card number.</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-900 mt-4">3.2 Information we collect automatically</h3>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Device &amp; connection:</strong> IP address, user-agent, device type, approximate geolocation (city / country), language, time zone, screen size.</li>
              <li><strong>Activity:</strong> pages viewed, features used, clicks, time spent, scroll depth, search queries, advisor conversations, errors encountered.</li>
              <li><strong>Authentication state:</strong> login timestamps, sessions (issuing IP and device), 2FA method used, recovery-code use, sign-in failures.</li>
              <li><strong>Cloudflare protective layer:</strong> request metadata used for WAF, rate limiting, Bot Fight Mode, and Turnstile challenges.</li>
              <li><strong>Cookies &amp; similar technologies:</strong> see §11.</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-900 mt-4">3.3 Information from third parties</h3>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Identity verification vendors</strong> — Persona, Sumsub, or equivalents — return KYC/KYB results, AML/PEP/sanctions screening hits, and document images.</li>
              <li><strong>Public registries and data sources</strong> for Due Diligence: Companies House, SEC EDGAR, OFAC/EU/UK consolidated sanctions lists, Crunchbase, PitchBook (where licensed), patent and research databases, public news (GDELT, NewsAPI), professional networks.</li>
              <li><strong>OAuth providers</strong> you connect (Google, Microsoft, LinkedIn, Stripe, etc.) — profile fields and the scopes you authorize.</li>
              <li><strong>Referrals</strong> — when another user invites you, we receive your email and any notes the inviter shared.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">4. How we use your information</h2>
            <p>We use personal information for the following purposes, each tied to a legal basis where EU/UK law applies:</p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Operate the Platform</strong> — accounts, role-based access, navigation, search (legal basis: contract).</li>
              <li><strong>Identity verification, AML, accreditation</strong> — including sanctions and PEP screening on KYC/KYB submission and on any change of country or entity type (legal basis: legal obligation; legitimate interests in protecting investors and the integrity of the platform).</li>
              <li><strong>Personal Advisor and tutoring</strong> — to ask role-specific questions, propose features, and auto-fill platform pages on your behalf when you provide answers. The Advisor uses Cloudflare Workers AI and, in some non-production environments, GitHub Models; see §6.</li>
              <li><strong>Due Diligence</strong> — to run technical, financial, legal, and reputational diligence on ventures, partners, and applicants. DD findings are visible only to authorized Axal admins, partners, investors, and mentors assigned to the case, subject to NDAs (legal basis: legitimate interests in informed investment decisions; consent where required).</li>
              <li><strong>Founder ↔ Investor introductions</strong> — to coordinate three-way NDAs (Founder, Investor, Axal as intermediary) before private founder data is unlocked to an investor.</li>
              <li><strong>Market Intelligence</strong> — to produce aggregated, anonymised insights (sector compass, investor signals, sentiment, technology-adoption-lifecycle positioning). We apply k-anonymity (n ≥ 5) and aggregation; we do not publish row-level data. You can opt out at any time in Settings &gt; Privacy. (legal basis: legitimate interests; consent for sensitive data).</li>
              <li><strong>Notifications</strong> — email and in-app messages for account, security, billing, contracts, deals, mentor sessions, calendar events, and (with your consent) marketing.</li>
              <li><strong>Billing and tax</strong> — subscription management, payment processing, invoicing, tax reporting (legal basis: contract; legal obligation).</li>
              <li><strong>Safety and abuse prevention</strong> — anti-fraud, anti-cheat checks on self-reported financial figures (cross-checked against Stripe/Plaid where you have connected them), rate limiting, prompt-injection detection on the Advisor.</li>
              <li><strong>Improving the Platform</strong> — debugging, error monitoring, performance tuning, feature analytics.</li>
              <li><strong>Compliance and legal claims</strong> — responding to lawful requests, enforcing our Terms, defending or bringing legal claims.</li>
            </ul>
            <p>
              <strong>We do not sell your personal information</strong> and we do
              not engage in &quot;sharing&quot; or &quot;targeted advertising&quot;
              within the meaning of California, Colorado, or comparable
              state privacy laws.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">5. Who we share information with</h2>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Other users you choose to engage with.</strong> Founders, investors, mentors, and partners see each other&apos;s information only as permitted by your visibility settings and any pairwise NDA in force.</li>
              <li><strong>Sub-processors</strong> who run parts of the Platform on our behalf. Current list — <a href="/trust-center/subprocessors" className="text-violet-700 underline">trust-center/subprocessors</a> — includes: Cloudflare (workers, D1, R2, KV, Queues, Durable Objects, Workers AI, Browser Rendering, Pages, Access, WAF), Stripe (billing), Persona and/or Sumsub (KYC/KYB), Google Workspace and/or Microsoft 365 (email and calendar), DocuSign (e-sign, optional), Anthropic (LLM fallback for high-stakes synthesis only, with prompt caching), Plaid (financial connectivity, optional), Carta (cap-table sync, optional), and the integrations you connect.</li>
              <li><strong>Investors and operating partners</strong> who have signed an NDA with you (Founder ↔ Investor three-way NDA, or partner-specific NDA), only with respect to the data the NDA covers.</li>
              <li><strong>Professional advisors</strong> we engage — auditors, lawyers, accountants, insurance providers — under confidentiality obligations.</li>
              <li><strong>Authorities</strong> — when we are legally required to disclose, or to comply with court orders, sanctions screening, AML obligations, or law-enforcement requests. We push back on overbroad demands.</li>
              <li><strong>In a corporate transaction</strong> — if Axal is involved in a merger, acquisition, financing, or asset sale, your information may transfer to the successor under equivalent protections.</li>
            </ul>
            <p>[LEGAL REVIEW] The subprocessors page must be kept current; review quarterly.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">6. AI and the Personal Advisor</h2>
            <p>
              The Personal Advisor is an AI assistant that helps you fill in
              your project pages, profile, thesis, and other platform
              surfaces. It is constrained to platform tasks and refuses
              off-topic requests. We process your messages through
              Cloudflare Workers AI for live production traffic; for
              preview and development we may route to GitHub Models;
              high-stakes synthesis (for example, due-diligence report
              summaries) may use Anthropic Claude with prompt caching.
              We do not train any third-party model on your inputs.
            </p>
            <p>
              The Advisor never reads another user&apos;s private data into
              your conversation. Tool calls (e.g. &quot;find a mentor&quot;) are
              executed by our Worker against the platform&apos;s authorized
              data only. Conversations are retained per §10.
            </p>
            <p>
              The Advisor will not take destructive actions on your behalf.
              Where high-leverage figures (TAM, MRR, runway, cash balance,
              etc.) are involved, we may require you to attest and may
              cross-check against your connected Stripe / Plaid /
              accounting source. We do this both to protect investors
              and to maintain the integrity of platform-wide aggregates.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">7. International transfers</h2>
            <p>
              The Platform runs on Cloudflare&apos;s global edge. Your data may
              be stored or processed in the United States, the European
              Economic Area, the United Kingdom, and other countries where
              our sub-processors operate. Where we transfer personal data
              out of the EEA or UK, we rely on Standard Contractual Clauses,
              the UK International Data Transfer Addendum, or an equivalent
              valid transfer mechanism. We assess transfer risk regularly
              and apply additional safeguards (encryption in transit,
              encryption at rest, contractual restrictions on sub-processor
              re-transfer) where warranted.
            </p>
            <p>[LEGAL REVIEW] Map of data residency by sub-processor required.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">8. Security</h2>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>TLS 1.2+ in transit; HSTS on all axal.vc subdomains.</li>
              <li>Sensitive PII columns (tax ID, phone, government ID numbers, financial figures, cap-table holders) encrypted at the column level with AES-256-GCM and per-tenant data-encryption keys wrapped by a master KEK; only last-4 digits stored in cleartext where used for UX.</li>
              <li>Signed contracts and uploaded documents stored in Cloudflare R2 with per-envelope encryption keys and gated short-lived download URLs minted by the Worker; no public R2 access.</li>
              <li>Two-factor authentication available (TOTP and SMS via Google Identity Platform); high-risk actions (admin impersonation, billing changes, contract void, DD report download) require TOTP specifically.</li>
              <li>Cloudflare Access protects administrative routes.</li>
              <li>Audit logs of administrative actions and security-sensitive operations are retained for at least 7 years for regulated record-keeping; routine production logs are retained for a shorter period.</li>
              <li>We follow a coordinated-disclosure vulnerability program — see <a href="https://github.com/AxalNetwork/StudioOS/blob/main/SECURITY.md" className="text-violet-700 underline">SECURITY.md</a>.</li>
            </ul>
            <p>
              No method of transmission or storage is perfectly secure.
              If we suffer a security incident materially affecting your
              personal data we will notify you and the relevant
              regulators within the timelines required by law.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">9. Your rights</h2>
            <p>Depending on where you live, you may have the right to:</p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>Access the personal data we hold about you.</li>
              <li>Correct inaccurate or incomplete data.</li>
              <li>Delete data we no longer need to retain (subject to overriding legal obligations such as AML record-keeping and accreditation evidence).</li>
              <li>Restrict or object to certain processing.</li>
              <li>Withdraw consent at any time where we rely on consent (without affecting prior lawful processing).</li>
              <li>Export a portable copy of the data you provided.</li>
              <li>Opt out of analytics contributions in Settings &gt; Privacy.</li>
              <li>Opt out of marketing emails via the unsubscribe link in every marketing message.</li>
              <li>Lodge a complaint with your supervisory authority (EEA, UK, CA, US state attorney general, etc.).</li>
              <li>Use the Global Privacy Control (GPC) browser signal to opt out of any sale or sharing of personal information; we honor GPC.</li>
            </ul>
            <p>
              To exercise any of these rights, email <a href="mailto:privacy@axal.vc" className="text-violet-700 underline">privacy@axal.vc</a> from
              the email registered to your account, or use the request
              forms in Settings &gt; Privacy. We respond within 30 days
              (extendable by another 60 days for complex requests, with
              notice). We may need to verify your identity before fulfilling
              a request.
            </p>
            <p>
              California residents: see §13 for additional disclosures.
              EU/UK residents: see §14.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">10. Retention</h2>
            <p>
              We keep personal data only as long as necessary for the
              purposes described in §4 or as required by law. Indicative
              periods:
            </p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>Account data — for the life of the account; deleted within 30 days of a confirmed account-deletion request unless overriding legal obligations apply.</li>
              <li>KYC/KYB/Accreditation records — at least 5 years after the end of the customer relationship, in line with AML record-keeping requirements; longer where required by applicable law.</li>
              <li>Signed contracts and e-sign envelopes — 7 years minimum.</li>
              <li>Billing and tax records — as required by applicable tax law (typically 7–10 years).</li>
              <li>Advisor conversations — 90 days for Free tier, 1 year for paid tiers; longer where you have explicitly opted in.</li>
              <li>Sanctions / PEP / DD findings — at least 7 years.</li>
              <li>Production access and security logs — at least 7 years (audit log streamed to long-term cold storage).</li>
              <li>Aggregated, anonymised statistics — indefinitely; these contain no identifying information.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">11. Cookies and similar technologies</h2>
            <p>We use a small set of cookies:</p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Strictly necessary</strong> — session, CSRF, Cloudflare Turnstile, Cloudflare bot protection. These cannot be turned off.</li>
              <li><strong>Functional</strong> — your theme, density, sidebar default, dismissed page explainers, last-active tab.</li>
              <li><strong>Analytics</strong> — privacy-friendly first-party analytics for feature usage. We do not use third-party advertising trackers.</li>
            </ul>
            <p>
              You can manage cookie categories in Settings &gt; Privacy.
              We honor the Global Privacy Control signal automatically.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">12. Children</h2>
            <p>
              The Platform is not intended for users under 18 years of age,
              and we do not knowingly collect personal data from children.
              If you believe a child has provided us personal data, contact
              <a href="mailto:privacy@axal.vc" className="text-violet-700 underline"> privacy@axal.vc</a> and
              we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">13. California residents</h2>
            <p>
              In the past 12 months we have collected the categories of
              personal information described in §3 for the business
              purposes in §4. We do not sell personal information and do
              not engage in &quot;sharing&quot; for cross-context behavioral
              advertising. California residents have the rights set out
              in §9. To submit a request, email <a href="mailto:privacy@axal.vc" className="text-violet-700 underline">privacy@axal.vc</a> or
              use the in-product request form. We do not discriminate
              against users who exercise their privacy rights.
            </p>
            <p>[LEGAL REVIEW] CPRA categories table to be inserted.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">14. EEA and UK residents</h2>
            <p>
              We rely on the following legal bases under the GDPR and UK
              GDPR: (i) <strong>contract</strong> for account operation
              and the services you use; (ii) <strong>legal obligation</strong> for
              KYC/AML/sanctions, tax, and record-keeping; (iii) <strong>legitimate
              interests</strong> for Due Diligence on potential investments,
              security, fraud prevention, product improvement, and
              anonymised market analytics; (iv) <strong>consent</strong> for
              marketing communications and any optional sensitive-data
              processing.
            </p>
            <p>
              For data transfers outside the EEA or UK we rely on the
              European Commission&apos;s Standard Contractual Clauses, the
              UK Addendum, or an equivalent transfer tool. Contact our
              data-protection officer at <a href="mailto:dpo@axal.vc" className="text-violet-700 underline">dpo@axal.vc</a>.
              You have the right to complain to your local supervisory
              authority.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">15. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. If we make
              material changes we will give you notice through the
              Platform or by email at least 14 days before they take
              effect, where required by law. The &quot;Last Updated&quot; date
              at the top tells you when this version was published.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">16. Contact</h2>
            <p>
              Privacy questions: <a href="mailto:privacy@axal.vc" className="text-violet-700 underline">privacy@axal.vc</a><br/>
              Data Protection Officer: <a href="mailto:dpo@axal.vc" className="text-violet-700 underline">dpo@axal.vc</a><br/>
              Security: <a href="mailto:security@axal.vc" className="text-violet-700 underline">security@axal.vc</a><br/>
              Postal: [LEGAL REVIEW — confirmed registered postal address]
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
