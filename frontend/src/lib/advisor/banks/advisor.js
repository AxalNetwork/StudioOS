/**
 * Task #11 (AC-2) — Advisor question bank.
 *
 * Column names mirror the live D1 `advisors` schema (display_name,
 * bio, sectors_json, expertise_json, hourly_rate_usd, linkedin_url)
 * — see writeRouter.ts. Don’t introduce ids the router doesn’t
 * know; they would land as `noop` and never persist.
 */
import { all, required, minChars, maxChars, csvNonEmpty, nonNegativeNumber, url, oneOf } from '../validators';

export const ADVISOR_BANK = [
  // --- Identity --------------------------------------------------------
  {
    id: 'advisor.profile.display_name',
    label: 'What name should we display on your advisor profile?',
    type: 'short',
    explainer: 'Shown to founders in the advisor directory and on office-hours invites.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, minChars(2), maxChars(80)),
  },
  {
    id: 'advisor.profile.bio',
    label: 'A short bio (2-3 sentences) — what should founders know about you?',
    type: 'long',
    explainer: 'Headline + bio is what the advisor matcher reads when ranking suggestions.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, minChars(40), maxChars(800)),
  },

  // --- Expertise -------------------------------------------------------
  {
    id: 'advisor.profile.sectors',
    label: 'Which sectors do you cover? (comma-separated)',
    type: 'short',
    explainer: 'Stored as a JSON list; used to match founders by sector.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, csvNonEmpty(1)),
  },
  {
    id: 'advisor.profile.expertise',
    label: 'Which functional areas of expertise do you offer? (comma-separated)',
    type: 'short',
    explainer: 'e.g. Sales, Hiring, Fundraising, GTM',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, csvNonEmpty(1)),
  },

  // --- Comp preference -------------------------------------------------
  {
    id: 'advisor.profile.hourly_rate_usd',
    label: 'Your hourly rate in USD (0 if pro-bono).',
    type: 'number',
    explainer: 'Pro-bono advisors are surfaced first to free-tier founders.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, nonNegativeNumber),
  },

  // --- Topics willing / unwilling -------------------------------------
  {
    id: 'advisor.topics.willing',
    label: 'Which topics are you happy to take on? (comma-separated)',
    type: 'short',
    explainer: 'Free-form topic tags layered on top of your sector and expertise lists.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, csvNonEmpty(1)),
  },
  {
    id: 'advisor.topics.unwilling',
    label: 'Anything you would rather not advise on?',
    type: 'short',
    explainer: 'Optional — saves both sides time.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: maxChars(280),
  },

  // --- Calendar --------------------------------------------------------
  {
    id: 'advisor.calendar.weekly_hours',
    label: 'Roughly how many hours per week can you offer founders?',
    type: 'select',
    options: ['<1', '1-2', '3-5', '5+'],
    explainer: 'Caps how many active office-hour slots the booking page exposes per week.',
    doc_anchor: 'portals/advisor',
    page_target: '/calendar',
    validate: all(required, oneOf(['<1', '1-2', '3-5', '5+'])),
  },

  // --- LinkedIn --------------------------------------------------------
  {
    id: 'advisor.profile.linkedin_url',
    label: 'Share your LinkedIn URL so founders can vet you.',
    type: 'short',
    explainer: 'Public link rendered on your advisor card so founders can vet you before booking.',
    doc_anchor: 'portals/advisor',
    page_target: '/advisors/me',
    validate: all(required, url),
  },
];

export default ADVISOR_BANK;
