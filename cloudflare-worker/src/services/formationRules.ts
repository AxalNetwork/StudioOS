/** D6704 (#6704): deterministic comparison rules over a published catalogue; no I/O or model. */
import type { CatalogueForm } from './formationCatalogue';
import { AGENT_DISCLAIMERS, GENERAL_COUNSEL_DISCLAIMER_KEY } from './agents/disclaimers';

export type FormationAnswers = {
  founders: { residence_country: string | null }[];
  operating_countries: string[];
  management_country?: string;
  founder_state?: string;
  written_us_investor_requirement?: boolean; us_investor_requirement_document?: string;
  cross_border?: boolean; regulated?: boolean; spinout?: boolean; flip?: boolean; fund?: boolean; grant?: boolean;
  payments?: boolean; health?: boolean;
};
/** Closed v1 rule payload, stored in formation_rules.rule_json. An unknown shape refuses rather than guessing. */
export type ComparisonRule = {
  scenario: number; country: string; form_key: string;
  when: Record<string, string | boolean>;
  reasons: string[]; what_would_change_it: string[];
};
export type RuleCatalogue = { version: number; status: string; forms: CatalogueForm[]; rules: ComparisonRule[] };
const prohibited = /tax[ _-]*rate|saving|index.?rank|\b\d+(?:\.\d+)?\s*%/i;
const safeText = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 2000 && !prohibited.test(s);
export function formationRules(answers: FormationAnswers, catalogue: RuleCatalogue, openedForm: string | null = null) {
  if (catalogue.status !== 'published' || !Number.isSafeInteger(catalogue.version) || catalogue.version < 1) throw new Error('published_catalogue_required');
  if (!Array.isArray(answers.founders) || !answers.founders.length || answers.founders.some(f => !/^[A-Z]{2}$/.test(f.residence_country || ''))
    || !Array.isArray(answers.operating_countries) || !answers.operating_countries.length || answers.operating_countries.some(c => !/^[A-Z]{2}$/.test(c))) throw new Error('residence_and_management_required');
  for (const key of ['written_us_investor_requirement','cross_border','regulated','spinout','flip','fund','grant','payments','health'] as const) if (answers[key] !== undefined && typeof answers[key] !== 'boolean') throw new Error('boolean_answer_required');
  if (answers.written_us_investor_requirement && (typeof answers.us_investor_requirement_document !== 'string' || !answers.us_investor_requirement_document.trim())) throw new Error('written_requirement_evidence_required');
  const home = answers.management_country;
  if (!home || !/^[A-Z]{2}$/.test(home)) throw new Error('management_country_invalid');
  const countries = new Set([...answers.founders.map(f => f.residence_country), ...answers.operating_countries, home]);
  const complex = ['regulated', 'spinout', 'flip', 'fund', 'grant', 'payments', 'health'].some(k => answers[k as keyof FormationAnswers] === true);
  const specialist = complex || answers.cross_border === true || countries.size > 1;
  const forms = [...catalogue.forms].sort((a,b) => a.form.key < b.form.key ? -1 : a.form.key > b.form.key ? 1 : 0);
  if (new Set(forms.map(f => f.form.key)).size !== forms.length) throw new Error('duplicate_form');
  const ruleFor = (key: string) => catalogue.rules.find(r => r.form_key === key && r.country === home && r.when && typeof r.when === 'object' && !Array.isArray(r.when) && Object.entries(r.when).every(([k,v]) => ['founder_state', 'written_us_investor_requirement', 'cross_border', 'regulated', 'spinout', 'flip', 'fund', 'grant', 'payments', 'health'].includes(k) && answers[k as keyof FormationAnswers] === v));
  const selected = forms.filter(f => f.form.offer_mode !== 'off' && !!ruleFor(f.form.key) && (ruleFor(f.form.key)!.scenario !== 1 || (f.form.key === 'us_de_llc' && answers.founder_state === 'DE')) && (
    f.form.key === openedForm || (answers.written_us_investor_requirement === true && f.form.key === 'us_de_ccorp') ||
    ((f.jurisdiction.country === home || answers.founders.some(founder => founder.residence_country === f.jurisdiction.country)) && f.jurisdiction.country !== 'EE' && !['us_wy_ccorp', 'us_de_llc'].includes(f.form.key)) ||
    (home === 'US' && answers.founder_state === 'DE' && f.form.key === 'us_de_llc')
  )).sort((a,b) => (a.form.key === openedForm ? 0 : a.form.key === 'us_de_ccorp' && answers.written_us_investor_requirement ? 1 : 2) - (b.form.key === openedForm ? 0 : b.form.key === 'us_de_ccorp' && answers.written_us_investor_requirement ? 1 : 2)).slice(0,3);
  // Opened forms always occupy a slot, even when the local catalogue has several forms.
  const opened = forms.find(f => f.form.key === openedForm && f.form.offer_mode !== 'off');
  if (opened && !selected.includes(opened)) selected.splice(2,1,opened);
  const options = selected.map(f => {
    const rule = ruleFor(f.form.key);
    if (!rule || !Number.isInteger(rule.scenario) || rule.scenario < 1 || rule.scenario > 13 || !Array.isArray(rule.reasons) || !rule.reasons.length || !Array.isArray(rule.what_would_change_it) || !rule.what_would_change_it.length || ![...rule.reasons, ...rule.what_would_change_it].every(safeText)) throw new Error('comparison_rule_not_recorded');
    if (!safeText(f.form.key) || !safeText(f.form.label)) throw new Error('comparison_text_invalid');
    const requirements = f.facts.filter(x => /^(residency|director|secretary|registered_office|licensing|capital|filing|local_presence)(_|$)/.test(x.key)).map(x => {
      if (!safeText(x.key) || (x.source && (!safeText(x.source.title) || (x.source.url != null && !safeText(x.source.url)))) || (x.value != null && !safeText(x.value))) throw new Error('comparison_text_invalid');
      return { key: x.key, value: x.value, status: x.status, source: x.source, checked_on: x.checked_on };
    });
    const path = specialist || (f.jurisdiction.country === 'EE' && home !== 'EE') ? 'specialist' : 'simple';
    // Decision 10A preserves the simple route for an otherwise simple non-US founder choosing Delaware.
    return { waiver_eligible: [4,5,10,11,13].includes(rule.scenario) && !['payments','health','fund','flip','spinout'].some(k => answers[k as keyof FormationAnswers] === true), form_key: f.form.key, label: f.form.label, scenario: rule.scenario, path, structure_gate: path === 'specialist' ? 'required' : 'not_required', reasons: rule.reasons, what_would_change_it: rule.what_would_change_it, requirements, offer_mode: f.form.offer_mode };
  });
  if (!options.length) throw new Error('comparison_rule_not_recorded');
  return { catalogue_version: catalogue.version, notice: { key: GENERAL_COUNSEL_DISCLAIMER_KEY, version: 'D4421', text: AGENT_DISCLAIMERS[GENERAL_COUNSEL_DISCLAIMER_KEY] },
    information: home === 'US' && answers.founder_state !== 'DE' ? ['home-state LLC'] : [], options,
    not_shown: forms.filter(f => !selected.includes(f)).map(f => ({ form_key: f.form.key, reason: f.form.offer_mode === 'off' ? 'Not offered' : !ruleFor(f.form.key) ? 'No published comparison rule covers this form and these circumstances' : f.jurisdiction.country === 'EE' ? 'Open this form to compare it' : 'Not selected by the recorded circumstances; open the form to compare it' })) };
}
