/** D5567 part 5: synthetic owner-registry evidence for broker integration tests only. */
import type { ContainmentEvidence } from '../src/services/agents/workspaceContainment.ts';
export function containmentFixture(verified_at: number): ContainmentEvidence {
 return { provider:'cloudflare',revision:'synthetic-owner-registry',source:'owner_registry',verified_at,
 egress:{deny_all:true,connect_time_allowlist:true,blocks_private_ranges:true,blocks_dns_rebinding:true,blocks_redirect_escape:true,covers_raw_sockets:true},
 metadata_blocked:true,localhost_blocked:true,guest:{d1_binding:false,durable_object_binding:false,secret_bindings:false,control_plane_credentials:false,other_tenant_mounts:false},
 privileged:false,host_socket:false,runs_as_root:false,no_new_privileges:true,immutable_image:true,sandbox:'microvm'};
}
