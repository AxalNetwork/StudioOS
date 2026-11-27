// D1355: unmodified files from LinkedIn's own downloads, read 2026-10-28.
export const LINKEDIN_SOURCE = 'https://content.linkedin.com/content/dam/me/business/en-us/amp/xbu/linkedin-revised-brand-guidelines/logos/in-logo.zip';
export const LINKEDIN_GUIDELINES = 'https://brand.linkedin.com/in-logo';
export const LINKEDIN_BUTTON_SOURCE = 'https://content.linkedin.com/content/dam/developer/branding/signin_with_linkedin-buttons.zip';
export const LINKEDIN_ASSET_HASHES = Object.freeze({
  "linkedin-in-blue.png": "3c0149f26168b5fe0f43e68664abe40341a6443b3cd435d18a73e12f64f8b600",
  "linkedin-in-white.png": "ed22a5ab46c171e3449708ff34923de7298da00ac204c7f85444db05bf888791",
  "linkedin-signin-default.png": "bea8279a2ca5d22e08d31bfc18a01cab97d689d828cb55435fa43a108e993a2f",
  "linkedin-signin-hover.png": "e56776de5dd22153ab95c2c224349ed7c01070fbb3703bf8bb6d136ed3692191",
  "linkedin-signin-active.png": "6939ae92e9aebbcd8c9b9f3a29951930aa0b333047c77d1a14fb839e25e81f6e"
});
const image = (name) => ({ tag: 'image', attrs: { width: 635, height: 540, href: '/site/' + name, preserveAspectRatio: 'xMidYMid meet' }, children: [] });
const blue = image('linkedin-in-blue.png');
const white = image('linkedin-in-white.png');
export const LINKEDIN_MARK = Object.freeze({
  name: 'LinkedIn', viewBox: '0 0 635 540', hex: '#2867B2', dark: '#ffffff',
  source: LINKEDIN_SOURCE, sourceBlob: '8bc2d53ce28288d1004a2ea9670fa4571b0343dc', version: '2026-10-28',
  licence: LINKEDIN_GUIDELINES, guidelines: LINKEDIN_GUIDELINES,
  // 28px viewport keeps the actual bug above 21px, including the supplied ®.
  // 8px reserved space is our compact-UI rule, not a claimed LinkedIn number.
  minGlyph: 28, clearSpace: 8,
  artwork: [
    { tag: 'g', attrs: { className: 'dark:hidden' }, children: [blue] },
    { tag: 'g', attrs: { className: 'hidden dark:inline' }, children: [white] },
  ],
  lightArtwork: [blue], inverseArtwork: [white],
});
export const LINKEDIN_SIGNIN = Object.freeze({
  source: LINKEDIN_BUTTON_SOURCE,
  guidelines: 'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2#image-resources',
  default: '/site/linkedin-signin-default.png', hover: '/site/linkedin-signin-hover.png', active: '/site/linkedin-signin-active.png',
});
