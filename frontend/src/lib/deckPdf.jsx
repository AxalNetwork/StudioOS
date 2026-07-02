// Task #25 — react-pdf renderer for the pitch deck. Loaded lazily so the
// ~600KB pdf engine never enters the main bundle.
import React from 'react';

// Strip very basic markdown so the PDF body reads naturally without
// needing a full markdown→PDF pipeline. react-pdf doesn't ship one.
function stripMarkdown(s) {
  if (!s) return '';
  return String(s)
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export async function downloadDeckPdf(deck) {
  // Lazy import keeps @react-pdf/renderer out of the main bundle.
  const pdf = await import('@react-pdf/renderer');
  const { Document, Page, Text, View, StyleSheet, Image, pdf: pdfFn } = pdf;

  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#5b21b6', color: 'white',
      padding: 56, flexDirection: 'column',
      fontSize: 12, fontFamily: 'Helvetica',
    },
    subtitle: { fontSize: 10, letterSpacing: 2, color: '#ddd6fe', textTransform: 'uppercase' },
    title: { fontSize: 28, fontWeight: 700, marginTop: 8, color: 'white' },
    body: { fontSize: 13, marginTop: 18, color: '#ede9fe', lineHeight: 1.5 },
    bullets: { marginTop: 18 },
    bulletRow: { flexDirection: 'row', marginBottom: 8 },
    bulletDot: { color: '#c4b5fd', width: 12 },
    bulletText: { flex: 1, fontSize: 12, color: 'white', lineHeight: 1.4 },
    image: { marginTop: 'auto', alignSelf: 'flex-end', maxHeight: 120, maxWidth: 240, objectFit: 'contain' },
    footer: { marginTop: 'auto', fontSize: 9, color: '#c4b5fd' },
    coverPage: { backgroundColor: '#4c1d95', color: 'white', padding: 64, justifyContent: 'center' },
    coverTitle: { fontSize: 36, fontWeight: 700, color: 'white' },
    coverMeta: { marginTop: 16, fontSize: 12, color: '#ddd6fe' },
  });

  const Slide = ({ s, idx, total }) => (
    <Page size={[960, 540]} style={styles.page} orientation="landscape">
      {s.subtitle ? <Text style={styles.subtitle}>{s.subtitle}</Text> : null}
      <Text style={styles.title}>{s.title}</Text>
      {s.body ? <Text style={styles.body}>{stripMarkdown(s.body)}</Text> : null}
      {(s.bullets || []).length > 0 && (
        <View style={styles.bullets}>
          {s.bullets.map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>
      )}
      {/* Image is best-effort — react-pdf can fail on cross-origin images;
          we wrap in a try/catch at render-time via the parent. */}
      {s.image_url ? <Image src={s.image_url} style={styles.image} /> : null}
      <Text style={styles.footer}>{idx + 1} / {total}</Text>
    </Page>
  );

  // Strip images from any slide whose URL fails to load — a single bad
  // image otherwise crashes the entire pdf() call.
  const slides = await Promise.all((deck.slides || []).map(async (s) => {
    if (!s.image_url) return s;
    try {
      const r = await fetch(s.image_url, { mode: 'cors' });
      if (!r.ok) throw new Error('fetch failed');
      return s;
    } catch { return { ...s, image_url: null }; }
  }));

  const doc = (
    <Document title={deck.title || 'Pitch deck'}>
      <Page size={[960, 540]} style={[styles.page, styles.coverPage]} orientation="landscape">
        <Text style={styles.coverTitle}>{deck.title || 'Pitch Deck'}</Text>
        <Text style={styles.coverMeta}>Version {deck.version}</Text>
      </Page>
      {slides.map((s, i) => <Slide key={i} s={s} idx={i} total={slides.length} />)}
    </Document>
  );

  const blob = await pdfFn(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(deck.title || 'pitch-deck').replace(/[^\w.-]+/g, '-').toLowerCase()}-v${deck.version}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
