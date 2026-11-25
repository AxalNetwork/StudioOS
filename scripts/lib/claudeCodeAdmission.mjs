// D8505: who may start an @claude run, decided in a read-only job before any model call or write token.
/**
 * `claude-code.yml`'s `admit` job calls `decide()` with the event GitHub sent and two reads made with
 * that job's read-only token: each requester's real permission on the repository (the collaborator
 * permission API) and, for a pull request, its current head. The `if:` on the job still filters on
 * `author_association` first (#4571 SC-02), but that is GitHub's label for the commenter, not their
 * permission, so it never admits on its own.
 *
 * The decision fails closed: an unreadable permission, an unreadable head or a malformed event refuses.
 * A refused request ends in the admit job, with one line in the job summary; the model job never starts.
 */

/** The permissions that may start a run. The API's `permission` field folds `maintain` into `write`. */
export const ADMIT_PERMISSIONS = Object.freeze(['admin', 'write']);
export const MENTION = '@claude';
/** The values the collaborator permission API's `permission` field can take; anything else is read as none. */
export const KNOWN_PERMISSIONS = Object.freeze(['admin', 'maintain', 'write', 'triage', 'read', 'none']);
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const SHA = /^[0-9a-f]{40}$/;
const NUMBER = /^[1-9][0-9]{0,9}$/;

/** The owner's optional allowlist (repository variable CLAUDE_CODE_ALLOWED_ACTORS): logins, comma or space separated. */
export function parseAllowlist(raw) {
  return [...new Set(String(raw ?? '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

const mentions = (...texts) => texts.some((t) => typeof t === 'string' && t.includes(MENTION));
const loginOf = (u) => (u && typeof u.login === 'string' ? u.login : null);

/**
 * What the event asks for, read from the payload only: the kind, the issue or pull request number,
 * who must be permitted (the text's author and the account that caused the event), and the head the
 * event saw. No network.
 */
export function requestOf(eventName, event) {
  const sender = loginOf(event?.sender);
  const both = (author) => [...new Set([author, sender])];
  switch (eventName) {
    case 'issue_comment': {
      const n = event?.issue?.number;
      return { kind: event?.issue?.pull_request ? 'pull_request' : 'issue', number: n, requesters: both(loginOf(event?.comment?.user)),
        mention: mentions(event?.comment?.body), eventHead: null };
    }
    case 'pull_request_review_comment':
      return { kind: 'pull_request', number: event?.pull_request?.number, requesters: both(loginOf(event?.comment?.user)),
        mention: mentions(event?.comment?.body), eventHead: event?.pull_request?.head?.sha ?? null };
    case 'pull_request_review':
      return { kind: 'pull_request', number: event?.pull_request?.number, requesters: both(loginOf(event?.review?.user)),
        mention: mentions(event?.review?.body), eventHead: event?.pull_request?.head?.sha ?? null };
    case 'issues':
      return { kind: 'issue', number: event?.issue?.number, requesters: both(loginOf(event?.issue?.user)),
        mention: mentions(event?.issue?.body, event?.issue?.title), eventHead: null };
    case 'workflow_dispatch':
      return { kind: 'dispatch', number: null, requesters: [sender], mention: true, eventHead: null };
    default:
      return null;
  }
}

const refuse = (reason, line, extra = {}) => ({ admitted: false, reason, summary: `Refused: ${line}`, ...extra });

/**
 * The decision. `api.permission(login)` answers 'admin' | 'write' | 'read' | 'none', or null when the
 * read failed; `api.pullHead(number)` answers { sha, repository } or null.
 */
export async function decide({ eventName, event, repository, ref, sha, allowlist = [] }, api) {
  const req = requestOf(eventName, event);
  if (!req) return refuse('unsupported_event', `the event \`${eventName}\` does not start a run.`);
  if (!event?.repository?.full_name || event.repository.full_name !== repository) {
    return refuse('repository_mismatch', 'the event names another repository than the one this run is in.');
  }
  if (!req.mention) return refuse('no_mention', `the text does not mention ${MENTION}.`);
  if (req.kind === 'dispatch' && ref !== 'refs/heads/main') {
    return refuse('dispatch_not_main', 'a manual run starts from main only (the federation rule refuses any other ref).');
  }
  if (req.kind !== 'dispatch' && !NUMBER.test(String(req.number ?? ''))) return refuse('malformed_event', 'the event carries no issue or pull request number.');
  if (!req.requesters.length || req.requesters.some((l) => !l || !LOGIN.test(l))) {
    return refuse('malformed_event', 'the event does not name who wrote the request.');
  }
  const allowed = allowlist.map((s) => s.toLowerCase());
  for (const login of req.requesters) {
    const answered = await api.permission(login);
    // A value the API does not define never reaches the summary: it is read as none.
    const permission = answered == null ? null : KNOWN_PERMISSIONS.includes(answered) ? answered : 'none';
    if (permission == null) return refuse('permission_unavailable', `the permission of ${login} could not be read, so the request is not admitted.`);
    if (!ADMIT_PERMISSIONS.includes(permission)) {
      return refuse('not_permitted', `${login} has ${permission} permission on this repository; a run needs write or admin.`, { requester: login });
    }
    if (allowed.length && !allowed.includes(login.toLowerCase())) {
      return refuse('not_on_allowlist', `${login} is not on the owner's list (CLAUDE_CODE_ALLOWED_ACTORS).`, { requester: login });
    }
  }
  let headSha = SHA.test(String(sha ?? '')) ? sha : null;
  if (req.kind === 'pull_request') {
    const head = await api.pullHead(req.number);
    if (!head || !SHA.test(String(head.sha ?? ''))) return refuse('head_unavailable', `the head of pull request ${req.number} could not be read.`);
    if (req.eventHead && req.eventHead !== head.sha) {
      return refuse('head_moved', `pull request ${req.number} moved after the review was written (${req.eventHead.slice(0, 7)} → ${head.sha.slice(0, 7)}).`);
    }
    headSha = head.sha;
  }
  if (!headSha) return refuse('malformed_event', 'the run has no commit to bind to.');
  const requester = req.requesters[0];
  const target = req.kind === 'dispatch' ? 'a manual run on main' : `${req.kind === 'issue' ? 'issue' : 'pull request'} ${req.number}`;
  return {
    admitted: true, reason: 'admitted', requester, kind: req.kind, number: req.kind === 'dispatch' ? '' : String(req.number), headSha, repository,
    summary: `Admitted: ${requester} (write or admin) on ${target}, bound to ${headSha.slice(0, 7)}.`,
  };
}

/**
 * A line as the job summary and $GITHUB_OUTPUT may carry it: one line, printable ASCII without markdown or HTML
 * markup (no < > ` | [ ] ! * \\), at most 300 characters. Every value in a line is validated already; this is
 * the last guard before the file.
 */
export function safeLine(text) {
  return String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*→\s*/g, ' to ').replace(/[^\x20-\x7e]|[<>`|[\]!*\\]/g, '').slice(0, 300);
}

/** The admit job's outputs, as `name=value` lines for $GITHUB_OUTPUT. Only payload-derived, validated values. */
export function outputLines(d) {
  const out = { admitted: d.admitted ? 'true' : 'false', reason: d.reason, kind: d.kind ?? '', number: d.number ?? '', head_sha: d.headSha ?? '', repository: d.repository ?? '' };
  return Object.entries(out).map(([k, v]) => `${k}=${safeLine(v)}`);
}

/** The model job's last gate: the pull request's head must still be the admitted one. */
export function headStillAdmitted(admitted, current) {
  if (!SHA.test(String(admitted ?? ''))) return { ok: false, line: 'no admitted head to compare.' };
  if (!SHA.test(String(current ?? ''))) return { ok: false, line: 'the current head could not be read.' };
  if (admitted !== current) return { ok: false, line: `the head moved since admission (${admitted.slice(0, 7)} → ${current.slice(0, 7)}).` };
  return { ok: true, line: `the head is still ${admitted.slice(0, 7)}.` };
}
