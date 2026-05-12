import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// NOTE FOR INTERNAL USE — REMOVE BEFORE PRODUCTION:
// These Terms of Service are a comprehensive working draft tailored to
// the current StudioOS feature set. They MUST be reviewed by qualified
// legal counsel in every jurisdiction where Axal VC offers services
// before going live. Securities, advisory, AML, and consumer-protection
// items in particular need counsel sign-off. Items marked [LEGAL
// REVIEW] are placeholders to be confirmed.

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8">
          <ArrowLeft size={16} /> Back to Axal Ventures
        </Link>

        <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-gray-600 mb-2">Effective Date: May 12, 2026</p>
        <p className="text-sm text-gray-500 mb-8">
          These Terms of Service (&quot;Terms&quot;) govern your access to and
          use of studioos.axal.vc and the related Cloudflare-hosted
          services (the &quot;Platform&quot;) operated by Axal VC
          (&quot;Axal,&quot; &quot;we,&quot; &quot;us&quot;). By creating an account or
          using the Platform you accept these Terms. If you do not
          agree, do not use the Platform.
        </p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-8">

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">1. What the Platform is</h2>
            <p>
              The Platform is a venture studio and venture capital operating
              system. It supports founders, investors, mentors, operating
              partners, and Axal administrators with workflows for:
              project building, customer discovery, roadmap and OKRs,
              cap-table management, fundraising, incorporation, e-signature,
              KYC/KYB/accreditation, mentor and office-hours booking,
              co-founder matching, market intelligence, due diligence,
              integrations with third-party CRMs and data feeds, and an
              AI Personal Advisor.
            </p>
            <p>
              The Platform is an information-management tool. Except where
              we expressly say otherwise in a separate written agreement,
              <strong> Axal is not acting as your broker-dealer, investment
              adviser, attorney, accountant, or fiduciary</strong> when you
              use the Platform. Nothing on the Platform is investment,
              tax, or legal advice. Templates, scoring outputs, advisor
              suggestions, and market signals are informational only.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">2. Eligibility and accounts</h2>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>You must be at least 18 years old and legally able to enter into a binding contract.</li>
              <li>Some features (e.g. accessing investor deal rooms, participating in capital partnerships) require additional eligibility — including, where applicable, <strong>accredited-investor status under Rule 501 of Regulation D</strong> in the United States, professional/sophisticated-investor status in the EU/UK, or equivalent qualification under your local law.</li>
              <li>You agree to provide accurate, complete, and up-to-date information about yourself and any entity you represent, and to keep that information current. Misrepresentations may result in suspension, termination, and reporting to applicable authorities.</li>
              <li>You are responsible for everything that happens under your account. Choose a strong password, keep it secret, and enable two-factor authentication. Notify <a href="mailto:security@axal.vc" className="text-violet-700 underline">security@axal.vc</a> immediately of any unauthorized use.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">3. Roles and what each one gets</h2>
            <p>
              The features available to you depend on your account role
              and (where applicable) your subscription tier. Roles and
              tiers may change over time; we will give you notice of
              material changes that affect what you can do or what you
              pay.
            </p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Founders</strong> — Free, Growth, or Studio subscription. Some heavy-leverage features (capital raising, advanced legal templates, KYC bulk operations) require Growth or Studio.</li>
              <li><strong>Investors</strong> — Free, Professional, or Institutional subscription. Higher tiers unlock more saved searches, deal-room slots, co-invest rights of first look, and dedicated reporting.</li>
              <li><strong>Mentors</strong> — Free. Mentor activity is governed by a separate Mentor Engagement disclaimer signed at onboarding.</li>
              <li><strong>Operating Partners</strong> — Access governed by a separate Partner Deal Agreement (equity, services, deal-sourcing, capital, or custom).</li>
              <li><strong>Spin-Out Lab participants</strong> — New founders without an incorporated company get guided, week-gated access to the Platform during the 30-day sprint.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">4. Subscriptions, billing, refunds</h2>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>Paid subscriptions renew automatically on a monthly or annual cycle. Stripe is our payment processor; by subscribing you also agree to Stripe&apos;s terms.</li>
              <li>You may cancel at any time in Settings &gt; Billing. Cancellation prevents the next renewal; access continues until the end of your current billing period.</li>
              <li>Fees are non-refundable except where required by law. We may issue prorated credits for service outages or in cases of clear billing error at our discretion.</li>
              <li>Taxes are added where required. You are responsible for any taxes payable on your end (withholding, VAT/GST registration, etc.).</li>
              <li>We may change pricing on no less than 30 days&apos; notice for renewals. Existing prepaid annual terms are honored.</li>
              <li>If a payment fails, we will retry in line with Stripe&apos;s retry schedule. Persistent failure may result in downgrade to Free or suspension.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">5. KYC, KYB, accreditation, sanctions</h2>
            <p>
              Some features require us to verify who you are, who your
              entity is, and that you meet legal thresholds for certain
              activities. By using those features you agree to provide
              the requested documentation and consent to our use of
              third-party verifiers (Persona, Sumsub, or equivalents).
            </p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Founders</strong> on the Spin-Out Lab do not require KYC for basic use; KYC is triggered if and when you incorporate, move capital, or accept payouts.</li>
              <li><strong>Investors</strong> must complete KYC, accreditation, and (if investing through an entity) KYB before accessing private deal rooms.</li>
              <li><strong>Mentors</strong> sign a mutual NDA and engagement disclaimer.</li>
              <li><strong>Operating partners</strong> always complete KYB; KYC and accreditation are required only for capital-bearing partnerships.</li>
              <li>We screen against OFAC, EU, UK, UN, and other applicable consolidated sanctions and PEP lists. A confirmed hit will result in denial or termination of access; we will follow the law in each case.</li>
              <li>If you believe we have made an error in screening, contact <a href="mailto:compliance@axal.vc" className="text-violet-700 underline">compliance@axal.vc</a>.</li>
            </ul>
            <p>[LEGAL REVIEW] Confirm jurisdiction-specific accreditation language for US/EU/UK/CA/APAC and align with Trust Center copy.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">6. NDAs and confidentiality</h2>
            <p>
              The Platform issues several NDAs and confidentiality
              agreements: a platform NDA between you and Axal at signup;
              a three-way Founder ↔ Investor ↔ Axal NDA before private
              founder data is unlocked to an investor; mentor and partner
              NDAs at onboarding. By signing these you agree to the terms
              in the respective documents, which prevail over these Terms
              for the specific subject matter they cover.
            </p>
            <p>
              Until a relevant NDA is in force, content tagged as
              &quot;private&quot; in the Platform stays masked. Disregarding NDA
              obligations may result in account termination and legal
              action.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">7. Content you submit</h2>
            <p>
              You retain ownership of the content you upload or generate on
              the Platform (project descriptions, OKRs, deck content,
              financial figures, cap-table inputs, advisor answers,
              uploaded documents). You grant Axal a worldwide,
              non-exclusive, royalty-free license to host, process, copy,
              display, and otherwise use that content as needed to operate
              and improve the Platform — including to produce aggregated,
              anonymised analytics where you have not opted out — for the
              duration you keep the content on the Platform.
            </p>
            <p>
              You represent and warrant that you have the right to submit
              the content, that it does not infringe anyone&apos;s rights, and
              that the financial and identity information you provide is
              true and not misleading. Misrepresentation of high-leverage
              figures (TAM, MRR, ARR, runway, cap-table holdings,
              accreditation status) is a material breach of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">8. Personal Advisor and AI features</h2>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>The Personal Advisor and other AI-powered features are tools, not advisors. Output may be inaccurate, incomplete, or out of date. You are responsible for verifying anything you act on.</li>
              <li>The Advisor is scope-locked to platform tasks. Attempts to bypass that scope — including prompt injection, jailbreaks, or scraping — are prohibited and may be detected and blocked.</li>
              <li>We may apply per-user usage limits to AI features to control cost and abuse.</li>
              <li>We do not knowingly train any third-party model on your inputs. Our LLM providers (Cloudflare Workers AI, GitHub Models in non-production, Anthropic for narrow high-stakes synthesis) operate under their own data-use commitments which we honor.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">9. Integrations</h2>
            <p>
              You can connect third-party services to your account (HubSpot,
              Calendly, Salesforce, Carta, Crunchbase, Slack, DocuSign,
              Affinity, and others). Each provider has its own terms; you
              are responsible for complying with them. We process tokens
              and data exchanged with these providers under §6 of the
              Privacy Policy. You can disconnect at any time in Settings &gt;
              Integrations; we will purge stored tokens within 7 days.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">10. Permitted use; what is prohibited</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li>Use the Platform for any unlawful purpose, to violate sanctions, or to facilitate fraud, market manipulation, money laundering, or terrorism financing.</li>
              <li>Misrepresent identity, qualifications, accreditation, financial figures, cap-table holdings, or conflicts of interest.</li>
              <li>Access, scrape, or copy other users&apos; data outside features designed for that purpose (and any applicable NDA).</li>
              <li>Reverse engineer, decompile, or attempt to derive source code from the Platform.</li>
              <li>Probe, scan, or test the vulnerability of the Platform without written authorization (responsible security research per <a href="https://github.com/AxalNetwork/StudioOS/blob/main/SECURITY.md" className="text-violet-700 underline">SECURITY.md</a> is welcome).</li>
              <li>Send spam, malware, or unauthorized commercial communications via the Platform.</li>
              <li>Build a competing product using the Platform&apos;s data, content, or workflows.</li>
              <li>Resell, sublicense, or expose the Platform to third parties beyond seats your subscription authorizes.</li>
              <li>Use the Platform to provide investment advice or regulated financial services to third parties.</li>
            </ul>
            <p>
              We may suspend or terminate accounts engaged in any of the
              above and report serious violations to authorities.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">11. Intellectual property</h2>
            <p>
              The Platform, including its software, designs, templates,
              brand, and content provided by Axal (other than user
              content), is owned by Axal and our licensors and is
              protected by intellectual-property laws. Subject to these
              Terms, we grant you a limited, non-exclusive, non-
              transferable, revocable license to access and use the
              Platform for its intended purpose during your subscription.
              You may not remove proprietary notices.
            </p>
            <p>
              Templates we provide (NDAs, cofounder agreements, Section
              83(b) forms, SAFE/convertible templates, partnership
              agreements, etc.) are starting points; their use does not
              create an attorney-client relationship with Axal, and you
              should have qualified counsel review any document before
              relying on it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">12. Due Diligence findings</h2>
            <p>
              Due Diligence outputs — including platform-internal scoring,
              risk bands, and section-level findings — are generated
              from a mix of self-reported data, third-party integrations,
              and public sources. They are not guarantees, certifications,
              or assurances about any person or entity. Investors must
              conduct their own independent diligence before making any
              investment decision. Founders subject to DD will have the
              opportunity to review and respond to factual inaccuracies
              before any final report is shared with an external party.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">13. Capital activities and securities disclaimer</h2>
            <p>
              The Platform may help users coordinate fundraising and
              cap-table activity. Axal is not a registered broker-dealer
              or investment adviser. The Platform is not a securities
              offering, a solicitation, or a placement service. Any
              securities transaction conducted between users is solely
              between those users and their respective counsel. Axal does
              not provide investment recommendations, valuations,
              fairness opinions, or fiduciary advice through the Platform.
            </p>
            <p>
              <strong>Venture investments are highly risky and
              illiquid.</strong> Investors should expect that some or all
              of their capital may be lost and should only invest amounts
              they can afford to lose entirely.
            </p>
            <p>[LEGAL REVIEW] Country-specific securities disclaimers (US 506(c), EU PR, UK FSMA, etc.).</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">14. Third-party content</h2>
            <p>
              The Platform may surface third-party content (news, public
              registries, market data, integration outputs). Axal does not
              endorse or guarantee accuracy of that content. Your use of
              third-party content is at your own risk and subject to the
              third party&apos;s terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">15. Suspension and termination</h2>
            <p>
              We may suspend or terminate your access at any time, with
              or without notice, for: violation of these Terms, sanctions
              or regulatory restrictions, security incidents, non-payment,
              or the discontinuation of the Platform. Where reasonable, we
              will give you advance notice and an opportunity to cure.
            </p>
            <p>
              You may terminate at any time in Settings &gt; Account &gt;
              Delete account. Upon termination we will retain personal
              data only as described in §10 of the Privacy Policy.
              Confidentiality obligations, accrued payment obligations,
              and provisions that by their nature should survive will
              survive termination.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">16. Disclaimer of warranties</h2>
            <p>
              To the maximum extent permitted by law, the Platform is
              provided <strong>&quot;AS IS&quot; and &quot;AS AVAILABLE&quot;</strong> without
              warranties of any kind, express or implied, including
              merchantability, fitness for a particular purpose, non-
              infringement, accuracy, or that the Platform will be
              uninterrupted or error-free. Some jurisdictions do not
              allow exclusion of implied warranties; in those
              jurisdictions our liability is limited to the maximum
              extent permitted.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">17. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, neither Axal nor
              its affiliates, officers, employees, agents, or licensors
              will be liable for any indirect, incidental, special,
              consequential, exemplary, or punitive damages, or for any
              lost profits, lost revenue, lost data, business interruption,
              or substitute services, even if advised of the possibility.
              Our aggregate liability arising out of or relating to the
              Platform will not exceed the greater of (a) the fees you
              paid to Axal in the 12 months before the event giving rise
              to the claim, or (b) US $100.
            </p>
            <p>
              Some jurisdictions do not allow these limitations; in those
              jurisdictions our liability is limited to the maximum
              extent permitted by law.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">18. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Axal and its
              affiliates from any claims, damages, and expenses
              (including reasonable attorneys&apos; fees) arising out of (i)
              your breach of these Terms or any NDA, (ii) your
              misrepresentations on the Platform, (iii) content you
              submit, or (iv) your unlawful use of the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">19. Governing law and dispute resolution</h2>
            <p>
              These Terms are governed by the laws of [LEGAL REVIEW —
              Delaware / England &amp; Wales / other], without regard to
              conflict-of-laws principles. The exclusive venue for
              disputes is the state or federal courts located in [LEGAL
              REVIEW — county/city], and you and Axal consent to
              personal jurisdiction there.
            </p>
            <p>
              [LEGAL REVIEW] Decide whether to include a binding
              arbitration / class-action waiver clause (US) and confirm
              consumer-protection carve-outs for EU/UK users.
            </p>
            <p>
              Nothing in this section limits a party&apos;s right to seek
              injunctive relief in any court of competent jurisdiction
              for the protection of intellectual property or
              confidential information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">20. Changes to these Terms</h2>
            <p>
              We may update these Terms. If we make material changes we
              will give notice through the Platform or by email at least
              14 days before they take effect, where required by law.
              Continued use of the Platform after the effective date
              constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">21. Notices</h2>
            <p>
              We may send notices to the email address on your account or
              through in-app messages. You may send notices to <a href="mailto:legal@axal.vc" className="text-violet-700 underline">legal@axal.vc</a> or
              to our registered postal address [LEGAL REVIEW].
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">22. Miscellaneous</h2>
            <ul className="list-disc list-outside ml-6 space-y-2">
              <li><strong>Entire agreement.</strong> These Terms, the Privacy Policy, any subscription order, and any NDA, partner deal, or engagement disclaimer you sign make up the entire agreement.</li>
              <li><strong>Order of precedence.</strong> Where these Terms conflict with a separately signed agreement (e.g. Partner Deal Agreement, Investor Subscription Agreement, NDA), the separately signed agreement controls for its subject matter.</li>
              <li><strong>Severability.</strong> If any provision is held unenforceable, the remaining provisions remain in effect.</li>
              <li><strong>Waiver.</strong> A failure to enforce a provision is not a waiver.</li>
              <li><strong>Assignment.</strong> You may not assign these Terms without our consent; we may assign them as part of a merger, acquisition, financing, or asset sale.</li>
              <li><strong>Force majeure.</strong> Neither party is liable for failures caused by events outside reasonable control (natural disaster, war, pandemic, third-party infrastructure outage).</li>
              <li><strong>Independent contractors.</strong> No partnership, joint venture, or employment relationship is created by these Terms.</li>
              <li><strong>Headings.</strong> Section headings are for convenience only and do not affect interpretation.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">23. Contact</h2>
            <p>
              Legal: <a href="mailto:legal@axal.vc" className="text-violet-700 underline">legal@axal.vc</a><br/>
              Compliance: <a href="mailto:compliance@axal.vc" className="text-violet-700 underline">compliance@axal.vc</a><br/>
              Privacy: <a href="mailto:privacy@axal.vc" className="text-violet-700 underline">privacy@axal.vc</a><br/>
              Security: <a href="mailto:security@axal.vc" className="text-violet-700 underline">security@axal.vc</a><br/>
              Postal: [LEGAL REVIEW — confirmed registered postal address]
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
