/**
 * D717 (#1857) — signing in four steps: read the paper, tick the consent,
 * adopt a typed or drawn signature once, then confirm and Sign.
 *
 * Pure: no React and no DOM. `ESignPage.jsx` holds the flow in
 * a reducer over `signingReducer`, and its step components take every word
 * from `signingCopy(envelope)` through a `copy` prop, so the booklet (#1858)
 * passes its own copy without touching a layout.
 *
 * Nothing here is stored in the browser: the adoption lives in React state
 * only, and is dropped the moment the name, the mode or the ink changes.
 */

export const SIGN_STEPS = ['read', 'consent', 'adopt', 'confirm'];

// The Worker's `SIGNATURE_DATAURL_PREFIX` (routes/esign.ts); a test holds the
// two equal.
export const SIGNATURE_PNG_PREFIX = 'data:image/png;base64,';

const isPng = (u) => typeof u === 'string' && u.startsWith(SIGNATURE_PNG_PREFIX);
const filled = (s) => typeof s === 'string' && s.trim() !== '';

export function initialSigning(name) {
  return { step: 'read', accepted: false, mode: 'type', name: name || '', adopted: null };
}

/**
 * Any action that does not apply to the current step returns the same state
 * object, so a stray dispatch never moves the flow.
 */
export function signingReducer(state, action) {
  switch (action?.type) {
    case 'start':
      return initialSigning(action.name);
    case 'continue':
      if (state.step === 'read') return { ...state, step: 'consent' };
      if (state.step === 'consent' && state.accepted) return { ...state, step: 'adopt' };
      return state;
    case 'back':
      if (state.step === 'consent') return { ...state, step: 'read' };
      if (state.step === 'adopt') return { ...state, step: 'consent' };
      if (state.step === 'confirm') return { ...state, step: 'adopt' };
      return state;
    case 'accept':
      return { ...state, accepted: action.value === true };
    case 'name':
      return dropAdoption({ ...state, name: typeof action.value === 'string' ? action.value : '' });
    case 'mode':
      if (action.value !== 'type' && action.value !== 'draw') return state;
      return dropAdoption({ ...state, mode: action.value });
    case 'ink_changed':
      return dropAdoption(state);
    case 'adopt':
      if (state.step !== 'adopt' || !filled(state.name) || !isPng(action.dataUrl)) return state;
      return { ...state, step: 'confirm', adopted: { dataUrl: action.dataUrl, mode: state.mode, name: state.name } };
    case 'cancel':
    case 'failed':
      if (state.step !== 'confirm') return state;
      return { ...state, step: 'adopt' };
    default:
      return state;
  }
}

// A change to what was adopted drops it, and on the confirm step returns to
// the pad, so `confirm` never holds a null adoption.
function dropAdoption(state) {
  return { ...state, adopted: null, step: state.step === 'confirm' ? 'adopt' : state.step };
}

export function canSign(state) {
  return !!state
    && state.step === 'confirm'
    && state.accepted === true
    && !!state.adopted
    && isPng(state.adopted.dataUrl)
    && filled(state.name)
    && state.adopted.name === state.name;
}

export function typedSignatureFont(px) {
  return `italic 400 ${px}px "Public Sans", sans-serif`;
}

/** The px size the name fits at: 32 down to 12, inside the width less 24. */
export function fitTypedSignature(ctx, name, width) {
  let px = 32;
  for (; px > 12; px -= 1) {
    ctx.font = typedSignatureFont(px);
    if (ctx.measureText(name).width <= width - 24) break;
  }
  ctx.font = typedSignatureFont(px);
  return px;
}

/**
 * White ground, `#111827` ink in both themes, because the PNG is printed on
 * paper. Returns whether ink was drawn: a blank name leaves the canvas white.
 */
export function drawTypedSignature(ctx, name, { width, height }) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const text = (name || '').trim();
  if (!text) return false;
  fitTypedSignature(ctx, text, width);
  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, height / 2);
  return true;
}

/**
 * Always resolves: on load, on rejection, at once without `document.fonts`,
 * and after `ms` when the load never settles — a signer cut off from Google
 * Fonts still gets a signature, in the fallback face.
 */
export function whenFontReady(fonts, font, ms = 1500) {
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const settle = () => { clearTimeout(timer); resolve(); };
    try {
      Promise.resolve(fonts.load(font)).then(settle, settle);
    } catch {
      settle();
    }
  });
}

const asDate = (v) => (v instanceof Date ? v : new Date(v));

export function utcDate(v) {
  const d = asDate(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function utcClock(v) {
  const d = asDate(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16);
}

export function envelopeShort(uuid) {
  const u = uuid || '';
  return { head: u.slice(0, 8), tail: u.slice(-4) };
}

/**
 * Every generic string the four steps show, keyed by place. The booklet's
 * copy (#1858) has the same keys; only it sets `doneAction`.
 */
export function signingCopy(envelope) {
  const title = envelope?.document_title || 'this document';
  const { head, tail } = envelopeShort(envelope?.envelope_uuid);
  return {
    readTitle: `Sign ${title}`,
    readCounter: '1 of 4',
    readContinue: 'Continue',
    envelopeLine: `Envelope ${head}…${tail}`,
    consentTitle: 'Sign electronically',
    consentCounter: '2 of 4',
    consentText: 'I agree that my electronic signature is the legal equivalent of my handwritten signature and that I am bound by the terms of this Agreement.',
    consentLaw: 'Electronic signature is legally binding under E-SIGN (15 U.S.C. § 7001) and UETA.',
    consentContinue: 'Continue',
    adoptTitle: 'Adopt a signature',
    adoptCounter: '3 of 4',
    signingAs: 'Signing as',
    modeType: 'Type',
    modeDraw: 'Draw',
    nameLabel: 'Full legal name',
    typeHint: 'Type your full legal name. It is drawn on each signature line.',
    drawLabel: 'Draw your signature',
    drawClear: 'Clear',
    drawHint: 'Sign here using mouse, trackpad, or touch',
    adoptNote: 'By adopting, you agree it has the same effect as your handwritten signature.',
    adoptAction: 'Adopt and sign',
    confirmTitle: `Apply this signature to ${title}?`,
    confirmBy: 'By:',
    confirmName: 'Name:',
    confirmDate: 'Date:',
    confirmSign: 'Sign',
    confirmSigning: 'Signing…',
    confirmCancel: 'Cancel',
    doneTop: 'Signed',
    doneTitle: `You signed ${title}`,
    doneCompleted: 'Completed.',
    donePartial: 'Partially signed.',
    doneNext: 'You will receive a copy by email shortly. You may now close this window.',
    declinedTop: 'Declined',
    declinedTitle: `You declined to sign ${title}`,
    declinedLine: 'The Axal VC team has been notified.',
  };
}
