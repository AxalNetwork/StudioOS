/**
 * Task #4 (ID) — Public /roadmap page.
 *
 * Three columns (Soon / Next / Later) driven by data/roadmap.js.
 * Logged-in users can upvote each card; votes persist via
 * POST /api/public/roadmap/votes (one vote per user per item).
 * Anonymous visitors see the counts and a prompt to sign in.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronUp, Loader2 } from 'lucide-react';
import { request } from '../lib/api';
import { usePageMeta } from '../lib/seo';
import { ROADMAP_ITEMS, COLUMN_LABELS, AUDIENCE_LABELS } from '../data/roadmap';
import { safeReadJSON } from './../lib/storage';

const COLS = ['soon', 'next', 'later'];

function VoteButton({ item, vote, onToggle, loggedIn, busy }) {
  const isMine = !!vote.mine;
  return (
    <button
      type="button"
      disabled={busy || !loggedIn}
      onClick={() => onToggle(item.id, !isMine)}
      aria-pressed={isMine}
      title={loggedIn ? (isMine ? 'Remove your vote' : 'Upvote this idea') : 'Sign in to upvote'}
      className={`min-h-[44px] flex flex-col items-center justify-center px-2 py-1 rounded-lg border transition-colors ${
        isMine
          ? 'border-violet-500 bg-violet-50 text-violet-700'
          : loggedIn
            ? 'border-gray-200 text-gray-700 hover:border-violet-300 hover:bg-violet-50'
            : 'border-gray-200 text-gray-400 cursor-not-allowed'
      }`}
    >
      <ChevronUp size={16} aria-hidden="true" />
      <span className="text-xs font-semibold tabular-nums">{vote.count}</span>
    </button>
  );
}

export default function PublicRoadmapPage() {
  const user = safeReadJSON('user', null);
  const loggedIn = !!user;
  const [votes, setVotes] = useState({});  // { [id]: {count, mine} }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  usePageMeta({
    title: 'Roadmap',
    description: 'What we\'re building next — vote on the features that matter to you.',
    path: '/roadmap',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await request('/public/roadmap/votes');
        if (alive) {
          const map = {};
          (res.items || []).forEach((v) => { map[v.id] = { count: v.count || 0, mine: !!v.mine }; });
          // Make sure every roadmap card has at least a 0-count entry.
          ROADMAP_ITEMS.forEach((it) => { if (!map[it.id]) map[it.id] = { count: 0, mine: false }; });
          setVotes(map);
        }
      } catch (ex) {
        // Non-fatal: render cards with 0 votes if the API is unreachable.
        if (alive) {
          const map = {};
          ROADMAP_ITEMS.forEach((it) => { map[it.id] = { count: 0, mine: false }; });
          setVotes(map);
          setError(ex.message || '');
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  async function toggle(id, want) {
    if (!loggedIn) return;
    setBusy(true);
    setError('');
    // Optimistic update
    setVotes((prev) => {
      const cur = prev[id] || { count: 0, mine: false };
      return { ...prev, [id]: { count: cur.count + (want ? 1 : -1), mine: want } };
    });
    try {
      await request('/public/roadmap/votes', {
        method: want ? 'POST' : 'DELETE',
        body: JSON.stringify({ item_id: id }),
      });
    } catch (ex) {
      // Roll back on failure
      setVotes((prev) => {
        const cur = prev[id] || { count: 0, mine: false };
        return { ...prev, [id]: { count: cur.count + (want ? -1 : 1), mine: !want } };
      });
      setError(ex.message || 'Could not record your vote.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8 min-h-[44px]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Axal VC
        </Link>

        <header className="text-center max-w-2xl mx-auto mb-10">
          <h1 className="text-4xl font-bold text-gray-900 mb-3 dark:text-gray-100">Roadmap</h1>
          <p className="text-base text-gray-600">
            What we're building next.{' '}
            {loggedIn
              ? <>Tap upvote on the ideas that matter to you — we read every signal.</>
              : <><Link to="/login" className="text-violet-700 underline">Sign in</Link> to upvote the ideas that matter to you.</>}
          </p>
        </header>

        {error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

        <div className="grid lg:grid-cols-3 gap-6">
          {COLS.map((col) => {
            const meta = COLUMN_LABELS[col];
            const items = ROADMAP_ITEMS.filter((i) => i.column === col);
            return (
              <section key={col} aria-labelledby={`col-${col}`} className="space-y-4">
                <div>
                  <h2 id={`col-${col}`} className="text-lg font-bold text-gray-900 dark:text-gray-100">{meta.title}</h2>
                  <p className="text-xs text-gray-500">{meta.subtitle}</p>
                </div>
                {items.map((item) => {
                  const v = votes[item.id] || { count: 0, mine: false };
                  const aud = AUDIENCE_LABELS[item.audience] || AUDIENCE_LABELS.all;
                  return (
                    <article key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 flex gap-3 dark:border-gray-800 dark:bg-gray-900" data-card>
                      <VoteButton item={item} vote={v} onToggle={toggle} loggedIn={loggedIn} busy={busy} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${aud.color}`}>{aud.label}</span>
                          <span className="text-xs text-gray-500">{item.status}</span>
                        </div>
                        <h3 className="font-semibold text-gray-900 mb-1 dark:text-gray-100">{item.title}</h3>
                        <p className="text-sm text-gray-700 dark:text-gray-300">{item.body}</p>
                      </div>
                    </article>
                  );
                })}
                {items.length === 0 && (
                  <div className="text-sm text-gray-500 italic">Nothing in this column yet.</div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
