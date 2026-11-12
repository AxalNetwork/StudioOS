// D5671: trusted scheduled GitHub fallback check, independent of the Cloudflare and Slack delivery paths.
import {readCloudflareHeartbeat} from '../engineering-notifications/cloudflare-heartbeat-5671.mjs';
const result=process.env.CF_HEARTBEAT_MAINTENANCE==='true'?{state:'maintenance'}:await readCloudflareHeartbeat({url:process.env.CF_STATUS_URL,secret:process.env.CF_OBSERVER_SECRET});
console.log(`[cf-monitor][${result.state}] notification delivery heartbeat`);
if(!['healthy','maintenance'].includes(result.state))process.exitCode=1;
