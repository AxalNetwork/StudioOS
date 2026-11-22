/** D7121 part 3 (#7121): the approved Wellness page and PDF in the public and admin catalog. */
export default {
  key: 'wellness',
  name: 'Wellness',
  group: 'Access',
  avail: 'proposed',
  purpose: 'A private place in your Axal VC account to check in with yourself each week, find qualified support and book a 1:1 session on your own terms.',
  audience: 'Founders and Administrators with access to Wellbeing, and the studio operators who introduce it.',
  canonical: '/programs/wellness',
  pdf: '/program-briefs/axal-vc-wellness-v1.pdf',
  edition: 'Edition 1 · November 2026',
  slides: 5,
  // The OG registry already shares /programs/wellness with the purpose sentence (D7121); one page, one description.
  og: {
    title: 'Wellness · Programs',
    description: 'A private place in your Axal VC account to check in with yourself each week, find qualified support and book a 1:1 session on your own terms.',
  },
  card: {
    who: 'Founders and Administrators with access to Wellbeing',
    line: 'Proposed · not open. Your personal workspace is separate from this public presentation.',
  },
};
