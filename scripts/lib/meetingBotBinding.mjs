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
