// Ambient declaration for Wrangler/Vite-style `?raw` markdown imports.
// Wrangler bundles the .md file content as a string literal at build time;
// tsc has no built-in support for this so we declare it here.
declare module '*.md?raw' {
  const content: string;
  export default content;
}

// D711 — the legal paper's faces and mark, bundled by wrangler.toml's
// `[[rules]] type = "Data"` block as ArrayBuffers.
declare module '*.woff2' {
  const content: ArrayBuffer;
  export default content;
}
declare module '*.png' {
  const content: ArrayBuffer;
  export default content;
}

// D764 (#2089) — the rail's model matrix, which wrangler bundles as a JSON
// module (`services/ai/railMatrix.ts`). Only this one file is imported so.
declare module '*/railMatrix.json' {
  const matrix: {
    _generated: string;
    // #4313 part 3: a page row names its kind; its models come from that kind's job.
    rows: { pageKey: string; kind: string; routeTask: string }[];
    options: {
      pageKey: string; optionKey: string; optionLabel: string; kind: string; handler: string; routeTask: string;
      models: { id: string; role: string; line: string }[];
    }[];
  };
  export default matrix;
}
