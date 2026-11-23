/**
 * D6995 (#6995): the home page hero's words, in one plain module.
 *
 * `pages/LandingPage.jsx` draws them, and `lib/ogRegistry.js` hands them to
 * `scripts/prerender-og.mjs`, which writes them into `/` before any
 * JavaScript runs. It imports nothing, so plain Node (the build scripts) can
 * load it the way Vite does.
 */

/** The headline, split around the one emphasised word the page draws in <em>. */
export const HOME_HEADLINE = Object.freeze({
  lead: 'Where we ',
  em: 'build',
  tail: ' the rails for the next generation of ventures',
});

/** The headline as plain text, with no markup. */
export const HOME_HEADLINE_TEXT = HOME_HEADLINE.lead + HOME_HEADLINE.em + HOME_HEADLINE.tail;

/** The sentence under the headline. */
export const HOME_OFFER =
  'Axal VC is the operating platform for venture creation: venture tools, a global partner network, ' +
  'and capital when you’re ready to scale, all in one system for turning an idea into an organization.';

/** The hero's primary action. */
export const HOME_PRIMARY = Object.freeze({ label: 'Join Axal VC', to: '/register' });
