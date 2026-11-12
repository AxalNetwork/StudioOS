/** D5618: generated bindings plus secrets installed separately by the owner. */
export type Env = MergeControlBindings & {
  WEBHOOK_SECRET?: string;
  OWNER_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
};
export interface Delivery {
  delivery: string; repo: string; event: string; action: string;
  reason: string | null; headSha: string | null; headRef: string | null; at: number;
}
export interface Run {
  id: number; event: string; head_sha: string; head_branch: string; path: string; status: string;
}
export type GithubApi = (method: string, path: string, body?: unknown) => Promise<unknown>;
