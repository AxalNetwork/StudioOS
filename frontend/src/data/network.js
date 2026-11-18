// Shared Network taxonomies: public Events reads the format filter, and the
// circle and directory surfaces read their respective labels and field shapes.

// ---------------------------------------------------------------------------
// Circle taxonomy
// ---------------------------------------------------------------------------

// The six circle families. `accent` maps to Tailwind colour families already in
// the design system; `icon` is a lucide-react icon name resolved on the page.
export const CIRCLE_TYPES = [
  { id: 'founder', label: 'Founder circles', short: 'Founders', icon: 'Rocket', accent: 'violet',
    blurb: 'Peer groups for operators building and scaling ventures.' },
  { id: 'investor', label: 'Investor circles', short: 'Investors', icon: 'TrendingUp', accent: 'emerald',
    blurb: 'Angels, LPs, and funds sharing dealflow and diligence.' },
  { id: 'partner', label: 'Service partner circles', short: 'Partners', icon: 'Handshake', accent: 'sky',
    blurb: 'Vetted operators — legal, finance, GTM, design, engineering.' },
  { id: 'advisor', label: 'Advisor circles', short: 'Advisors', icon: 'GraduationCap', accent: 'amber',
    blurb: 'Advisors and domain experts offering office hours and guidance.' },
  { id: 'city', label: 'City / region circles', short: 'City & region', icon: 'MapPin', accent: 'rose',
    blurb: 'Local hubs for in-person meetups and regional dealflow.' },
  { id: 'topic', label: 'Topic circles', short: 'Topics', icon: 'Sparkles', accent: 'indigo',
    blurb: 'Deep-dive communities around a sector or technology.' },
];

export const CIRCLE_TYPE_LABEL = Object.fromEntries(
  CIRCLE_TYPES.map((t) => [t.id, t.label]),
);
export const CIRCLE_TYPE_ACCENT = Object.fromEntries(
  CIRCLE_TYPES.map((t) => [t.id, t.accent]),
);

// Access model — public pages anyone can preview vs invite-only circles.
export const ACCESS_TYPES = [
  { id: 'public', label: 'Public', desc: 'Anyone can view and join.' },
  { id: 'private', label: 'Invite-only', desc: 'Request access or get invited by a member.' },
];

// Activity signal shown on each card.
export const ACTIVITY_LEVELS = {
  active: { label: 'Active', dot: 'bg-emerald-500' },
  growing: { label: 'Growing', dot: 'bg-sky-500' },
  quiet: { label: 'Quiet', dot: 'bg-slate-400' },
  new: { label: 'New', dot: 'bg-violet-500' },
};

// ---------------------------------------------------------------------------
// Circles are admin-managed (Task #9): the former hardcoded CIRCLES array was
// removed. The public /circles page fetches published circles from the worker
// (GET /api/public/circles) and admins author them from /admin/circles.
// ---------------------------------------------------------------------------

// Format filter for the public event feed.
export const FORMATS = [
  { id: 'online', label: 'Online' },
  { id: 'in_person', label: 'In-person' },
  { id: 'hybrid', label: 'Hybrid' },
];

// ---------------------------------------------------------------------------
// Directory categories — the tabbed structure for the public Directory.
// `live` marks the tab wired to the production API; the rest are curated
// preview/"coming soon" surfaces until their public endpoints ship.
// ---------------------------------------------------------------------------
export const DIRECTORY_CATEGORIES = [
  { id: 'partners', label: 'Service Partners', icon: 'Handshake', live: true,
    blurb: 'Vetted operators — legal, finance, design, recruiting, GTM and more.' },
  { id: 'startups', label: 'Startups', icon: 'Rocket', live: false,
    blurb: 'Ventures building in and around the Axal VC studio.' },
  { id: 'investors', label: 'Investors & LPs', icon: 'TrendingUp', live: false,
    blurb: 'Angels, funds, and limited partners active in the network.' },
  { id: 'advisors', label: 'Advisors', icon: 'GraduationCap', live: false,
    blurb: 'Advisors and domain experts offering office hours and guidance.' },
];

// Field shapes for the not-yet-live Directory tabs.
//
// These used to be three invented listings per tab, complete with company and
// PERSON names ("Dr. Priya Nair", "Marcus Vale") rendered on a PUBLIC page in
// the same card layout as the real, live Service Partners tab. Each card did
// carry a "Preview" chip — but a Preview chip beside a plausible name reads as
// "preview of this listing", not "this person does not exist", and a card seen
// on its own carries no banner at all.
//
// The cards now show the FIELDS a listing will carry, with the identity slot
// left explicitly blank. Nothing here names an entity, so nothing here can be
// mistaken for one.
export const DIRECTORY_PREVIEWS = {
  startups: [
    { id: 's1', category: 'Sector', geography: 'Location', stage: 'Stage', tags: ['focus', 'focus'] },
    { id: 's2', category: 'Sector', geography: 'Location', stage: 'Stage', tags: ['focus'] },
    { id: 's3', category: 'Sector', geography: 'Location', stage: 'Stage', tags: ['focus', 'focus'] },
  ],
  investors: [
    { id: 'i1', category: 'Investor type', geography: 'Location', stage: 'Cheque stage', tags: ['thesis'] },
    { id: 'i2', category: 'Investor type', geography: 'Location', stage: 'Cheque stage', tags: ['thesis', 'thesis'] },
    { id: 'i3', category: 'Investor type', geography: 'Location', stage: 'Cheque stage', tags: ['thesis'] },
  ],
  advisors: [
    { id: 'a1', category: 'Speciality', geography: 'Location', stage: 'Advisor', tags: ['skill', 'skill'] },
    { id: 'a2', category: 'Speciality', geography: 'Location', stage: 'Advisor', tags: ['skill'] },
    { id: 'a3', category: 'Speciality', geography: 'Location', stage: 'Advisor', tags: ['skill', 'skill'] },
  ],
};
