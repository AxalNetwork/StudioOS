/** D669: an assistant name is self-declared; only callback URLs establish recognition.
 * Unknown callbacks remain connectable with an explicit unverified label.
 */
export const ASSISTANT_CALLBACKS: Record<string, readonly string[]> = {
  ChatGPT: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  Claude: ['https://claude.ai/api/mcp/auth_callback'],
  // No published exact callback found in the vendors' linked setup docs.
  // S1 must verify these before adding an entry; never guess a trusted URL.
  Gemini: [],
  Grok: [],
};
export function assistantIdentity(raw: string): { verified_assistant: string | null; assistant_label: string } {
  let uri: URL;
  try { uri = new URL(raw); } catch { return { verified_assistant: null, assistant_label: 'Unverified assistant' }; }
  if (uri.username || uri.password || uri.hash || uri.search) return { verified_assistant: null, assistant_label: 'Unverified assistant' };
  const key = uri.origin + uri.pathname;
  for (const [name, callbacks] of Object.entries(ASSISTANT_CALLBACKS)) {
    const chatgptCallback = name === 'ChatGPT' && uri.origin === 'https://chatgpt.com' && /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(uri.pathname);
    if (callbacks.includes(key) || chatgptCallback) return { verified_assistant: name, assistant_label: name };
  }
  return { verified_assistant: null, assistant_label: 'Unverified assistant' };
}
