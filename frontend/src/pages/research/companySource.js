// D7810 (#7810): source words come from the stored record and its exact publisher reference, with unreviewed terms explicit.
const https = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};
export function companySource(record = {}, reference = null) {
  const publisher = String(record.source_name || '').trim();
  const reviewed =
    publisher &&
    reference?.source_name === record.source_name &&
    reference?.licence_name &&
    reference?.terms_reviewed_on;
  return {
    label: publisher || 'Source not recorded',
    licenceWords: reviewed
      ? reference.licence_name
      : `${record.source_license || 'Licence not recorded'} · licence terms not reviewed`,
    licenceLink: reviewed ? https(reference.licence_link) : null,
    attribution: reviewed ? reference.required_attribution || null : null,
    linkText: 'View the source record',
    sourceLink: https(record.source_url),
    asOf: record.as_of || null,
    termsState: reviewed ? 'reviewed' : 'licence terms not reviewed',
  };
}
