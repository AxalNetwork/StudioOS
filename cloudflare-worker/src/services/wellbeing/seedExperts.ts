/**
 * Task #8 (DI) — seed a starter set of experts so the directory renders
 * sane matches on a fresh DB. Idempotent: re-running inserts only the
 * experts whose `seed_key` (mapped to `bio` first line marker) is missing.
 *
 * Each expert is multi-category and multi-modality so the matching engine
 * has variety to score against. All seeded experts are flagged
 * `is_active=1` and `verified=1` — admins can demote via direct SQL or a
 * future admin UI.
 */
import type { Env } from '../../types';

interface SeedExpert {
  uid: string;
  name: string;
  headline: string;
  bio: string;
  photo_url: string;
  categories: string[];
  sectors: string[];
  languages: string[];
  timezones: string[];
  modalities: string[];
  pricing_model: 'free' | 'paid' | 'sliding_scale' | 'first_free_then_paid';
  hourly_rate_usd: number | null;
  first_session_free: 0 | 1;
  calendly_url: string | null;
  website_url: string | null;
}

const SEEDS: SeedExpert[] = [
  {
    uid: 'seed_marina_lopes',
    name: 'Marina Lopes',
    headline: 'Executive coach for early-stage founders',
    bio: 'ICF-certified executive coach. 12 years coaching seed/Series A founders through scaling, co-founder conflict, and burnout.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Marina%20Lopes',
    categories: ['executive_coach', 'leadership_coach', 'burnout_specialist'],
    sectors: ['saas', 'fintech', 'consumer'],
    languages: ['en', 'pt'],
    timezones: ['America/New_York', 'America/Sao_Paulo'],
    modalities: ['video', 'phone'],
    pricing_model: 'first_free_then_paid',
    hourly_rate_usd: 250,
    first_session_free: 1,
    calendly_url: 'https://calendly.com/marina-lopes/founder-intro',
    website_url: null,
  },
  {
    uid: 'seed_dr_sanjay_patel',
    name: 'Dr. Sanjay Patel',
    headline: 'Sleep specialist physician — founder edition',
    bio: 'Board-certified in sleep medicine. Works with high-performing founders on sleep architecture, recovery, and shift-disruption.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Sanjay%20Patel',
    categories: ['sleep_specialist_physician', 'sleep_coach', 'functional_medicine_md'],
    sectors: [],
    languages: ['en', 'hi'],
    timezones: ['America/Los_Angeles'],
    modalities: ['video'],
    pricing_model: 'paid',
    hourly_rate_usd: 400,
    first_session_free: 0,
    calendly_url: 'https://calendly.com/dr-patel-sleep/30min',
    website_url: null,
  },
  {
    uid: 'seed_yuki_tanaka',
    name: 'Yuki Tanaka',
    headline: 'GTM advisor — exited B2B SaaS founder',
    bio: 'Built and sold an enterprise SaaS in APAC. Now advises early-stage founders on PMF→GTM and first-10-rep sales motions.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Yuki%20Tanaka',
    categories: ['gtm_advisor', 'sales_advisor', 'exited_founder_mentor'],
    sectors: ['saas', 'enterprise', 'b2b'],
    languages: ['en', 'ja'],
    timezones: ['Asia/Tokyo', 'Asia/Singapore'],
    modalities: ['video', 'async_chat'],
    pricing_model: 'paid',
    hourly_rate_usd: 300,
    first_session_free: 1,
    calendly_url: 'https://calendly.com/yuki-tanaka/founder-gtm',
    website_url: null,
  },
  {
    uid: 'seed_amelia_clark',
    name: 'Amelia Clark, RD',
    headline: 'Performance nutrition for founders',
    bio: 'Registered dietitian focused on cognitive performance, sustained energy, and travel-heavy schedules.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Amelia%20Clark',
    categories: ['nutritionist', 'dietitian', 'habits_coach'],
    sectors: [],
    languages: ['en'],
    timezones: ['Europe/London'],
    modalities: ['video', 'async_chat'],
    pricing_model: 'sliding_scale',
    hourly_rate_usd: 150,
    first_session_free: 0,
    calendly_url: 'https://calendly.com/amelia-clark-rd/intro',
    website_url: null,
  },
  {
    uid: 'seed_carlos_rivera',
    name: 'Carlos Rivera',
    headline: 'Fundraising advisor — pre-seed to Series A',
    bio: 'Ex-VC partner. 80+ founders coached through their first institutional round. Story, deck, narrative, term-sheet review.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Carlos%20Rivera',
    categories: ['fundraising_advisor', 'startup_advisor_general', 'finance_advisor'],
    sectors: ['saas', 'fintech', 'climate', 'ai'],
    languages: ['en', 'es'],
    timezones: ['America/New_York'],
    modalities: ['video', 'phone'],
    pricing_model: 'paid',
    hourly_rate_usd: 350,
    first_session_free: 1,
    calendly_url: 'https://calendly.com/carlos-rivera-fundraising/30min',
    website_url: null,
  },
  {
    uid: 'seed_dr_ngozi_okafor',
    name: 'Dr. Ngozi Okafor',
    headline: 'Therapist — founder mental health',
    bio: 'Licensed clinical psychologist. CBT and IFS modalities. Specialises in identity, anxiety, and isolation in founders.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Ngozi%20Okafor',
    categories: ['therapist_clinical', 'burnout_specialist', 'minority_founder_mentor'],
    sectors: [],
    languages: ['en'],
    timezones: ['Africa/Lagos', 'Europe/London'],
    modalities: ['video'],
    pricing_model: 'sliding_scale',
    hourly_rate_usd: 180,
    first_session_free: 0,
    calendly_url: 'https://calendly.com/dr-ngozi/founder-intake',
    website_url: null,
  },
  {
    uid: 'seed_priya_chen',
    name: 'Priya Chen',
    headline: 'Mindfulness & breathwork coach',
    bio: 'Decade of teaching mindfulness in high-stakes environments. Short, daily-use practices designed for builder workflows.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Priya%20Chen',
    categories: ['mindfulness_coach', 'breathwork_coach', 'stress_management_coach'],
    sectors: [],
    languages: ['en', 'zh'],
    timezones: ['Asia/Singapore'],
    modalities: ['video', 'in_person'],
    pricing_model: 'free',
    hourly_rate_usd: 0,
    first_session_free: 1,
    calendly_url: 'https://calendly.com/priya-chen-mindful/intro',
    website_url: null,
  },
  {
    uid: 'seed_alex_morgan',
    name: 'Alex Morgan',
    headline: 'Strength coach — sustainable energy',
    bio: 'CSCS-certified. Programmes for founders with limited time, focused on injury-free longevity and energy management.',
    photo_url: 'https://api.dicebear.com/7.x/initials/svg?seed=Alex%20Morgan',
    categories: ['strength_coach', 'personal_trainer', 'productivity_coach'],
    sectors: [],
    languages: ['en'],
    timezones: ['America/Los_Angeles'],
    modalities: ['video', 'in_person'],
    pricing_model: 'paid',
    hourly_rate_usd: 120,
    first_session_free: 1,
    calendly_url: 'https://calendly.com/alex-morgan-strength/intro',
    website_url: null,
  },
];

export async function ensureSeededExperts(env: Env): Promise<void> {
  for (const s of SEEDS) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO experts
           (uid, name, headline, bio, photo_url, categories_json, sectors_json,
            languages_json, timezones_json, modalities_json, pricing_model,
            hourly_rate_usd, first_session_free, calendly_url, website_url,
            verified, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      ).bind(
        s.uid, s.name, s.headline, s.bio, s.photo_url,
        JSON.stringify(s.categories), JSON.stringify(s.sectors),
        JSON.stringify(s.languages), JSON.stringify(s.timezones),
        JSON.stringify(s.modalities),
        s.pricing_model, s.hourly_rate_usd, s.first_session_free,
        s.calendly_url, s.website_url,
      ).run();
    } catch (e: any) {
      console.warn('[wellbeing] expert seed failed:', s.uid, String(e?.message || e));
    }
  }
}
