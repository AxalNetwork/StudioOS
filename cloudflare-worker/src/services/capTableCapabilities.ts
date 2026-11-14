/**
 * D5074 slice 2 (#5074): the cap table record's capabilities, computed once from who the caller is on the venture.
 *
 * `GET /api/captable/record/:projectId` returns this map beside the record, and every record write in
 * `routes/captable.ts` (`recordWriter`) refuses from the same map, so the page can never be shown a control the
 * Worker then refuses, nor refused one it was shown. The Worker stays the enforcement boundary.
 *
 * | Capability              | Owner | Co-founder | Ordinary admin | Super Admin | Reader (advisor, investor grant) |
 * |-------------------------|-------|------------|----------------|-------------|----------------------------------|
 * | `propose`, `import`     | yes   | yes        | yes, reasoned  | no          | no                               |
 * | `record` (record, accept, dismiss, void, classes, currency) | yes | no | yes, reasoned | no | no                |
 * | `correct`               | no    | no         | yes            | no          | no                               |
 * | `export`                | yes   | yes        | with a support read | with a support read | when it may read     |
 * | `admin_reason_required` | no    | no         | yes            | no          | no                               |
 *
 * An admin never holds the venture's own read or write gate (`captableAccess.ts`, D1130): an ordinary admin writes
 * only as a studio correction with a reason, and reads only through the reasoned support read; a Super Admin writes
 * nothing here.
 *
 * The write capabilities say who may write. Every write also needs the Studio plan, which `plan` says on its own,
 * so the page can tell "not yours to do" from "your plan does not include it": a control is drawn when its
 * capability and `plan` are both true, and the plan's gate when only `plan` is false. The Worker refuses a write
 * without the plan with the plan's own 402, before it looks at the capability. An ordinary admin's write is a
 * studio correction: it carries the support reason the founder reads (`admin_reason_required`).
 */
export const RECORD_CAPABILITIES = ['propose', 'import', 'record', 'correct', 'export', 'admin_reason_required'] as const;
export type RecordCapability = typeof RECORD_CAPABILITIES[number];
export type RecordCapabilities = Record<RecordCapability, boolean> & { plan: boolean };

/** Who the caller is on this venture, as `recordWriter` has always worked it out. */
export type RecordStanding = {
  /** The venture's read gate (`canReadProject`). */
  readable: boolean;
  /** The venture's write gate (`canWriteProject`). */
  writable: boolean;
  /** The account is an admin. */
  admin: boolean;
  superAdmin: boolean;
  /** The founder account that owns the venture, or a member whose membership role is `owner`. */
  owner: boolean;
  /** The Studio plan. */
  plan: boolean;
};

/** The map, from the standing alone. Pure: the read and the writes give it the same standing. */
export function recordCapabilities(s: RecordStanding): RecordCapabilities {
  const correction = s.admin && !s.superAdmin;
  const writer = s.writable || correction;
  const records = writer && (s.admin || s.owner);
  return {
    propose: writer,
    import: writer,
    record: records,
    correct: writer && correction,
    export: s.readable,
    admin_reason_required: correction,
    plan: s.plan,
  };
}

/** True only for a `true` in the map: no map, an unknown key or any other value allows nothing. */
export const recordCan = (caps: Partial<Record<string, unknown>> | null | undefined, key: RecordCapability) => caps?.[key] === true;
