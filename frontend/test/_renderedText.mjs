/**
 * The text a reader sees in `renderToStaticMarkup` output, markup removed —
 * for asserting on the sentences a component draws.
 *
 * A CHARACTER SCAN, NOT A REGEX REPLACE. `html.replace(/<[^>]*>/g, '')`
 * needs a closing `>` to remove anything, so a tag left open at the end comes
 * through whole: `x<script` stays `x<script`, and `d<img src=x onerror=1`
 * keeps its handler. CodeQL rates that high (incomplete multi-character
 * sanitization, alert 6146 on D204's test), and the property it asks for is
 * the right one even here, where the input is React's own output: a helper
 * shaped like a sanitizer gets copied to places that are not tests. This scan
 * drops everything from a `<` to the next `>` or to the end, so what it
 * returns never contains a `<`, and no tag can survive it.
 *
 * On React's output it returns exactly what the regex did — React escapes `<`
 * and `>` in text and attribute values alike, so every `<` it emits opens a
 * tag. D204's suite ran both over every render it makes and they agreed.
 *
 * The two entities these tests read are decoded afterwards, `&amp;` last, so
 * an escaped `&amp;#39;` stays the literal text `&#39;` rather than becoming
 * an apostrophe it never was.
 */
export function renderedText(html) {
  let out = '';
  let inTag = false;
  for (const ch of String(html)) {
    if (ch === '<') inTag = true;
    else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
}
