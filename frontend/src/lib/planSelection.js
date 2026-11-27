/**
 * #4651 — what registration says about the plan a visitor chose on /pricing (see `planIntent.js` for the contract).
 * Split from it so `pricingModel.js` can build register addresses without importing the model that reads its cards.
 */
import { planCards } from './pricingModel';
import { specFor } from './planIntent';

/**
 * What registration says about the chosen plan, from the public catalogue read: `{ state, ... }`.
 *   ready        the plan, what it costs a month, how it is charged and what is committed;
 *   unavailable  the plan, or its yearly price, is not sold now: said so, and nothing else is substituted;
 *   unreadable   the catalogue could not be read: that is not the same as the plan not existing.
 */
export function selectionFor(read, intent) {
  if (!intent) return null;
  const found = specFor(intent.planKey);
  if (!found) return { state: 'unavailable', name: null, line: 'That plan is not one Axal VC sells. Choose a plan on Pricing.' };
  const { spec } = found;
  if (!read || !Array.isArray(read.plans)) return { state: 'unreadable', name: spec.name, line: `${spec.name}’s price could not be read just now. That is not the same as it not being offered.` };
  const built = planCards(read, [spec], { billing: intent.interval, signedIn: false });
  const card = built.cards?.[0];
  if (!card || !card.offered) return { state: 'unavailable', name: spec.name, line: `${spec.name} is not offered right now. Nothing has been chosen for you instead.` };
  if (intent.interval === 'yearly' && card.yearlyMissing) {
    return { state: 'unavailable', name: spec.name, line: `Yearly billing is not offered for ${spec.name} right now. Choose monthly or another plan on Pricing; nothing was switched for you.` };
  }
  const yearly = intent.interval === 'yearly';
  return {
    state: 'ready', name: spec.name, kick: spec.kick || '', interval: intent.interval, tab: found.tab,
    perMonth: `${card.price} ${card.unit}`,
    basis: yearly ? card.note : 'billed every month',
    commitment: yearly ? `The full ${card.note.replace(/ billed yearly$/, '')} is charged at checkout, for the whole year.` : 'Charged each month at checkout.',
  };
}
