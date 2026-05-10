// Ambient declaration for Wrangler/Vite-style `?raw` markdown imports.
// Wrangler bundles the .md file content as a string literal at build time;
// tsc has no built-in support for this so we declare it here.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
