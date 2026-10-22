/**
 * D886 B3 (#2581): the Meet tab's audio, taken from the page itself.
 *
 * Meet plays each remote participant through a WebRTC track. An init script,
 * added before Meet's own scripts run, wraps `RTCPeerConnection` so every
 * remote audio track is also connected to one Web Audio mix. A
 * `ScriptProcessorNode` reads the mix in blocks and hands each to the adapter
 * through `window.__eadwynAudio(rate, base64Float32)`.
 *
 * Nothing is sent until the adapter switches capture on, after admission
 * (`window.__eadwynCapture.on = true`), and the core subscribes to audio only
 * after the notice (B2). The mix is mono and mixed, never per participant
 * (D886 §4: B6 names speakers from the speaking timeline). The audio never
 * leaves the process except as B2's chunks, and is never logged.
 *
 * Chromium feeds a remote WebRTC track into Web Audio only while a media
 * element also plays it, so each track is also attached to a muted `<audio>`.
 */

export const CAPTURE_BINDING = '__eadwynAudio';

/** The init script. It is a string because it runs in the page, not in Node. */
export const CAPTURE_SCRIPT = `(() => {
  if (window.__eadwynCapture) return;
  const Native = window.RTCPeerConnection;
  const state = { on: false, ctx: null, mix: null };
  window.__eadwynCapture = state;
  if (!Native) return;
  const start = () => {
    if (state.ctx) return;
    const ctx = new AudioContext();
    const mix = ctx.createGain();
    const node = ctx.createScriptProcessor(4096, 1, 1);
    mix.connect(node);
    node.connect(ctx.destination);
    node.onaudioprocess = (e) => {
      e.outputBuffer.getChannelData(0).fill(0);
      if (!state.on || typeof window.${CAPTURE_BINDING} !== 'function') return;
      const data = e.inputBuffer.getChannelData(0);
      const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      window.${CAPTURE_BINDING}(ctx.sampleRate, btoa(s));
    };
    state.ctx = ctx;
    state.mix = mix;
  };
  const attach = (track) => {
    if (!track || track.kind !== 'audio') return;
    start();
    const stream = new MediaStream([track]);
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    state.ctx.createMediaStreamSource(stream).connect(state.mix);
    state.ctx.resume().catch(() => {});
  };
  function Wrapped(...args) {
    const pc = new Native(...args);
    pc.addEventListener('track', (e) => attach(e.track));
    return pc;
  }
  Wrapped.prototype = Native.prototype;
  Object.setPrototypeOf(Wrapped, Native);
  window.RTCPeerConnection = Wrapped;
})();`;

/** A block from the page, decoded: the samples and the page's sample rate. */
export function decodeBlock(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  const out = new Float32Array(Math.floor(bytes.length / 4));
  new Uint8Array(out.buffer).set(bytes.subarray(0, out.length * 4));
  return out;
}
