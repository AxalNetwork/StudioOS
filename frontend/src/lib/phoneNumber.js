// #2639: form input only. The Worker still requires strict E.164, and SMS
// verification still proves control of the number. Min metadata checks number
// lengths and country prefixes without claiming a number is assigned/mobile.
import { getCountries, getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString } from 'libphonenumber-js/min';

export const PHONE_ERROR = 'Enter a mobile number for the selected country, or start with + and a country code.';
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const PHONE_COUNTRIES = getCountries().map(country => ({
  country, label: `${regionNames.of(country) || country} (+${getCountryCallingCode(country)})`,
})).sort((a, b) => a.label.localeCompare(b.label, 'en'));

export function phoneCountry(value) {
  const country = String(value || '').trim().toUpperCase().replace(/^UK$/, 'GB');
  return isSupportedCountry(country) ? country : 'US';
}

export function phonePlaceholder(country) {
  const rawCountry = String(country || '').trim().toUpperCase().replace(/^UK$/, 'GB');
  if (rawCountry && !isSupportedCountry(rawCountry)) return '+country code …';
  const code = phoneCountry(country);
  return { CH: '079 …', US: '(202) 555-01xx', CA: '(416) 555-01xx', GB: '07700 900…', FR: '06 39 98 …', IT: '3…' }[code]
    || `+${getCountryCallingCode(code)} …`;
}

export function normalizePhoneInput(value, country = 'US') {
  const raw = String(value || '').trim();
  // Refuse letters/extensions and stray punctuation rather than guessing which
  // part was the intended destination. Never truncate a pasted phone number.
  if (!raw || raw.length > 80 || !/^[+\d\s().\u2010-\u2015-]+$/.test(raw)) return null;
  const input = raw.replace(/[\s().\u2010-\u2015-]/g, '').replace(/^00/, '+');
  if (!/^\+?\d+$/.test(input)) return null;
  const rawCountry = String(country || '').trim().toUpperCase().replace(/^UK$/, 'GB');
  if (!input.startsWith('+') && rawCountry && !isSupportedCountry(rawCountry)) return null;
  const selected = phoneCountry(country);
  const parsed = parsePhoneNumberFromString(input, { defaultCountry: selected, extract: false });
  if (!parsed || !parsed.isPossible() || parsed.ext || !/^\+[1-9]\d{6,14}$/.test(parsed.number)) return null;
  // An explicit international prefix wins over the national-format default.
  // Send its actual country to the existing SMS country allow-list too.
  const resolvedCountry = parsed.country || (parsed.countryCallingCode === getCountryCallingCode(selected) ? selected : null);
  if (!resolvedCountry) return null;
  return { e164: parsed.number, international: parsed.formatInternational(), country: resolvedCountry };
}
