/**
 * D5074 slice 4 (#5074): Capital relationships' module read `capabilities`, as the Worker computes them
 * (`cloudflare-worker/src/services/capRelCapabilities.ts`), for the frontend fixtures.
 * `cloudflare-worker/test/caprel_capabilities_5074.test.ts` pins this mirror to the Worker's own function.
 */
export const CAPREL_CAPABILITIES = ['work', 'support_reads', 'support_read', 'admin_reason_required'];

/** The Worker's map for a standing: `staff` (an admin or the Super Admin), `worker` (the owner or a co-founder). */
export function capRelCapabilities({ staff = false, worker = false } = {}) {
  const works = !staff && worker;
  return { work: works, support_reads: works, support_read: staff, admin_reason_required: staff };
}

export const CAPREL_WORKER_CAPS = capRelCapabilities({ worker: true });
export const CAPREL_STAFF_CAPS = capRelCapabilities({ staff: true });
