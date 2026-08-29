/**
 * Invitation copy, one entry per persona, straight from the Emails canvas.
 *
 * TWO VARIANTS PER PERSONA, and the difference is the point. `h1`/`line`/
 * `bullets`/`cta` are the broadcast invitation — a template, and it reads like
 * one. `gpNote`/`gpCta` are the general partner writing to one person; the copy
 * says so out loud ("I am writing personally because a template would undersell
 * this", "I came across what you are building and wanted to write personally
 * rather than let a template do it"). Rendering the GP note through the
 * broadcast chrome would contradict its own first sentence, which is why
 * `renderInvite` takes the variant and the footer follows from it.
 *
 * CONTENT ONLY. No HTML, no `<table>`, no inline styles. The chrome lives in
 * `inviteChrome.ts` because the canvas specifies ONE chrome for every message,
 * and twelve senders in `email.ts` each carrying their own copy of it is how
 * that stops being true.
 *
 * The strings are the canvas's, transcribed rather than rewritten. Where the
 * product later disagrees with the copy, change it here and the change is
 * visible in review as a copy change — not buried in a template literal.
 */

export type PersonaKey = 'founder' | 'investor' | 'advisor' | 'partner';

export interface PersonaInvite {
  label: string;
  /** Broadcast subject/headline. */
  h1: string;
  line: string;
  /** [label, detail] — rendered as a definition list, not a bulleted sentence. */
  bullets: Array<[string, string]>;
  cta: string;
  /** The GP's personal note: one paragraph per entry, in order. */
  gpNote: string[];
  gpCta: string;
}

export const PERSONA_INVITES: Record<PersonaKey, PersonaInvite> = {
  founder: {
    label: 'Founder',
    h1: 'You’re invited to build with Axal VC',
    line: 'Axal VC backs technical founders through incorporation, the first cheque, and the paperwork nobody warns you about.',
    bullets: [
      ['Incorporation', 'Delaware C-Corp or your jurisdiction, filed and tracked'],
      ['Cap table', 'Founder stock, vesting, 83(b) — one record, not a spreadsheet'],
      ['Capital', 'Warm introductions to investors who write at your stage'],
      ['Data room', 'Diligence-ready from the first cheque, not assembled in a panic'],
      ['Advisor network', 'Matched by what you are actually stuck on'],
    ],
    cta: 'Create your founder account',
    gpNote: [
      'I came across what you are building and wanted to write personally rather than let a template do it.',
      'Axal VC exists for the part most founders do alone — incorporation, the cap table, the first cheque. If any of that is ahead of you, I think we would be useful.',
      'No obligation either way. If it is not the right moment, say so and I will leave it.',
    ],
    gpCta: 'Create your founder account',
  },
  investor: {
    label: 'Investor',
    h1: 'Curated spin-out deal flow, and the LP side in one place',
    line: 'Axal VC opens its spin-out pipeline to investors, and gives LPs their fund reporting and capital calls in the same workspace.',
    bullets: [
      ['Deal flow', 'Spin-outs at first-cheque stage, screened before they reach you'],
      ['Diligence', 'Data rooms prepared to a standard, not per-founder improvisation'],
      ['LP workspace', 'Commitments, called capital, and distributions in one ledger'],
      ['Capital calls', 'Notice, figures, and wire instructions where they belong'],
      ['Fund reporting', 'Quarterly reports issued as frozen snapshots, re-downloadable'],
    ],
    cta: 'Set up your LP account',
    gpNote: [
      'I am writing personally because a template would undersell this.',
      'We are opening the spin-out pipeline to a small number of investors, and LPs get their reporting and capital calls in the same place rather than in an inbox.',
      'Happy to walk you through the current fund before you decide anything.',
    ],
    gpCta: 'Set up your LP account',
  },
  advisor: {
    label: 'Advisor',
    h1: 'Join the Axal VC advisor network',
    line: 'Advisors hold office hours and get matched to founders by expertise, not by availability.',
    bullets: [
      ['Office hours', 'You set the slots; founders book against your real calendar'],
      ['Matched by expertise', 'Founders reach you because of what you know'],
      ['Structured engagements', 'Scope, term, and equity agreed in writing up front'],
      ['Track record', 'Outcomes recorded, with the founder’s consent, not self-reported'],
      ['One workspace', 'Sessions, notes, and agreements in a single place'],
    ],
    cta: 'Complete your advisor profile',
    gpNote: [
      'I wanted to ask you directly rather than through a form.',
      'We match advisors to founders by expertise rather than availability, which means fewer sessions and better ones. Your name came up for exactly that reason.',
      'A short call first if you prefer — entirely up to you.',
    ],
    gpCta: 'Complete your advisor profile',
  },
  partner: {
    label: 'Partner',
    h1: 'Join the Axal VC Partner Network',
    line: 'Service partners get referrals from founders who need what they do, and co-marketing that reaches the same audience.',
    bullets: [
      ['Referrals', 'Founders with a stated need, not a scraped contact list'],
      ['Service placement', 'Listed where founders look for the work you do'],
      ['Co-marketing', 'Joint content and events with attribution back to you'],
      ['Scoped engagements', 'Terms and deliverables agreed before work starts'],
      ['One relationship', 'Referrals, delivery, and payment through one workspace'],
    ],
    cta: 'Join the Partner Network',
    gpNote: [
      'This is a personal note rather than a broadcast.',
      'Our founders keep needing the work you do, and at the moment they find people by asking around. I would rather send them to you properly.',
      'If the timing is wrong, tell me and I will come back later.',
    ],
    gpCta: 'Join the Partner Network',
  },
};

export const PERSONA_KEYS = Object.keys(PERSONA_INVITES) as PersonaKey[];

export function isPersonaKey(v: unknown): v is PersonaKey {
  return typeof v === 'string' && (PERSONA_KEYS as string[]).includes(v);
}
