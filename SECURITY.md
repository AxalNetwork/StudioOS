# Security Policy

Axal VC operates a regulated venture-capital platform. We treat security
reports from researchers, customers, and the public as a first-class
operational priority. This document tells you how to reach us, what to
expect, and what we ask of you.

> **Last updated:** 2026-09-03
> **Contact:** `security@axal.vc`
> **PGP fingerprint:** _to be added — see "Encrypted reports" below_

## Supported versions

We operate a single production deployment of StudioOS. The `studioos`
Cloudflare Worker serves both `axal.vc` and `app.axal.vc` as whole-host
custom domains — the SPA from its assets binding and the API at
`/api/*` on either host — with one build behind both, and the static
responses carrying the headers `docs/_headers` declares. There is no
Cloudflare Pages deployment (the mirror was retired on 2026-09-03).
Everything is continuously updated;
there is no notion of a "supported version" for end users. Researchers should target the live production surface or
a publicly available preview environment.

The development FastAPI backend in `backend/` is **not deployed to
production** and is out of scope for this policy.

## How to report a vulnerability

We strongly prefer private disclosure. Pick whichever channel is easiest:

1. **GitHub Security Advisory (preferred for code-level issues).**
   Open a draft advisory at
   `https://github.com/AxalNetwork/StudioOS/security/advisories/new`.
   This is private to maintainers; do not file a public issue.
2. **Email** `security@axal.vc`. We monitor this address 24/7.
   For sensitive payloads use the PGP key below.
3. **In-app report.** Logged-in users can use the "Report a security
   issue" link in the footer; submissions route to the same triage
   queue.

Please include:

- A clear description of the issue and its potential impact.
- Steps to reproduce (proof-of-concept code, screenshots, request/response
  pairs, video — whatever helps).
- The URL, endpoint, or component affected.
- Your environment (browser, OS, account role if any).
- Whether the issue is already public; if so, where.

If you need an encrypted channel before disclosing, email
`security@axal.vc` with subject `PGP key request` and we will reply with
our current public key. Do not send sensitive payloads in plaintext if
you suspect prior compromise.

## Response SLAs

| Severity | Triage acknowledgement | Status update cadence | Fix target |
|---|---|---|---|
| Critical (RCE, auth bypass, mass PII exposure, payment fraud) | within 4 business hours | every 24 hours | within 7 days |
| High (privilege escalation, IDOR on sensitive data, signed-contract integrity, KYC bypass) | within 1 business day | every 3 business days | within 30 days |
| Medium (stored XSS without escalation, rate-limit gaps, info disclosure of non-PII) | within 3 business days | weekly | within 90 days |
| Low (best-practice deviations, security headers, non-exploitable config issues) | within 5 business days | on milestone | best-effort |

Business hours are Monday–Friday, 09:00–18:00 in the reporting user's
local time zone where known; otherwise UTC. We will tell you which
severity bucket we assigned and why.

## Scope

**In scope**

- `axal.vc`, `app.axal.vc`, and any subdomain that resolves to
  Cloudflare Workers under our `axal.vc` zone.
- The Cloudflare Worker production API at `axal.vc/api/*`.
- D1, KV, R2, Durable Objects, Queues, and Workers AI integrations
  reachable from the production Worker.
- The frontend SPA, served by the production Worker on `axal.vc` and
  `app.axal.vc`.
- Authentication and authorization flows (signup, login, TOTP, SMS,
  Cloudflare Access on admin paths, impersonation, role checks).
- Contract and e-sign flows, including KYC/KYB/accreditation, NDAs,
  cofounder agreements, Section 83(b), SAFE/convertible flows.
- Integrations we operate (Stripe, HubSpot, Calendly, Salesforce,
  Carta, Crunchbase, Slack, DocuSign, Affinity) where the vulnerability
  is in our integration code or token handling.
- Personal Advisor chatbot — prompt injection, scope-lock bypass, tool
  misuse, exfiltration of other users' data. As of Task #31 the
  production Advisor surface runs on Cloudflare Workers AI only; the
  dev/eval-only provider toggle and its gating contract are documented
  in [`docs/dev/ANTHROPIC_DEV.md`](docs/dev/ANTHROPIC_DEV.md). Any
  finding that bypasses the mount gate or the
  `scripts/ci/no-anthropic-in-prod.mjs` CI guard to reach a non-WAI
  provider from a production stage is in scope.
- Trust Center, Due Diligence, Admin Console, and Monitoring &
  Observability surfaces.

**Out of scope**

- The Replit-only FastAPI dev backend in `backend/`. It is never
  deployed.
- Static marketing copy or documentation pages with no auth state.
- Findings that require a privileged position you obtained outside
  Axal's systems (stolen credentials, compromised device, etc.).
- DoS / volumetric attacks, network-layer attacks, or any technique
  intended to degrade availability rather than demonstrate a flaw.
- Reports based solely on missing security headers, automated scanner
  output, software version banners, or "best-practice" gaps without a
  concrete exploit path.
- Social engineering, physical attacks, and attempts to phish or
  pressure Axal staff or users.
- Issues in upstream providers (Cloudflare, Stripe, GitHub, AWS, Sumsub,
  Persona, etc.) not specific to our integration code; please report
  those to the provider directly.
- Vulnerabilities affecting end-of-life browsers or unmaintained client
  software.
- "Self-XSS" or attacks requiring the user to paste content into their
  own browser console.
- Automated scans, fuzzing, or load tests run against production without
  prior written authorization.

If you are unsure whether something is in scope, ask us first via
`security@axal.vc` before testing.

## Matching data — storage, sharing, and retention

The platform computes people-matches (investor ↔ founder, partner, and
co-founder) from member profiles, skill ratings, and values vectors.
We treat these as sensitive and handle them as follows.

**Consent (opt-in, off by default).** A member only appears as a
candidate in any match list after they explicitly enable *"Include me in
matching"* in Settings → Privacy. The preference is stored in
`user_settings.matching_opt_in` and defaults OFF — the absence of a
setting is treated as opted out. It can only be enabled once the
member's profile is at least 60% complete. Every people-matching
endpoint enforces this as a **hard filter**: opted-out members are
removed before any scoring, so they never surface in ranked *or*
excluded results. The filter fails closed — if the consent store is
unavailable, no one is treated as opted in.

**Storage.** Skill and value rows are stamped with the active taxonomy
version at write time (`taxonomy_version`) so we can tell which taxonomy
a member's profile was captured against. Match scores are computed on
demand; cached radar results live in KV with a short (~5 minute) TTL and
are keyed on the taxonomy version, so a taxonomy change invalidates them
on the next request.

**Sharing.** Match lists are visible only to the requesting member
(their own matches) and to admins. Every match-list endpoint records an
audit-log entry (`activity_logs`, action `match_list_generated`) when
the caller is an admin — capturing the actor, the kind of list, and the
result count. Member self-service match requests are not audited.

**Retention.** Consent preferences and taxonomy stamps persist with the
member's profile and are removed on account deletion. Cached radars
expire automatically via their KV TTL. Audit-log entries are retained
under our standard activity-log retention policy.

## Safe harbor

Axal authorizes good-faith security research under this policy. If you
comply with this document, including the boundaries below, we will not
pursue or support any legal action against you, including under the
Computer Fraud and Abuse Act, the Digital Millennium Copyright Act,
applicable EU/UK computer-misuse statutes, or analogous laws in your
jurisdiction. We will also work with you in good faith if a third party
asserts a claim against you for actions taken under this policy.

This authorization is conditional. You must:

- Make a good-faith effort to avoid privacy violations, data destruction,
  service interruption, and degradation of user experience.
- Stop testing and report immediately the moment you encounter user
  data, secrets, or evidence of an active compromise.
- Use test accounts you create, not production accounts you do not own.
- Refrain from running automated scans against production without
  written authorization.
- Refrain from exfiltrating data beyond the minimum needed to
  demonstrate the vulnerability.
- Refrain from disclosing the issue publicly until we have confirmed
  remediation or 90 days have passed, whichever comes first
  (coordinated disclosure).

If your testing crosses these lines unintentionally, tell us. We would
rather hear about it than read about it later.

## Coordinated disclosure

Our default is a **90-day coordinated disclosure window** starting on
the date we acknowledge the report. We may request a short extension
for issues requiring vendor coordination or a tricky migration; in those
cases we will explain and ask, not impose.

After remediation we will:

- Confirm the fix with you and ask you to validate.
- Publish a public security advisory on the GitHub repository with a
  CVE if applicable.
- Credit you publicly (name and/or handle and link) unless you ask to
  remain anonymous.

## Recognition

We do not yet operate a paid bug bounty program. We do maintain a
**Hall of Recognition** at `https://axal.vc/security/hall` listing
researchers who have responsibly disclosed valid issues, with their
permission. Critical and high-severity reports may receive a discretionary
acknowledgement (swag, account credit, or a referral bonus on the Refer
& Earn program). Reach out to discuss before publishing.

## Encrypted reports

If you need encrypted communication, request our current PGP public
key by emailing `security@axal.vc` from any address. We rotate the key
periodically; the fingerprint is published at
`https://axal.vc/security/pgp.txt` and the key is also discoverable on
`keys.openpgp.org`.

## Reporting credential exposure

If you believe an Axal-issued credential (API key, OAuth token, service
account, signed cookie) has leaked publicly — for example on a public
GitHub repo, in a paste site, or in a third-party tool — please notify
us immediately at `security@axal.vc` with subject `Credential exposure`.
We will rotate within the SLA windows above and credit you in the
Hall of Recognition.

## What we ask you not to do

- Do not access, modify, or delete data belonging to anyone other than
  yourself or a test account you control.
- Do not pivot from a finding into deeper compromise — demonstrate
  impact, then stop.
- Do not threaten to disclose for payment or any other coercive purpose.
  We treat extortion as a hostile act and will involve law enforcement.

---

This policy is a living document. We will update it as our platform and
threat model evolve. Material changes will be announced via the GitHub
repository and the in-app Trust Center.
