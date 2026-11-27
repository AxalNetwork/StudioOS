/** D5618: generated bindings plus secrets installed separately by the owner. */
export type Env = MergeControlBindings & {
  WEBHOOK_SECRET?: string;
  OWNER_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  CAPACITY_OWNER_TOKEN?: string;
  /** Separate org-read credential; never added to the repository App token request. */
  CAPACITY_INVENTORY_TOKEN?: string;
  /** D7109: the manual "Fix conflicts" check. Only `true` turns it on; unset (the default) ignores every conflict delivery. */
  MANUAL_CONFLICT_ENABLED?: string;
  /** D7109: the repository's numeric ID, the check's authority with GITHUB_APP_ID and GITHUB_INSTALLATION_ID. */
  GITHUB_REPOSITORY_ID?: string;
};
export interface Delivery {
  delivery: string; repo: string; event: string; action: string;
  reason: string | null; headSha: string | null; headRef: string | null; at: number;
  /** D5990: the base the policy compares against (`merge_group.base_sha`, `pull_request.base.sha`); null for other events. */
  baseSha?: string | null;
  /** D5990: the pull request number on `pull_request` deliveries; null otherwise. */
  pr?: number | null;
  /** D7109: the verified fields of a merge-queue ejection, a check-run action or a moved pull request; absent otherwise. */
  conflict?: ConflictDelivery | null;
}
/** D7109: what the webhook keeps from the verified bytes for the manual conflict check, and nothing else. */
export type ConflictDelivery =
  | { kind: 'ejection'; repositoryId: number; headRepositoryId: number | null; installationId: number; pr: number;
    headSha: string; baseRef: string; baseSha: string; reason: string }
  | { kind: 'click'; payload: ConflictClickPayload }
  | { kind: 'moved'; pr: number };
export interface ConflictClickPayload {
  action: 'requested_action';
  requested_action: { identifier: string };
  installation: { id: number };
  repository: { id: number; full_name: string };
  sender: { id: number; login: string; type: string };
  check_run: { id: number; name: string; status: string; conclusion: string | null; head_sha: string;
    external_id: string; app: { id: number } };
}
export interface Run {
  id: number; event: string; head_sha: string; head_branch: string; path: string; status: string;
}
export type GithubApi = (method: string, path: string, body?: unknown) => Promise<unknown>;
