import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { reportError } from '../lib/log';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const LINKEDIN_URL = 'https://www.linkedin.com/in/guillaumelauzier/';

const ABOUT_TEXT =
  'Over the past two decades, I\u2019ve built companies and seen how challenging it is to turn ideas into businesses while balancing operations, people, uncertainty, and growth. In the age of AI, everything is moving faster, execution cycles are shorter, and the right tools can change what is possible, while also freeing founders to focus more on customers and what truly matters. Axal VC was created to help founders bridge that gap with a global network of partners, operators, and experts who bring capital, insight, and hands-on support. The aim is simple: structure ideas into action and surround founders with the right ecosystem to build with clarity, speed, and conviction.';

const MANIFESTO_PARAGRAPHS = [
  'Every age builds the tools it deserves. Ours is learning that intelligence alone is not enough: it must be connected, resilient, and accountable to the world it shapes.',
  'Axal VC is a global venture partner network, equipped with the tools, operating infrastructure, and capital resources to help founders build what comes next.',
  'We back founders building modular digital systems that adapt at the machine level, software that protects privacy and intellectual property, and AI that helps societies navigate complexity with greater clarity. We believe infrastructure should not stand apart from the world, but move with it: interconnected through IoT, responsive to change, and built to endure.',
  'We also believe technology must remain in relationship with the living systems around it. Biodiversity is not a backdrop to progress; it is part of the same fabric. To preserve diversity is to preserve the conditions for future possibility.',
  'This is our investment thesis and our conviction: digital transformation in the age of AI, guided by structured execution, faster time to action, and intelligent decision-making\u2014not only for efficiency, but for continuity, stewardship, and the long future.',
];

export default function TeamPage() {
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/public/team`)
      .then((r) => {
        if (!r.ok) throw new Error(`team_fetch_${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const members = Array.isArray(data.members) ? data.members : [];
        setMember(members[0] || null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('about_page_fetch_failed', err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <h1 className="text-3xl font-bold">About</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            The story behind Axal VC.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-12">
          {/* Manifesto / Thesis section */}
          <section className="mb-16 rounded-3xl overflow-hidden shadow-xl border border-slate-200 dark:border-slate-800">
            <div className="relative">
              <img
                src="/axal-vc-future.png"
                alt="Axal VC — vision of the future"
                className="w-full h-64 sm:h-80 object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/30 to-slate-900/80" />
              <div className="absolute bottom-0 left-0 px-8 pb-6">
                <span className="text-xs font-semibold tracking-widest uppercase text-violet-300">
                  Our thesis
                </span>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 px-8 py-10 space-y-5">
              {MANIFESTO_PARAGRAPHS.map((para, i) => (
                <p
                  key={i}
                  className={
                    i === 0
                      ? 'text-xl font-semibold leading-relaxed text-slate-900 dark:text-slate-100'
                      : i === MANIFESTO_PARAGRAPHS.length - 1
                      ? 'text-base leading-relaxed text-violet-700 dark:text-violet-300 font-medium border-t border-slate-100 dark:border-slate-800 pt-5'
                      : 'text-base leading-relaxed text-slate-600 dark:text-slate-400'
                  }
                >
                  {para}
                </p>
              ))}
            </div>
          </section>

          <h2 className="text-xl font-bold mb-8 text-slate-900 dark:text-slate-100">Team</h2>

          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-10 items-start">
              <div className="shrink-0">
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square w-full max-w-[280px] mx-auto md:mx-0 rounded-2xl overflow-hidden bg-gradient-to-br from-violet-100 to-violet-50 dark:from-violet-900/30 dark:to-slate-800"
                >
                  {member?.photo_url && !photoFailed ? (
                    <img
                      src={member.photo_url}
                      alt={member.name || 'Managing Partner'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={() => setPhotoFailed(true)}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" />
                  )}
                </a>
                {member?.name && (
                  <h2 className="mt-4 text-xl font-bold">
                    <a
                      href={LINKEDIN_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {member.name}
                    </a>
                  </h2>
                )}
                <p className="text-sm text-violet-700 dark:text-violet-300 font-medium">
                  Managing Partner
                </p>
              </div>

              <div>
                <p className="text-base sm:text-lg leading-relaxed text-slate-700 dark:text-slate-300">
                  {ABOUT_TEXT}
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
