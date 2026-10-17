/** D690 — the plain-data contract shared by the four cycle record services. */
import type { Env, User } from '../../types';
import type { ProjectRef } from '../../routes/_founder_validate_helpers';

export type Cycle = 'validate' | 'build' | 'raise' | 'grow';
export type Gate = 'read' | 'write' | ((project: ProjectRef, user: User) => boolean);

export type Row = {
  a: string;
  b?: string;
  c?: string;
  tone?: string;
  href?: string;
  action?: string | { key: string; body: Record<string, unknown> };
};

export type RecordSection = {
  key: string;
  title: string;
  gate: 'read' | 'write';
  rows: Row[];
  empty?: string;
  action?: string | { key: string; body: Record<string, unknown> };
  side?: boolean;
};

/** The gate is checked before `read`, so a hidden section never reads its store. */
export type SectionSpec = {
  key: string;
  title: string;
  side?: boolean;
  gate?: Gate;
  /** Required when a custom gate represents a writer-only section. */
  publicGate?: 'read' | 'write';
  read: (ctx: RecordContext, id: string, record: RecordContent) => Promise<Pick<RecordSection, 'rows' | 'empty' | 'action'>>;
};

export type RecordField = {
  key: string;
  label: string;
  kind: 'T' | 'CH' | 'CK';
  input?: 'date' | 'money' | 'email' | 'file';
  placeholder?: string;
  value?: unknown;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  note?: string;
};

export type RecordContext = {
  env: Env;
  projectId: number;
  project: ProjectRef;
  user: User;
};

export type RecordContent = {
  title: string;
  sub: string;
  pills: Array<string | { text: string; tone?: string }>;
  facts: [RecordFact, RecordFact, RecordFact, RecordFact];
  createdBy?: number | null;
  createdAt?: string | null;
};

export type RecordFact = { label: string; value: string | number | null; reason?: string };
export type RecordForm = {
  title: string;
  sub?: string;
  cta?: string;
  foot?: string;
  fields: RecordField[];
};

export type ActionResult = { ok: boolean; record?: unknown; open?: unknown };
export type RecordAction = {
  key: string;
  label: string;
  kind: 'form' | 'write' | 'link';
  tone?: 'default' | 'primary' | 'danger';
  href?: string;
  form?: RecordForm;
  confirm?: string | { title: string; body?: string; cta?: string };
  multipart?: boolean;
  /** Server-only callback. It is removed from the read response. */
  execute?: (ctx: RecordContext, id: string, body: Record<string, unknown> | FormData) => Promise<ActionResult>;
  /** Any id named in an action body must be checked in its own store. */
  references?: (body: Record<string, unknown> | FormData) => Array<{ store: Store; id: string | number }>;
};

export type OldRowsMatcher = {
  /** Older rows with an entity id in the old entity type. */
  entityTypes?: string[];
  /** Older JSON details whose $.id is this id, optionally without a prefix. */
  actions?: string[];
  idWithoutPrefix?: string;
};

export type Store =
  | 'pain_groups' | 'discovery_interviews' | 'customer_segments'
  | 'competitor_candidates' | 'demand_signals' | 'revenue_entries'
  | 'waitlist_signups' | 'hypotheses' | 'hypothesis_pain_links'
  | 'interview_sessions' | 'validation_decisions' | 'validation_decision_commitments';

export type ModuleSpec = {
  read: Gate;
  write: Gate;
  store: Store;
  activityType?: string;
  oldRows?: OldRowsMatcher;
  record: (ctx: RecordContext, id: string) => Promise<RecordContent>;
  sections: SectionSpec[];
  actions: (ctx: RecordContext, id: string, record: RecordContent) => Promise<RecordAction[]>;
  formOptions?: (ctx: RecordContext, query: Record<string, string>) => Promise<unknown>;
};

export type RecordRegistry = Partial<Record<Cycle, Record<string, ModuleSpec>>>;
