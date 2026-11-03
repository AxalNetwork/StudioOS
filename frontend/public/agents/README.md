# frontend/public/agents

The portraits of the 16 AI agents in the roster (#4116, landed by #4118). They are
served as-is from `/agents/`, and the Worker's persona catalogue
(`cloudflare-worker/src/services/agents/personas.ts`) gives each persona
`avatar: /agents/<key>.webp`.

**Where they come from.** The owner generated them with ChatGPT from the prompts
on #4118 (16-bit pixel art, passport framing, the Axal pin on the chest), and
uploaded them on 2026-11-03. Pixel art is on purpose: it tells an AI agent apart
from a human member, and no portrait is a likeness of a real person. They are
kept exactly as generated; only the size changed.

**The rule for each persona.** Three files, named by the persona's `key` in
lower case ASCII:

- `<key>.png`: 1024×1024, a 256-colour palette PNG (under the 500 KB size gate);
- `<key>.webp`: 512×512, the one the app draws;
- `<key>_256.webp`: 256×256, for small avatars.

A new persona adds its three files here.
`frontend/test/agent_avatars_d4118.test.mjs` fails when a persona in the
catalogue is missing one, or when a file here belongs to no persona.
