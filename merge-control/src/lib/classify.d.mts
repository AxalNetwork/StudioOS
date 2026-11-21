/** D5620: types for the shared pure classifier in `classify.mjs`. */
export type Tier = 'T0' | 'T1' | 'T2';
export interface ChangedFile {
  path: string;
  /** Name-status code: A, C, D, M or R with an optional score. */
  status: string;
  previousPath?: string;
  /** Raw destination mode; 120000 and 160000 are links or submodules. */
  mode?: string;
  patch?: string;
}
export interface Classification { tier: Tier; reasons: string[] }
export function classify(files: readonly ChangedFile[]): Classification;
