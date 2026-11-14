// Three-band ring visualiser for the recording view. Reads an AnalyserNode (fftSize 2048) or a demo signal.
// Strands are 0.6px closed waves offset in radius/phase. Low: outer, cw. High: inner, ccw.
(function () {
  const BANDS = [
    { lo: 20, hi: 250, r: 150, w: 36, n: 32, speed: 0.08, lobes: 7, dir: 1, cols: ['#2e1065', '#5b21b6'], dark: ['#3b0764', '#5b21b6'], a: 0.85 },
    { lo: 250, hi: 2000, r: 112, w: 26, n: 32, speed: 0.14, lobes: 9, dir: 1, cols: ['#6d28d9', '#8b5cf6'], dark: ['#6d28d9', '#a855f7'], a: 0.75 },
    { lo: 2000, hi: 8000, r: 80, w: 16, n: 32, speed: 0.22, lobes: 11, dir: -1, cols: ['#a78bfa', '#c4b5fd'], dark: ['#c084fc', '#ede9fe'], a: 0.9 },
  ];
  class RingViz extends HTMLElement {
    connectedCallback() {
      this.style.cssText = 'display:block;width:100%;height:100%';
      this.canvas = document.createElement('canvas'); this.canvas.style.cssText = 'width:100%;height:100%;display:block'; this.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.energy = [0, 0, 0]; this.target = [0, 0, 0]; this.t = 0; this.last = performance.now();
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || this.getAttribute('motion') === 'reduced';
      this.resize(); this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this);
      this._vis = () => { if (document.hidden) cancelAnimationFrame(this._raf); else this.loop(); }; document.addEventListener('visibilitychange', this._vis);
      this.loop();
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect(); document.removeEventListener('visibilitychange', this._vis); this.audio && this.audio.close && this.audio.close(); }
    resize() { const dpr = Math.min(2, devicePixelRatio || 1); const w = this.clientWidth || 360, h = this.clientHeight || 360; this.canvas.width = w * dpr; this.canvas.height = h * dpr; this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = w; this.H = h; }
    async useMic() {
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); this.audio = new (window.AudioContext || window.webkitAudioContext)(); const src = this.audio.createMediaStreamSource(stream); this.an = this.audio.createAnalyser(); this.an.fftSize = 2048; src.connect(this.an); this.freq = new Uint8Array(this.an.frequencyBinCount); this.setAttribute('source', 'mic'); this.dispatchEvent(new CustomEvent('mic', { detail: 'granted' })); }
      catch (e) { this.setAttribute('source', 'denied'); this.dispatchEvent(new CustomEvent('mic', { detail: 'denied' })); }
    }
    sample() {
      const mode = this.getAttribute('mode') || 'speech';
      if (this.an) { this.an.getByteFrequencyData(this.freq); const nyq = this.audio.sampleRate / 2, N = this.freq.length; return BANDS.map(b => { const i0 = Math.floor(b.lo / nyq * N), i1 = Math.min(N - 1, Math.ceil(b.hi / nyq * N)); let s = 0; for (let i = i0; i <= i1; i++) s += this.freq[i]; return Math.min(1, (s / (i1 - i0 + 1)) / 160); }); }
      const t = this.t;
      if (mode === 'silence' || mode === 'paused' || mode === 'denied' || mode === 'nosound') return [0.04, 0.03, 0.02];
      // demo voice: syllable bursts on the mid band, occasional consonant flicks high, slow low rumble
      const syll = Math.max(0, Math.sin(t * 5.2) * 0.6 + Math.sin(t * 1.7) * 0.4), pause = (Math.sin(t * 0.45) > 0.65) ? 0.15 : 1;
      return [0.22 + 0.18 * Math.sin(t * 0.9) * pause, Math.min(1, (0.25 + syll * 0.75) * pause), Math.max(0, (Math.sin(t * 13.1) > 0.82 ? 0.9 : 0.12) * pause)];
    }
    loop() {
      this._raf = requestAnimationFrame(() => this.loop());
      const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; const mode = this.getAttribute('mode') || 'speech';
      if (mode !== 'paused' && !this.reduced) this.t += dt;
      const s = this.sample();
      for (let i = 0; i < 3; i++) { const k = s[i] > this.energy[i] ? dt / 0.08 : dt / 0.4; this.energy[i] += (s[i] - this.energy[i]) * Math.min(1, k); }
      this.draw(mode);
    }
    draw(mode) {
      const ctx = this.ctx, W = this.W, H = this.H, cx = W / 2, cy = H / 2, scale = Math.min(W, H) / 400;
      const dark = this.getAttribute('theme') === 'dark';
      ctx.clearRect(0, 0, W, H);
      const dim = mode === 'paused' ? 0.35 : mode === 'denied' ? 0.3 : 1;
      const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
      const bands = mode === 'denied' ? [BANDS[1]] : BANDS;
      if (mode === 'stopping') { ctx.beginPath(); ctx.arc(cx, cy, 90 * scale, 0, Math.PI * 2); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 6; ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 90 * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.38); ctx.strokeStyle = dark ? '#ede9fe' : '#2e1065'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.stroke(); return; }
      bands.forEach((b, bi) => {
        const e = mode === 'denied' ? 0 : this.energy[bi], base = b.r * scale, amp = (6 + 34 * e) * scale, n = lowPower ? Math.round(b.n * 0.6) : b.n;
        const rot = this.reduced ? 0 : this.t * b.speed * b.dir, breathe = this.reduced ? 0 : Math.sin(this.t * 0.6 + bi) * 2 * scale;
        const cols = dark ? b.dark : b.cols;
        ctx.save();
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
        // haze / bloom pass
        ctx.filter = dark ? 'blur(24px)' : 'blur(28px)'; ctx.globalAlpha = dark ? 0.35 : 0.18;
        ctx.beginPath(); for (let k = 0; k <= 180; k++) { const a = (k / 180) * Math.PI * 2; const r = base + breathe + amp * (0.5 + 0.5 * Math.sin(a * b.lobes + rot)) + (b.w * scale) / 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.strokeStyle = cols[0]; ctx.lineWidth = b.w * scale; ctx.stroke();
        ctx.filter = 'none';
        // strands
        const g = ctx.createLinearGradient(cx - base, cy, cx + base, cy); g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
        ctx.strokeStyle = g; ctx.lineWidth = 0.6; ctx.globalAlpha = b.a * dim;
        for (let s = 0; s < n; s++) {
          const off = (s / (n - 1) - 0.5) * b.w * scale, ph = (s / n) * 0.9;
          ctx.beginPath();
          for (let k = 0; k <= 240; k++) { const a = (k / 240) * Math.PI * 2; const wave = 0.5 + 0.5 * Math.sin(a * b.lobes + rot + ph) ; const wave2 = 0.5 + 0.5 * Math.sin(a * (b.lobes + 2) - rot * 0.7 + ph * 1.3); const r = base + breathe + off + amp * (wave * 0.7 + wave2 * 0.3); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.closePath(); ctx.stroke();
        }
        ctx.restore();
      });
      if (this.getAttribute('flash') === '1') { ctx.save(); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(cx, cy, (BANDS[0].r + 30) * scale, -Math.PI / 2 - 0.08, -Math.PI / 2 + 0.08); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore(); }
    }
  }
  if (!customElements.get('ring-viz')) customElements.define('ring-viz', RingViz);
})();
