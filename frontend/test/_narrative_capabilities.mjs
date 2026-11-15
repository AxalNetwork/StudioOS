/**
 * D5074 slice 3 (#5074): the Investor narrative versions read's `capabilities`, as the Worker computes them
 * (`cloudflare-worker/src/services/narrative/capabilities.ts`), for the frontend fixtures. A fixture names who the
 * viewer is, and its form-options reply carries the map the Worker would send that viewer.
 * `cloudflare-worker/test/narrative_capabilities_5074.test.ts` pins this mirror to the Worker's own function.
 */
export const NARRATIVE_CAPABILITIES = ['edit', 'check', 'note', 'end_read', 'admin_reason_required'];

/** The Worker's map for a standing: `admin` (an admin with a reason), `founder` (the venture's founder). */
export function narrativeCapabilities({ admin = false, founder = false } = {}) {
  return {
    edit: !admin,
    check: !admin && founder,
    note: true,
    end_read: admin,
    admin_reason_required: admin,
  };
}

export const FOUNDER_CAPS = narrativeCapabilities({ founder: true });
export const COFOUNDER_CAPS = narrativeCapabilities({});
export const ADMIN_CAPS = narrativeCapabilities({ admin: true });

/** A form-options reply with the viewer's map (the founder's by default), unless the fixture already set one. */
export function withNarrativeCapabilities(options, viewer = { founder: true }) {
  if (!options || typeof options !== 'object' || 'capabilities' in options) return options;
  return { ...options, capabilities: narrativeCapabilities(viewer) };
}
