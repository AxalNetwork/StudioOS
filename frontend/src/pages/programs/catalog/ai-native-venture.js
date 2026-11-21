/**
 * D6967 (#6967) — AI-native Venture's map entry: registry key → canonical page → committed PDF.
 *
 * A proposed programme that is not open (`560_program_registry.sql`: status `proposed`;
 * `…_4873.sql`: `not_open`). Nothing public reads a programme's status, so this edition states
 * it; a status change in the registry is a new edition (`-v2`). Plain data with no imports.
 * The page and the slides are `../content/ai-native-venture.js`.
 */
export default {
  key: 'ai-native-venture',
  name: 'AI-native Venture',
  group: 'Ventures',
  avail: 'proposed',
  eyebrow: 'A proposed programme for founders',
  // The registry's purpose (593_referral_partners_copy.sql), led by its status (canvas PGA01).
  purpose: 'A proposed programme, not yet open: founders would build an AI-native company with Eadwyn and the studio’s tools.',
  audience: 'Founders exploring how they would build an AI-native company. Which founders exactly is still to be confirmed.',
  canonical: '/programs/ai-native-venture',
  pdf: '/program-briefs/axal-vc-ai-native-venture-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 4,
  og: {
    title: 'AI-native Venture · Programs',
    description: 'A proposed programme, not yet open: founders would build an AI-native company with Eadwyn and the studio’s tools. A four-slide PDF to download.',
  },
  // The index card (pilot canvas PGS08): its fixed line, since nothing reads the status live.
  card: { who: 'Founders', line: 'Proposed. It is not open, and no applications are taken.' },
};
