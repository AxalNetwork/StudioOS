/** Apply only after the owner creates the remote bot hosts. No deployment. */
import { parseSections } from '../check-wrangler-binding-parity.mjs';

/** Each site environment's own bot host. Preview's binding is optional: staging has none (#7147, D7147 part 2). */
export const BOT_HOSTS = [
  { prefix: '', script: 'studioos-meeting-bot', optional: false },
  { prefix: 'env.production.', script: 'studioos-meeting-bot', optional: false },
  { prefix: 'env.preview.', script: 'studioos-meeting-bot-preview', optional: true },
];

/**
 * D7147 part 2 (amends D886 for staging): production, and the top level, must
 * bind their own bot host. Preview may bind nothing at all (staging), or only
 * the separate preview host: never production's, never a local class. With no
 * binding, `[env.preview.vars]` must keep `MEETING_BOT = "off"`.
 * Returns null when the environment's binding is allowed, else a reason code.
 */
export function botBindingProblem(sections, prefix) {
  const host = BOT_HOSTS.find((h) => h.prefix === prefix);
  if (!host) throw Error('unknown_bot_environment');
  const rows = sections.filter((s) => s.name === prefix + 'durable_objects.bindings' && s.kv.get('name') === '"MEETING_BOT_CONTAINER"');
  if (rows.length === 0) {
    if (!host.optional) return 'missing_bot_binding';
    const bot = sections.filter((s) => s.name === prefix + 'vars' && s.kv.has('MEETING_BOT')).map((s) => s.kv.get('MEETING_BOT'));
    return bot.length === 1 && bot[0] === '"off"' ? null : 'bot_on_without_binding';
  }
  if (rows.length > 1) return 'duplicate_bot_binding';
  const [row] = rows;
  if (row.kv.get('class_name') !== '"MeetingBotContainer"') return 'wrong_bot_class';
  if (!row.kv.has('script_name')) return 'local_bot_class';
  if (row.kv.get('script_name') !== JSON.stringify(host.script)) return 'wrong_bot_host';
  return null;
}

export function withMeetingBotBinding(source) {
  const sections = parseSections(source);
  for (const { prefix, script, optional } of BOT_HOSTS) {
    const header = `[[${prefix}durable_objects.bindings]]`;
    const existing = sections.find((s) => s.name === prefix + 'durable_objects.bindings' && s.kv.get('name') === '"MEETING_BOT_CONTAINER"');
    if (existing) {
      if (existing.kv.get('class_name') !== '"MeetingBotContainer"' || existing.kv.get('script_name') !== JSON.stringify(script)) throw Error('conflicting_bot_binding');
      continue;
    }
    // Staging carries no bot binding by owner decision (#7147): never add one back, and refuse a bot switched on without it.
    if (optional) {
      const problem = botBindingProblem(sections, prefix);
      if (problem) throw Error(problem);
      continue;
    }
    if (!source.includes(header)) throw Error('missing_do_bindings');
    source = source.replace(header, `# D886: independent private bot host.\n${header}\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"\nscript_name = "${script}"\n\n${header}`);
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
