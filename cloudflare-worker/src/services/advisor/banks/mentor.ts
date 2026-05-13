/**
 * Task #2 (AR) + Task #5 (CH) — Mentor bank.
 *
 * Onboarding + ongoing engagement: identity → expertise → comp →
 * topic preferences → calendar capacity → vetting → engagement health.
 */
import type { Question } from '../questionBank';

type RowSpec = {
  id: string; prompt: string;
  kind?: Question['input_kind']; imp?: Question['importance'];
  hint?: string; opts?: string[]; skip?: boolean; ev?: boolean;
  followups?: string[]; mi?: Question['mi_section'];
  sent?: boolean; talc?: boolean;
};
const inferValidate = (k?: Question['input_kind']): Question['validate'] =>
  k === 'select' ? 'select' : k === 'number' ? 'number' :
  k === 'short' ? 'short'   : k === 'multi'  ? 'multi'  :
  k === 'long'  ? 'long'    : 'long';
const block = (section: string, page: string, anchor: string,
               rows: RowSpec[]): Question[] =>
  rows.map(r => ({
    id: r.id, persona: 'mentor', section,
    prompt: r.prompt, hint: r.hint,
    input_kind: r.kind ?? 'long', options: r.opts,
    importance: r.imp ?? 'normal',
    page_target: page, doc_anchor: anchor,
    validate: r.id.endsWith('linkedin_url') ? 'url'
            : r.id.endsWith('sectors') || r.id.endsWith('expertise') ||
              r.id.endsWith('topics_willing') || r.id.endsWith('topics_unwilling') ? 'csv'
            : inferValidate(r.kind),
    skip_allowed: r.skip,
    requires_evidence: r.ev,
    followups: r.followups,
    mi_section: r.mi,
    sentiment_eligible: r.sent,
    talc_eligible: r.talc,
  }));

export const MENTOR_BANK: Question[] = [
  // ---- PROFILE --------------------------------------------------------
  ...block('PROFILE', '/mentors/me', 'portals/mentor', [
    { id: 'mentor.profile.display_name', prompt: 'What name should we display on your mentor profile?', kind: 'short', imp: 'critical', followups: ['mentor.profile.bio'] },
    { id: 'mentor.profile.bio', prompt: 'A short bio (2-3 sentences) — what should founders know about you?', imp: 'critical', followups: ['mentor.profile.linkedin_url'] },
    { id: 'mentor.profile.linkedin_url', prompt: 'Share your LinkedIn URL so founders can vet you.', kind: 'short', imp: 'high', followups: ['mentor.profile.years_operating'] },
    { id: 'mentor.profile.years_operating', prompt: 'How many years have you spent operating in startups (founder / exec / IC)?', kind: 'number', skip: true },
    { id: 'mentor.profile.exits_or_outcomes', prompt: 'Notable exits or outcomes you can speak to (1-2 lines).', skip: true },
    { id: 'mentor.profile.public_writing', prompt: 'Link to a blog, podcast, or talk that represents your thinking (or "none").', kind: 'short', skip: true },
  ]),

  // ---- EXPERTISE ------------------------------------------------------
  ...block('EXPERTISE', '/mentors/me', 'portals/mentor', [
    { id: 'mentor.profile.sectors', prompt: 'Which sectors do you cover? (comma-separated)', kind: 'short', imp: 'high', mi: 'sector_heat' },
    { id: 'mentor.profile.expertise', prompt: 'Which functional areas of expertise do you offer? (comma-separated)', kind: 'short', imp: 'high' },
    { id: 'mentor.expertise.stages', prompt: 'Which company stages do you most enjoy advising?', kind: 'select', opts: ['Pre-idea','Pre-seed','Seed','Series A','Series B+','Any'], mi: 'capital_velocity' },
    { id: 'mentor.expertise.geographies', prompt: 'Which geographies are you most plugged into? (comma-separated)', kind: 'short', mi: 'sentiment_geo' },
    { id: 'mentor.expertise.adoption_curve', prompt: 'Are you sharper on early-adopter GTM or scaling-into-mass-market motions?', kind: 'select', opts: ['Early adopters','Early majority','Both'], mi: 'talc', talc: true },
    { id: 'mentor.expertise.depth_or_breadth', prompt: 'Depth specialist (one domain, deep) or breadth generalist (many topics, lighter)?', kind: 'select', opts: ['Depth','Breadth','Mix'] },
  ]),

  // ---- TOPICS ---------------------------------------------------------
  ...block('TOPICS', '/mentors/me', 'portals/mentor', [
    { id: 'mentor.topics.willing', prompt: 'Which topics are you happy to take on? (comma-separated)', kind: 'short', followups: ['mentor.topics.unwilling'] },
    { id: 'mentor.topics.unwilling', prompt: 'Anything you would rather not advise on?', kind: 'short', skip: true, followups: ['mentor.topics.signature_session'] },
    { id: 'mentor.topics.signature_session', prompt: 'What is your signature session — the talk you can give to any founder?' },
    { id: 'mentor.topics.recent_wins', prompt: 'A recent founder win you helped catalyse (1-2 sentences). Skip if too sensitive.', skip: true, mi: 'partner_pulse', sent: true },
    { id: 'mentor.topics.preferred_session_length_min', prompt: 'Preferred 1:1 session length (minutes).', kind: 'select', opts: ['15','30','45','60','90'] },
    { id: 'mentor.topics.async_vs_sync', prompt: 'Do you prefer async (Slack/email) or sync (calls) for ongoing support?', kind: 'select', opts: ['Async','Sync','Mix'] },
  ]),

  // ---- COMP -----------------------------------------------------------
  ...block('COMP', '/mentors/me', 'portals/mentor', [
    { id: 'mentor.profile.hourly_rate_usd', prompt: 'Your hourly rate in USD (0 if pro-bono).', kind: 'number', imp: 'high' },
    { id: 'mentor.comp.equity_open', prompt: 'Are you open to taking startup equity in lieu of cash for advisory?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'mentor.comp.minimum_engagement_hours', prompt: 'Minimum engagement size (hours) before you take a new founder.', kind: 'number', skip: true },
  ]),

  // ---- CALENDAR -------------------------------------------------------
  ...block('CALENDAR', '/calendar', 'portals/mentor', [
    { id: 'mentor.calendar.weekly_hours', prompt: 'Roughly how many hours per week can you offer founders?', kind: 'select', opts: ['<1','1-2','3-5','5+'], imp: 'high' },
    { id: 'mentor.calendar.timezones_covered', prompt: 'Time zones you can comfortably take meetings in (comma-separated).', kind: 'short', mi: 'sentiment_geo' },
    { id: 'mentor.calendar.notice_required_hours', prompt: 'Minimum notice you need to schedule a session (hours).', kind: 'number' },
    { id: 'mentor.calendar.office_hours_window', prompt: 'Do you offer recurring office hours? Day + window (e.g. "Fri 1-3pm PT") or "ad-hoc only".', kind: 'short', skip: true },
  ]),

  // ---- ENGAGEMENT (ongoing) ------------------------------------------
  ...block('ENGAGEMENT', '/mentors/me', 'portals/mentor', [
    { id: 'mentor.engagement.active_founders', prompt: 'How many founders are you actively mentoring right now?', kind: 'number', skip: true, mi: 'partner_pulse' },
    { id: 'mentor.engagement.satisfaction', prompt: 'On a 1-10, how satisfied are you with your current mentoring engagements?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'mentor.engagement.intros_made_qtr', prompt: 'How many intros did you make for mentees last quarter?', kind: 'number', skip: true, mi: 'partner_pulse' },
    { id: 'mentor.engagement.biggest_friction', prompt: 'Biggest friction in being a mentor on the platform?', mi: 'sentiment', sent: true },
    { id: 'mentor.engagement.referral_likely', prompt: 'How likely are you to refer another mentor to the platform? (NPS-style 0-10)', kind: 'select', opts: ['0','1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
  ]),
];

export default MENTOR_BANK;
