/**
 * A price a person types, as whole minor units (D4674). Pure.
 *
 * "12.50", "12,50", "1,5", "1 500", "1,500" and "1.500,50" are all things people
 * type, and a parser that strips commas turns "12,50" into 1250 dollars and "1,5"
 * into 15. The rule here: a separator followed by one or two digits at the end
 * is the decimal mark; a separator followed by exactly three digits is a group
 * mark (a price has at most two decimals, so three digits cannot be decimals);
 * and when both appear, the last one is the decimal mark and the other must group
 * by threes. A lone dot before exactly three digits ("1.500") could be a
 * thousands mark or a mistyped decimal, so it is refused. Anything else is refused with a sentence, never guessed. All
 * arithmetic is on digit strings, so no float rounds a cent.
 */
const GROUPED = /^\d{1,3}([.,\s]\d{3})+$/;

export function amountToCents(input) {
  const raw = String(input ?? '').trim().replace(/^[$€£]\s*/, '').replace(/\s+/g, ' ');
  if (!raw) return { cents: null };
  const bad = { error: 'Enter an amount like 1500, 1500.50 or 1.500,50.' };
  if (!/^[\d.,\s]+$/.test(raw) || /[.,]{2}/.test(raw) || /^[.,]|[.,]$/.test(raw)) return bad;

  let whole; let frac = '';
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  const mark = Math.max(lastDot, lastComma);
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the later one is the decimal mark, the other groups by threes.
    const head = raw.slice(0, mark);
    const tail = raw.slice(mark + 1);
    const groupMark = lastDot > lastComma ? ',' : '.';
    if (!/^\d{1,2}$/.test(tail) || !GROUPED.test(head) || head.replace(/\d|\s/g, '') !== groupMark.repeat(head.replace(/\d|\s/g, '').length)) return bad;
    whole = head.replace(/[.,\s]/g, ''); frac = tail;
  } else if (mark >= 0) {
    const head = raw.slice(0, mark);
    const tail = raw.slice(mark + 1);
    const several = (raw.match(new RegExp(`\\${raw[mark]}`, 'g')) || []).length > 1;
    if (/^\d{1,2}$/.test(tail) && !several && /^\d+$/.test(head.replace(/\s/g, ''))) {
      whole = head.replace(/\s/g, ''); frac = tail;
    } else if (raw[mark] === '.' && !several && /^\d{3}$/.test(tail)) {
      // "1.500" is 1,500 where a dot groups and 1.5 where it is the decimal mark.
      return { error: 'A dot followed by three digits could mean thousands or a decimal. Write the amount without it, such as 1500 or 1.50.' };
    } else if (GROUPED.test(raw) && raw.replace(/\d|\s/g, '') === raw[mark].repeat((raw.match(new RegExp(`\\${raw[mark]}`, 'g')) || []).length)) {
      whole = raw.replace(/[.,\s]/g, '');
    } else return bad;
  } else {
    if (!GROUPED.test(raw) && !/^\d+$/.test(raw)) return bad;
    whole = raw.replace(/\s/g, '');
  }
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return { error: 'That amount is too large.' };
  return { cents };
}

/** Cents to a plain editable amount: 12345 → "123.45", 500000 → "5000". Never a float. */
export function centsToInput(cents) {
  if (cents == null || cents === '' || !Number.isFinite(Number(cents))) return '';
  const n = Math.round(Number(cents));
  const whole = Math.trunc(Math.abs(n) / 100);
  const frac = String(Math.abs(n) % 100).padStart(2, '0');
  return `${n < 0 ? '-' : ''}${whole}${frac === '00' ? '' : `.${frac}`}`;
}
