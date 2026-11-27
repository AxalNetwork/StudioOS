/**
 * Task #8 (DI) — canonical Expert category catalogue.
 *
 * Single source of truth referenced by:
 *   - services/wellbeing/match.ts  (validates `categories` on Expert rows)
 *   - routes/wellbeing.ts          (returns the catalogue to the FE)
 *   - frontend/src/pages/WellbeingPage.jsx (filter dropdown labels)
 *
 * Categories are grouped into seven families (advisory, advisorship, three
 * wellness families, lifestyle, cross-cutting). An expert can belong to
 * multiple categories across families.
 */
export interface ExpertCategoryDef {
  key: string;
  label: string;
  family: ExpertCategoryFamily;
}

export type ExpertCategoryFamily =
  | 'advisory'
  | 'advisorship'
  | 'wellness_mental'
  | 'wellness_physical'
  | 'wellness_clinical'
  | 'wellness_lifestyle'
  | 'cross_cutting';

export const EXPERT_CATEGORY_FAMILIES: Record<ExpertCategoryFamily, string> = {
  advisory: 'Advisory',
  advisorship: 'Advisorship',
  wellness_mental: 'Wellness — Mental & Emotional',
  wellness_physical: 'Wellness — Physical',
  wellness_clinical: 'Wellness — Clinical / Functional',
  wellness_lifestyle: 'Wellness — Lifestyle',
  cross_cutting: 'Cross-cutting',
};

export const EXPERT_CATEGORIES: ExpertCategoryDef[] = [
  // Advisory
  { key: 'startup_advisor_general', label: 'Startup advisor (general)', family: 'advisory' },
  { key: 'gtm_advisor', label: 'Go-to-market advisor', family: 'advisory' },
  { key: 'product_advisor', label: 'Product advisor', family: 'advisory' },
  { key: 'engineering_advisor', label: 'Engineering / CTO advisor', family: 'advisory' },
  { key: 'fundraising_advisor', label: 'Fundraising advisor', family: 'advisory' },
  { key: 'sales_advisor', label: 'Sales advisor', family: 'advisory' },
  { key: 'marketing_advisor', label: 'Marketing advisor', family: 'advisory' },
  { key: 'finance_advisor', label: 'Finance / CFO advisor', family: 'advisory' },
  { key: 'legal_advisor', label: 'Legal advisor', family: 'advisory' },
  { key: 'hr_people_advisor', label: 'People & HR advisor', family: 'advisory' },
  { key: 'data_ai_advisor', label: 'Data / AI advisor', family: 'advisory' },
  { key: 'design_advisor', label: 'Design advisor', family: 'advisory' },
  { key: 'operations_advisor', label: 'Operations advisor', family: 'advisory' },
  { key: 'international_expansion_advisor', label: 'International expansion advisor', family: 'advisory' },

  // Advisorship
  { key: 'peer_founder_advisor', label: 'Peer founder advisor', family: 'advisorship' },
  { key: 'second_time_founder_advisor', label: 'Second-time founder advisor', family: 'advisorship' },
  { key: 'exited_founder_advisor', label: 'Exited founder advisor', family: 'advisorship' },
  { key: 'industry_advisor', label: 'Industry-vertical advisor', family: 'advisorship' },
  { key: 'first_time_founder_advisor', label: 'First-time founder advisor', family: 'advisorship' },
  { key: 'minority_founder_advisor', label: 'Underrepresented founder advisor', family: 'advisorship' },

  // Wellness — Mental & Emotional
  { key: 'executive_coach', label: 'Executive coach', family: 'wellness_mental' },
  { key: 'leadership_coach', label: 'Leadership coach', family: 'wellness_mental' },
  { key: 'therapist_clinical', label: 'Therapist / clinical psychologist', family: 'wellness_mental' },
  { key: 'psychiatrist', label: 'Psychiatrist', family: 'wellness_mental' },
  { key: 'mindfulness_coach', label: 'Mindfulness / meditation coach', family: 'wellness_mental' },
  { key: 'burnout_specialist', label: 'Burnout specialist', family: 'wellness_mental' },
  { key: 'relationship_counsellor', label: 'Relationship counsellor', family: 'wellness_mental' },
  { key: 'sport_psychologist', label: 'Sport / performance psychologist', family: 'wellness_mental' },

  // Wellness — Physical
  { key: 'nutritionist', label: 'Nutritionist', family: 'wellness_physical' },
  { key: 'dietitian', label: 'Registered dietitian', family: 'wellness_physical' },
  { key: 'personal_trainer', label: 'Personal trainer', family: 'wellness_physical' },
  { key: 'strength_coach', label: 'Strength & conditioning coach', family: 'wellness_physical' },
  { key: 'yoga_teacher', label: 'Yoga teacher', family: 'wellness_physical' },
  { key: 'physiotherapist', label: 'Physiotherapist', family: 'wellness_physical' },

  // Wellness — Clinical / Functional
  { key: 'sleep_specialist_physician', label: 'Sleep specialist physician', family: 'wellness_clinical' },
  { key: 'functional_medicine_md', label: 'Functional medicine MD', family: 'wellness_clinical' },
  { key: 'integrative_medicine_md', label: 'Integrative medicine MD', family: 'wellness_clinical' },
  { key: 'longevity_clinician', label: 'Longevity clinician', family: 'wellness_clinical' },
  { key: 'gp_concierge', label: 'Concierge GP', family: 'wellness_clinical' },
  { key: 'hormone_specialist', label: 'Hormone / endocrine specialist', family: 'wellness_clinical' },

  // Wellness — Lifestyle
  { key: 'stress_management_coach', label: 'Stress-management coach', family: 'wellness_lifestyle' },
  { key: 'sleep_coach', label: 'Sleep coach', family: 'wellness_lifestyle' },
  { key: 'productivity_coach', label: 'Productivity / focus coach', family: 'wellness_lifestyle' },
  { key: 'habits_coach', label: 'Habits coach', family: 'wellness_lifestyle' },
  { key: 'breathwork_coach', label: 'Breathwork coach', family: 'wellness_lifestyle' },
  { key: 'spiritual_philosophical_advisor', label: 'Spiritual / philosophical advisor', family: 'wellness_lifestyle' },

  // Cross-cutting
  { key: 'diversity_inclusion_advisor', label: 'Diversity & inclusion advisor', family: 'cross_cutting' },
  { key: 'esg_advisor', label: 'ESG / impact advisor', family: 'cross_cutting' },
  { key: 'tax_advisor', label: 'Personal tax advisor', family: 'cross_cutting' },
  { key: 'wealth_advisor', label: 'Wealth advisor', family: 'cross_cutting' },
  { key: 'estate_planning_advisor', label: 'Estate planning advisor', family: 'cross_cutting' },
];

export const EXPERT_CATEGORY_KEYS: Set<string> = new Set(EXPERT_CATEGORIES.map((c) => c.key));

export const VALID_MODALITIES = ['video', 'phone', 'in_person', 'async_chat'] as const;
export type Modality = typeof VALID_MODALITIES[number];

export const VALID_PRICING_MODELS = ['free', 'paid', 'sliding_scale', 'first_free_then_paid'] as const;
export type PricingModel = typeof VALID_PRICING_MODELS[number];

export function isValidCategoryKey(k: string): boolean {
  return EXPERT_CATEGORY_KEYS.has(k);
}
