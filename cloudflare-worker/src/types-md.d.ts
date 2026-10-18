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
