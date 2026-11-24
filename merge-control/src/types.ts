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
};
export interface Delivery {
  delivery: string; repo: string; event: string; action: string;
  reason: string | null; headSha: string | null; headRef: string | null; at: number;
  /** D5990: the base the policy compares against (`merge_group.base_sha`, `pull_request.base.sha`); null for other events. */
  baseSha?: string | null;
  /** D5990: the pull request number on `pull_request` deliveries; null otherwise. */
  pr?: number | null;
}
export interface Run {
  id: number; event: string; head_sha: string; head_branch: string; path: string; status: string;
}
export type GithubApi = (method: string, path: string, body?: unknown) => Promise<unknown>;
