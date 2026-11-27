/**
 * The custom host a licence's own admin binds, and the two records that prove
 * it is theirs (D197, S17–S19 + H31–H34).
 *
 * NOTHING IN THIS REPOSITORY VALIDATED AN ARBITRARY HOSTNAME BEFORE THIS FILE.
 * There are four copies of `BRANCH_CODE_RE` and four independent derivations
 * of `${code}.axal.vc`, and every one of them answers the same narrow
 * question — *is this host OURS?* None of them can answer *is this a
 * hostname at all, and is it one a licence may claim?*, which is what a
 * tenant typing into a text field needs. `validateHostname` is that, and it
 * is deliberately not built on those regexes: they share a subject and not a
 * question.
 *
 * EVERY REFUSAL IS ITS OWN SENTENCE. S18 draws four of them and H33 draws
 * four more, and the reason they are spelt out rather than collapsed into
 * "invalid hostname" is the same reason S19a names which DNS record is wrong:
 * the person reading is standing in a registrar panel, and a generic error
 * tells them nothing about which thing to change.
 *
 * WHAT `verifyRecords` CANNOT DO, said here rather than discovered. It asks a
 * DNS-over-HTTPS resolver whether the tenant published the two records. It
 * does NOT make the host serve anything — that needs a Cloudflare for SaaS
 * custom hostname on the `os.axal.vc` zone, for which this repository has no
 * groundwork and nobody has set a token. So `verified` is as far as the state
 * machine goes, and the screen says so. S17's own rule is what makes that
 * honest: **a licence never waits on DNS** — members are on the fallback host
 * the deploy issued the whole time.
 *
 * THE RESOLVER IS INJECTED, AND THAT IS NOT A TESTING CONVENIENCE. It is the
 * only way this file can be exercised at all: `cloudflare-dns.com` is refused
 * at CONNECT from the environment this was written in, so the live call has
 * never run here and the suite drives it with recorded DoH response shapes
 * instead. A call that cannot be exercised and is not injected is a call
 * nothing can assert about.
 */
import { withDeadline } from '../util/deadline';

/**
 * The one target every tenant publishes, for every licence.
 *
 * S17's own words: "One STABLE target for every tenant. The registrar never
 * sees the per-tenant fallback origin — we attach {slug}.os.axal.vc behind
 * cname.os.axal.vc ourselves, so a tenant's published DNS never has to change
 * when their origin does."
 *
 * THIS ZONE IS A DEPLOYMENT PRECONDITION, NOT AN ASSUMPTION THIS CODE MAKES.
 * `os.axal.vc` does not exist in this repository's infrastructure: the
 * shipped platform host is `<code>.axal.vc`, derived independently in four
 * places, and adopting `{slug}.os.axal.vc` would move provisioning, the
 * generated wrangler config, cookie names (D104), OAuth callbacks and
 * `assertBranchAppUrl`. That adoption is its own decision. Until the zone
 * exists and Cloudflare for SaaS is configured behind it, a tenant who
 * publishes this CNAME has a host that verifies and does not yet serve —
 * which is exactly why nothing here reports `active`.
 */
export const CNAME_TARGET = 'cname.os.axal.vc';

/** The TXT record's name is this prefix on the host being claimed. */
export const TXT_PREFIX = '_axal-challenge';

/** Hosts a licence may never bind, and the sentence each refusal gives. */
const HQ_HOSTS = ['axal.vc', 'app.axal.vc'];

/** One label: letters, digits and inner hyphens, 1–63 characters. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type HostRefusal = { ok: false; code: string; error: string };
export type HostAccepted = { ok: true; hostname: string };

/**
 * Lowercase, trim, and drop one trailing dot.
 *
 * The trailing dot is the fully-qualified form a registrar panel will happily
 * show, so a tenant copying from one is not typing a mistake — it is the same
 * host and is normalised rather than refused.
 */
export function normaliseHostname(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Is this a hostname, and is it one this licence may claim?
 *
 * Returns the normalised host or a refusal carrying the sentence S18/H33
 * draw for that case. It answers nothing about whether another licence
 * already holds it — that is a database question and belongs at the call
 * site, which is also where the other operator's public name is looked up.
 */
export function validateHostname(raw: unknown): HostAccepted | HostRefusal {
  const input = String(raw ?? '').trim();
  if (!input) {
    return { ok: false, code: 'host_required', error: 'Enter the hostname members will type.' };
  }
  // Checked BEFORE normalising, because normalising would hide the very thing
  // the sentence is about.
  if (/^[a-z]+:\/\//i.test(input)) {
    return {
      ok: false,
      code: 'host_has_scheme',
      error: 'Host only — no scheme. app.yourhost.com, not https://yourhost.com.',
    };
  }
  if (input.includes('/')) {
    return {
      ok: false,
      code: 'host_has_path',
      error: 'A path is not a host: yourhost.com/app is a page on a host, not a host.',
    };
  }
  if (input.includes(':')) {
    return {
      ok: false,
      code: 'host_has_port',
      error: 'Host only — no port. A port is not part of a hostname.',
    };
  }
  if (input.includes('*')) {
    return {
      ok: false,
      code: 'host_wildcard',
      error: 'One host per field in this pass. Wildcards are not accepted.',
    };
  }
  if (/[\s,]/.test(input)) {
    return {
      ok: false,
      code: 'host_multiple',
      error: 'One host per field in this pass. Add a second row when that exists.',
    };
  }

  const host = normaliseHostname(input);
  // 253 is the DNS limit on a presentation-form name; a host longer than it
  // cannot resolve anywhere, so refusing is kinder than storing it.
  if (host.length > 253) {
    return { ok: false, code: 'host_too_long', error: 'That hostname is longer than DNS allows.' };
  }
  // ASCII IS CHECKED BEFORE THE LABEL RULE, AND THE ORDER IS THE WHOLE POINT.
  // `LABEL` refuses any character outside `[a-z0-9-]`, so a unicode host fails
  // it first — which made this refusal UNREACHABLE in the first draft of this
  // file, caught by its own test rather than by review. Its sentence is the
  // useful one: somebody typing `münchen.de` needs telling to enter the
  // punycode form, not that a hostname may contain letters and digits.
  //
  // Punycode is welcome; a raw unicode host is not, because what a registrar
  // stores and what a resolver answers with is the a-label either way.
  if (/[^\x21-\x7e]/.test(host)) {
    return {
      ok: false,
      code: 'host_not_ascii',
      error: 'Enter the punycode form (xn--…) of an international domain.',
    };
  }
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) {
    return {
      ok: false,
      code: 'host_not_a_label',
      error: 'The hostname must be a valid DNS name — lowercase letters, digits and hyphens.',
    };
  }

  if (HQ_HOSTS.includes(host)) {
    return {
      ok: false,
      code: 'host_is_hq',
      error: 'axal.vc and app.axal.vc belong to Super Admin — a licence cannot bind either.',
    };
  }
  if (host === 'os.axal.vc' || host.endsWith('.os.axal.vc')) {
    return {
      ok: false,
      code: 'host_is_platform',
      error: 'A fallback host under os.axal.vc is infrastructure and is not available.',
    };
  }
  if (host === 'axal.vc' || host.endsWith('.axal.vc')) {
    return {
      ok: false,
      code: 'host_is_ours',
      error: 'Hosts under axal.vc are ours — bind a name you control.',
    };
  }

  return { ok: true, hostname: host };
}

/** A token the tenant publishes verbatim. Hex, so no character needs quoting. */
export function mintChallengeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type DnsRecord = {
  kind: 'ownership' | 'traffic';
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
  ttl: number;
};

/**
 * The two records, derived rather than stored.
 *
 * Deriving them means the screen and the verifier cannot disagree about what
 * was asked for: S19a's second failure sentence exists precisely because a
 * tenant can point the CNAME at the right-looking wrong thing, and the check
 * compares against this same value.
 */
export function recordsFor(hostname: string, token: string): DnsRecord[] {
  return [
    {
      kind: 'ownership',
      type: 'TXT',
      name: `${TXT_PREFIX}.${hostname}`,
      value: `axal-verify=${token}`,
      ttl: 300,
    },
    { kind: 'traffic', type: 'CNAME', name: hostname, value: CNAME_TARGET, ttl: 300 },
  ];
}

const DOH = 'https://cloudflare-dns.com/dns-query';
const DNS_DEADLINE_MS = 5_000;

type DohAnswer = { name?: string; type?: number; data?: string };
type DohBody = { Status?: number; Answer?: DohAnswer[] };

/** One DoH query. Returns the answers, or `null` when the resolver could not be read. */
async function resolve(
  name: string,
  type: 'TXT' | 'CNAME',
  fetchImpl: typeof fetch,
): Promise<DohAnswer[] | null> {
  try {
    const url = `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await withDeadline(
      fetchImpl(url, { headers: { accept: 'application/dns-json' } }),
      DNS_DEADLINE_MS,
      `doh-${type}`,
    );
    if (!res || !res.ok) return null;
    const body = (await res.json()) as DohBody;
    // NXDOMAIN (3) is an ANSWER — the name does not exist — not a failure to
    // read the resolver, and the two must not collapse: one is "you have not
    // published it yet" and the other is "we could not look".
    if (body?.Status === 3) return [];
    if (typeof body?.Status === 'number' && body.Status !== 0) return null;
    return Array.isArray(body?.Answer) ? body.Answer : [];
  } catch {
    return null;
  }
}

/** A resolver's TXT answers arrive quoted; a CNAME target arrives with a trailing dot. */
const unquote = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1');

export type RecordVerdict = {
  kind: 'ownership' | 'traffic';
  ok: boolean;
  /** `readable: false` means the resolver could not be read — never "not published". */
  readable: boolean;
  found: string | null;
  title: string;
  detail: string;
};

export type VerifyResult = { checked_at: string; records: RecordVerdict[] };

/**
 * Ask a resolver whether the tenant published both records.
 *
 * EVERY FAILURE NAMES ITS OWN RECORD, which is S19a's whole point: a tenant
 * standing in a registrar panel needs to know which row to edit, and "DNS
 * error" tells them nothing. The second traffic failure is the one worth
 * reading twice — a CNAME pointing at the tenant's own fallback origin looks
 * right and is the mistake the stable-target design exists to prevent, so it
 * gets its own sentence rather than falling into "does not point at".
 */
export async function verifyRecords(
  hostname: string,
  token: string,
  now: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const txtName = `${TXT_PREFIX}.${hostname}`;
  const want = `axal-verify=${token}`;
  const [txt, cname] = await Promise.all([
    resolve(txtName, 'TXT', fetchImpl),
    resolve(hostname, 'CNAME', fetchImpl),
  ]);

  const records: RecordVerdict[] = [];

  if (txt === null) {
    records.push({
      kind: 'ownership',
      ok: false,
      readable: false,
      found: null,
      title: 'We could not read DNS for the ownership record',
      detail:
        'The resolver did not answer. This is not a claim that the record is missing — '
        + 'nothing changed at your registrar. Check again in a moment.',
    });
  } else {
    const found = txt.map((a) => unquote(String(a.data ?? ''))).find((v) => v === want) ?? null;
    records.push(
      found
        ? {
            kind: 'ownership',
            ok: true,
            readable: true,
            found,
            title: 'Ownership record found',
            detail: `${txtName} carries ${want}.`,
          }
        : {
            kind: 'ownership',
            ok: false,
            readable: true,
            found: txt.length ? unquote(String(txt[0].data ?? '')) : null,
            title: `No TXT yet at ${txtName}`,
            detail:
              'The ownership record has not propagated. It saves instantly at most registrars; '
              + 'give it five minutes and check again.',
          },
    );
  }

  if (cname === null) {
    records.push({
      kind: 'traffic',
      ok: false,
      readable: false,
      found: null,
      title: 'We could not read DNS for the traffic record',
      detail:
        'The resolver did not answer. This is not a claim that the record is missing — '
        + 'nothing changed at your registrar. Check again in a moment.',
    });
  } else {
    const targets = cname.map((a) => String(a.data ?? '').trim().replace(/\.$/, '').toLowerCase());
    const hit = targets.includes(CNAME_TARGET);
    const actual = targets[0] ?? null;
    if (hit) {
      records.push({
        kind: 'traffic',
        ok: true,
        readable: true,
        found: CNAME_TARGET,
        title: 'Traffic record found',
        detail: `${hostname} points at ${CNAME_TARGET}.`,
      });
    } else if (actual && actual.endsWith('.os.axal.vc')) {
      records.push({
        kind: 'traffic',
        ok: false,
        readable: true,
        found: actual,
        title: `CNAME at ${hostname} does not point at ${CNAME_TARGET}`,
        detail:
          `It currently resolves to ${actual}. That is our fallback origin, not the published `
          + `target — point it at ${CNAME_TARGET} so the origin can move without your DNS changing.`,
      });
    } else {
      records.push({
        kind: 'traffic',
        ok: false,
        readable: true,
        found: actual,
        title: actual
          ? `CNAME at ${hostname} does not point at ${CNAME_TARGET}`
          : `No CNAME yet at ${hostname}`,
        detail: actual
          ? `It currently resolves to ${actual}. Point it at ${CNAME_TARGET}.`
          : 'Add the CNAME at your registrar, with proxy or the orange cloud off, then check again.',
      });
    }
  }

  return { checked_at: now, records };
}

/* ------------------------------------------------------------------ *
 * The stored row, and the one shape both tiers render                  *
 * ------------------------------------------------------------------ */

/** A `licence_domains` row (migration 280), as stored. */
export type LicenceDomainRow = {
  id: number;
  licence_id: number;
  hostname: string;
  challenge_token: string;
  state: string;
  txt_verified_at: string | null;
  cname_verified_at: string | null;
  last_checked_at: string | null;
  last_check_json: string | null;
  is_primary: number;
  detached_at: string | null;
  detached_by_user_id: number | null;
  detach_reason: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * WHY `verified` IS NOT `active`, said in the payload rather than left to the
 * two screens to word separately.
 *
 * Both records confirmed means the tenant controls the name and has pointed it
 * at the published target. It does NOT mean the host answers: that needs a
 * Cloudflare for SaaS custom hostname on `os.axal.vc`, which this repository
 * has no groundwork for and nobody has a token for. So the payload carries the
 * fact and the reason, and neither screen has to invent a sentence for a state
 * the platform cannot reach. S17's own rule is what keeps this from being a
 * failure: a licence never waits on DNS — members are on the fallback host the
 * deploy issued the whole time.
 */
export const SERVES_REASON =
  'A verified host does not serve yet. Issuing its certificate needs a Cloudflare for SaaS '
  + 'custom hostname on os.axal.vc, which is not configured. Members keep using the platform '
  + 'host until it is — nothing about them is waiting on this.';

export type DomainPayload = {
  hostname: string;
  state: string;
  /** Derived, never stored — so the wizard and the checker cannot disagree. */
  records: DnsRecord[];
  txt_verified_at: string | null;
  cname_verified_at: string | null;
  last_checked_at: string | null;
  /** The last verdict, reprinted rather than re-queried on every render. */
  last_check: VerifyResult | null;
  is_primary: boolean;
  detached_at: string | null;
  detach_reason: string | null;
  created_at: string;
  /** Named, never claimed. See `SERVES_REASON`. */
  serves: false;
  serves_reason: string;
};

/**
 * One row, one payload, read by BOTH tiers.
 *
 * H31's strip and S18's wizard draw different amounts of it — HQ sees status
 * and the tenant sees the records — but they must not derive it differently,
 * which is the drift D196 found one column over when `AdminLicences.jsx` read
 * `d.kind` off a table that had none.
 */
export function domainPayload(row: LicenceDomainRow): DomainPayload {
  let lastCheck: VerifyResult | null = null;
  try {
    lastCheck = row.last_check_json ? (JSON.parse(row.last_check_json) as VerifyResult) : null;
  } catch { lastCheck = null; }
  return {
    hostname: row.hostname,
    state: row.state,
    records: recordsFor(row.hostname, row.challenge_token),
    txt_verified_at: row.txt_verified_at,
    cname_verified_at: row.cname_verified_at,
    last_checked_at: row.last_checked_at,
    last_check: lastCheck,
    is_primary: Number(row.is_primary) === 1,
    detached_at: row.detached_at,
    detach_reason: row.detach_reason,
    created_at: row.created_at,
    serves: false,
    serves_reason: SERVES_REASON,
  };
}

/**
 * The one host this licence bound, or null.
 *
 * THROWS RATHER THAN SWALLOWING when `licence_domains` is unreadable, and the
 * caller decides what that means. A database without migration 280 has no
 * table, and "no host bound" is a different claim from "we could not look" —
 * the #204 distinction, which every caller below renders as its own state.
 */
export async function loadDomainRow(
  env: { DB: D1Database },
  licenceId: number,
): Promise<LicenceDomainRow | null> {
  return await env.DB.prepare(
    `SELECT id, licence_id, hostname, challenge_token, state,
            txt_verified_at, cname_verified_at, last_checked_at, last_check_json,
            is_primary, detached_at, detached_by_user_id, detach_reason,
            created_by_user_id, created_at, updated_at
       FROM licence_domains WHERE licence_id = ?`,
  ).bind(licenceId).first<LicenceDomainRow>();
}
