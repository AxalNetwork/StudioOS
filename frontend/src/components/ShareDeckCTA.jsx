import React, { useState } from 'react';
import { ArrowRight, MessageSquare, FileSignature } from 'lucide-react';
import ShareViewerSignupModal from './ShareViewerSignupModal';

// Task #6 — end-of-deck call-to-action shown only when the viewer is on
// a share link (PitchDeckPrintPage renders this with shareMode=true).
// `category` decides the copy + which post-NDA flow we route into:
//   - commercial → customer-discovery feedback capture
//   - fundraising → auto-generated deal-pack ready to sign
// The card itself is intentionally lightweight — the heavy lifting
// (account creation, NDA signing, capture / deal-pack rendering) lives
// in ShareViewerSignupModal so it can be opened from anywhere later.
export default function ShareDeckCTA({
  category, shareToken, deckId, viewId, projectId, projectName, methodId,
  slides, embedded = false,
}) {
  const [open, setOpen] = useState(false);
  if (!category) return null;

  const isCommercial = category === 'commercial';
  const title = isCommercial
    ? 'Tell the team what you think'
    : 'Want to review the deal?';
  const body = isCommercial
    ? `Share structured feedback with ${projectName || 'the founders'} — what resonates, what doesn't, and whether you'd buy. Join the Axal VC network in 30 seconds; everything you share stays under NDA.`
    : `Open the deal pack for ${projectName || 'this project'} — the SAFE, term sheet, and side letters are ready for your review. Join the Axal VC network in 30 seconds; everything is under NDA.`;
  const buttonLabel = isCommercial ? 'Join & give feedback' : 'Join & open the deal';
  const Icon = isCommercial ? MessageSquare : FileSignature;
  const accent = isCommercial
    ? 'from-emerald-50 to-teal-50 border-emerald-200 text-emerald-900'
    : 'from-violet-50 to-indigo-50 border-violet-200 text-violet-900';
  const btn = isCommercial
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-violet-600 hover:bg-violet-700';

  return (
    <div className={embedded ? 'w-full' : 'max-w-4xl mx-auto py-10 px-4'}>
      <div className={`bg-gradient-to-br ${accent} border rounded-2xl shadow-sm ${embedded ? 'p-6' : 'p-8 sm:p-10'}`}>
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-white/70 p-3 border border-white">
            <Icon size={22} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl sm:text-2xl font-semibold leading-tight">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed max-w-prose">{body}</p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`mt-5 inline-flex items-center gap-2 text-white text-sm font-medium px-5 py-2.5 rounded-lg ${btn}`}
            >
              {buttonLabel} <ArrowRight size={14} />
            </button>
            <p className="mt-3 text-[11px] text-gray-500">
              By continuing you agree to the Axal VC terms and the project NDA.
            </p>
          </div>
        </div>
      </div>
      {open && (
        <ShareViewerSignupModal
          category={category}
          shareToken={shareToken}
          deckId={deckId}
          viewId={viewId}
          projectId={projectId}
          projectName={projectName}
          methodId={methodId}
          slides={slides}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
