import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, ChevronRight, Search, X } from 'lucide-react';

const SECTIONS = [
  { id: 'quickstart', title: 'Quickstart' },
  { id: 'how-it-works', title: 'How StudioOS Works' },
  { id: 'for-founders', title: 'For Founders' },
  { id: 'for-investors', title: 'For Investors & LPs' },
  { id: 'for-partners', title: 'For Partners' },
  { id: 'plans', title: 'Plans & Pricing' },
  { id: 'security', title: 'Security & Privacy' },
  { id: 'notifications', title: 'Notifications & Search' },
  { id: 'api', title: 'API & Integrations' },
  { id: 'support', title: 'Support & SLAs' },
  { id: 'glossary', title: 'Glossary' },
  { id: 'changelog', title: 'Changelog' },
];

function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-4 pb-2 border-b border-gray-100 scroll-mt-20">
      {children}
    </h2>
  );
}
function H3({ children }) {
  return <h3 className="text-base font-semibold text-gray-800 mt-6 mb-2 scroll-mt-20">{children}</h3>;
}
function P({ children }) {
  return <p className="text-sm text-gray-700 leading-relaxed mb-3">{children}</p>;
}
function UL({ children }) {
  return <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 mb-3 pl-2">{children}</ul>;
}
function LI({ children }) {
  return <li className="leading-relaxed">{children}</li>;
}
function Strong({ children }) {
  return <strong className="font-semibold text-gray-900">{children}</strong>;
}
function Code({ children }) {
  return <code className="font-mono text-[11px] bg-gray-100 text-violet-700 px-1.5 py-0.5 rounded">{children}</code>;
}
function Note({ children }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 mb-4">
      {children}
    </div>
  );
}

function ScoreTable() {
  const rows = [
    ['Market', '25', 'TAM/SAM (10), Urgency (10), Trend (5)'],
    ['Team', '20', 'Expertise (8), Execution (8), Network (4)'],
    ['Product', '15', 'MVP time (7), Complexity (5), Dependencies (3)'],
    ['Capital', '15', 'Cost to MVP (7), Time to revenue (5), Burn risk (3)'],
    ['Strategic Fit', '15', 'Alignment with thesis (10), Synergy (5)'],
    ['Distribution', '10', 'Channels (5), Virality (5)'],
  ];
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">Dimension</th>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">Max pts</th>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">What we measure</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(([dim, pts, desc]) => (
            <tr key={dim} className="hover:bg-gray-50/50">
              <td className="px-4 py-2.5 font-medium text-gray-900">{dim}</td>
              <td className="px-4 py-2.5 text-gray-600">{pts}</td>
              <td className="px-4 py-2.5 text-gray-600">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlaTable() {
  const rows = [
    ['Apply / Listed (free)', 'Best-effort', 'Best-effort'],
    ['Founder Spin-Out', '24 business hours', '5 business days'],
    ['Alumni / Verified Partner', '12 business hours', '3 business days'],
    ['Premium / Co-Invest / Prospect LP', '4 business hours', '2 business days'],
    ['Committed LP', '4 business hours', '2 business days'],
    ['Studio License Cloud', '2 business hours', '1 business day'],
    ['Studio License Enterprise', '30 minutes (24/7)', '4 hours, 99.95% uptime SLA'],
  ];
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">Plan</th>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">First response</th>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">Resolution target</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(([plan, resp, res]) => (
            <tr key={plan} className="hover:bg-gray-50/50">
              <td className="px-4 py-2.5 font-medium text-gray-900">{plan}</td>
              <td className="px-4 py-2.5 text-gray-600">{resp}</td>
              <td className="px-4 py-2.5 text-gray-600">{res}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataPolicyTable() {
  const rows = [
    ['Contracts (Document)', 'Admin, Partner, owning Founder'],
    ['signed_ip (legal proof IP)', 'Admin only'],
    ['signed_by (signer email)', 'Admin, the signer, doc owner'],
    ['Personal contact info', 'Admin, the subject, co-members (email only)'],
    ['Company member roster', 'Admin, members of that company'],
  ];
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">Resource</th>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">Who may view un-masked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(([res, who]) => (
            <tr key={res} className="hover:bg-gray-50/50">
              <td className="px-4 py-2.5 font-medium text-gray-900"><Code>{res}</Code></td>
              <td className="px-4 py-2.5 text-gray-600">{who}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GLOSSARY_TERMS = [
  ['AML/KYC', 'Anti-Money-Laundering / Know-Your-Customer checks; mandatory for LP onboarding.'],
  ['Capital call', 'Notice from the GP requesting LPs wire a portion of their commitment.'],
  ['Carry / Carried interest', "The GP's share of profits, typically 20% above a hurdle rate."],
  ['D1', "Cloudflare's SQLite-at-the-edge database, our edge persistence layer."],
  ['DPI', 'Distributions to Paid-In; ratio of cash returned to LPs vs. cash called.'],
  ['Durable Object', "Cloudflare's stateful primitive used for WebSocket fan-out (PipelineRoom, OnboardingChat)."],
  ['Entitlement', 'A computed boolean flag indicating whether a user can access a gated feature, derived from their subscription tier.'],
  ['GP', 'General Partner; the studio operating entity (Axal Management, LLC for Axal VC).'],
  ['LP', 'Limited Partner; an investor in the fund.'],
  ['LPA', 'Limited Partnership Agreement; the master fund document.'],
  ['PPM', 'Private Placement Memorandum.'],
  ['RBAC', 'Role-Based Access Control.'],
  ['RFP', 'Request For Proposal; how founders solicit partner services.'],
  ['SAFE', 'Simple Agreement for Future Equity; standard early-stage fundraising instrument.'],
  ['Spin-out', 'A startup that exits the studio as an independent company.'],
  ['SPV', 'Special Purpose Vehicle; a fund structure for a single deal or co-invest.'],
  ['Tier 1 / Tier 2 / Rejected', 'Scoring outcomes (≥85 / 70–84 / <70).'],
  ['TOTP', 'Time-based One-Time Password; our 2FA method (no passwords).'],
  ['TVPI', 'Total Value to Paid-In; ratio of fund NAV + distributions vs. cash called.'],
  ['Waterfall', 'The distribution priority among LPs and the GP.'],
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('quickstart');
  const [search, setSearch] = useState('');
  const contentRef = useRef(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const headings = el.querySelectorAll('h2[id]');
      let current = 'quickstart';
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 120) current = h.id;
      }
      setActiveSection(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const filteredGlossary = GLOSSARY_TERMS.filter(([term, def]) =>
    !search || term.toLowerCase().includes(search.toLowerCase()) || def.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden -mx-6 -my-6">
      {/* Sidebar TOC */}
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto py-6 px-4 hidden lg:block">
        <div className="flex items-center gap-2 mb-5">
          <BookOpen size={14} className="text-violet-600" />
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Contents</span>
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left text-sm px-2.5 py-1.5 rounded-lg transition-colors ${activeSection === s.id
                ? 'bg-violet-100 text-violet-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-violet-600 text-xs font-semibold uppercase tracking-widest mb-2">
              <BookOpen size={14} /> Documentation
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">StudioOS Documentation</h1>
            <p className="text-sm text-gray-500">Last updated May 2026 · Applies to StudioOS v1.0+</p>
            <p className="text-sm text-gray-700 mt-3 leading-relaxed">
              Welcome to <Strong>StudioOS</Strong>, the venture studio operating system that powers Axal VC's 30-Day Spin-Out Engine.
              This is the single source of truth for everyone using the platform — whether you're a founder spinning out a company,
              an LP tracking your portfolio, a service partner looking for deal flow, or a venture studio licensing the platform.
            </p>
          </div>

          {/* Quickstart */}
          <H2 id="quickstart">Quickstart</H2>

          <H3>1. Create your account</H3>
          <P>Go to <Strong>axal.vc/register</Strong>, enter your email, and pass the Cloudflare Turnstile check. We'll send a verification link via email.</P>

          <H3>2. Verify your email</H3>
          <P>Click the link within 24 hours. The link is single-use and SHA-256-hashed at rest, so it cannot be replayed. If it expires, request a new one — you can resend up to 3 times per hour.</P>

          <H3>3. Set up TOTP (passwordless 2FA)</H3>
          <P>After verification, scan the QR code with <Strong>Google Authenticator</Strong>, <Strong>1Password</Strong>, <Strong>Authy</Strong>, or any TOTP-compliant app. We do not use passwords — every login requires a fresh 6-digit code from your authenticator. Save the recovery codes shown after setup somewhere safe.</P>

          <H3>4. Pick your role</H3>
          <P>On first login, you'll be routed to one of three portals based on the role assigned to your account:</P>
          <UL>
            <LI><Strong>Founder Portal</Strong> — you're applying or running a spin-out venture</LI>
            <LI><Strong>Investor Portal</Strong> — you're a Limited Partner (LP) or co-investor</LI>
            <LI><Strong>Partner Portal</Strong> — you're a service provider (legal, accounting, design, GTM, etc.)</LI>
          </UL>
          <P>Admins (studio operators) see all three plus the Admin Console and can switch between views via the violet Portal Switcher bar at the top.</P>

          <H3>5. Complete your profile</H3>
          <P>Each portal asks 4–8 onboarding questions tailored to your role. Your answers populate scoring inputs (founders), LP commitment terms (investors), or service catalog entries (partners). Bookmark <Strong>axal.vc/dashboard</Strong> and continue below.</P>

          {/* How it works */}
          <H2 id="how-it-works">How StudioOS Works</H2>
          <P>StudioOS is built around <Strong>seven engines</Strong> that handle the full lifecycle of venture creation:</P>
          <UL>
            <LI><Strong>Intelligence Engine</Strong> — Market pulse, sector signals, competitive intelligence, studio benchmarks, conviction picks.</LI>
            <LI><Strong>Scoring & Diligence Engine</Strong> — Proprietary 100-point scoring algorithm + automated diligence checks (legal, technical, financial).</LI>
            <LI><Strong>AI Advisory Suite</Strong> — On-demand AI advisor for strategy, GTM, fundraising, hiring; financial planner with burn/runway projections; diligence checker.</LI>
            <LI><Strong>Deal & Match Engine</Strong> — Deal flow CRM (applied → scored → active → funded), partner matchmaking, referral system.</LI>
            <LI><Strong>Legal & Compliance Engine</Strong> — 18 templates spanning GP governance, fund formation (LPA, PPM, Subscription, Management Co.), portfolio execution (SAFE, term sheets, SPAs, bylaws, equity splits, IP, voting rights), and compliance (Form ADV, AML/KYC, 83(b)).</LI>
            <LI><Strong>Operations & Support Hub</Strong> — Ticketing (auto-syncs to GitHub Issues), activity & audit log, real-time pipeline updates via WebSockets.</LI>
            <LI><Strong>Capital & Investment Engine</Strong> — Capital calls, LP investor portal, fund management, distributions ledger, TVPI/DPI tracking, secondary liquidity marketplace.</LI>
          </UL>
          <P>Every action is recorded in the <Strong>activity log</Strong> (audit-grade), encrypted at rest, and gated by strict role-based access control (RBAC). The platform runs on FastAPI with a Cloudflare Workers edge layer for WebSockets, caching, and queue draining.</P>

          {/* For Founders */}
          <H2 id="for-founders">For Founders</H2>
          <P>You're here to spin out a company in 30 days. Here's the entire flow.</P>

          <H3>Submitting your venture</H3>
          <P>Open <Strong>Founder Portal → Submit Idea</Strong>. The multi-step form captures your problem & market hypothesis, TAM/SAM estimates, team, product plan, capital plan, strategic fit, and distribution / go-to-market. Submitting auto-triggers scoring within seconds.</P>

          <H3>The 100-point score</H3>
          <ScoreTable />
          <P><Strong>Outcomes:</Strong></P>
          <UL>
            <LI><Strong>≥85 → Tier 1 (Immediate Spinout)</Strong> — moved to BUILD stage, mentor & legal docs auto-staged</LI>
            <LI><Strong>70–84 → Tier 2 (Conditional)</Strong> — needs additional diligence; iterate on weak dimensions and re-submit</LI>
            <LI><Strong>&lt;70 → Rejected</Strong> — feedback delivered with the lowest-scoring dimensions explained</LI>
          </UL>

          <H3>The 30-day playbook</H3>
          <P>Tier 1 ventures enter the 4-week Builder Kit:</P>
          <UL>
            <LI><Strong>Week 1 — Brand & narrative.</Strong> Logo, brand kit, pitch deck (AI-assisted), one-pager, domain procurement.</LI>
            <LI><Strong>Week 2 — Legal & financial.</Strong> Incorporation wizard, cap table setup, founder vesting (4-year, 1-year cliff default), 83(b) elections, IP assignment.</LI>
            <LI><Strong>Week 3 — Product & GTM.</Strong> MVP scoping, hiring plan, GTM strategy, first-customer outreach templates.</LI>
            <LI><Strong>Week 4 — Fundraising.</Strong> SAFE templates, data room, term sheet, pitch practice with AI advisor, investor list.</LI>
          </UL>

          <H3>Legal templates</H3>
          <P>Founders get free use of these during their spin-out: SAFE (post-money, MFN, valuation cap), Term sheet, Stock Purchase Agreement, Bylaws, Founder equity split & vesting, IP assignment & confidentiality, Voting rights, 83(b) election letter.</P>
          <Note><Strong>Important:</Strong> templates are starting points, not legal advice. Your spin-out includes a partner attorney review before signing.</Note>

          <H3>AI Advisory</H3>
          <P>Ask the <Strong>AI Advisor</Strong> strategy questions (GTM, fundraising, product trade-offs, hiring), run a <Strong>Financial Plan</Strong> (burn/runway/projection scenarios), or trigger a <Strong>Diligence Check</Strong> before investor presentations. Falls back to deterministic templates if OpenAI is unavailable.</P>

          <H3>Liquidity (post-spin-out)</H3>
          <P>List founder/team shares on the <Strong>Secondary Marketplace</Strong> under Liquidity. Listings get an AI-generated fair-value badge. Buyer matching is anonymized — no emails or exact capital amounts are shipped to the AI.</P>

          {/* For Investors */}
          <H2 id="for-investors">For Investors & LPs</H2>

          <H3>LP Portal</H3>
          <P>Once your LPA is signed and commitment recorded, you'll see: commitment summary (total, called, uncalled), distributions ledger, TVPI/DPI charts, and capital call history with payment status.</P>

          <H3>Signing your LPA</H3>
          <P>LPAs are AI-generated with a deterministic fallback and viewable inline. Click <Strong>Sign LPA</Strong> → typed-name signature → click-through authentication. The legal record is your typed name + click-through with timestamp + audit log entry. Signed LPAs are downloadable via short-lived (5-minute) HMAC-signed URLs.</P>

          <H3>Capital calls</H3>
          <P>When the GP issues a capital call you receive an email notice, a push notification in your dashboard, and an entry on your Capital Calls tab with status: pending → wired → cleared.</P>

          <H3>Co-Invest & SPVs</H3>
          <P>Select deals offer co-invest opportunities. When opened, you'll see deal terms, allocation, deadline, and one-click commit. Each commit creates an SPV-scoped subscription with its own dataroom, reserve model, and waterfall simulation.</P>

          <H3>Reporting</H3>
          <P>LP reports (quarterly + annual) are generated automatically and available in the Reports tab as PDFs via short-lived signed URLs. Export to your fund administrator with one click (CSV + PDF bundle).</P>

          <H3>Prospect LP access</H3>
          <P>The <Strong>Prospect LP</Strong> tier ($499/mo) gives you read-only access to current deal flow, market intel, conviction signals, and studio benchmarks — without exposure to PII or signed legal docs.</P>

          {/* For Partners */}
          <H2 id="for-partners">For Partners (Service Providers)</H2>

          <H3>Your role</H3>
          <P>Partners are service providers — legal counsel, accounting, design, GTM, engineering, etc. You get a seat in the marketplace where founders can post RFPs and directly engage you.</P>

          <H3>Service catalog</H3>
          <P>Publish your services at <Strong>My Service Catalogue</Strong>. Each listing includes title, description, category, estimated time, and price. Founders browsing the Marketplace or Needs Board can discover and engage you directly.</P>

          <H3>Needs Board & RFPs</H3>
          <P>Founders post specific needs (e.g., "Need a Delaware incorporation lawyer for SAFE round"). You see matching RFPs under <Strong>Needs Board</Strong> and can respond directly. Engagements track status from intro → active → completed.</P>

          <H3>Partner insights</H3>
          <P>View demand signals — which service categories founders are requesting most, deal flow in your sector, and your match rate vs. other partners. Under <Strong>Demand Insights</Strong> in your sidebar.</P>

          <H3>Office hours</H3>
          <P>Publish office hours slots at <Strong>My Office Hours</Strong>. Founders book 15-minute sessions; confirmed bookings sync to your calendar and send email reminders to both parties.</P>

          {/* Plans */}
          <H2 id="plans">Plans & Pricing</H2>
          <UL>
            <LI><Strong>Apply / Listed (free)</Strong> — Submit your venture or list as a service partner. Access to public deal feed, scoring results, community forum.</LI>
            <LI><Strong>Founder Spin-Out</Strong> — Full 30-day Builder Kit, all 18 legal templates, AI Advisory Suite, pitch deck builder, financial model, brand kit, mentor matching.</LI>
            <LI><Strong>Alumni / Verified Partner</Strong> — Post-spin-out or graduated service partner. Continued platform access, alumni network, deal flow visibility.</LI>
            <LI><Strong>Premium / Co-Invest LP</Strong> — LP co-invest access, deal-by-deal SPVs, faster SLA, dedicated Slack channel.</LI>
            <LI><Strong>Committed LP</Strong> — Full LP portal: capital calls, distributions, TVPI/DPI tracking, quarterly reports, one-click fund administrator export.</LI>
            <LI><Strong>Prospect LP ($499/mo)</Strong> — Read-only access to deal flow, market intel, studio benchmarks — evaluate before committing.</LI>
            <LI><Strong>Studio License Cloud</Strong> — License StudioOS for your own venture studio. Branded instance, custom domain, your fund data.</LI>
            <LI><Strong>Studio License Enterprise</Strong> — Multi-fund, multi-GP, SSO/SAML, 30-min SLA, dedicated support engineer, 99.95% uptime SLA.</LI>
          </UL>

          {/* Security */}
          <H2 id="security">Security & Privacy</H2>

          <H3>Authentication</H3>
          <UL>
            <LI><Strong>TOTP-only</Strong> (no passwords). Your authenticator app is your password.</LI>
            <LI>Verification tokens SHA-256-hashed at rest with 24-hour expiry.</LI>
            <LI>Resend-verification rate-limited to 3/hour per email.</LI>
            <LI>JWT session tokens (24-hour expiry) signed with <Code>JWT_SECRET</Code>.</LI>
            <LI>Cloudflare Turnstile bot protection on registration.</LI>
          </UL>

          <H3>Perimeter (Cloudflare Zero Trust)</H3>
          <P>Backoffice routes (<Code>/api/admin/*</Code>, <Code>/api/monitoring/*</Code>, <Code>/api/infra/*</Code>) sit behind <Strong>Cloudflare Access</Strong>. Every request must include a valid <Code>Cf-Access-Jwt-Assertion</Code> header — verified via RS256 against the team JWKS — before it reaches the application's role check.</P>

          <H3>Sensitive data access policy</H3>
          <DataPolicyTable />

          <H3>Data minimization</H3>
          <UL>
            <LI>Drawn-signature images are <Strong>not</Strong> shipped or stored. Legal record = typed name + click-through + timestamp.</LI>
            <LI>Contract bodies never round-trip in JSON responses — wire shape is a file pointer + 5-minute HMAC-signed URL only.</LI>
            <LI>Search snippets for legal documents are neutral (no contract body leakage).</LI>
          </UL>

          <H3>Encryption at rest</H3>
          <P>Integration secrets Fernet-encrypted with PBKDF2-HMAC-SHA256 (200k iterations). Database backups encrypted at the storage layer.</P>

          <H3>Data deletion</H3>
          <P>You have the right to request full deletion of your account under GDPR, CCPA, and Swiss data protection law. Email <Strong>privacy@axal.vc</Strong> from your account email. We acknowledge within 7 days and complete deletion within 30 days. Some records (signed contracts, capital call records) are preserved for 7 years under financial recordkeeping obligations.</P>

          <H3>Security disclosure</H3>
          <P>Found a vulnerability? Report to <Strong>security@axal.vc</Strong> with a clear repro. We respond within 48 hours and follow Coordinated Vulnerability Disclosure (CVD).</P>

          {/* Notifications */}
          <H2 id="notifications">Notifications & Search</H2>

          <H3>Notification center</H3>
          <P>Bell icon in the top bar. Notifications are delivered via in-app (real-time via WebSocket), email (Gmail API, batched), and push (mobile PWA). Configure delivery channels per category in <Strong>Settings → Notifications</Strong>.</P>
          <UL>
            <LI>Deal updates (stage advances, scoring updates)</LI>
            <LI>Capital calls & distributions</LI>
            <LI>RFP invitations (partners)</LI>
            <LI>Office hours bookings</LI>
            <LI>Pipeline votes & comments</LI>
            <LI>System (security, billing)</LI>
          </UL>

          <H3>Global search</H3>
          <P>Press <code className="font-mono text-[11px] bg-gray-100 text-violet-700 px-1.5 py-0.5 rounded">⌘K</code> (macOS) or <code className="font-mono text-[11px] bg-gray-100 text-violet-700 px-1.5 py-0.5 rounded">Ctrl+K</code> (Windows/Linux) to open the global search palette. Search across deals, projects, founders, partners, documents, and tickets. Results respect your role's RBAC.</P>

          {/* API */}
          <H2 id="api">API & Integrations</H2>

          <H3>Available integrations</H3>
          <UL>
            <LI><Strong>HubSpot</Strong> — push deal pipeline + founder records to HubSpot CRM</LI>
            <LI><Strong>Salesforce</Strong> — same as HubSpot, for enterprise studios</LI>
            <LI><Strong>Sumsub</Strong> — KYC/AML onboarding for LPs</LI>
            <LI><Strong>Stripe Atlas</Strong> — incorporation handoff during Week 2</LI>
            <LI><Strong>Cooley GO</Strong> — legal template alignment with Cooley's library</LI>
            <LI><Strong>PitchBook</Strong> — market intelligence enrichment</LI>
            <LI><Strong>Custom</Strong> — bring your own webhook + API key</LI>
          </UL>
          <P>Connect at <Strong>Integrations</Strong> (admin or partner role only). Secrets stored Fernet-encrypted; previews shown masked. Webhook signatures validated via HMAC-SHA256 (<Code>X-Axal-Signature</Code> header).</P>

          <H3>API access</H3>
          <UL>
            <LI><Strong>Base URL:</Strong> <Code>https://studioos.guillaumelauzier.workers.dev/api</Code> (edge)</LI>
            <LI><Strong>Auth:</Strong> <Code>Authorization: Bearer &lt;jwt&gt;</Code> header on every request</LI>
            <LI><Strong>Rate limits:</Strong> 60 req/min user, 10 req/min AI, 1000 req/min global</LI>
            <LI><Strong>Idempotency:</Strong> <Code>Idempotency-Key</Code> header on POST to prevent dup-execution</LI>
          </UL>
          <P>API documentation (OpenAPI) at <Code>/api/docs</Code> (FastAPI auto-generated).</P>

          <H3>Webhooks</H3>
          <P>Subscribe at <Strong>Settings → Webhooks</Strong>. Events: <Code>deal.scored</Code>, <Code>deal.stage_advanced</Code>, <Code>capital_call.issued</Code>, <Code>distribution.executed</Code>, <Code>rfp.posted</Code>, <Code>engagement.completed</Code>, <Code>subscription.changed</Code>. Retries: 3 attempts with exponential backoff (1m, 5m, 30m).</P>

          {/* Support */}
          <H2 id="support">Support & SLAs</H2>

          <H3>Support tickets</H3>
          <P>Go to <Strong>Settings → Support</Strong> or use the floating help button. Filing a ticket auto-creates a GitHub Issue on <Code>AxalNetwork/StudioOS</Code>, routes to the right engineer, and sends you status updates as the issue progresses.</P>

          <H3>Response targets</H3>
          <SlaTable />

          <H3>Crisis playbooks</H3>
          <P>Founders facing existential issues (cap table emergency, lawsuit, co-founder dispute, runway crisis) can trigger a <Strong>Crisis Playbook</Strong> from the dashboard. Routes to a senior operator within 1 hour and unlocks emergency legal/financial templates.</P>

          <H3>Office hours</H3>
          <P>Studio operators host office hours twice a week (Tuesdays + Thursdays). Book a 15-minute slot under <Strong>Office Hours</Strong> in the sidebar. Premium Partners can also publish their own office hours.</P>

          <H3>Status page</H3>
          <P>Live system status: <Strong>status.axal.vc</Strong>. Includes API uptime, queue lag, AI worker latency, D1 health, WebSocket connection rate. Subscribe to incident updates via email or RSS.</P>

          {/* Glossary */}
          <H2 id="glossary">Glossary</H2>
          <div className="mb-4">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search glossary…"
                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400 bg-white"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <dl className="space-y-3">
            {filteredGlossary.map(([term, def]) => (
              <div key={term} className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
                <dt className="font-semibold text-gray-900 text-sm mb-0.5">{term}</dt>
                <dd className="text-sm text-gray-600">{def}</dd>
              </div>
            ))}
            {filteredGlossary.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-6">No terms match "{search}"</div>
            )}
          </dl>

          {/* Changelog */}
          <H2 id="changelog">Changelog</H2>
          <div className="space-y-4 mb-12">
            {[
              ['May 2026', 'Added complete Module reference sections for Founder, Investor, and Partner portals — every sidebar item now documented with its purpose, tier requirements, and category grouping.'],
              ['May 2026', 'Initial publication of full user documentation. Added Plans & Pricing aligned to four-audience strategy. Documented Security & Privacy policies, API surface, integrations.'],
              ['Apr 2026', 'Cloudflare Zero Trust perimeter, sensitive-data access policy, storage cleanup (signed URLs, neutral search snippets).'],
              ['Apr 2026', 'Pipeline community voting with role-weighted tallies.'],
              ['Apr 2026', 'VC Fund / LP core (vc_funds, limited_partners, fund_distributions).'],
              ['Apr 2026', 'Liquidity & Secondary Marketplace launched.'],
              ['Apr 2026', 'Refer & Earn enhancements (Quick Share, Contacts CSV, editable templates).'],
            ].map(([date, note]) => (
              <div key={note} className="flex gap-4">
                <div className="shrink-0 text-xs font-semibold text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full h-fit mt-0.5 whitespace-nowrap">{date}</div>
                <p className="text-sm text-gray-700 leading-relaxed">{note}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-6 pb-4 text-xs text-gray-400 text-center">
            Questions or corrections? File a ticket at <strong className="text-gray-500">Settings → Support</strong> with the label <Code>docs</Code>. ·
            StudioOS © 2026 Axal Management, LLC.
          </div>
        </div>
      </div>
    </div>
  );
}
