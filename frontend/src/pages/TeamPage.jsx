import React, { useEffect, useState } from 'react';
import { Users, Loader2, Globe, Mail } from 'lucide-react';

const LinkedInIcon = (props) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { reportError } from '../lib/log';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export default function TeamPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/public/team`)
      .then((r) => {
        if (!r.ok) throw new Error(`team_fetch_${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMembers(Array.isArray(data.members) ? data.members : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('team_page_fetch_failed', err);
        setError('Could not load team. Please try again later.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="w-7 h-7 text-violet-600" /> Team
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            The people behind Axal — operators, builders, and investors across the studio.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-10">
          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading team…
            </div>
          ) : error ? (
            <div className="text-center text-red-600 dark:text-red-400 py-20">{error}</div>
          ) : members.length === 0 ? (
            <div className="text-center text-slate-500 py-20">Team profiles coming soon.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {members.map((m) => (
                <article
                  key={m.slug}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col"
                >
                  <div className="aspect-square bg-gradient-to-br from-violet-100 to-violet-50 dark:from-violet-900/30 dark:to-slate-800 flex items-center justify-center">
                    {m.photo_url ? (
                      <img
                        src={m.photo_url}
                        alt={m.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <Users className="w-16 h-16 text-violet-400" />
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <h2 className="text-lg font-bold">{m.name}</h2>
                    <p className="text-sm text-violet-700 dark:text-violet-300 font-medium">{m.title}</p>
                    {m.location && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{m.location}</p>}
                    {m.short_bio && <p className="text-sm text-slate-700 dark:text-slate-300 mt-3 leading-relaxed">{m.short_bio}</p>}
                    {Array.isArray(m.focus_areas) && m.focus_areas.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {m.focus_areas.map((f) => (
                          <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{f}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-auto pt-4 flex items-center gap-3 text-slate-500 dark:text-slate-400">
                      {m.socials?.linkedin && (
                        <a href={m.socials.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${m.name} on LinkedIn`} className="hover:text-violet-600">
                          <LinkedInIcon />
                        </a>
                      )}
                      {m.socials?.website && (
                        <a href={m.socials.website} target="_blank" rel="noopener noreferrer" aria-label={`${m.name} website`} className="hover:text-violet-600">
                          <Globe size={16} />
                        </a>
                      )}
                      {m.socials?.email && (
                        <a href={`mailto:${m.socials.email}`} aria-label={`Email ${m.name}`} className="hover:text-violet-600">
                          <Mail size={16} />
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
