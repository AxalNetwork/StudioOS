/** Apply only after the owner creates both remote bot hosts. No deployment. */
import { parseSections } from '../check-wrangler-binding-parity.mjs';
export function withMeetingBotBinding(source) {
  const sections=parseSections(source);
  for(const [prefix,script] of [['','studioos-meeting-bot'],['env.production.','studioos-meeting-bot'],['env.preview.','studioos-meeting-bot-preview']]){
    const header=`[[${prefix}durable_objects.bindings]]`;
    const existing=sections.find(s=>s.name===prefix+'durable_objects.bindings'&&s.kv.get('name')==='"MEETING_BOT_CONTAINER"');
    if(existing){
      if(existing.kv.get('class_name')!=='"MeetingBotContainer"'||existing.kv.get('script_name')!==JSON.stringify(script))throw Error('conflicting_bot_binding');
      continue;
    }
    if(!source.includes(header))throw Error('missing_do_bindings');
    source=source.replace(header,`# D886: independent private bot host.\n${header}\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"\nscript_name = "${script}"\n\n${header}`);
  }
  return source;
}

/** Keep the reviewed topology catalogue aligned with the opt-in binding. */
export function withMeetingBotTopology(source) {
  const row="  { name: 'MEETING_BOT_CONTAINER', kind: 'Durable Object namespace', hq: 'MeetingBotContainer', branch: () => null, shared: false, hqOnly: true },";
  if(source.includes(row))return source;
  if(source.includes("name: 'MEETING_BOT_CONTAINER'"))throw Error('conflicting_bot_topology');
  const marker="  { name: 'MEETING_BOT_RUN', kind: 'Durable Object namespace', hq: 'MeetingBotRun', branch: () => 'MeetingBotRun', shared: false },";
  if(!source.includes(marker))throw Error('missing_binding_catalogue');
  return source.replace(marker,marker+'\n'+row);
}
