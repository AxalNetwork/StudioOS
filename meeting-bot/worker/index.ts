/** Private cross-script bot host. Only an explicitly enabled preview accepts authenticated synthetic canary HTTP. */
import { previewIngress, type CanaryEnv } from './previewCanary';
export { MeetingBotContainer } from './container';
export default { fetch:(request:Request,env:CanaryEnv={})=>env.CF_BOT_AUDIENCE==='preview'?previewIngress(request,env):new Response(null,{status: 404}) };
