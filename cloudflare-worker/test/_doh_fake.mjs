// D1506: the export and save paths resolve an outside image's host over DNS
// over HTTPS before they fetch it (services/decks/imageSafety.ts). A test's
// fetch stub answers that query with `dohAnswer`, so a synthetic host such as
// img.example.test resolves to a public address, as a real public host would.
// A host listed in `privateHosts` resolves to a private address instead.
export const DOH_PREFIX = 'https://cloudflare-dns.com/dns-query';

/** The DoH answer for `url`, or null when `url` is not a DoH query. */
export function dohAnswer(url, privateHosts = []) {
  if (!String(url).startsWith(DOH_PREFIX)) return null;
  const q = new URL(String(url));
  const name = q.searchParams.get('name') || '';
  const type = q.searchParams.get('type');
  const ip = privateHosts.includes(name) ? '10.0.0.7' : '93.184.216.34';
  const Answer = type === 'A' ? [{ name, type: 1, data: ip }] : [];
  return new Response(JSON.stringify({ Status: 0, Answer }), { status: 200, headers: { 'Content-Type': 'application/dns-json' } });
}
