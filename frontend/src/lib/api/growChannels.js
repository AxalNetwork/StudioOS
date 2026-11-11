// D4486 (#4486) — read-only venture channels and connection cards; mounted Worker routes/grow_channels.ts.
import { request } from '../api.js';

export const growChannelsApi = {
  channels: (project) => request(`/grow/channels?project=${encodeURIComponent(project)}`),
};
