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
//
// Two presentations:
//   - standalone (default): a light card on its own page at the end of the
//     deck. Used by every non-Spin-Out deck.
//   - embedded: injected *inside* the Spin-Out deck's dark "Deal Readiness"
//     slide (PitchDeckPrintPage passes embedded). It is styled to belong to
//     that dark slide and kept compact so it fits within the slide frame.
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
  // Body copy is fixed; only the project name varies. The embedded (on-slide)
  // variant caps the name so the body can't grow past ~2 lines and push the
  // card out of the dark Slide 10 frame; the standalone card keeps the full name.
  const makeBody = (name) => isCommercial
    ? `Share structured feedback with ${name || 'the founders'} — what resonates, what doesn't, and whether you'd buy. Join the Axal VC network in 30 seconds; everything you share stays under NDA.`
    : `Open the deal pack for ${name || 'this startup'} — the SAFE, term sheet, and side letters are ready for your review. Join the Axal VC network in 30 seconds; everything is under NDA.`;
  const body = makeBody(projectName);
  const buttonLabel = isCommercial ? 'Join & give feedback' : 'Join & open the deal';
  const Icon = isCommercial ? MessageSquare : FileSignature;

  const modal = open ? (
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
  ) : null;

  // ── Embedded (Spin-Out "Deal Readiness" dark slide) ──────────────────────
  // Hex values mirror the deck's dark palette (deckData.js): dpanel #171C25,
  // dline #2A313D, accent #2C4BE0 / accentLt #6E86FF, dmuted #9099A6,
  // dfaint #5C6573. The fundraising variant uses the slide's blue accent so it
  // reads as part of the diligence/next-steps treatment; the commercial
  // (feedback) variant stays emerald but tuned for the dark background.
  if (embedded) {
    const v = isCommercial
      ? { btn: 'bg-emerald-500 hover:bg-emerald-400', accent: '#34D399', border: 'rgba(52,211,153,0.40)' }
      : { btn: 'bg-[#6B46C1] hover:bg-[#7C55D4]', accent: '#A78BFA', border: 'rgba(167,139,250,0.45)' };
    const projShort = projectName && projectName.length > 40
      ? `${projectName.slice(0, 39).trimEnd()}…`
      : projectName;
    return (
      <div className="w-full">
        <div
          className="rounded-xl border px-4 py-3.5"
          style={{ backgroundColor: '#171C25', borderColor: v.border }}
        >
          <div className="flex items-start gap-3">
            <div
              className="rounded-lg p-2 shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: `1px solid ${v.border}`, color: v.accent }}
            >
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold leading-tight text-white">{title}</h2>
              <p className="mt-1 text-[11px] leading-snug line-clamp-3" style={{ color: '#9099A6' }}>{makeBody(projShort)}</p>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className={`mt-2.5 inline-flex items-center gap-1.5 text-white text-[12px] font-medium px-3.5 py-1.5 rounded-md ${v.btn}`}
              >
                {buttonLabel} <ArrowRight size={12} />
              </button>
              <p className="mt-2 text-[10px]" style={{ color: '#828B99' }}>
                By continuing you agree to the Axal VC terms and the startup NDA.
              </p>
            </div>
          </div>
        </div>
        {modal}
      </div>
    );
  }

  // ── Standalone end-of-deck card (light) — unchanged ──────────────────────
  const accent = isCommercial
    ? 'from-emerald-50 to-teal-50 border-emerald-200 text-emerald-900'
    : 'from-violet-50 to-indigo-50 border-violet-200 text-violet-900';
  const btn = isCommercial
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-violet-600 hover:bg-violet-700';

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className={`bg-gradient-to-br ${accent} border rounded-2xl shadow-sm p-8 sm:p-10`}>
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
              By continuing you agree to the Axal VC terms and the startup NDA.
            </p>
          </div>
        </div>
      </div>
      {modal}
    </div>
  );
}
