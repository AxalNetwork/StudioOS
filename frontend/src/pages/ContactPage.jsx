import React, { useState } from 'react';
import { Mail, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { request } from '../lib/api';

const KINDS = [
  { id: 'contact', label: 'General enquiry' },
  { id: 'support', label: 'Support request' },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', kind: 'contact', hp: '' });
  const [status, setStatus] = useState({ state: 'idle', error: '', issueUrl: '' });

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ state: 'sending', error: '', issueUrl: '' });
    try {
      const res = await request('/contact', { method: 'POST', body: JSON.stringify(form) });
      setStatus({ state: 'sent', error: '', issueUrl: res?.issue_url || '' });
      setForm({ name: '', email: '', subject: '', message: '', kind: form.kind, hp: '' });
    } catch (err) {
      const msg = err?.message || 'Something went wrong. Please email hello@axal.vc instead.';
      setStatus({ state: 'error', error: msg, issueUrl: '' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <PublicNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Mail className="w-7 h-7 text-violet-600" /> Contact us
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Send us a message — it lands directly in our team queue. We usually reply within one business day.
            For account-specific issues, please pick <em>Support request</em>.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-10">
          {status.state === 'sent' ? (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-6">
              <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-300 font-semibold">
                <CheckCircle2 className="w-5 h-5" /> Message received
              </div>
              <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
                Thanks — we'll be in touch shortly.
                {status.issueUrl ? <> Reference: <a href={status.issueUrl} target="_blank" rel="noopener noreferrer" className="underline">tracking link</a>.</> : null}
              </p>
              <button
                type="button"
                onClick={() => setStatus({ state: 'idle', error: '', issueUrl: '' })}
                className="mt-4 text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Your name</span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={update('name')}
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Email</span>
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={form.email}
                    onChange={update('email')}
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Kind</span>
                <select
                  value={form.kind}
                  onChange={update('kind')}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Subject</span>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={form.subject}
                  onChange={update('subject')}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Message</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={8}
                  value={form.message}
                  onChange={update('message')}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </label>

              {/* Honeypot — hidden from real users; bots fill everything. */}
              <input
                type="text"
                name="hp"
                value={form.hp}
                onChange={update('hp')}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute -left-[9999px] w-px h-px opacity-0"
              />

              {status.state === 'error' && (
                <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{status.error}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Or email <a href="mailto:hello@axal.vc" className="text-violet-700 dark:text-violet-300 hover:underline">hello@axal.vc</a> directly.
                </p>
                <button
                  type="submit"
                  disabled={status.state === 'sending'}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status.state === 'sending' ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Send message'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
