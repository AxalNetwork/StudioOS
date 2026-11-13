/* ============================================================================
 *  AXAL VC — SPIN-OUT DEMO DAY DECK GENERATOR
 *  Template-ready. All content lives in the DATA object below; the render code
 *  underneath never hard-codes copy. To repopulate the deck for a new spin-out,
 *  replace DATA (or feed it from the Axal VC platform's structured fields) and
 *  re-run. Visual system (THEME) is shared across every slide.
 *
 *  Run:  npm i -g pptxgenjs react react-dom react-icons sharp
 *        node build.js   ->   Basepoint_SpinOut_DemoDay.pptx
 * ========================================================================== */

const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const { FaDatabase, FaChartLine, FaEye, FaBolt, FaCheck } = require("react-icons/fa");

/* ----------------------------------------------------------------------------
 *  THEME — restrained editorial VC system (white/black/grayscale + 1 accent)
 * -------------------------------------------------------------------------- */
const THEME = {
  fileName: "Basepoint_SpinOut_DemoDay.pptx",
  fonts: { head: "Arial", body: "Arial" },
  color: {
    ink: "12151C", body: "4B5563", muted: "8A93A0", faint: "AEB6C0",
    line: "E4E7EC", panel: "F6F7F9", panel2: "EEF0F3", white: "FFFFFF",
    accent: "2C4BE0", accentSoft: "E7EBFD", accentMid: "B9C4F6",
    dbg: "0E1116", dpanel: "171C25", dline: "2A313D",
    dmuted: "9099A6", dfaint: "5C6573", accentLt: "6E86FF",
    done: "1F9D6B", active: "D98A2B", pending: "9AA3AF",
  },
};

/* ----------------------------------------------------------------------------
 *  DATA — the spin-out's structured fields (swap this block per company)
 *  status values: "done" | "active" | "pending"
 * -------------------------------------------------------------------------- */
const DATA = {
  brand: {
    lab: "AXAL VC · SPIN-OUT LAB",
    footerRight: "BASEPOINT · CONFIDENTIAL",
    network: "Axal VC",
  },

  cover: {
    company: "BASEPOINT",
    eyebrowRight: "DEMO DAY · DAY 30 / 30",
    thesis: "Private-market lenders still price risk on weeks-old data. Basepoint scores it in real time.",
    signalLabel: "VALIDATION SIGNAL · 30-DAY SPRINT",
    signalCaption: "Cumulative discovery interviews",
    signalX: ["D0", "D5", "D10", "D15", "D20", "D25", "D30"],
    signalY: [6, 14, 22, 29, 35, 39, 42],
    meta: [
      ["SECTOR", "Fintech / AI"],
      ["STAGE", "Pre-seed"],
      ["FOUNDER", "Maya Osei"],
      ["LAB STATUS", "Day 30 / 30"],
    ],
  },

  problem: {
    eyebrow: "Problem", idx: "02",
    title: "Three pains surface in every lender conversation.",
    framing: "Synthesized from 42 discovery interviews with credit and risk teams at mid-market private lenders.",
    quote: "We re-underwrite on data that's already three weeks old. By then the borrower has moved.",
    quoteAttr: "Head of Credit · mid-market direct lender",
    barsLabel: "PAIN FREQUENCY ACROSS INTERVIEWS",
    pains: [
      ["Stale data at decision time", 86, "36 / 42"],
      ["Manual, slow review cycles", 71, "30 / 42"],
      ["Thin coverage of private borrowers", 64, "27 / 42"],
      ["No continuous monitoring", 52, "22 / 42"],
    ],
  },

  validation: {
    eyebrow: "Validation", idx: "03",
    title: "Empirical signal from a 30-day discovery sprint.",
    cards: [
      ["42", "Interviews completed"],
      ["31", "Distinct pains captured"],
      ["8.1", "Mean solution-fit (/10)"],
      ["9", "Design-partner LOIs"],
    ],
    funnelLabel: "DISCOVERY FUNNEL · OUTREACH \u2192 COMMITTED",
    stages: [
      ["Reached out", 180],
      ["Interviewed", 42],
      ["Pain confirmed", 36],
      ["Solution-fit \u2265 7", 24],
      ["LOI / design partner", 9],
    ],
    conversion: ["21%", "interview \u2192 LOI conversion"],
  },

  market: {
    eyebrow: "Market", idx: "04",
    title: "A $3.2B serviceable market, expanding with private credit.",
    // [shortLabel, value, description] — outer to inner
    rings: [
      ["TAM", "$14B", "Private-credit risk tooling"],
      ["SAM", "$3.2B", "Mid-market private lenders"],
      ["SOM", "$180M", "Early-target segment, 3-yr"],
    ],
    whyNowLabel: "WHY NOW",
    why: [
      ["Private credit has scaled fast.", "AUM has roughly doubled since 2020, outpacing the tooling underwriters rely on."],
      ["Data infra is in, risk tooling isn't.", "Lenders now warehouse loan data but still score risk on manual, periodic reviews."],
      ["Monitoring pressure is rising.", "LPs and regulators increasingly expect continuous, auditable risk reporting."],
    ],
    assumptions: "Assumptions: bottom-up from ~2,400 addressable mid-market lenders \u00D7 $75K ACV; SOM = ~8% reached in 3 years.",
  },

  solution: {
    eyebrow: "Solution", idx: "05",
    title: "From raw borrower data to a live risk score.",
    // [iconKey, label, description] — iconKey maps to ICONS
    steps: [
      ["ingest", "Ingest", "Connect loan tapes, bank feeds, and filings in minutes."],
      ["score", "Score", "Generate a real-time risk score with explainable drivers."],
      ["monitor", "Monitor", "Continuously watch every borrower, not just at review."],
      ["act", "Act", "Trigger alerts and repricing the moment risk moves."],
    ],
    outcomeLabel: "OUTCOME",
    outcomes: [
      ["40%", "faster credit decisions"],
      ["Continuous", "monitoring vs. quarterly reviews"],
      ["Earlier", "default and covenant signals"],
    ],
  },

  roadmap: {
    eyebrow: "Roadmap", idx: "06",
    title: "Now, next, later \u2014 on a 30-day operating clock.",
    days: ["Day 0", "Day 30", "Day 60", "Day 90"],
    currentDay: 1, // index into days marked as "today"
    phases: [
      ["NOW", "Day 0 \u2013 30", [
        ["done", "42 discovery interviews completed"],
        ["done", "Working risk-score prototype"],
        ["active", "9 design partners signed"],
      ]],
      ["NEXT", "Day 31 \u2013 60", [
        ["pending", "Live pilot with 3 design partners"],
        ["pending", "Scoring API v1 in production"],
        ["pending", "First paid contract signed"],
      ]],
      ["LATER", "Day 61 \u2013 90", [
        ["pending", "SOC 2 Type I underway"],
        ["pending", "10 paying lenders onboarded"],
        ["pending", "Seed round opened"],
      ]],
    ],
  },

  team: {
    eyebrow: "Team & Network", idx: "07",
    title: "A founder backed by an operating network.",
    founder: {
      initials: "MO", name: "Maya Osei", role: "Founder & CEO",
      bio: "Ex-credit-risk lead; built underwriting models across a $2B private-credit book.",
    },
    advisorsLabel: "ADVISORS",
    advisors: [
      ["DK", "Daniel Kerr", "Former CRO, regional bank"],
      ["RP", "Rina Patel", "Fintech GTM, 2 exits"],
      ["AlV", "Alex Voss", "ML lead, risk modeling"],
    ],
    centerName: "Basepoint",
    // [xIn, yIn, name, sub] — positions on the 13.33x7.5 canvas
    nodes: [
      [9.35, 2.50, "Axal VC", "studio + capital"],
      [11.85, 4.15, "Capital network", "intro pipeline"],
      [9.35, 5.80, "Design partners", "9 lenders"],
      [6.85, 4.15, "Advisor bench", "credit + GTM"],
    ],
  },

  captable: {
    eyebrow: "Cap table & incorporation", idx: "08",
    title: "Entity-ready: clean cap table and founder setup.",
    checklistLabel: "FOUNDER & ENTITY SETUP",
    items: [
      ["Delaware C-corp formed", "done"],
      ["Founder equity issued", "done"],
      ["4-yr vesting, 1-yr cliff", "done"],
      ["83(b) elections filed", "done"],
      ["IP assignment executed", "done"],
      ["Option pool reserved (15%)", "done"],
      ["SAFE template prepared", "active"],
    ],
    donutLabel: "CAP TABLE · FULLY DILUTED",
    centerBig: "100%", centerSmall: "post-formation",
    // [label, value] — value is a percentage number
    segments: [
      ["Founders", 80],
      ["Option pool", 15],
      ["SAFE (reserved)", 5],
    ],
  },

  ask: {
    eyebrow: "The ask", idx: "09",
    title: "Raising $750K pre-seed to reach revenue.",
    kpis: [
      ["$750K", "Target raise"],
      ["SAFE", "Instrument · $6M cap"],
      ["18 mo", "Runway"],
      ["8 wks", "Target close"],
    ],
    useLabel: "USE OF FUNDS · 18-MONTH PLAN",
    funds: [
      ["Engineering & product", 45],
      ["Go-to-market", 25],
      ["Data & infrastructure", 20],
      ["Operations & legal", 10],
    ],
    milestone: ["Gets us to:", "10 paying lenders and seed-ready metrics."],
  },

  deal: {
    eyebrow: "Deal readiness", idx: "10",
    title: "Data room open. Ready to move.",
    diligenceLabel: "DILIGENCE PACKAGE",
    ready: [
      ["Data room", "Open"],
      ["Financial model", "Included"],
      ["Cap table & legal docs", "Included"],
      ["Customer references", "On request"],
      ["NDA", "Not required"],
    ],
    nextLabel: "NEXT STEPS",
    steps: [
      ["1", "30-minute intro call"],
      ["2", "Data room access granted same day"],
      ["3", "SAFE \u2014 target close in 8 weeks"],
    ],
    closingLine: "Open to diligence and intros this week.",
    contact: "maya@basepoint.xyz   ·   axal.vc",
  },
};

/* ----------------------------------------------------------------------------
 *  Speaker-note field map (auto vs manual) — kept with each slide
 * -------------------------------------------------------------------------- */
const NOTES = {
  cover: "COVER. Focal: thesis statement; area chart is the data hero (cumulative discovery interviews over the sprint).\nAUTO: company, thesis, sector/stage/founder, lab-day counter, validation-signal series.\nMANUAL: final thesis wording.",
  problem: "PROBLEM. Message: a few high-frequency, evidenced pains, ranked.\nAUTO: pain themes, frequency %, interview counts, pull quote.\nMANUAL: choose which quote to surface; trim labels.",
  validation: "VALIDATION. Message: measurable signal from the sprint.\nAUTO: scorecard values, funnel stage counts, conversion rate.\nMANUAL: none (computed).",
  market: "MARKET. Message: credible bottom-up serviceable market.\nAUTO: TAM/SAM/SOM figures, ACV + lender-count assumptions.\nMANUAL: the three why-now lines.",
  solution: "SOLUTION. Message: data \u2192 live score, four steps.\nAUTO: step copy, outcome metrics.\nMANUAL: confirm outcome numbers vs. latest pilot.",
  roadmap: "ROADMAP. Message: operating plan on the 30-day cadence.\nAUTO: milestones + status flags (milestone tracker).\nMANUAL: none if tracker is current.",
  team: "TEAM & NETWORK. Message: founder inside a structured operating network.\nAUTO: profiles, network node labels (people graph).\nMANUAL: advisor consent; swap initials for headshots.",
  captable: "CAP TABLE & INCORPORATION. Message: legal + equity setup is investor-ready.\nAUTO: checklist statuses, cap-table splits (data-room module).\nMANUAL: none if module current.",
  ask: "THE ASK. Message: specific raise tied to a milestone.\nAUTO: raise, instrument/cap, runway, close, allocations.\nMANUAL: confirm cap + close with counsel.",
  deal: "DEAL READINESS. Message: diligence-ready now, frictionless next step.\nAUTO: document statuses, timeline, contact.\nMANUAL: confirm contact + live data-room link.",
};

/* ============================================================================
 *  RENDER ENGINE  (content-agnostic below this line)
 * ========================================================================== */
const C = THEME.color, F = THEME.fonts;
const W = 13.33, H = 7.5, ML = 0.7, MR = 0.7, CW = W - ML - MR;
const shadow = () => ({ type: "outer", color: "000000", blur: 7, offset: 2, angle: 90, opacity: 0.10 });

let pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Axal VC — Spin-out Lab";
pres.title = "Spin-out Demo Day";

// icons
async function iconPng(Comp, hex, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: hex, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
let ICON = {};
async function loadIcons() {
  ICON.ingest  = await iconPng(FaDatabase, "#" + C.accent);
  ICON.score   = await iconPng(FaChartLine, "#" + C.accent);
  ICON.monitor = await iconPng(FaEye, "#" + C.accent);
  ICON.act     = await iconPng(FaBolt, "#" + C.accent);
  ICON.check   = await iconPng(FaCheck, "#" + C.white);
}

// shared primitives
function eyebrow(s, label, idx, dark) {
  s.addText(label.toUpperCase(), { x: ML, y: 0.5, w: 8, h: 0.3, margin: 0, valign: "middle",
    fontFace: F.head, fontSize: 11, bold: true, charSpacing: 3, color: C.accent });
  s.addText(`${idx} / 10`, { x: W - MR - 3, y: 0.5, w: 3, h: 0.3, margin: 0, align: "right",
    valign: "middle", fontFace: F.head, fontSize: 11, bold: true, charSpacing: 2,
    color: dark ? C.dfaint : C.faint });
}
function footer(s, dark) {
  const col = dark ? C.dfaint : C.faint;
  s.addText(DATA.brand.lab, { x: ML, y: 7.06, w: 6, h: 0.3, margin: 0, valign: "middle",
    fontFace: F.head, fontSize: 8, charSpacing: 2, color: col });
  if (!dark) s.addText(DATA.brand.footerRight, { x: W - MR - 6, y: 7.06, w: 6, h: 0.3, margin: 0,
    align: "right", valign: "middle", fontFace: F.head, fontSize: 8, charSpacing: 2, color: col });
}
function title(s, text, w) {
  s.addText(text, { x: ML, y: 1.05, w: w || 11.5, h: 0.95, margin: 0, valign: "top",
    fontFace: F.head, fontSize: 29, bold: true, color: C.ink, lineSpacingMultiple: 1.02 });
}
function panel(s, x, y, w, h, o = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: o.r || 0.08,
    fill: { color: o.fill || C.white },
    line: o.line === false ? { type: "none" } : { color: o.lineColor || C.line, width: 1 },
    shadow: o.shadow === false ? undefined : shadow() });
}
function statusDot(s, x, y, status, d = 0.22) {
  if (status === "done") {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.done }, line: { type: "none" } });
    s.addImage({ data: ICON.check, x: x + d * 0.27, y: y + d * 0.27, w: d * 0.5, h: d * 0.5 });
  } else if (status === "active") {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.active }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + d * 0.34, y: y + d * 0.34, w: d * 0.32, h: d * 0.32,
      fill: { color: C.white }, line: { type: "none" } });
  } else {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.white }, line: { color: C.faint, width: 1.5 } });
  }
}

/* ---- SLIDE 1 — COVER (dark) ---- */
function cover() {
  const d = DATA.cover, s = pres.addSlide();
  s.background = { color: C.dbg };
  s.addText(DATA.brand.lab, { x: ML, y: 0.5, w: 8, h: 0.3, margin: 0, valign: "middle",
    fontFace: F.head, fontSize: 11, bold: true, charSpacing: 3, color: C.dmuted });
  s.addText(d.eyebrowRight, { x: W - MR - 5, y: 0.5, w: 5, h: 0.3, margin: 0, align: "right",
    valign: "middle", fontFace: F.head, fontSize: 11, bold: true, charSpacing: 2, color: C.accentLt });
  s.addText(d.company, { x: ML, y: 1.95, w: 7.6, h: 0.4, margin: 0, fontFace: F.head,
    fontSize: 15, bold: true, charSpacing: 4, color: C.accentLt });
  s.addText(d.thesis, { x: ML, y: 2.45, w: 7.5, h: 2.6, margin: 0, valign: "top",
    fontFace: F.head, fontSize: 33, bold: true, color: C.white, lineSpacingMultiple: 1.05 });

  s.addText(d.signalLabel, { x: 8.7, y: 2.2, w: 4.0, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 9.5, bold: true, charSpacing: 2, color: C.dmuted });
  s.addChart(pres.charts.AREA, [{ name: "Signal", labels: d.signalX, values: d.signalY }], {
    x: 8.55, y: 2.55, w: 4.25, h: 2.5,
    chartColors: [C.accentLt], chartColorsOpacity: [30],
    chartArea: { fill: { color: C.dbg } }, plotArea: { fill: { color: C.dbg } },
    lineSize: 3, lineSmooth: true,
    showLegend: false, showTitle: false,
    catAxisLabelColor: C.dfaint, catAxisLabelFontSize: 8, catAxisLineShow: false,
    valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
    valAxisMinVal: 0, valAxisMaxVal: Math.ceil(Math.max(...d.signalY) * 1.14),
  });
  s.addText(String(d.signalY[d.signalY.length - 1]), { x: 11.85, y: 2.62, w: 0.95, h: 0.35, margin: 0,
    align: "right", fontFace: F.head, fontSize: 16, bold: true, color: C.accentLt });
  s.addText(d.signalCaption, { x: 8.55, y: 5.05, w: 4.25, h: 0.3, margin: 0, fontFace: F.body,
    fontSize: 9, italic: true, color: C.dfaint });

  d.meta.forEach((m, i) => {
    const x = ML + i * 2.95;
    s.addText(m[0], { x, y: 6.05, w: 2.6, h: 0.25, margin: 0, fontFace: F.head, fontSize: 9,
      bold: true, charSpacing: 2, color: C.dfaint });
    s.addText(m[1], { x, y: 6.32, w: 2.6, h: 0.4, margin: 0, fontFace: F.head, fontSize: 15,
      bold: true, color: C.white });
  });
  s.addNotes(NOTES.cover);
}

/* ---- SLIDE 2 — PROBLEM ---- */
function problem() {
  const d = DATA.problem, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  s.addText(d.framing, { x: ML, y: 2.15, w: 4.0, h: 1.0, margin: 0, valign: "top",
    fontFace: F.body, fontSize: 13.5, color: C.body, lineSpacingMultiple: 1.15 });
  panel(s, ML, 3.45, 4.0, 2.5, { fill: C.panel, line: false });
  s.addText("\u201C", { x: ML + 0.15, y: 3.45, w: 1, h: 0.9, margin: 0, fontFace: "Georgia",
    fontSize: 54, bold: true, color: C.accentMid });
  s.addText(d.quote, { x: ML + 0.35, y: 4.05, w: 3.35, h: 1.3, margin: 0, valign: "top",
    fontFace: F.body, fontSize: 14.5, italic: true, color: C.ink, lineSpacingMultiple: 1.12 });
  s.addText(d.quoteAttr, { x: ML + 0.35, y: 5.35, w: 3.35, h: 0.4, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 1, color: C.muted });

  const bx = 5.35, bw = 7.25;
  s.addText(d.barsLabel, { x: bx, y: 2.0, w: bw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.muted });
  let py = 2.55;
  d.pains.forEach((p, i) => {
    s.addText(p[0], { x: bx, y: py, w: bw - 1.6, h: 0.32, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 14, bold: true, color: C.ink });
    s.addText(`${p[1]}%`, { x: bx + bw - 1.6, y: py, w: 0.9, h: 0.32, margin: 0, align: "right",
      valign: "middle", fontFace: F.head, fontSize: 14, bold: true, color: i === 0 ? C.accent : C.body });
    s.addText(p[2], { x: bx + bw - 0.65, y: py, w: 0.65, h: 0.32, margin: 0, align: "right",
      valign: "middle", fontFace: F.body, fontSize: 9.5, color: C.faint });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: py + 0.4, w: bw, h: 0.17, rectRadius: 0.085,
      fill: { color: C.panel2 }, line: { type: "none" } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: py + 0.4, w: bw * (p[1] / 100), h: 0.17,
      rectRadius: 0.085, fill: { color: i === 0 ? C.accent : C.accentMid }, line: { type: "none" } });
    py += 0.92;
  });
  footer(s);
  s.addNotes(NOTES.problem);
}

/* ---- SLIDE 3 — VALIDATION ---- */
function validation() {
  const d = DATA.validation, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const cw = 2.85, gap = 0.18, cy = 1.95, ch = 1.45;
  d.cards.forEach((c, i) => {
    const x = ML + i * (cw + gap);
    panel(s, x, cy, cw, ch, { r: 0.1 });
    s.addText(c[0], { x: x + 0.25, y: cy + 0.18, w: cw - 0.5, h: 0.7, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 40, bold: true, color: C.accent });
    s.addText(c[1], { x: x + 0.25, y: cy + 0.92, w: cw - 0.5, h: 0.4, margin: 0, valign: "top",
      fontFace: F.head, fontSize: 11, color: C.muted });
  });

  s.addText(d.funnelLabel, { x: ML, y: 3.75, w: 11, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.muted });
  const maxV = Math.max(...d.stages.map(s2 => s2[1])), fx = 3.05, maxW = 7.7;
  const trans = [55, 40, 28, 16, 0];
  let fy = 4.2;
  d.stages.forEach((st, i) => {
    s.addText(st[0], { x: ML, y: fy, w: 2.25, h: 0.34, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 12, bold: true, color: C.ink });
    const w = Math.max(0.45, maxW * (st[1] / maxV));
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: fx, y: fy, w, h: 0.34, rectRadius: 0.05,
      fill: { color: C.accent, transparency: trans[Math.min(i, trans.length - 1)] }, line: { type: "none" } });
    s.addText(String(st[1]), { x: fx + w + 0.12, y: fy, w: 1.0, h: 0.34, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 12, bold: true, color: i === d.stages.length - 1 ? C.accent : C.body });
    fy += 0.5;
  });
  s.addText([
    { text: d.conversion[0], options: { bold: true, color: C.accent, fontSize: 18 } },
    { text: "  " + d.conversion[1], options: { color: C.muted, fontSize: 12 } },
  ], { x: 6.4, y: 5.72, w: 6.0, h: 0.4, margin: 0, valign: "middle", fontFace: F.head });
  footer(s);
  s.addNotes(NOTES.validation);
}

/* ---- SLIDE 4 — MARKET ---- */
function market() {
  const d = DATA.market, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const cx = 3.35, cy = 4.0, dia = [3.5, 2.4, 1.25];
  const fills = [C.panel2, C.accentSoft, C.accent];
  dia.forEach((dd, i) => {
    s.addShape(pres.shapes.OVAL, { x: cx - dd / 2, y: cy - dd / 2, w: dd, h: dd,
      fill: { color: fills[i] }, line: { color: C.white, width: 1.5 } });
  });
  s.addText(d.rings[2][1], { x: cx - 0.9, y: cy - 0.22, w: 1.8, h: 0.44, margin: 0, align: "center",
    valign: "middle", fontFace: F.head, fontSize: 15, bold: true, color: C.white });
  s.addText(d.rings[1][1], { x: cx - 0.7, y: cy - 1.05, w: 1.4, h: 0.34, margin: 0, align: "center",
    fontFace: F.head, fontSize: 13, bold: true, color: C.ink });
  s.addText(d.rings[0][1], { x: cx - 0.6, y: cy - 1.62, w: 1.2, h: 0.3, margin: 0, align: "center",
    fontFace: F.head, fontSize: 12, bold: true, color: C.body });

  let ly = 6.05;
  [2, 1, 0].forEach(idx => {
    const r = d.rings[idx], col = fills[idx];
    s.addShape(pres.shapes.OVAL, { x: ML, y: ly + 0.02, w: 0.16, h: 0.16, fill: { color: col },
      line: col === C.panel2 ? { color: C.line, width: 1 } : { type: "none" } });
    s.addText([
      { text: `${r[0]}  `, options: { bold: true, color: C.ink, fontSize: 11 } },
      { text: `${r[1]}  `, options: { bold: true, color: C.accent, fontSize: 11 } },
      { text: r[2], options: { color: C.muted, fontSize: 10 } },
    ], { x: ML + 0.28, y: ly - 0.06, w: 5.6, h: 0.3, margin: 0, valign: "middle", fontFace: F.head });
    ly += 0.34;
  });

  const wx = 7.05, ww = 5.55;
  s.addText(d.whyNowLabel, { x: wx, y: 2.0, w: ww, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 11, bold: true, charSpacing: 2, color: C.accent });
  let yy = 2.5;
  d.why.forEach((q, i) => {
    s.addText(String(i + 1).padStart(2, "0"), { x: wx, y: yy, w: 0.6, h: 0.5, margin: 0, valign: "top",
      fontFace: F.head, fontSize: 18, bold: true, color: C.accentMid });
    s.addText(q[0], { x: wx + 0.65, y: yy, w: ww - 0.65, h: 0.35, margin: 0, valign: "top",
      fontFace: F.head, fontSize: 14.5, bold: true, color: C.ink });
    s.addText(q[1], { x: wx + 0.65, y: yy + 0.36, w: ww - 0.65, h: 0.7, margin: 0, valign: "top",
      fontFace: F.body, fontSize: 11.5, color: C.body, lineSpacingMultiple: 1.12 });
    yy += 1.18;
  });
  s.addText(d.assumptions, { x: wx, y: 6.05, w: ww, h: 0.6, margin: 0, valign: "top",
    fontFace: F.body, fontSize: 9.5, italic: true, color: C.muted, lineSpacingMultiple: 1.1 });
  footer(s);
  s.addNotes(NOTES.market);
}

/* ---- SLIDE 5 — SOLUTION ---- */
function solution() {
  const d = DATA.solution, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const n = d.steps.length, gap = 0.4, cw = (CW - (n - 1) * gap) / n, cy = 2.2, ch = 2.3;
  d.steps.forEach((st, i) => {
    const x = ML + i * (cw + gap);
    panel(s, x, cy, cw, ch, { r: 0.1 });
    s.addShape(pres.shapes.OVAL, { x: x + 0.28, y: cy + 0.3, w: 0.72, h: 0.72,
      fill: { color: C.accentSoft }, line: { type: "none" } });
    s.addImage({ data: ICON[st[0]], x: x + 0.46, y: cy + 0.48, w: 0.36, h: 0.36 });
    s.addText(`0${i + 1}`, { x: x + cw - 0.85, y: cy + 0.3, w: 0.6, h: 0.4, margin: 0, align: "right",
      fontFace: F.head, fontSize: 13, bold: true, color: C.faint });
    s.addText(st[1], { x: x + 0.28, y: cy + 1.15, w: cw - 0.5, h: 0.4, margin: 0, fontFace: F.head,
      fontSize: 17, bold: true, color: C.ink });
    s.addText(st[2], { x: x + 0.28, y: cy + 1.55, w: cw - 0.5, h: 0.65, margin: 0, valign: "top",
      fontFace: F.body, fontSize: 11, color: C.body, lineSpacingMultiple: 1.12 });
    if (i < n - 1) s.addText("\u2192", { x: x + cw + 0.02, y: cy + 0.85, w: gap - 0.04, h: 0.5,
      margin: 0, align: "center", valign: "middle", fontFace: F.head, fontSize: 20, color: C.accentMid });
  });

  s.addText(d.outcomeLabel, { x: ML, y: 4.85, w: 4, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.accent });
  const ow = 3.85, og = 0.19, oy = 5.2;
  d.outcomes.forEach((o, i) => {
    const x = ML + i * (ow + og);
    panel(s, x, oy, ow, 1.15, { fill: C.panel, line: false });
    s.addText(o[0], { x: x + 0.28, y: oy + 0.15, w: ow - 0.5, h: 0.55, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 26, bold: true, color: C.ink });
    s.addText(o[1], { x: x + 0.28, y: oy + 0.7, w: ow - 0.5, h: 0.38, margin: 0, valign: "top",
      fontFace: F.body, fontSize: 11, color: C.body });
  });
  footer(s);
  s.addNotes(NOTES.solution);
}

/* ---- SLIDE 6 — ROADMAP ---- */
function roadmap() {
  const d = DATA.roadmap, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const railY = 2.2, x0 = ML + 0.1, x1 = W - MR - 0.1;
  s.addShape(pres.shapes.LINE, { x: x0, y: railY, w: x1 - x0, h: 0, line: { color: C.line, width: 1.5 } });
  d.days.forEach((day, i) => {
    const x = x0 + (x1 - x0) * (i / (d.days.length - 1)), now = i === d.currentDay;
    s.addShape(pres.shapes.OVAL, { x: x - 0.07, y: railY - 0.07, w: 0.14, h: 0.14,
      fill: { color: now ? C.accent : C.faint }, line: { type: "none" } });
    s.addText(day + (now ? "  ·  today" : ""), { x: x - 1, y: railY + 0.12, w: 2, h: 0.25, margin: 0,
      align: "center", fontFace: F.head, fontSize: 9.5, bold: true, color: now ? C.accent : C.muted });
  });

  const colW = 3.77, colGap = 0.31, colY = 2.85, colH = 3.55;
  d.phases.forEach((p, i) => {
    const x = ML + i * (colW + colGap);
    panel(s, x, colY, colW, colH, { r: 0.1, fill: i === 0 ? C.accentSoft : C.panel, line: false });
    s.addText(p[0], { x: x + 0.3, y: colY + 0.28, w: colW - 0.6, h: 0.4, margin: 0, fontFace: F.head,
      fontSize: 16, bold: true, charSpacing: 1, color: i === 0 ? C.accent : C.ink });
    s.addText(p[1], { x: x + 0.3, y: colY + 0.68, w: colW - 0.6, h: 0.3, margin: 0, fontFace: F.head,
      fontSize: 11, bold: true, color: C.muted });
    let iy = colY + 1.2;
    p[2].forEach(m => {
      statusDot(s, x + 0.3, iy + 0.02, m[0]);
      s.addText(m[1], { x: x + 0.64, y: iy - 0.04, w: colW - 0.94, h: 0.55, margin: 0, valign: "top",
        fontFace: F.body, fontSize: 11.5, color: C.ink, lineSpacingMultiple: 1.05 });
      iy += 0.72;
    });
  });
  s.addText([
    { text: "\u25CF ", options: { color: C.done, fontSize: 11 } },
    { text: "Done    ", options: { color: C.muted, fontSize: 10 } },
    { text: "\u25CF ", options: { color: C.active, fontSize: 11 } },
    { text: "In progress    ", options: { color: C.muted, fontSize: 10 } },
    { text: "\u25CB ", options: { color: C.pending, fontSize: 11 } },
    { text: "Planned", options: { color: C.muted, fontSize: 10 } },
  ], { x: ML, y: 6.55, w: 11, h: 0.3, margin: 0, valign: "middle", fontFace: F.head });
  footer(s);
  s.addNotes(NOTES.roadmap);
}

/* ---- SLIDE 7 — TEAM / NETWORK ---- */
function team() {
  const d = DATA.team, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const lx = ML, lw = 4.7;
  panel(s, lx, 2.0, lw, 2.0, { r: 0.1 });
  s.addShape(pres.shapes.OVAL, { x: lx + 0.3, y: 2.3, w: 1.05, h: 1.05, fill: { color: C.accent }, line: { type: "none" } });
  s.addText(d.founder.initials, { x: lx + 0.3, y: 2.3, w: 1.05, h: 1.05, margin: 0, align: "center",
    valign: "middle", fontFace: F.head, fontSize: 24, bold: true, color: C.white });
  s.addText(d.founder.name, { x: lx + 1.55, y: 2.32, w: lw - 1.8, h: 0.4, margin: 0, fontFace: F.head,
    fontSize: 19, bold: true, color: C.ink });
  s.addText(d.founder.role, { x: lx + 1.55, y: 2.72, w: lw - 1.8, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 12, bold: true, color: C.accent });
  s.addText(d.founder.bio, { x: lx + 0.3, y: 3.45, w: lw - 0.6, h: 0.5, margin: 0, valign: "top",
    fontFace: F.body, fontSize: 11.5, color: C.body, lineSpacingMultiple: 1.1 });

  s.addText(d.advisorsLabel, { x: lx, y: 4.25, w: lw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.muted });
  let ay = 4.62;
  d.advisors.forEach(a => {
    s.addShape(pres.shapes.OVAL, { x: lx, y: ay, w: 0.5, h: 0.5, fill: { color: C.panel2 }, line: { type: "none" } });
    s.addText(a[0], { x: lx, y: ay, w: 0.5, h: 0.5, margin: 0, align: "center", valign: "middle",
      fontFace: F.head, fontSize: 11, bold: true, color: C.body });
    s.addText([
      { text: a[1] + "   ", options: { bold: true, color: C.ink, fontSize: 12.5 } },
      { text: a[2], options: { color: C.muted, fontSize: 11 } },
    ], { x: lx + 0.65, y: ay, w: lw - 0.65, h: 0.5, margin: 0, valign: "middle", fontFace: F.head });
    ay += 0.62;
  });

  const cX = 9.35, cY = 4.15, nw = 2.2, nh = 0.92;
  d.nodes.forEach(nd => {
    s.addShape(pres.shapes.LINE, { x: Math.min(cX, nd[0]), y: Math.min(cY, nd[1]),
      w: Math.abs(nd[0] - cX), h: Math.abs(nd[1] - cY), line: { color: C.accentMid, width: 1.5 } });
  });
  d.nodes.forEach(nd => {
    panel(s, nd[0] - nw / 2, nd[1] - nh / 2, nw, nh, { r: 0.1 });
    s.addText(nd[2], { x: nd[0] - nw / 2 + 0.1, y: nd[1] - nh / 2 + 0.13, w: nw - 0.2, h: 0.32, margin: 0,
      align: "center", fontFace: F.head, fontSize: 12.5, bold: true, color: C.ink });
    s.addText(nd[3], { x: nd[0] - nw / 2 + 0.1, y: nd[1] - nh / 2 + 0.48, w: nw - 0.2, h: 0.3, margin: 0,
      align: "center", fontFace: F.body, fontSize: 10, color: C.muted });
  });
  s.addShape(pres.shapes.OVAL, { x: cX - 1.0, y: cY - 0.55, w: 2.0, h: 1.1, fill: { color: C.accent },
    line: { type: "none" }, shadow: shadow() });
  s.addText(d.centerName, { x: cX - 1.0, y: cY - 0.55, w: 2.0, h: 1.1, margin: 0, align: "center",
    valign: "middle", fontFace: F.head, fontSize: 16, bold: true, color: C.white });
  footer(s);
  s.addNotes(NOTES.team);
}

/* ---- SLIDE 8 — CAP TABLE ---- */
function captable() {
  const d = DATA.captable, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const lx = ML, lw = 6.5;
  s.addText(d.checklistLabel, { x: lx, y: 2.0, w: lw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.muted });
  let iy = 2.5;
  d.items.forEach(it => {
    const done = it[1] === "done";
    panel(s, lx, iy, lw, 0.5, { r: 0.06, fill: C.panel, line: false, shadow: false });
    statusDot(s, lx + 0.18, iy + 0.13, it[1], 0.24);
    s.addText(it[0], { x: lx + 0.6, y: iy, w: lw - 2.1, h: 0.5, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 13, bold: true, color: C.ink });
    s.addText(done ? "Done" : "In progress", { x: lx + lw - 1.5, y: iy, w: 1.35, h: 0.5, margin: 0,
      align: "right", valign: "middle", fontFace: F.head, fontSize: 11, bold: true,
      color: done ? C.done : C.active });
    iy += 0.6;
  });

  const rx = 7.55, rw = 5.05;
  s.addText(d.donutLabel, { x: rx, y: 2.0, w: rw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.muted });
  const donutColors = [C.accent, C.accentMid, C.panel2];
  s.addChart(pres.charts.DOUGHNUT, [{
    name: "Cap table", labels: d.segments.map(x => x[0]), values: d.segments.map(x => x[1]),
  }], {
    x: rx + 0.55, y: 2.5, w: 3.9, h: 3.0, holeSize: 62,
    chartColors: donutColors, showLegend: false, showValue: false,
    dataBorder: { pt: 2, color: C.white },
  });
  // center label (centered on donut hole)
  s.addText([
    { text: d.centerBig, options: { bold: true, fontSize: 22, color: C.ink, breakLine: true } },
    { text: d.centerSmall, options: { fontSize: 10, color: C.muted } },
  ], { x: rx + 1.6, y: 3.62, w: 1.8, h: 0.78, margin: 0, align: "center", valign: "middle", fontFace: F.head });
  let cy2 = 5.75;
  d.segments.forEach((l, i) => {
    s.addShape(pres.shapes.OVAL, { x: rx + 0.55, y: cy2 + 0.02, w: 0.16, h: 0.16, fill: { color: donutColors[i] },
      line: donutColors[i] === C.panel2 ? { color: C.line, width: 1 } : { type: "none" } });
    s.addText([
      { text: l[0] + "   ", options: { color: C.ink, fontSize: 11, bold: true } },
      { text: l[1] + "%", options: { color: C.muted, fontSize: 11 } },
    ], { x: rx + 0.8, y: cy2 - 0.05, w: rw - 0.8, h: 0.28, margin: 0, valign: "middle", fontFace: F.head });
    cy2 += 0.3;
  });
  footer(s);
  s.addNotes(NOTES.captable);
}

/* ---- SLIDE 9 — ASK ---- */
function ask() {
  const d = DATA.ask, s = pres.addSlide();
  s.background = { color: C.white };
  eyebrow(s, d.eyebrow, d.idx);
  title(s, d.title);

  const kw = 2.85, kh = 1.7, kgx = 0.3, kgy = 0.3, kx0 = ML, ky0 = 2.2;
  d.kpis.forEach((k, i) => {
    const x = kx0 + (i % 2) * (kw + kgx), y = ky0 + Math.floor(i / 2) * (kh + kgy);
    panel(s, x, y, kw, kh, { r: 0.1 });
    s.addText(k[0], { x: x + 0.28, y: y + 0.3, w: kw - 0.5, h: 0.75, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 33, bold: true, color: C.accent });
    s.addText(k[1], { x: x + 0.28, y: y + 1.05, w: kw - 0.5, h: 0.45, margin: 0, valign: "top",
      fontFace: F.head, fontSize: 12, color: C.muted });
  });

  const ux = 6.95, uw = 5.65;
  s.addText(d.useLabel, { x: ux, y: 2.0, w: uw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.muted });
  let fy = 2.55;
  d.funds.forEach((f, i) => {
    s.addText(f[0], { x: ux, y: fy, w: uw - 0.9, h: 0.3, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 13, bold: true, color: C.ink });
    s.addText(`${f[1]}%`, { x: ux + uw - 0.9, y: fy, w: 0.9, h: 0.3, margin: 0, align: "right",
      valign: "middle", fontFace: F.head, fontSize: 13, bold: true, color: i === 0 ? C.accent : C.body });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ux, y: fy + 0.36, w: uw, h: 0.17, rectRadius: 0.085,
      fill: { color: C.panel2 }, line: { type: "none" } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ux, y: fy + 0.36, w: uw * (f[1] / 100), h: 0.17,
      rectRadius: 0.085, fill: { color: i === 0 ? C.accent : C.accentMid }, line: { type: "none" } });
    fy += 0.82;
  });
  panel(s, ux, 6.0, uw, 0.7, { fill: C.accentSoft, line: false, shadow: false });
  s.addText([
    { text: d.milestone[0] + "  ", options: { bold: true, color: C.accent, fontSize: 12 } },
    { text: d.milestone[1], options: { color: C.ink, fontSize: 12 } },
  ], { x: ux + 0.25, y: 6.0, w: uw - 0.5, h: 0.7, margin: 0, valign: "middle", fontFace: F.head });
  footer(s);
  s.addNotes(NOTES.ask);
}

/* ---- SLIDE 10 — DEAL READINESS (dark) ---- */
function deal() {
  const d = DATA.deal, s = pres.addSlide();
  s.background = { color: C.dbg };
  eyebrow(s, d.eyebrow, d.idx, true);
  s.addText(d.title, { x: ML, y: 1.05, w: 11.5, h: 0.95, margin: 0, valign: "top",
    fontFace: F.head, fontSize: 30, bold: true, color: C.white });

  const lx = ML, lw = 6.0;
  s.addText(d.diligenceLabel, { x: lx, y: 2.15, w: lw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.accentLt });
  let ry = 2.6;
  d.ready.forEach(r => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: lx, y: ry, w: lw, h: 0.55, rectRadius: 0.06,
      fill: { color: C.dpanel }, line: { color: C.dline, width: 1 } });
    s.addShape(pres.shapes.OVAL, { x: lx + 0.22, y: ry + 0.185, w: 0.18, h: 0.18,
      fill: { color: C.accentLt }, line: { type: "none" } });
    s.addText(r[0], { x: lx + 0.6, y: ry, w: lw - 2.3, h: 0.55, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 13, bold: true, color: C.white });
    s.addText(r[1], { x: lx + lw - 1.85, y: ry, w: 1.7, h: 0.55, margin: 0, align: "right",
      valign: "middle", fontFace: F.head, fontSize: 12, bold: true, color: C.dmuted });
    ry += 0.66;
  });

  const rx = 7.35, rw = 5.25;
  s.addText(d.nextLabel, { x: rx, y: 2.15, w: rw, h: 0.3, margin: 0, fontFace: F.head,
    fontSize: 10, bold: true, charSpacing: 2, color: C.accentLt });
  let sy = 2.6;
  d.steps.forEach(st => {
    s.addShape(pres.shapes.OVAL, { x: rx, y: sy, w: 0.5, h: 0.5, fill: { color: C.accent }, line: { type: "none" } });
    s.addText(st[0], { x: rx, y: sy, w: 0.5, h: 0.5, margin: 0, align: "center", valign: "middle",
      fontFace: F.head, fontSize: 16, bold: true, color: C.white });
    s.addText(st[1], { x: rx + 0.7, y: sy, w: rw - 0.7, h: 0.5, margin: 0, valign: "middle",
      fontFace: F.head, fontSize: 14, bold: true, color: C.white });
    sy += 0.85;
  });
  s.addShape(pres.shapes.LINE, { x: rx, y: 5.55, w: rw, h: 0, line: { color: C.dline, width: 1 } });
  s.addText(d.closingLine, { x: rx, y: 5.7, w: rw, h: 0.5, margin: 0, valign: "top",
    fontFace: F.head, fontSize: 15, bold: true, color: C.white });
  s.addText(d.contact, { x: rx, y: 6.2, w: rw, h: 0.4, margin: 0, valign: "top",
    fontFace: F.body, fontSize: 12, color: C.accentLt });
  s.addText(DATA.brand.lab, { x: ML, y: 7.06, w: 6, h: 0.3, margin: 0, valign: "middle",
    fontFace: F.head, fontSize: 8, charSpacing: 2, color: C.dfaint });
  s.addNotes(NOTES.deal);
}

/* ---- BUILD ---- */
(async () => {
  await loadIcons();
  cover(); problem(); validation(); market(); solution();
  roadmap(); team(); captable(); ask(); deal();
  await pres.writeFile({ fileName: "/home/claude/" + THEME.fileName });
  console.log("written:", THEME.fileName);
})();
