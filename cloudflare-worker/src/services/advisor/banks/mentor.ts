/**
 * Task #2 (AR) — Mentor bank.
 *
 * Onboarding sequence: identity → expertise → comp → topic
 * preferences → calendar capacity → LinkedIn vetting URL.
 */
import type { Question } from '../questionBank';

export const MENTOR_BANK: Question[] = [
  { id: 'mentor.profile.display_name', persona: 'mentor', section: 'PROFILE',
    prompt: 'What name should we display on your mentor profile?',
    input_kind: 'short', importance: 'critical',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'short' },
  { id: 'mentor.profile.bio', persona: 'mentor', section: 'PROFILE',
    prompt: 'A short bio (2-3 sentences) — what should founders know about you?',
    input_kind: 'long', importance: 'critical',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'long' },
  { id: 'mentor.profile.sectors', persona: 'mentor', section: 'EXPERTISE',
    prompt: 'Which sectors do you cover? (comma-separated)',
    input_kind: 'short', importance: 'high',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'csv' },
  { id: 'mentor.profile.expertise', persona: 'mentor', section: 'EXPERTISE',
    prompt: 'Which functional areas of expertise do you offer? (comma-separated)',
    input_kind: 'short', importance: 'high',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'csv' },
  { id: 'mentor.profile.hourly_rate_usd', persona: 'mentor', section: 'COMP',
    prompt: 'Your hourly rate in USD (0 if pro-bono).',
    input_kind: 'number', importance: 'high',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'number' },
  { id: 'mentor.topics.willing', persona: 'mentor', section: 'TOPICS',
    prompt: 'Which topics are you happy to take on? (comma-separated)',
    input_kind: 'short', importance: 'normal',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'csv' },
  { id: 'mentor.topics.unwilling', persona: 'mentor', section: 'TOPICS',
    prompt: 'Anything you would rather not advise on?',
    input_kind: 'short', importance: 'low',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'short', skip_allowed: true },
  { id: 'mentor.calendar.weekly_hours', persona: 'mentor', section: 'CALENDAR',
    prompt: 'Roughly how many hours per week can you offer founders?',
    input_kind: 'select', options: ['<1', '1-2', '3-5', '5+'], importance: 'high',
    page_target: '/calendar', doc_anchor: 'portals/mentor',
    validate: 'select' },
  { id: 'mentor.profile.linkedin_url', persona: 'mentor', section: 'PROFILE',
    prompt: 'Share your LinkedIn URL so founders can vet you.',
    input_kind: 'short', importance: 'high',
    page_target: '/mentors/me', doc_anchor: 'portals/mentor',
    validate: 'url' },
];

export default MENTOR_BANK;
