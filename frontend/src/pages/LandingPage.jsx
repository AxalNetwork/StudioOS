import React from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Target, Brain, Globe, FileText, Users, DollarSign,
  Rocket, ChevronRight, Shield, BarChart3, ArrowRight, Clock,
  Search, ClipboardCheck, Hammer, Banknote, Repeat
} from 'lucide-react';
import Footer from '../components/Footer';

const THESIS_PILLS = [
  'AI',
  'Blockchain',
  'Quantum',
  'Digital Infrastructure',
  'Frontier Software',
];

const PIPELINE_WEEKS = [
  {
    week: 'Week 1',
    title: 'Intake',
    icon: Search,
    color: 'from-violet-500 to-violet-600',
    items: [
      'Founder + partner intake',
      'Sector & thesis fit check',
      '100-point AI scoring',
      'Initial partner matching',
    ],
    output: 'Qualified Opportunity',
  },
  {
    week: 'Week 2',
    title: 'Diligence',
    icon: ClipboardCheck,
    color: 'from-blue-500 to-blue-600',
    items: [
      'Automated tech & market diligence',
      'Reusable diligence packet',
      'Reference & background checks',
      'Risk + KYC review',
    ],
    output: 'Shared Diligence Pack',
  },
  {
    week: 'Week 3',
    title: 'Build',
    icon: Hammer,
    color: 'from-emerald-500 to-emerald-600',
    items: [
      'Auto incorporation',
      '18-template legal pack',
      'Cap table + SAFE',
      'Investor materials',
    ],
    output: 'Investable Entity',
  },
  {
    week: 'Week 4',
    title: 'Fund',
    icon: Banknote,
    color: 'from-orange-500 to-orange-600',
    items: [
      'Capital calls',
      'Syndicated commitments',
      'Closing + wires',
      'LP dashboards live',
    ],
    output: 'Funded Company',
  },
];

const FOUNDER_BENEFITS = [
  {
    icon: Globe,
    title: 'Global partner intros',
    desc: 'Warm-routed to investors and operators across our network.',
  },
  {
    icon: Brain,
    title: 'AI strategy advisor',
    desc: 'Always-on guidance for GTM, fundraising, and financials.',
  },
  {
    icon: FileText,
    title: '18 legal templates',
    desc: 'Incorporation, SAFE, equity splits, IP — generated for you.',
  },
  {
    icon: Shield,
    title: 'Diligence done once',
    desc: 'A single diligence pack reused across every partner you meet.',
  },
  {
    icon: DollarSign,
    title: 'Capital on tap',
    desc: 'Capital calls and LP dashboards built into the pipeline.',
  },
  {
    icon: Repeat,
    title: 'Secondary liquidity',
    desc: 'Marketplace for early liquidity for founders and employees.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/axal-mark.png" alt="Axal VC" className="h-8" />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif" }} className="text-lg font-bold text-gray-900">Axal VC</span>
          </div>
          <div className="hidden md:flex items-center gap-7">
            <a href="#network" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Network</a>
            <a href="#platform" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Platform</a>
            <a href="#pipeline" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">4-Week Pipeline</a>
            <a href="#founders" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Founders</a>
            <a href="#contact" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Contact</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-400 transition-colors px-4 py-2 rounded-lg">
              Sign In
            </Link>
            <Link to="/register" className="text-sm bg-violet-600 hover:bg-violet-700 transition-colors text-white px-5 py-2 rounded-lg font-medium">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-100 border border-violet-300 rounded-full text-xs text-violet-700 mb-8">
              <Zap size={12} /> Axal VC · Global Venture Partner Network
            </div>
            <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6 text-gray-900">
              From Idea to{' '}
              <span className="text-violet-600">Funded Company</span>
              <br />in 30 Days
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
              The operating system for how global partners and founders source,
              diligence, fund, and exit — together.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
              {THESIS_PILLS.map((p) => (
                <span key={p} className="text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700">
                  {p}
                </span>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/register" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20 hover:shadow-violet-600/40">
                Become a Partner <ArrowRight size={16} />
              </Link>
              <a href="#founders" className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/40">
                For Founders <ArrowRight size={16} />
              </a>
              <a href="#pipeline" className="flex items-center gap-2 bg-white hover:bg-violet-50 border border-violet-300 text-violet-700 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium">
                Watch the 4-Week Pipeline <ChevronRight size={16} />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 max-w-3xl mx-auto">
            {[
              { value: '30', label: 'Days to Launch', suffix: '' },
              { value: '100', label: 'Point Scoring', suffix: 'pt' },
              { value: '88', label: 'Match Rate', suffix: '%' },
              { value: '4', label: 'Idea to Funded', suffix: ' wks' },
            ].map((stat, i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                <div className="text-2xl md:text-3xl font-bold text-violet-600">{stat.value}<span className="text-lg">{stat.suffix}</span></div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">A Venture Studio, Reimagined</h2>
            <p className="text-gray-600 leading-relaxed">
              Traditional VCs are fragmented, manual, and relationship-driven.
              Axal is building a programmable venture network — the AWS for venture capital.
              We combine data, AI, and global partnerships into a single operating system.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Brain,
                title: 'Intelligence Engine',
                desc: 'AI-powered scoring, market intelligence, and predictive analytics turn raw data into investment decisions in 24 hours.',
              },
              {
                icon: Rocket,
                title: '30-Day Spin-Out',
                desc: 'From validated idea to funded entity in 4 weeks. Automated incorporation, legal frameworks, and capital deployment.',
              },
              {
                icon: Users,
                title: 'Partner Network',
                desc: 'AI-matched partners bring deals, capital, and expertise. Referral systems create compounding network effects.',
              },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-8 hover:border-violet-300 hover:shadow-lg transition-all">
                <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mb-5">
                  <item.icon size={22} className="text-violet-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">{item.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pipeline" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-[11px] text-emerald-700 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live in Production
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">The 4-Week Pipeline</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Every venture goes through a fixed 4-week cycle — Intake, Diligence, Build, Fund — fully systematized and partially automated.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {PIPELINE_WEEKS.map((step, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-6 relative overflow-hidden hover:shadow-lg transition-all">
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${step.color}`} />
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500 font-medium">{step.week}</div>
                  <step.icon size={16} className="text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold mb-4 text-gray-900">{step.title}</h3>
                <ul className="space-y-2 mb-4">
                  {step.items.map((item, j) => (
                    <li key={j} className="flex items-center gap-2 text-xs text-gray-600">
                      <div className="w-1 h-1 rounded-full bg-gray-400" /> {item}
                    </li>
                  ))}
                </ul>
                <div className="pt-3 border-t border-gray-200">
                  <span className="text-[10px] text-gray-500 uppercase">Output:</span>
                  <div className="text-xs text-violet-600 font-medium mt-0.5">{step.output}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="founders" className="py-20 px-6 bg-gradient-to-b from-emerald-50/40 to-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-100 border border-emerald-200 rounded-full text-[11px] text-emerald-700 mb-4">
                <Rocket size={11} /> For Founders Going Global
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-5 text-gray-900">
                Build a global company without the global overhead.
              </h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Most founders lose months stitching together intros, lawyers, term sheets, and
                cap-table tools. Axal collapses that into a single pipeline: warm partner intros,
                an AI strategy advisor in your corner, a full legal pack, and capital that's
                already pre-wired into the platform.
              </p>
              <p className="text-gray-600 leading-relaxed mb-8">
                You run diligence once. You sign legals once. Then partners across the network
                can fund you, advise you, and — when it's time — give your team early liquidity
                through the secondary market.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to="/register" className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 transition-all px-6 py-3 rounded-xl text-sm font-medium text-white shadow-lg shadow-emerald-600/20">
                  Apply as a Founder <ArrowRight size={14} />
                </Link>
                <a href="#pipeline" className="flex items-center gap-2 bg-white border border-gray-300 hover:border-gray-400 transition-colors px-6 py-3 rounded-xl text-sm font-medium text-gray-900">
                  See the Pipeline <ChevronRight size={14} />
                </a>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {FOUNDER_BENEFITS.map((b, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-emerald-300 hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center mb-3">
                    <b.icon size={18} className="text-emerald-700" />
                  </div>
                  <div className="text-sm font-semibold text-gray-900 mb-1">{b.title}</div>
                  <div className="text-xs text-gray-600 leading-relaxed">{b.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">StudioOS Platform</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Seven integrated engines powering the entire venture creation lifecycle.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: BarChart3, title: 'Market Intelligence', desc: 'Real-time sector signals, competitive data, and gap opportunities.', to: '/market-intel' },
              { icon: Target, title: 'Scoring Engine', desc: '100-point algorithm with AI augmentation for instant Go/No-Go decisions.', to: '/scoring' },
              { icon: Brain, title: 'AI Advisory', desc: 'Strategy, GTM, fundraising advice and financial planning for founders.', to: '/advisory' },
              { icon: FileText, title: 'Legal Engine', desc: 'Auto incorporation, SAFE agreements, equity splits, IP licensing.', to: '/legal' },
              { icon: Users, title: 'Partner Matchmaking', desc: 'AI-powered matching with referral tracking and deal syndication.', to: '/matches' },
              { icon: DollarSign, title: 'Capital Engine', desc: 'Automated capital calls, LP portal, and live portfolio performance.', to: '/funds' },
              { icon: Rocket, title: 'Orchestration / Spin-Out', desc: 'The 30-day workflow engine that drives every venture from intake to launch.', to: '/studio-ops' },
            ].map((f, i) => (
              <Link key={i} to={f.to} className="flex items-start gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 hover:shadow-lg transition-all group">
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                  <f.icon size={18} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1 text-gray-900 flex items-center gap-1.5">
                    {f.title}
                    <ChevronRight size={12} className="text-gray-400 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="network" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-300 rounded-3xl p-10 md:p-16 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">Become a Partner</h2>
            <p className="text-gray-700 max-w-xl mx-auto mb-8 leading-relaxed">
              Join our global network of investors, operators, and service providers.
              Get matched with high-potential startups, access proprietary deal flow,
              and earn through referral commissions and equity participation.
            </p>
            <div className="grid md:grid-cols-3 gap-6 mb-10 max-w-2xl mx-auto text-left">
              {[
                { icon: Globe, title: 'Deal Access', desc: 'AI-scored startups delivered to your dashboard' },
                { icon: Shield, title: 'Verified Diligence', desc: 'Automated legal, tech, and financial checks' },
                { icon: Clock, title: 'Speed', desc: '30-day cycle from idea to funded company' },
              ].map((b, i) => (
                <div key={i} className="flex items-start gap-3">
                  <b.icon size={18} className="text-violet-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{b.title}</div>
                    <div className="text-xs text-gray-600">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/register" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-8 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20">
                Apply Now <ArrowRight size={16} />
              </Link>
              <Link to="/login" className="flex items-center gap-2 bg-white hover:bg-gray-100 transition-colors px-8 py-3.5 rounded-xl text-sm font-medium text-gray-900 border border-gray-200">
                Sign In to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="py-20 px-6 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Building in <span className="text-violet-400">AI</span>, <span className="text-violet-400">Blockchain</span>, <span className="text-violet-400">Quantum</span>, <span className="text-violet-400">Digital Infrastructure</span>, or <span className="text-violet-400">Frontier Software</span>?
          </h2>
          <p className="text-gray-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            Whether you're a partner sourcing the next thesis-aligned company or a founder going
            global from day one — start with a 30-second intake.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/register" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/30">
              Get Started <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-white">
              Sign In
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
