#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const PAGE = { w: 884, h: 978 };
const BLUE = [12, 51, 150];
const GREEN = [24, 110, 64];
const RED = [190, 62, 55];
const BLACK = [15, 16, 20];
const GRAY = [110, 110, 116];

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function loadInput(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  required(data.date, "date");
  required(data.analyst, "analyst");
  required(data.market?.indexes?.length, "market.indexes");
  required(data.market?.assets?.length, "market.assets");
  required(data.earnings?.beats?.length, "earnings.beats");
  required(data.earnings?.misses?.length, "earnings.misses");
  required(data.themes?.length, "themes");
  return data;
}

function esc(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/—/g, "-")
    .replace(/·/g, "-");
}

function rgb(c) {
  return `${(c[0] / 255).toFixed(3)} ${(c[1] / 255).toFixed(3)} ${(c[2] / 255).toFixed(3)}`;
}

class Pdf {
  constructor() {
    this.ops = [];
  }

  y(y) {
    return PAGE.h - y;
  }

  color(c) {
    this.ops.push(`${rgb(c)} rg ${rgb(c)} RG`);
  }

  text(x, y, text, size = 10, font = "F1", color = BLACK) {
    this.color(color);
    this.ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${this.y(y).toFixed(2)} Tm (${esc(text)}) Tj ET`);
  }

  line(x1, y1, x2, y2, color = [210, 210, 210], width = 1) {
    this.color(color);
    this.ops.push(`${width} w ${x1} ${this.y(y1).toFixed(2)} m ${x2} ${this.y(y2).toFixed(2)} l S`);
  }

  rect(x, y, w, h, color) {
    this.color(color);
    this.ops.push(`${x} ${this.y(y + h).toFixed(2)} ${w} ${h} re f`);
  }

  wrap(text, maxChars) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  para(x, y, text, maxChars, size = 11, leading = 15, font = "F1", color = BLACK) {
    let yy = y;
    for (const line of this.wrap(text, maxChars)) {
      this.text(x, yy, line, size, font, color);
      yy += leading;
    }
    return yy;
  }

  save(file) {
    const content = this.ops.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>",
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, pdf);
  }
}

function isNegative(text) {
  return String(text).trim().startsWith("-");
}

function marketTable(pdf, x, y, w, title, headers, rows, cols) {
  pdf.text(x, y, title, 16, "F2", BLUE);
  pdf.line(x, y + 14, x + w, y + 14, [185, 185, 185], 1.2);
  let yy = y + 33;
  headers.forEach((h, i) => pdf.text(x + cols[i], yy, h, 10, "F2"));
  yy += 24;
  for (const row of rows) {
    row.forEach((cell, i) => {
      let color = BLACK;
      if (i >= 2) color = isNegative(cell) ? RED : GREEN;
      pdf.text(x + cols[i], yy, cell, 10.2, i === 0 ? "F2" : "F1", color);
    });
    yy += 25;
  }
}

function earningsTable(pdf, x, y, rows) {
  const cols = [0, 48, 114, 171, 236];
  ["TICKER", "COMPANY", "PRICE", "1D MOVE", "COMMENTARY"].forEach((h, i) => pdf.text(x + cols[i], y, h, 8.2, "F2"));
  let yy = y + 28;
  for (const row of rows.slice(0, 5)) {
    pdf.text(x + cols[0], yy, row[0], 8.5, "F2");
    pdf.text(x + cols[1], yy, row[1], 8.5);
    pdf.text(x + cols[2], yy, row[2], 8.5);
    pdf.text(x + cols[3], yy, row[3], 8.5, "F2", isNegative(row[3]) ? RED : GREEN);
    pdf.wrap(row[4], 49).slice(0, 3).forEach((line, j) => pdf.text(x + cols[4], yy + j * 11, line, 6.6));
    yy += 43;
  }
}

function render(data, output) {
  const pdf = new Pdf();
  pdf.rect(0, 0, PAGE.w, PAGE.h, [253, 253, 253]);
  pdf.text(26, 41, "MORNING BRIEFING", 10.5, "F2");
  pdf.text(26, 78, "US Equity Morning Note", 29, "F2");
  pdf.text(26, 108, "Equity Research - Data: Yahoo Finance - Prices in USD", 10.5);
  pdf.text(26, 125, data.date, 10.5, "F2");
  pdf.text(26, 142, data.subtitle || "Live snapshot - delayed quotes where applicable", 10.5);
  pdf.text(815, 54, "Market opens", 10.5, "F2");
  pdf.text(815, 71, "09:30 ET", 12, "F2");
  pdf.text(786, 138, `Analyst: ${data.analyst}`, 10.5, "F2");

  marketTable(pdf, 24, 178, 402, "Market Snapshot", ["INDEX", "CLOSE", "1D", "1W", "YTD"], data.market.indexes, [0, 126, 215, 291, 366]);
  marketTable(pdf, 442, 178, 420, " ", ["ASSET / RATE", "LAST", "1D", "1W", "YTD"], data.market.assets, [15, 147, 230, 307, 383]);

  pdf.line(24, 336, 860, 336, [235, 235, 235], 0.7);
  pdf.para(24, 358, data.tone, 132, 12.2, 17.5, "F2");
  pdf.line(24, 442, 860, 442, [185, 185, 185], 1.2);

  pdf.text(24, 465, "Overnight Earnings Reactions", 16, "F2", BLUE);
  pdf.text(24, 497, "Beats / Positive Reactions", 10.5, "F2", GREEN);
  earningsTable(pdf, 24, 523, data.earnings.beats);
  pdf.text(24, 736, "Misses / Negative Reactions", 10.5, "F2", RED);
  earningsTable(pdf, 24, 762, data.earnings.misses);

  pdf.line(426, 442, 426, 950, [235, 235, 235], 0.8);
  pdf.text(442, 465, "Sector Themes & Read-Throughs", 16, "F2", BLUE);
  let y = 501;
  data.themes.slice(0, 5).forEach((theme, i) => {
    pdf.rect(441, y - 12, 16, 16, BLUE);
    pdf.text(447, y, String(i + 1), 9, "F2", [255, 255, 255]);
    const dot = theme.indexOf(".");
    pdf.text(464, y, theme.slice(0, dot + 1), 11.7, "F2");
    y = pdf.para(464, y + 16, theme.slice(dot + 2), 62, 11.7, 15.1);
    y += 14;
  });

  pdf.text(24, 957, data.sourceNote || "Market snapshot: Yahoo Finance. Earnings movers: public overnight movers; delayed quotes where applicable.", 7.5, "F3", GRAY);
  pdf.save(output);
}

const input = path.resolve(arg("data", "examples/leo-live-2026-05-06.json"));
const output = path.resolve(arg("out", "output/US_Market_Morning_Call.pdf"));
render(loadInput(input), output);
console.log(output);
