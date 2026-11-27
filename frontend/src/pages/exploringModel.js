/**
 * D8730 (#8730) — the Exploring page's one next step per state, built to SPV11
 * to SPV13 and SPV31 of `design/incoming/Studio Home Previews Page.dc.html`.
 *
 * States: no role chosen; the founder track (Apply to the Spin-Out Lab); an
 * investor, advisor or partner track with discovery open; discovery finished.
 * Profiling is Not applicable while exploring in every state (owner, Q2 A,
 * 2026-11-27): the Worker's /advisor/progress says `applicable:false` for a
 * still-exploring visitor, so Fit and Completion agree. Member-only pages are
 * listed under "Opens with membership" without links (Q3 A). Pure, so a Node
 * test reads every state.
 */

export const TRACK_LABELS = Object.freeze({ founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Partner' });

/** What the discovery questions tell the Axal team, per track. Investor is the canvas's; the other two follow it. */
const DISCOVERY_WHAT = Object.freeze({
  investor: 'what you invest in and what you need',
  advisor: 'how you advise founders and what you need',
  partner: 'how you work with the studio and what you need',
});

export const EADWYN_UNAVAILABLE = 'Eadwyn is unavailable right now. Try again in a few minutes.';
export const PROFILING_NA = 'Not applicable while exploring';
export const PROFILING_LINE = 'Skills, work values, archetype and Axal Fit are asked once your membership agreement is signed. Nothing here is waiting on you.';
export const STICKY_NOTE = 'The action is the bar at the foot of the screen.';

/** The track a visitor is on, or null. Anything else is no track, never a guess. */
export function trackOf(role) {
  return Object.prototype.hasOwnProperty.call(TRACK_LABELS, role) ? role : null;
}

/**
 * The discovery count from /advisor/progress. `read` is
 * `{ status: 'loading' | 'error' | 'ok', value }`. A count that could not be
 * read is Unavailable, never 0.
 */
export function discoveryOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  const o = read.status === 'ok' ? read.value?.overall : null;
  if (!o || !Number.isFinite(Number(o.total)) || Number(o.total) <= 0) return { state: 'unavailable' };
  const total = Number(o.total);
  const answered = Math.max(0, Math.min(total, Number(o.answered) || 0));
  const skipped = Math.max(0, Number(o.skipped) || 0);
  return { state: 'ready', answered, total, complete: o.complete === true || answered + skipped >= total };
}

/** Which of the four states the visitor is in. */
export function exploringStateOf({ role, discovery }) {
  const track = trackOf(role);
  if (!track) return 'none';
  if (track === 'founder') return 'founder';
  if (discovery?.state === 'ready' && discovery.complete) return 'done';
  return 'discovery';
}

/**
 * The one next step: eyebrow, heading, body and its single action.
 * `action.kind` is 'chat' (to Eadwyn on this page) or 'link'; `action.button`
 * false draws it as a link, not a button. `lane` is the page's LANE_COPY entry.
 * In a preview the visitor's own count is never drawn.
 */
export function nextStepFor({ state, role, discovery, lane, preview = false, eadwynAvailable = true }) {
  const track = trackOf(role);
  const label = track ? TRACK_LABELS[track] : null;
  const count = !preview && discovery?.state === 'ready' ? `${discovery.answered} of ${discovery.total} answered. ` : '';
  const chatDown = eadwynAvailable === false;
  if (state === 'founder') {
    return {
      eyebrow: 'Your next step', heading: 'Apply to the Spin-Out Lab',
      body: `The Axal team ${lane?.next || ''}`.trim(),
      action: { kind: 'link', to: lane?.cta?.to || '/spinout-lab', label: lane?.cta?.label || 'Apply to the Spin-Out Lab', button: true },
    };
  }
  if (state === 'done') {
    return {
      eyebrow: 'Where you are', heading: 'Nothing is needed from you now',
      body: `The Axal team ${lane?.next || ''}`.trim(),
      action: chatDown ? null : { kind: 'chat', label: 'Review your answers in Eadwyn', button: false },
      unavailable: chatDown,
    };
  }
  if (state === 'discovery') {
    return {
      eyebrow: 'Your next step', heading: `Answer the ${label.toLowerCase()} discovery questions`,
      body: chatDown ? EADWYN_UNAVAILABLE : `${count}They tell the Axal team ${DISCOVERY_WHAT[track]}. Once they are done, nothing else is needed from you before the review.`,
      action: chatDown ? null : { kind: 'chat', label: 'Continue with Eadwyn', button: true },
      unavailable: chatDown,
    };
  }
  return {
    eyebrow: 'Your next step', heading: 'Tell Eadwyn which role you are exploring',
    body: chatDown ? EADWYN_UNAVAILABLE : 'Founder, investor, advisor or operating partner. Your answer picks the short set of questions that follows. You can change it later in Settings.',
    action: chatDown ? null : { kind: 'chat', label: 'Answer in Eadwyn', button: true },
    unavailable: chatDown,
  };
}

/** The line under "Welcome". */
export function welcomeLine(state) {
  return state === 'none'
    ? 'Tell us which role you are exploring, and the Axal team reviews your profile for it.'
    : 'Membership under review — you can keep working. We send an agreement to sign when it clears.';
}

/**
 * The founder track's two lists (SPV12). Every link in "Available now" opens a
 * page an Exploring account can use; the member-only pages draw no link,
 * because RoleGuard sends an Exploring account back from them (SPV31).
 */
export const AVAILABLE_NOW = Object.freeze([
  { t: 'Spin-Out Lab', to: '/spinout-lab', d: 'The 28-day programme, its weeks and what each one asks.' },
  { t: 'Email', to: '/email', d: 'Your Axal inbox.' },
  { t: 'My Profile', to: '/account', d: 'Name, photo and how people reach you.' },
]);
export const OPENS_WITH_MEMBERSHIP = Object.freeze([
  { t: 'Validate · log interviews', d: 'Opens once your agreement is signed.' },
  { t: 'Build · this week', d: 'Commitments, board, roadmap, cadence.' },
  { t: 'Research · ask the library', d: 'Metered per question.' },
  { t: 'Company record', d: 'Name, jurisdiction, stage.' },
  { t: 'Send an introduction · share a data room · apply to a cohort decision', d: 'Held until the licence is assigned.' },
]);
