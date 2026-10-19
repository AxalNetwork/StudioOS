/**
 * D757 §2.12 (#1929) — what Zoom's page, the Customer conversations cards and
 * Record a session say about feeding Validate. One module, so the strings
 * move once when D754 f1's and D756's pages take them over.
 *
 * THE COPY IS D757 §2.12's, WORD FOR WORD. `frontend/test/connector_wording_d757.test.mjs`
 * pins every string. The Worker's fields decide what is drawn: `suggests`
 * and `distribution` (#1922), and `configured` (D751).
 *
 * NO "USED BY" LINKS (the owner, 2026-10-19). Every profile sees Connectors,
 * and Validate is the founder's alone, so a card or a connector page never
 * links to Validate › Record a session or Validate › Inbox. The Worker's
 * `used_by` is not drawn.
 */

/** Validate's module keys (`integrations/moduleLabels.ts`), named as `cycleValidate.ts` MODULES. */
export const VALIDATE_MODULE_LABELS = Object.freeze({
  problem_discovery: 'Problem discovery',
  customer_research: 'Customer research',
  ideal_customer_profile: 'Ideal customer profile',
  market_intelligence: 'Market intelligence',
  demand_signals: 'Demand and urgency signals',
  experiments: 'Experiments and evidence',
  verdict: 'Verdict',
});

/** Zoom's `suggests` as #1922 ships it: the six modules a transcript suggests into. */
export const DEFAULT_SUGGESTS = Object.freeze([
  'problem_discovery', 'customer_research', 'ideal_customer_profile', 'market_intelligence', 'demand_signals', 'experiments',
]);

/** "a", "a and b", "a, b, and c". */
export function listSentence(names) {
  const n = names.length;
  if (n <= 1) return names[0] || '';
  if (n === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[n - 1]}`;
}

/**
 * The engine sentence, naming the modules a source suggests into. Unknown keys
 * and Verdict (it has its own sentence) are left out; with none left, the six.
 */
export function engineSentence(suggests) {
  const keys = (Array.isArray(suggests) ? suggests : [])
    .filter((k) => k !== 'verdict' && Object.hasOwn(VALIDATE_MODULE_LABELS, k));
  const names = [...new Set(keys.length ? keys : DEFAULT_SUGGESTS)].map((k) => VALIDATE_MODULE_LABELS[k]);
  return `Eadwyn writes a draft summary and suggests findings for ${listSentence(names)}. You accept each one. Accepted evidence is there for your Verdict.`;
}

// ---------- Zoom (`/account/connectors/zoom`) -------------------------------

export const ZOOM_HOW_STEPS = Object.freeze([
  'Schedule a call from an interview in Record a session. Axal creates the meeting on your Zoom account.',
  'When the call ends and Zoom finishes its cloud transcript, Axal imports it into that interview.',
]);

/** How it works: the two steps, then the engine sentence from Zoom's `suggests`. */
export const zoomHowItWorks = (suggests) => [...ZOOM_HOW_STEPS, engineSentence(suggests)];

export const ZOOM_SECTIONS = Object.freeze([
  { key: 'need', title: 'What you need', text: 'A Zoom Pro plan or higher, cloud recording on, and Create audio transcript turned on before the call.' },
  { key: 'consent', title: 'Consent', text: 'Before Axal schedules a recorded call, you confirm the interviewee agreed. Zoom also shows its own recording notice.' },
  { key: 'cost', title: 'Cost', text: 'Summaries and suggestions use your AI allowance, then your token packs.' },
  { key: 'data', title: 'Your data', text: "Transcripts are kept in your interview. Deleting the interview deletes them. Disconnecting revokes Axal's access at Zoom; transcripts already imported stay in your interviews." },
]);

/** Beside Disconnect: the half of Your data that says what Disconnect keeps. */
export const ZOOM_DISCONNECT_NOTE = "Disconnecting revokes Axal's access at Zoom; transcripts already imported stay in your interviews.";

/** D751's `configured: false`. */
export const ZOOM_UNCONFIGURED = "Zoom isn't set up on Axal yet, so it can't be connected. Nothing was sent to Zoom.";

export const ZOOM_DISTRIBUTION = Object.freeze({
  own_account: "Zoom hasn't approved Axal for other Zoom accounts yet. Until it does, only accounts in Axal's own Zoom organisation can connect.",
  beta: 'Zoom beta: open to invited founders.',
  public: null,
});

/**
 * Who can connect, from `distribution`. Anything but `beta` or `public` is
 * the narrowest, as the Worker reads `ZOOM_APP_AUDIENCE`: a page never
 * promises more founders than can connect.
 */
export function zoomDistributionNotice(distribution) {
  const d = typeof distribution === 'string' ? distribution.trim().toLowerCase() : '';
  return d === 'beta' || d === 'public' ? ZOOM_DISTRIBUTION[d] : ZOOM_DISTRIBUTION.own_account;
}

/** The notices above Zoom's sections: not set up (D751), then who can connect. */
export function zoomNotices(p) {
  const out = [];
  if (p?.configured === false) out.push({ key: 'unconfigured', text: ZOOM_UNCONFIGURED });
  const who = zoomDistributionNotice(p?.distribution);
  if (who) out.push({ key: 'distribution', text: who });
  return out;
}

// ---------- The Customer conversations cards --------------------------------

export const CHAT_ENGINE = 'Chats you assign to an interview become its notes. Eadwyn writes a draft summary and suggests findings for your Validate modules; you accept each one.';

/** Each card's engine sentence. No Used by links: see the header. */
export const CHANNEL_WORDING = Object.freeze({
  telegram: { engine: CHAT_ENGINE },
  whatsapp: { engine: CHAT_ENGINE },
  zoom: { engine: engineSentence(DEFAULT_SUGGESTS) },
  google_meet: { engine: engineSentence(DEFAULT_SUGGESTS) },
});

// ---------- Record a session -------------------------------------------------

export const RECORD_ENGINE = "Axal records this device's microphone, turns speech into text, then writes a draft summary and suggests findings for your Validate modules.";

/**
 * The source picker's D757 line: the recorder's for In person, Video and
 * Phone; the chats' for an imported WhatsApp or Telegram chat; none for a
 * pasted transcript.
 */
export function recordSourceLine(mode, provider) {
  if (mode === 'in_person' || mode === 'video' || mode === 'phone') return RECORD_ENGINE;
  if (mode === 'text' && (provider === 'whatsapp' || provider === 'telegram')) return CHAT_ENGINE;
  return null;
}
