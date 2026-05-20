/**
 * Task #4 (ID) — Public /demo page.
 *
 * Three audience CTAs: product demo, investor brief, partnership intro.
 * If `VITE_CALENDLY_URL` is set, embeds the Calendly inline widget;
 * otherwise renders a lightweight form that POSTs to
 * `/api/public/demo-request` (worker creates a GitHub Issue and emails
 * an acknowledgement via the existing transactional pipeline).
 */
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, BarChart3, Handshake, CheckCircle, Loader2 } from 'lucide-react';
import { request } from '../lib/api';
import { usePageMeta } from '../lib/seo';

const TOPICS = [
  { id: 'product', label: '30-min product demo', icon: Calendar, desc: 'Live walkthrough of the founder workspace and admin console.' },
  { id: 'investor', label: 'Investor brief', icon: BarChart3, desc: 'How institutional investors use Axal for deal flow + LP reporting.' },
  { id: 'partnership', label: 'Partnership intro', icon: Handshake, desc: 'For service providers, accelerators, and strategic partners.' },
];

const CALENDLY_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CALENDLY_URL) || '';

function CalendlyEmbed({ topic }) {
  const url = `${CALENDLY_URL}?hide_event_type_details=0&primary_color=7c3aed&utm_source=demo_page&utm_content=${encodeURIComponent(topic)}`;
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white" data-card>
      <iframe
        title="Schedule a demo"
        src={url}
        className="w-full"
        style={{ minHeight: 720, border: 0 }}
        loading="lazy"
      />
    </div>
  );
}

function ContactForm({ topic }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await request('/public/demo-request', {
        method: 'POST',
        body: JSON.stringify({ topic, name, email, company, message }),
      });
      setSuccess(true);
    } catch (ex) {
      setError(ex.message || 'Could not submit your request. Please try again or email hello@axal.vc.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center" data-card>
        <CheckCircle className="mx-auto text-emerald-600 mb-3" size={36} aria-hidden="true" />
        <h3 className="text-lg font-bold text-gray-900 mb-1">Thanks — we'll be in touch</h3>
        <p className="text-sm text-gray-700">
          We received your request and will follow up within one business day. A confirmation is on its way to {email}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4" data-card>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Your name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full min-h-[44px] px-3 rounded-lg border border-gray-300 focus:border-violet-500 focus:ring-1 focus:ring-violet-500" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Work email</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full min-h-[44px] px-3 rounded-lg border border-gray-300 focus:border-violet-500 focus:ring-1 focus:ring-violet-500" />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Company / fund</span>
        <input value={company} onChange={(e) => setCompany(e.target.value)}
          className="mt-1 w-full min-h-[44px] px-3 rounded-lg border border-gray-300 focus:border-violet-500 focus:ring-1 focus:ring-violet-500" />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">What would you like to cover?</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
          placeholder="Anything specific you'd like us to focus on…"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-violet-500 focus:ring-1 focus:ring-violet-500" />
      </label>
      {error && (
        <div role="alert" className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{error}</div>
      )}
      <button type="submit" disabled={submitting}
        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium">
        {submitting && <Loader2 className="animate-spin" size={16} aria-hidden="true" />}
        {submitting ? 'Sending…' : 'Request a time'}
      </button>
      <p className="text-xs text-gray-500">
        By submitting you agree to be contacted about your request. We never sell your data.
      </p>
    </form>
  );
}

export default function DemoPage() {
  const [search, setSearch] = useSearchParams();
  const topic = TOPICS.find((t) => t.id === search.get('topic'))?.id || 'product';

  usePageMeta({
    title: 'Book a demo',
    description: 'See Axal StudioOS live — pick a product demo, investor brief, or partnership intro.',
    path: '/demo',
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50/40 via-white to-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8 min-h-[44px]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Axal Ventures
        </Link>

        <header className="text-center max-w-2xl mx-auto mb-10">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">See it live</h1>
          <p className="text-base text-gray-600">
            Pick the conversation that fits — we'll meet you where you are.
          </p>
        </header>

        <div role="tablist" aria-label="Demo topic" className="grid sm:grid-cols-3 gap-3 mb-8">
          {TOPICS.map((t) => {
            const Icon = t.icon;
            const active = topic === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => { search.set('topic', t.id); setSearch(search); }}
                className={`text-left p-4 rounded-xl border transition-colors min-h-[44px] ${
                  active ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500/30' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <Icon size={22} className={active ? 'text-violet-600' : 'text-gray-600'} aria-hidden="true" />
                <div className="mt-2 font-semibold text-gray-900">{t.label}</div>
                <div className="text-xs text-gray-600 mt-1">{t.desc}</div>
              </button>
            );
          })}
        </div>

        {CALENDLY_URL ? <CalendlyEmbed topic={topic} /> : <ContactForm topic={topic} />}
      </div>
    </div>
  );
}
