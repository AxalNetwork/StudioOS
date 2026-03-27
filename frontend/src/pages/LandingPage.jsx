import React from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Target, Brain, Globe, FileText, Users, DollarSign,
  Rocket, ChevronRight, Shield, BarChart3, ArrowRight, Clock
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/axal-logo.png" alt="Axal Ventures" className="h-7" />
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#about" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">About</a>
            <a href="#how-it-works" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">How It Works</a>
            <a href="#features" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Platform</a>
            <a href="#partners" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Partners</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-4 py-2">
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
              <Zap size={12} /> The 30-Day Spin-Out Engine
            </div>
            <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6 text-gray-900">
              From Idea to{' '}
              <span className="text-violet-600">
                Funded Company
              </span>
              <br />in 30 Days
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10 leading-relaxed">
              Axal Ventures is the operating system for venture creation. We combine AI-powered scoring, 
              automated incorporation, and a global partner network to manufacture startups at scale.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/register" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-8 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20 hover:shadow-violet-600/40">
                Apply as Partner <ArrowRight size={16} />
              </Link>
              <a href="#how-it-works" className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 transition-colors px-8 py-3.5 rounded-xl text-sm font-medium text-gray-900">
                See How It Works <ChevronRight size={16} />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 max-w-3xl mx-auto">
            {[
              { value: '30', label: 'Days to Launch', suffix: '' },
              { value: '100', label: 'Point Scoring', suffix: 'pt' },
              { value: '88', label: 'Match Rate', suffix: '%' },
              { value: '11', label: 'Days to Inc.', suffix: '' },
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

      <section id="how-it-works" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">The 4-Week Pipeline</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Every startup goes through a fixed 4-week cycle — fully systematized and partially automated.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              {
                week: 'Week 1',
                title: 'Validate & Score',
                color: 'from-violet-500 to-violet-600',
                items: ['AI-powered validation', 'Market data analysis', '100-point scoring', 'Partner matching'],
                output: 'Go / No-Go Decision',
              },
              {
                week: 'Week 2',
                title: 'Build & Form',
                color: 'from-blue-500 to-blue-600',
                items: ['MVP development', 'Auto incorporation', 'Legal frameworks', 'Financial modeling'],
                output: 'Legal Entity + Deck',
              },
              {
                week: 'Week 3',
                title: 'Deal Flow',
                color: 'from-emerald-500 to-emerald-600',
                items: ['Deal activation', 'Partner proposals', 'Referral system', 'Auto diligence'],
                output: 'Investor Conversations',
              },
              {
                week: 'Week 4',
                title: 'Capital & Launch',
                color: 'from-orange-500 to-orange-600',
                items: ['Capital calls', 'Investor dashboards', 'Performance tracking', 'Public launch'],
                output: 'Funding Secured',
              },
            ].map((step, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-6 relative overflow-hidden hover:shadow-lg transition-all">
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${step.color}`} />
                <div className="text-xs text-gray-500 font-medium mb-1">{step.week}</div>
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

      <section id="features" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">StudioOS Platform</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Seven integrated engines powering the entire venture creation lifecycle.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: BarChart3, title: 'Market Intelligence', desc: 'Real-time sector signals, competitive data, and gap opportunities.' },
              { icon: Target, title: 'Scoring Engine', desc: '100-point algorithm with AI augmentation for instant Go/No-Go decisions.' },
              { icon: Brain, title: 'AI Advisory', desc: 'Strategy, GTM, fundraising advice and financial planning for founders.' },
              { icon: FileText, title: 'Legal Engine', desc: 'Auto incorporation, SAFE agreements, equity splits, IP licensing.' },
              { icon: Users, title: 'Partner Matchmaking', desc: 'AI-powered matching with referral tracking and deal syndication.' },
              { icon: DollarSign, title: 'Capital Engine', desc: 'Automated capital calls, LP portal, and live portfolio performance.' },
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 hover:shadow-lg transition-all">
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                  <f.icon size={18} className="text-violet-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1 text-gray-900">{f.title}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="partners" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-300 rounded-3xl p-10 md:p-16 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">Become a Partner</h2>
            <p className="text-gray-700 max-w-xl mx-auto mb-8 leading-relaxed">
              Join our network of investors, operators, and service providers. 
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

      <footer className="py-12 px-6 border-t border-gray-200">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/axal-logo.png" alt="Axal Ventures" className="h-6" />
          </div>
          <div className="text-xs text-gray-600">
            Rue Robert-Ceard 6, 1204 Geneva, Switzerland
          </div>
          <div className="text-xs text-gray-600">
            &copy; {new Date().getFullYear()} Axal SA. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
