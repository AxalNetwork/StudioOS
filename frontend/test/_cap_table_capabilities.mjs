/**
 * D5074 slice 2 (#5074): the cap table record read's `capabilities`, as the Worker computes them
 * (`cloudflare-worker/src/services/capTableCapabilities.ts`), for the frontend fixtures. A fixture names who the
 * viewer is (its account and whether the grants read says `can_change`), and the record reply carries the map the
 * Worker would send that viewer. `cap_table_capabilities_5074.test.ts` pins this mirror to the Worker's own function.
 */
import { hasTier } from '../src/sidebarConfig.js';

/** The map for one standing, as the Worker builds it. */
export function capTableCapabilities({ readable = true, writable = false, admin = false, superAdmin = false, owner = false, plan = true } = {}) {
  const correction = admin && !superAdmin;
  const writer = writable || correction;
  return {
    propose: writer,
    import: writer,
    record: writer && (admin || owner),
    correct: writer && correction,
    export: readable,
    admin_reason_required: correction,
    plan,
  };
}

/** The standing a fixture means: an admin account, or a member who may change access (the owner) or not (a co-founder). */
export function standingOf(user, grants) {
  const admin = String(user?.role || '').toLowerCase() === 'admin';
  const readable = grants && typeof grants === 'object';
  return {
    readable: true,
    writable: admin || !!readable,
    admin,
    superAdmin: !!user?.is_super_admin,
    owner: !admin && !!(readable && grants.can_change),
    plan: hasTier(user, 'studio'),
  };
}

/** A record reply with the viewer's capabilities, unless the fixture already set them or the reply is a refusal. */
export function withCapabilities(record, user, grants) {
  if (!record || typeof record !== 'object' || 'capabilities' in record) return record;
  return { ...record, capabilities: capTableCapabilities(standingOf(user, grants)) };
}
