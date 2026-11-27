/**
 * D717 decision 13 (#1859) — the phone check in front of an LP's wire
 * instructions, as a pure reducer so a Node test can hold it.
 *
 * Three steps. `gate` shows the amount, the due date and the warning box with
 * one tick; nothing names the bank or the account. `masked` shows the masked
 * instructions and is reached only from `gate` with the box ticked. `full` is
 * the full account number, fetched from the reveal route, reached only from
 * `masked` with the box ticked. Unticking at any step goes back to `gate`.
 *
 * The tick is a self-check, not a record: it lives in React state, nothing
 * stores it in the browser and nothing sends it to the Worker.
 */

export const WIRE_STEPS = ['gate', 'masked', 'full'];

/** The sentence in the phone-check box, word for word (DESK:43). #1860 imports it. */
export const PHONE_CHECK = 'Confirm these instructions by phone, on a number you already hold, before you send money. Axal VC never changes wire instructions by email.';

export function initialWire() {
  return { step: 'gate', confirmed: false };
}

/**
 * An action that does not apply to the current step returns the same state
 * object, so a stray dispatch re-renders nothing.
 */
export function wireReducer(state, action) {
  switch (action?.type) {
    case 'confirm':
      if (action.value === true) return state.confirmed ? state : { ...state, confirmed: true };
      return action.value === false ? initialWire() : state;
    case 'show':
      return state.step === 'gate' && state.confirmed ? { ...state, step: 'masked' } : state;
    case 'revealed':
      return state.step === 'masked' && state.confirmed ? { ...state, step: 'full' } : state;
    case 'hide':
      return state.step === 'full' ? { ...state, step: 'masked' } : state;
    default:
      return state;
  }
}

/** True once the LP has ticked and asked: the masked block is drawn. */
export function showsInstructions(state) {
  return state.confirmed && (state.step === 'masked' || state.step === 'full');
}

/** The full number may be asked for only from the masked block, with the box ticked. */
export function canReveal(state) {
  return state.confirmed && state.step === 'masked';
}

/**
 * The one way the reveal route is called. `fetchLine` runs only when
 * `canReveal(state)`; otherwise nothing is asked and the answer is null.
 */
export function revealWire(state, fetchLine) {
  if (!canReveal(state)) return null;
  return fetchLine();
}
