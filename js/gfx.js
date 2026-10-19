'use strict';
/*
 * Grafik: alle Felder und Gebäude werden prozedural im Pixel-Stil gezeichnet
 * (16x16 Pixel pro Feld wie im Original) und zwischengespeichert.
 */

const TS = 16;

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function srng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
}

const PAL = {
  dirt: '#9a6b3c', dirtD: '#86592f', dirtL: '#ad7d4b',
  water: '#2d5fcf', waterD: '#244fb4', waterL: '#5a86ea', foam: '#a9c6ff', sand: '#c8a868',
  tree: '#2f7d32', treeD: '#1d5520', treeL: '#4fa64f',
  grass: '#5aa845', grassD: '#47903a', grassL: '#79c25a',
  asphalt: '#6c6c6c', asphaltD: '#555555', line: '#e8e8d8',
  ballast: '#8e8270', tie: '#5a3a1e', railc: '#d8d8d8',
  pole: '#5a3a1e', wire: '#1a1a1a',
  rubble: '#7d7468', rubbleD: '#5c544a', rubbleL: '#a39a8c',
};

const GFX = {
  cache: new Map(),

  get(key, w, h, draw) {
    let c = this.cache.get(key);
    if (!c) {
      c = mkCanvas(w, h);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      draw(g, c);
      this.cache.set(key, c);
    }
    return c;
  },

  // ---------------- Grundflächen ----------------
  dirt(g, seed, ox, oy, w, h) {
    ox = ox || 0; oy = oy || 0; w = w || TS; h = h || TS;
    g.fillStyle = PAL.dirt; g.fillRect(ox, oy, w, h);
    const r = srng(seed * 7 + 3);
    const n = (w * h) / 18;
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() < 0.5 ? PAL.dirtD : PAL.dirtL;
      g.fillRect(ox + Math.floor(r() * w), oy + Math.floor(r() * h), 1, 1);
    }
  },

  grass(g, seed, ox, oy, w, h, base) {
    g.fillStyle = base || PAL.grass; g.fillRect(ox, oy, w, h);
    const r = srng(seed * 13 + 1);
    for (let i = 0; i < (w * h) / 14; i++) {
      g.fillStyle = r() < 0.5 ? PAL.grassD : PAL.grassL;
      g.fillRect(ox + Math.floor(r() * w), oy + Math.floor(r() * h), 1, 1);
    }
  },

  waterBase(g, frame) {
    g.fillStyle = PAL.water; g.fillRect(0, 0, TS, TS);
    g.fillStyle = PAL.waterD;
    for (let y = 1; y < TS; y += 4) g.fillRect(0, y, TS, 1);
    g.fillStyle = PAL.waterL;
    for (let y = 0; y < 4; y++) {
      const yy = y * 4 + 2;
      const xx = (y * 5 + frame * 2) % TS;
      g.fillRect(xx, yy, 3, 1);
      g.fillRect((xx + 8) % TS, yy, 2, 1);
    }
  },

  tileDirt(v) { return this.get('dirt' + v, TS, TS, g => this.dirt(g, v + 1)); },

  tileWater(mask, frame) {
    // mask: Bit gesetzt = Land auf dieser Seite (N,O,S,W)
    return this.get('w' + mask + '_' + frame, TS, TS, g => {
      this.waterBase(g, frame);
      g.fillStyle = PAL.sand;
      if (mask & 1) g.fillRect(0, 0, TS, 2);
      if (mask & 2) g.fillRect(TS - 2, 0, 2, TS);
      if (mask & 4) g.fillRect(0, TS - 2, TS, 2);
      if (mask & 8) g.fillRect(0, 0, 2, TS);
      g.fillStyle = PAL.foam;
      const f = frame & 1;
      if (mask & 1) for (let x = f; x < TS; x += 3) g.fillRect(x, 2, 1, 1);
      if (mask & 2) for (let y = f; y < TS; y += 3) g.fillRect(TS - 3, y, 1, 1);
      if (mask & 4) for (let x = f; x < TS; x += 3) g.fillRect(x, TS - 3, 1, 1);
      if (mask & 8) for (let y = f; y < TS; y += 3) g.fillRect(2, y, 1, 1);
    });
  },

  treeBlob(g, x, y, r, rr) {
    g.fillStyle = PAL.treeD;
    g.beginPath(); g.arc(x + 1, y + 1, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.tree;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.treeL;
    g.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), Math.max(1, Math.round(r / 2)), 1);
    void rr;
  },

  tileTrees(v, dense) {
    return this.get('t' + v + (dense ? 'd' : ''), TS, TS, g => {
      const r = srng(v * 31 + (dense ? 7 : 0) + 5);
      if (dense) { g.fillStyle = PAL.treeD; g.fillRect(0, 0, TS, TS); }
      else this.dirt(g, v + 11);
      const n = dense ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const x = 2 + r() * 12, y = 2 + r() * 12;
        this.treeBlob(g, x, y, dense ? 3.2 + r() * 1.3 : 2.4 + r() * 1.3, r);
      }
    });
  },

  tileRubble(v) {
    return this.get('rb' + v, TS, TS, g => {
      this.dirt(g, v + 21);
      const r = srng(v * 17 + 9);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = [PAL.rubble, PAL.rubbleD, PAL.rubbleL][Math.floor(r() * 3)];
        g.fillRect(Math.floor(r() * 14), Math.floor(r() * 14), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 2));
      }
    });
  },

  tileFire(frame) {
    return this.get('fire' + frame, TS, TS, g => {
      g.fillStyle = '#3a2412'; g.fillRect(0, 0, TS, TS);
      const r = srng(frame * 97 + 3);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = PAL.rubbleD; g.fillRect(Math.floor(r() * 14), Math.floor(r() * 14), 2, 2);
      }
      const cols = ['#c81e00', '#ff5a00', '#ffa800', '#ffe060'];
      for (let i = 0; i < 5; i++) {
        const x = 1 + Math.floor(r() * 12), h = 6 + Math.floor(r() * 8), w = 3 + Math.floor(r() * 2);
        for (let c = 0; c < 4; c++) {
          g.fillStyle = cols[c];
          const ww = Math.max(1, w - c), hh = Math.max(1, h - c * 2);
          g.fillRect(x + Math.floor(c / 2), TS - hh - 1, ww, hh);
        }
      }
    });
  },

  tileFlood(frame) {
    return this.get('flood' + frame, TS, TS, g => {
      this.waterBase(g, frame);
      g.globalAlpha = 0.45;
      this.dirt(g, 77);
      g.globalAlpha = 1;
      g.fillStyle = PAL.waterL;
      for (let i = 0; i < 4; i++) g.fillRect((i * 5 + frame * 3) % 14, i * 4 + 1, 3, 1);
    });
  },

  tileRad() {
    return this.get('rad', TS, TS, g => {
      this.dirt(g, 55);
      g.fillStyle = 'rgba(190,255,0,0.35)'; g.fillRect(0, 0, TS, TS);
      g.fillStyle = '#ffd800'; g.beginPath(); g.arc(8, 8, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111';
      for (let a = 0; a < 3; a++) {
        g.beginPath(); g.moveTo(8, 8);
        g.arc(8, 8, 4.5, a * 2.094 - 0.5, a * 2.094 + 0.5); g.fill();
      }
      g.fillStyle = '#ffd800'; g.beginPath(); g.arc(8, 8, 1.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.fillRect(7, 7, 2, 2);
    });
  },

  tilePark(v) {
    return this.get('park' + v, TS, TS, g => {
      this.grass(g, v + 40, 0, 0, TS, TS);
      if (v === 4) { // Brunnen
        g.fillStyle = '#b0b0b0'; g.beginPath(); g.arc(8, 8, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4a86f0'; g.beginPath(); g.arc(8, 8, 4.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#d8e8ff'; g.fillRect(7, 5, 2, 5); g.fillRect(5, 7, 6, 2);
        return;
      }
      const r = srng(v * 7 + 70);
      g.fillStyle = '#c8b890';
      if (v === 1) { g.fillRect(0, 7, TS, 2); }
      else if (v === 2) { g.fillRect(7, 0, 2, TS); }
      for (let i = 0; i < 3; i++) this.treeBlob(g, 3 + r() * 10, 3 + r() * 10, 2.2, r);
      g.fillStyle = '#e04080'; g.fillRect(Math.floor(r() * 14), Math.floor(r() * 14), 1, 1);
      g.fillStyle = '#ffe040'; g.fillRect(Math.floor(r() * 14), Math.floor(r() * 14), 1, 1);
    });
  },

  // ---------------- Verkehrswege ----------------
  // Asphalt-Arme vom Zentrum in Richtung der Maske
  drawRoadArms(g, mask) {
    if (mask === 0) mask = 10;
    const a = 3, b = 13;  // Straßenbreite 10 px
    g.fillStyle = PAL.asphaltD;
    g.fillRect(a - 1, a - 1, b - a + 2, b - a + 2);
    if (mask & 1) g.fillRect(a - 1, 0, b - a + 2, a);
    if (mask & 4) g.fillRect(a - 1, b, b - a + 2, TS - b);
    if (mask & 8) g.fillRect(0, a - 1, a, b - a + 2);
    if (mask & 2) g.fillRect(b, a - 1, TS - b, b - a + 2);
    g.fillStyle = PAL.asphalt;
    g.fillRect(a, a, b - a, b - a);
    if (mask & 1) g.fillRect(a, 0, b - a, a);
    if (mask & 4) g.fillRect(a, b, b - a, TS - b);
    if (mask & 8) g.fillRect(0, a, a, b - a);
    if (mask & 2) g.fillRect(b, a, TS - b, b - a);
    // Mittellinie
    g.fillStyle = PAL.line;
    const straightH = mask === 10 || mask === 2 || mask === 8;
    const straightV = mask === 5 || mask === 1 || mask === 4;
    if (straightH) for (let x = 1; x < TS; x += 4) g.fillRect(x, 7, 2, 1);
    if (straightV) for (let y = 1; y < TS; y += 4) g.fillRect(7, y, 1, 2);
    if (!straightH && !straightV) {
      if (mask & 1) g.fillRect(7, 0, 1, 2);
      if (mask & 4) g.fillRect(7, 14, 1, 2);
      if (mask & 8) g.fillRect(0, 7, 2, 1);
      if (mask & 2) g.fillRect(14, 7, 2, 1);
    }
  },

  tileRoad(mask) {
    return this.get('road' + mask, TS, TS, g => { this.dirt(g, 90 + mask); this.drawRoadArms(g, mask); });
  },

  drawRailArms(g, mask) {
    if (mask === 0) mask = 10;
    const horiz = (mask & 10) !== 0, vert = (mask & 5) !== 0;
    g.fillStyle = PAL.ballast;
    if (mask & 1) g.fillRect(4, 0, 8, 8);
    if (mask & 4) g.fillRect(4, 8, 8, 8);
    if (mask & 8) g.fillRect(0, 4, 8, 8);
    if (mask & 2) g.fillRect(8, 4, 8, 8);
    g.fillRect(4, 4, 8, 8);
    g.fillStyle = PAL.tie;
    if (mask & 8 || mask & 2) {
      const x0 = mask & 8 ? 0 : 6, x1 = mask & 2 ? 16 : 10;
      for (let x = x0 + 1; x < x1; x += 3) g.fillRect(x, 4, 2, 8);
    }
    if (mask & 1 || mask & 4) {
      const y0 = mask & 1 ? 0 : 6, y1 = mask & 4 ? 16 : 10;
      for (let y = y0 + 1; y < y1; y += 3) g.fillRect(4, y, 8, 2);
    }
    g.fillStyle = PAL.railc;
    if (mask & 8) { g.fillRect(0, 5, 8, 1); g.fillRect(0, 10, 8, 1); }
    if (mask & 2) { g.fillRect(8, 5, 8, 1); g.fillRect(8, 10, 8, 1); }
    if (mask & 1) { g.fillRect(5, 0, 1, 8); g.fillRect(10, 0, 1, 8); }
    if (mask & 4) { g.fillRect(5, 8, 1, 8); g.fillRect(10, 8, 1, 8); }
    if (horiz && vert) { g.fillRect(5, 5, 6, 1); g.fillRect(5, 10, 6, 1); g.fillRect(5, 5, 1, 6); g.fillRect(10, 5, 1, 6); }
    else if (horiz) { g.fillRect(4, 5, 8, 1); g.fillRect(4, 10, 8, 1); }
    else { g.fillRect(5, 4, 1, 8); g.fillRect(10, 4, 1, 8); }
  },

  tileRail(mask) {
    return this.get('rail' + mask, TS, TS, g => { this.dirt(g, 110 + mask); this.drawRailArms(g, mask); });
  },

  drawWireArms(g, mask, noPole) {
    if (mask === 0) mask = 10;
    g.fillStyle = PAL.wire;
    if (mask & 8) { g.fillRect(0, 6, 8, 1); g.fillRect(0, 9, 8, 1); }
    if (mask & 2) { g.fillRect(8, 6, 8, 1); g.fillRect(8, 9, 8, 1); }
    if (mask & 1) { g.fillRect(6, 0, 1, 8); g.fillRect(9, 0, 1, 8); }
    if (mask & 4) { g.fillRect(6, 8, 1, 8); g.fillRect(9, 8, 1, 8); }
    if (!noPole) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(8, 8, 3, 3);
      g.fillStyle = PAL.pole; g.fillRect(6, 6, 4, 4);
      g.fillStyle = '#8a6a3a'; g.fillRect(7, 7, 2, 2);
    }
  },

  tileWire(mask) {
    return this.get('wire' + mask, TS, TS, g => { this.dirt(g, 130 + mask); this.drawWireArms(g, mask); });
  },

  // Kreuzungen: o = 0 → Hauptweg waagrecht
  tileRoadWire(o) {
    return this.get('rw' + o, TS, TS, g => {
      this.dirt(g, 150 + o);
      this.drawRoadArms(g, o === 0 ? 10 : 5);
      g.fillStyle = PAL.wire;
      if (o === 0) { g.fillRect(6, 0, 1, TS); g.fillRect(9, 0, 1, TS); g.fillStyle = PAL.pole; g.fillRect(6, 0, 4, 2); g.fillRect(6, 14, 4, 2); }
      else { g.fillRect(0, 6, TS, 1); g.fillRect(0, 9, TS, 1); g.fillStyle = PAL.pole; g.fillRect(0, 6, 2, 4); g.fillRect(14, 6, 2, 4); }
    });
  },

  tileRoadRail(o) {
    return this.get('rr' + o, TS, TS, g => {
      this.dirt(g, 160 + o);
      this.drawRoadArms(g, o === 0 ? 10 : 5);
      g.fillStyle = PAL.tie;
      if (o === 0) { for (let y = 1; y < TS; y += 3) g.fillRect(4, y, 8, 2); g.fillStyle = PAL.railc; g.fillRect(5, 0, 1, TS); g.fillRect(10, 0, 1, TS); }
      else { for (let x = 1; x < TS; x += 3) g.fillRect(x, 4, 2, 8); g.fillStyle = PAL.railc; g.fillRect(0, 5, TS, 1); g.fillRect(0, 10, TS, 1); }
      // Schranken
      g.fillStyle = '#e02020';
      if (o === 0) { g.fillRect(2, 2, 1, 1); g.fillRect(13, 13, 1, 1); } else { g.fillRect(2, 13, 1, 1); g.fillRect(13, 2, 1, 1); }
    });
  },

  tileRailWire(o) {
    return this.get('lw' + o, TS, TS, g => {
      this.dirt(g, 170 + o);
      this.drawRailArms(g, o === 0 ? 10 : 5);
      g.fillStyle = PAL.wire;
      if (o === 0) { g.fillRect(6, 0, 1, TS); g.fillRect(9, 0, 1, TS); g.fillStyle = PAL.pole; g.fillRect(6, 0, 4, 2); g.fillRect(6, 14, 4, 2); }
      else { g.fillRect(0, 6, TS, 1); g.fillRect(0, 9, TS, 1); g.fillStyle = PAL.pole; g.fillRect(0, 6, 2, 4); g.fillRect(14, 6, 2, 4); }
    });
  },

  tileBridge(kind, o, frame) {
    return this.get('br' + kind + o + '_' + frame, TS, TS, g => {
      this.waterBase(g, frame);
      if (kind === 'wire') {
        g.fillStyle = '#777'; g.fillRect(5, 5, 6, 6);
        this.drawWireArms(g, o === 0 ? 10 : 5);
        return;
      }
      const deck = kind === 'road' ? '#8a8a8a' : '#6b5638';
      g.fillStyle = 'rgba(0,0,0,0.3)';
      if (o === 0) g.fillRect(0, 4, TS, 10); else g.fillRect(4, 0, 10, TS);
      g.fillStyle = deck;
      if (o === 0) g.fillRect(0, 2, TS, 12); else g.fillRect(2, 0, 12, TS);
      g.fillStyle = '#d8d8d8';
      if (o === 0) { g.fillRect(0, 2, TS, 1); g.fillRect(0, 13, TS, 1); for (let x = 0; x < TS; x += 4) { g.fillRect(x, 1, 1, 2); g.fillRect(x, 13, 1, 2); } }
      else { g.fillRect(2, 0, 1, TS); g.fillRect(13, 0, 1, TS); for (let y = 0; y < TS; y += 4) { g.fillRect(1, y, 2, 1); g.fillRect(13, y, 2, 1); } }
      if (kind === 'road') {
        g.fillStyle = PAL.asphalt;
        if (o === 0) g.fillRect(0, 3, TS, 10); else g.fillRect(3, 0, 10, TS);
        g.fillStyle = PAL.line;
        if (o === 0) for (let x = 1; x < TS; x += 4) g.fillRect(x, 7, 2, 1); else for (let y = 1; y < TS; y += 4) g.fillRect(7, y, 1, 2);
      } else {
        g.fillStyle = PAL.tie;
        if (o === 0) { for (let x = 1; x < TS; x += 3) g.fillRect(x, 4, 2, 8); g.fillStyle = PAL.railc; g.fillRect(0, 5, TS, 1); g.fillRect(0, 10, TS, 1); }
        else { for (let y = 1; y < TS; y += 3) g.fillRect(4, y, 8, 2); g.fillStyle = PAL.railc; g.fillRect(5, 0, 1, TS); g.fillRect(10, 0, 1, TS); }
      }
    });
  },

  // ---------------- Gebäude-Bausteine ----------------
  /** Block in 3/4-Ansicht: Dach oben, Fassade (Höhe hgt) unten, Schatten rechts. */
  block(g, x, y, w, d, hgt, roof, wall, opt) {
    opt = opt || {};
    const sh = Math.max(2, Math.round(hgt / 2));
    g.fillStyle = 'rgba(0,0,0,0.32)';
    g.fillRect(x + w, y + Math.min(sh, d - 1), Math.min(sh, 6), d - Math.min(sh, d - 1));
    g.fillRect(x + 2, y + d, w, 1);
    // Fassade
    g.fillStyle = wall; g.fillRect(x, y + d - hgt, w, hgt);
    g.fillStyle = shade(wall, -0.25); g.fillRect(x + w - 1, y + d - hgt, 1, hgt);
    if (opt.win !== false && hgt >= 3) {
      g.fillStyle = opt.winCol || shade(wall, -0.45);
      const lit = opt.lit;
      const r = srng((x * 31 + y * 17 + w) | 0);
      for (let wy = y + d - hgt + 1; wy < y + d - 1; wy += 2) {
        for (let wx = x + 1; wx < x + w - 1; wx += 2) {
          if (lit && r() < 0.3) { g.fillStyle = '#ffe890'; g.fillRect(wx, wy, 1, 1); g.fillStyle = opt.winCol || shade(wall, -0.45); }
          else g.fillRect(wx, wy, 1, 1);
        }
      }
    }
    // Dach
    const rd = d - hgt;
    if (rd > 0) {
      g.fillStyle = roof; g.fillRect(x, y, w, rd);
      g.fillStyle = shade(roof, 0.25); g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, rd);
      g.fillStyle = shade(roof, -0.25); g.fillRect(x, y + rd - 1, w, 1);
      if (opt.roofDetail && w > 4 && rd > 4) {
        g.fillStyle = shade(roof, -0.18);
        g.fillRect(x + 2, y + 2, 2, 2);
        if (w > 8) g.fillRect(x + w - 4, y + 2, 2, 1);
      }
    }
  },

  /** Kleines Haus mit Satteldach. */
  house(g, x, y, w, roof, wall, r) {
    const d = Math.round(w * 0.9);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 2, w, d);
    g.fillStyle = wall; g.fillRect(x, y + d - 3, w, 3);
    g.fillStyle = shade(wall, -0.5); g.fillRect(x + Math.floor(w / 2), y + d - 2, 1, 2);
    if (w > 5) { g.fillStyle = '#5a7ab0'; g.fillRect(x + 1, y + d - 2, 1, 1); g.fillRect(x + w - 2, y + d - 2, 1, 1); }
    g.fillStyle = roof; g.fillRect(x, y, w, d - 3);
    g.fillStyle = shade(roof, 0.3); g.fillRect(x, y, w, Math.floor((d - 3) / 2));
    g.fillStyle = shade(roof, -0.3); g.fillRect(x, y + Math.floor((d - 3) / 2), w, 1);
    if (r && r() < 0.5) { g.fillStyle = '#7a4a3a'; g.fillRect(x + w - 3, y, 2, 2); }
  },

  zoneLetter(g, ox, oy, letter, col) {
    g.fillStyle = '#111'; g.fillRect(ox + 2, oy + 2, 13, 13);
    g.fillStyle = col; g.fillRect(ox + 1, oy + 1, 13, 13);
    g.fillStyle = shade(col, 0.35); g.fillRect(ox + 1, oy + 1, 13, 1);
    g.fillStyle = '#fff';
    const P = {
      R: ['1110', '1001', '1110', '1010', '1001'],
      C: ['0111', '1000', '1000', '1000', '0111'],
      I: ['111', '010', '010', '010', '111'],
    }[letter];
    const pw = P[0].length;
    const sx = ox + 1 + Math.floor((13 - pw * 2) / 2), sy = oy + 3;
    for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < pw; xx++) if (P[yy][xx] === '1') g.fillRect(sx + xx * 2, sy + yy * 2, 2, 2);
  },

  emptyLot(g, size, seed, col) {
    const s = size * TS;
    this.dirt(g, seed, 0, 0, s, s);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(1, 1, s - 2, s - 2);
    g.fillStyle = shade(col, 0.4);
    for (let i = 1; i < s - 1; i += 3) { g.fillRect(i, 1, 1, 1); g.fillRect(i, s - 2, 1, 1); g.fillRect(1, i, 1, 1); g.fillRect(s - 2, i, 1, 1); }
  },

  // ---------------- Zonenbilder ----------------
  zoneKey(z) {
    switch (z.type) {
      case Z.RES:
        if (z.special) return 'Rs' + z.special + (z.var & 1);
        if (z.den === 0) return 'R0_' + z.houses.join('') + (z.var & 3);
        return 'R' + z.den + '_' + z.val + '_' + (z.var & 1);
      case Z.COM: return 'C' + z.den + '_' + z.val + '_' + (z.var & 1);
      case Z.IND: return 'I' + z.den + '_' + z.val + '_' + (z.var & 1);
      case Z.STADIUM: return 'S' + (z.game > 0 ? 1 : 0);
      default: return 'Z' + z.type;
    }
  },

  zoneImage(z) {
    const key = this.zoneKey(z);
    const px = z.size * TS;
    return this.get(key, px, px, g => this.drawZone(g, z));
  },

  drawZone(g, z) {
    const r = srng(z.var * 1000 + z.den * 37 + z.val * 101 + z.type * 7 + 1);
    switch (z.type) {
      case Z.RES: return z.special ? this.drawHospitalChurch(g, z.special, r) : (z.den === 0 ? this.drawHouses(g, z, r) : this.drawResidential(g, z.den, z.val, r));
      case Z.COM: return z.den === 0 ? this.drawEmpty(g, 'C', '#3a6ad8', r) : this.drawCommercial(g, z.den, z.val, r);
      case Z.IND: return z.den === 0 ? this.drawEmpty(g, 'I', '#d8b818', r) : this.drawIndustrial(g, z.den, z.val, r);
      case Z.POLICE: return this.drawPolice(g, r);
      case Z.FIRE: return this.drawFireStation(g, r);
      case Z.STADIUM: return this.drawStadium(g, z.game > 0, r);
      case Z.PORT: return this.drawPort(g, r);
      case Z.COAL: return this.drawCoal(g, r);
      case Z.NUCLEAR: return this.drawNuclear(g, r);
      case Z.AIRPORT: return this.drawAirport(g, r);
    }
  },

  drawEmpty(g, letter, col, r) {
    this.emptyLot(g, 3, Math.floor(r() * 100), col);
    this.zoneLetter(g, 16, 16, letter, col);
  },

  RES_PAL: [
    { ground: 'dirt', roofs: ['#7c6450', '#6e6e6e', '#7a4c3c'], wall: '#b4a48e' },
    { ground: '#7f9a48', roofs: ['#a8442e', '#86643e', '#6e7088'], wall: '#d4c4a4' },
    { ground: '#5aa845', roofs: ['#c45232', '#3a66a8', '#8e5a4a'], wall: '#ecdcc0' },
    { ground: '#4cb440', roofs: ['#e6e6e6', '#3c8cc4', '#c84a42'], wall: '#f6f2ea' },
  ],

  drawHouses(g, z, r) {
    this.emptyLot(g, 3, z.var + 5, '#2fb02f');
    this.zoneLetter(g, 16, 16, 'R', '#28a828');
    for (let i = 0; i < 8; i++) {
      const hv = z.houses[i];
      if (!hv) continue;
      const val = Math.min(3, Math.floor((hv - 1) / 3));
      const [hx, hy] = HOUSE_POS[i];
      this.drawHouseTile(g, hx * TS, hy * TS, val, hv, r);
    }
  },

  drawHouseTile(g, ox, oy, val, seed, r) {
    const p = this.RES_PAL[val];
    if (p.ground === 'dirt') this.dirt(g, seed + 3, ox, oy, TS, TS);
    else this.grass(g, seed + 3, ox, oy, TS, TS, p.ground);
    const roof = p.roofs[seed % 3];
    this.house(g, ox + 3, oy + 2, 10, roof, p.wall, r);
    if (val >= 2) { g.fillStyle = '#2f7d32'; g.fillRect(ox + 1, oy + 13, 2, 2); }
    if (val === 3 && seed % 2) { g.fillStyle = '#5ab0f0'; g.fillRect(ox + 11, oy + 12, 4, 3); }
  },

  groundFor(g, p, seed, s) {
    if (p.ground === 'dirt') this.dirt(g, seed, 0, 0, s, s);
    else this.grass(g, seed, 0, 0, s, s, p.ground);
  },

  drawResidential(g, den, val, r) {
    const p = this.RES_PAL[val];
    const s = 48;
    this.groundFor(g, p, Math.floor(r() * 50), s);
    const roof = () => p.roofs[Math.floor(r() * 3)];
    if (den === 1) {
      // Reihen-/Mehrfamilienhäuser
      const spots = [[3, 3], [26, 3], [3, 26], [26, 26]];
      for (const [x, y] of spots) this.house(g, x + Math.floor(r() * 3), y + Math.floor(r() * 2), 16, roof(), p.wall, r);
      g.fillStyle = '#b8b0a0'; g.fillRect(0, 22, s, 2);
    } else if (den === 2) {
      this.block(g, 3, 4, 18, 17, 5, roof(), p.wall, { roofDetail: true });
      this.block(g, 26, 4, 18, 17, 5, roof(), p.wall, { roofDetail: true });
      this.block(g, 6, 27, 34, 16, 5, roof(), p.wall, { roofDetail: true });
    } else if (den === 3) {
      this.block(g, 3, 3, 19, 22, 9, roof(), p.wall, { roofDetail: true });
      this.block(g, 26, 8, 18, 24, 10, roof(), p.wall, { roofDetail: true });
      this.block(g, 4, 30, 20, 15, 6, roof(), p.wall, { roofDetail: true });
    } else {
      this.block(g, 4, 2, 17, 34, 18, roof(), p.wall, { roofDetail: true, lit: true });
      this.block(g, 26, 8, 17, 36, 20, roof(), p.wall, { roofDetail: true, lit: true });
    }
    if (val >= 2) {
      g.fillStyle = '#2f7d32';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(2 + r() * 44, 44 + r() * 3, 1.8, 0, Math.PI * 2); g.fill(); }
    }
    if (val === 3 && den >= 2) { g.fillStyle = '#5ab0f0'; g.fillRect(36, 38, 9, 7); g.fillStyle = '#e8f4ff'; g.fillRect(36, 38, 9, 1); }
  },

  drawHospitalChurch(g, kind, r) {
    this.grass(g, 300 + kind, 0, 0, 48, 48);
    if (kind === 1) {
      this.block(g, 4, 6, 40, 30, 8, '#f0f0f0', '#e0e0e0', { roofDetail: false });
      g.fillStyle = '#e02020'; g.fillRect(21, 11, 6, 14); g.fillRect(17, 15, 14, 6);
      g.fillStyle = '#909090'; g.fillRect(4, 40, 40, 6);
      g.fillStyle = '#fff'; g.fillRect(6, 42, 6, 2);
    } else {
      this.block(g, 12, 14, 24, 28, 10, '#8a5a40', '#c8b8a0', { win: false });
      // Turm
      this.block(g, 19, 2, 10, 18, 8, '#5a3a2a', '#d0c4b0', { win: false });
      g.fillStyle = '#ffd040'; g.fillRect(23, 3, 2, 7); g.fillRect(21, 5, 6, 2);
      g.fillStyle = '#6a8ad8';
      for (let y = 34; y < 40; y += 3) { g.fillRect(15, y, 2, 2); g.fillRect(31, y, 2, 2); }
      g.fillStyle = '#909090'; g.fillRect(0, 44, 48, 3);
    }
    void r;
  },

  COM_PAL: [
    { ground: '#8a8478', roofs: ['#7a6e62', '#6a6a6a', '#8a6248'], wall: '#a89c8c', glass: '#4a4a52' },
    { ground: '#9a9a92', roofs: ['#8a8a8a', '#a08060', '#6a7a8a'], wall: '#c4bcac', glass: '#3c4c64' },
    { ground: '#a8a8a4', roofs: ['#b0b0b8', '#5a7aa0', '#c0a080'], wall: '#d8d4cc', glass: '#2c5a94' },
    { ground: '#b4b4b4', roofs: ['#e0e4ea', '#4a8ac8', '#c8c8d8'], wall: '#eef0f4', glass: '#2a70c0' },
  ],

  drawCommercial(g, den, val, r) {
    const p = this.COM_PAL[val];
    const s = 48;
    g.fillStyle = p.ground; g.fillRect(0, 0, s, s);
    g.fillStyle = shade(p.ground, -0.12);
    for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 46), Math.floor(r() * 46), 2, 1);
    const roof = () => p.roofs[Math.floor(r() * 3)];
    const opt = { winCol: p.glass, roofDetail: true, lit: val >= 2 };
    const awning = ['#e04040', '#40a040', '#e0c020', '#4060e0'];
    if (den === 1) {
      this.block(g, 3, 3, 18, 14, 4, roof(), p.wall, opt);
      this.block(g, 26, 3, 19, 14, 4, roof(), p.wall, opt);
      g.fillStyle = awning[Math.floor(r() * 4)]; g.fillRect(3, 16, 18, 2);
      g.fillStyle = awning[Math.floor(r() * 4)]; g.fillRect(26, 16, 19, 2);
      // Parkplatz
      g.fillStyle = '#555'; g.fillRect(3, 24, 42, 20);
      g.fillStyle = '#ddd'; for (let x = 6; x < 44; x += 6) g.fillRect(x, 25, 1, 8);
      const cars = ['#d03030', '#3050d0', '#e0e0e0', '#30a030', '#e0b020'];
      for (let i = 0; i < 5; i++) { g.fillStyle = cars[Math.floor(r() * 5)]; g.fillRect(7 + i * 6 + 1, 27, 3, 4); }
    } else if (den === 2) {
      this.block(g, 3, 3, 20, 22, 7, roof(), p.wall, opt);
      this.block(g, 26, 6, 19, 20, 6, roof(), p.wall, opt);
      this.block(g, 5, 30, 38, 14, 5, roof(), p.wall, opt);
    } else if (den === 3) {
      this.block(g, 4, 3, 24, 30, 12, roof(), p.wall, opt);
      this.block(g, 31, 10, 14, 22, 8, roof(), p.wall, opt);
      g.fillStyle = '#555'; g.fillRect(4, 37, 40, 8);
    } else if (den === 4) {
      this.block(g, 6, 2, 22, 40, 22, roof(), p.wall, opt);
      this.block(g, 32, 14, 13, 24, 10, roof(), p.wall, opt);
    } else {
      this.block(g, 3, 1, 19, 44, 30, roof(), p.wall, opt);
      this.block(g, 26, 2, 19, 42, 26, roof(), p.wall, opt);
      g.fillStyle = '#ff3030'; g.fillRect(12, 2, 1, 1); g.fillRect(35, 3, 1, 1);
    }
  },

  drawIndustrial(g, den, val, r) {
    const s = 48;
    const ground = val ? '#7c7a70' : '#6e5e4a';
    g.fillStyle = ground; g.fillRect(0, 0, s, s);
    g.fillStyle = shade(ground, -0.15);
    for (let i = 0; i < 25; i++) g.fillRect(Math.floor(r() * 47), Math.floor(r() * 47), 1 + Math.floor(r() * 2), 1);
    const wall = val ? '#a8a49a' : '#8e7a62';
    const roofA = val ? '#7a8088' : '#6a5a48';
    const roofB = val ? '#9a6a4a' : '#5a4a3a';
    // Sägezahndach-Halle
    const shed = (x, y, w, d) => {
      this.block(g, x, y, w, d, 5, roofA, wall, { win: false });
      g.fillStyle = shade(roofA, -0.3);
      for (let xx = x + 2; xx < x + w - 1; xx += 4) g.fillRect(xx, y + 1, 1, d - 7);
    };
    const tank = (x, y, rad) => {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 2, y + 2, rad, 0, Math.PI * 2); g.fill();
      g.fillStyle = val ? '#c8c8c0' : '#a09070'; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(x - rad / 3, y - rad / 3, rad / 2.5, 0, Math.PI * 2); g.fill();
    };
    const stack = (x, y) => {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 3, y + 3, 3, 10);
      g.fillStyle = '#7a3a2a'; g.fillRect(x, y, 3, 12);
      g.fillStyle = '#e8e8e8'; g.fillRect(x, y + 2, 3, 1);
      g.fillStyle = '#2a2a2a'; g.fillRect(x, y, 3, 1);
    };
    if (den === 1) {
      shed(4, 6, 26, 20);
      g.fillStyle = '#5a4a3a'; g.fillRect(6, 32, 10, 8); g.fillRect(20, 33, 8, 6);
      g.fillStyle = '#c08040'; g.fillRect(34, 30, 9, 9);
    } else if (den === 2) {
      shed(3, 4, 28, 22);
      this.block(g, 34, 22, 11, 18, 6, roofB, wall, {});
      stack(37, 4);
      tank(12, 38, 5);
    } else if (den === 3) {
      shed(3, 3, 24, 20);
      shed(3, 26, 22, 18);
      stack(32, 4); stack(38, 6);
      tank(36, 32, 6);
    } else {
      this.block(g, 2, 8, 30, 36, 10, roofB, wall, { roofDetail: true });
      stack(6, 0); stack(14, 0); stack(22, 1);
      tank(39, 12, 6); tank(40, 32, 6);
    }
  },

  // ---------------- Sonderbauten ----------------
  drawPolice(g, r) {
    g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, 48, 48);
    this.grass(g, 501, 0, 0, 48, 8);
    this.block(g, 4, 6, 40, 26, 8, '#28407a', '#c8ccd8', { roofDetail: true });
    // Stern
    g.fillStyle = '#ffd040';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 2.5 : 6;
      g.lineTo(24 + Math.cos(a) * rr, 14 + Math.sin(a) * rr);
    }
    g.fill();
    g.fillStyle = '#555'; g.fillRect(2, 36, 44, 10);
    for (let i = 0; i < 3; i++) {
      const x = 6 + i * 13;
      g.fillStyle = '#fff'; g.fillRect(x, 38, 8, 5);
      g.fillStyle = '#20206a'; g.fillRect(x + 2, 38, 4, 5);
      g.fillStyle = i % 2 ? '#f02020' : '#2060ff'; g.fillRect(x + 3, 39, 2, 1);
    }
    void r;
  },

  drawFireStation(g, r) {
    g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, 48, 48);
    this.grass(g, 502, 0, 0, 48, 6);
    this.block(g, 3, 5, 42, 28, 9, '#a82418', '#d8c8b0', { win: false });
    g.fillStyle = '#ffffff'; g.fillRect(19, 10, 10, 2); g.fillRect(23, 8, 2, 8);
    // Tore
    for (let i = 0; i < 3; i++) { g.fillStyle = '#3a3a3a'; g.fillRect(6 + i * 13, 26, 10, 7); g.fillStyle = '#e04030'; g.fillRect(7 + i * 13, 28, 8, 5); }
    // Löschfahrzeuge
    for (let i = 0; i < 2; i++) {
      const x = 8 + i * 20;
      g.fillStyle = '#d82018'; g.fillRect(x, 37, 14, 6);
      g.fillStyle = '#e8e8e8'; g.fillRect(x + 2, 38, 10, 1);
      g.fillStyle = '#9ad'; g.fillRect(x + 11, 38, 2, 2);
    }
    void r;
  },

  drawStadium(g, full, r) {
    const s = 64;
    this.grass(g, 600, 0, 0, s, s, '#5a9a40');
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(34, 34, 30, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b0aca4'; g.beginPath(); g.ellipse(32, 32, 30, 28, 0, 0, Math.PI * 2); g.fill();
    // Ränge
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = i % 2 ? '#8a8680' : '#c8c4bc';
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(32, 32, 28 - i * 3, 26 - i * 3, 0, 0, Math.PI * 2); g.stroke();
    }
    if (full) {
      const cols = ['#e04040', '#4040e0', '#f0f0f0', '#f0d040', '#40c040'];
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI * 2, d = 17 + r() * 11;
        g.fillStyle = cols[Math.floor(r() * 5)];
        g.fillRect(Math.round(32 + Math.cos(a) * d * 1.06), Math.round(32 + Math.sin(a) * d), 1, 1);
      }
    }
    // Spielfeld
    g.fillStyle = '#3c9a2c'; g.fillRect(17, 20, 30, 24);
    g.fillStyle = '#48aa36'; for (let x = 17; x < 47; x += 6) g.fillRect(x, 20, 3, 24);
    g.fillStyle = '#fff';
    g.fillRect(17, 20, 30, 1); g.fillRect(17, 43, 30, 1); g.fillRect(17, 20, 1, 24); g.fillRect(46, 20, 1, 24);
    g.fillRect(32, 20, 1, 24);
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(32.5, 32, 4, 0, Math.PI * 2); g.stroke();
    if (full) {
      g.fillStyle = '#ff2020'; for (let i = 0; i < 5; i++) g.fillRect(20 + Math.floor(r() * 12), 23 + Math.floor(r() * 18), 1, 2);
      g.fillStyle = '#2020ff'; for (let i = 0; i < 5; i++) g.fillRect(34 + Math.floor(r() * 11), 23 + Math.floor(r() * 18), 1, 2);
    }
  },

  drawPort(g, r) {
    const s = 64;
    g.fillStyle = '#8c8c86'; g.fillRect(0, 0, s, s);
    // Hafenbecken
    g.fillStyle = PAL.water; g.fillRect(36, 0, 28, 64);
    g.fillStyle = PAL.waterL; for (let y = 3; y < 64; y += 5) g.fillRect(40 + (y % 3) * 6, y, 4, 1);
    g.fillStyle = '#6a5a48'; g.fillRect(34, 0, 3, 64);
    // Pier
    g.fillStyle = '#9a8a70'; g.fillRect(37, 26, 24, 8);
    // Schiff
    g.fillStyle = '#8a2a1a'; g.fillRect(42, 40, 18, 7); g.fillStyle = '#e8e8e8'; g.fillRect(54, 41, 4, 5);
    g.fillStyle = '#2a2a2a'; g.fillRect(42, 46, 18, 1);
    // Lagerhallen
    this.block(g, 3, 3, 26, 14, 5, '#7a6a5a', '#b0a088', { win: false });
    // Container
    const cc = ['#c03020', '#2050a0', '#e0a020', '#309040', '#d06020'];
    for (let y = 22; y < 50; y += 5) for (let x = 3; x < 28; x += 7) {
      if (r() < 0.2) continue;
      g.fillStyle = cc[Math.floor(r() * 5)]; g.fillRect(x, y, 6, 4);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + 3, 6, 1);
    }
    // Kräne
    for (const y of [10, 36]) {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(31, y + 3, 14, 3);
      g.fillStyle = '#e0b818'; g.fillRect(28, y, 3, 8); g.fillRect(28, y + 1, 16, 2);
      g.fillStyle = '#3a3a3a'; g.fillRect(41, y + 3, 1, 4);
    }
    g.fillStyle = '#ddd'; g.fillRect(4, 56, 26, 4);
  },

  drawCoal(g, r) {
    const s = 64;
    g.fillStyle = '#6a6460'; g.fillRect(0, 0, s, s);
    // Kohlehalde
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.ellipse(14, 50, 12, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2e2e2e'; g.beginPath(); g.ellipse(12, 48, 7, 5, 0, 0, Math.PI * 2); g.fill();
    // Förderband
    g.fillStyle = '#4a4a4a'; g.fillRect(22, 40, 18, 2);
    // Hauptgebäude
    this.block(g, 26, 20, 34, 30, 12, '#5a5450', '#9a948a', { roofDetail: true });
    this.block(g, 30, 52, 26, 10, 4, '#4a4440', '#8a847a', { win: false });
    // Schornsteine
    for (const [x, y] of COAL_STACKS) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 3, y + 4, 5, 18);
      g.fillStyle = '#b8b0a8'; g.fillRect(x, y, 5, 20);
      g.fillStyle = '#c03020'; g.fillRect(x, y + 1, 5, 2); g.fillRect(x, y + 6, 5, 2);
      g.fillStyle = '#1a1a1a'; g.fillRect(x, y, 5, 1);
    }
    void r;
  },

  drawNuclear(g, r) {
    const s = 64;
    this.grass(g, 701, 0, 0, s, s, '#6a9a50');
    g.fillStyle = '#a0a0a0'; g.fillRect(0, 44, 64, 20);
    // Kühlturm
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(21, 23, 17, 0, Math.PI * 2); g.fill();
    const grd = g.createRadialGradient(15, 15, 2, 18, 20, 17);
    grd.addColorStop(0, '#f4f4f0'); grd.addColorStop(1, '#a8a8a0');
    g.fillStyle = grd; g.beginPath(); g.arc(18, 20, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a5a58'; g.beginPath(); g.arc(18, 20, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(18, 20, 8, 0, Math.PI * 2); g.fill();
    // Reaktorkuppel
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(49, 31, 12, 0, Math.PI * 2); g.fill();
    const g2 = g.createRadialGradient(42, 24, 1, 46, 28, 12);
    g2.addColorStop(0, '#ffffff'); g2.addColorStop(1, '#9aa0b0');
    g.fillStyle = g2; g.beginPath(); g.arc(46, 28, 12, 0, Math.PI * 2); g.fill();
    this.block(g, 6, 46, 26, 14, 5, '#6a7080', '#c8ccd4', {});
    this.block(g, 38, 46, 20, 14, 5, '#6a7080', '#c8ccd4', {});
    // Warnzeichen
    g.fillStyle = '#ffd800'; g.fillRect(45, 3, 9, 9);
    g.fillStyle = '#111'; g.beginPath(); g.arc(49.5, 7.5, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd800'; g.fillRect(49, 7, 1, 1);
    void r;
  },

  drawAirport(g, r) {
    const s = 96;
    this.grass(g, 801, 0, 0, s, s, '#6aa04a');
    // Rollbahn
    g.fillStyle = '#4a4a4a'; g.fillRect(4, 62, 88, 14);
    g.fillStyle = '#fff';
    for (let x = 8; x < 90; x += 8) g.fillRect(x, 68, 5, 2);
    g.fillRect(6, 64, 1, 10); g.fillRect(89, 64, 1, 10);
    for (let i = 0; i < 4; i++) { g.fillRect(9, 63 + i * 3, 4, 1); g.fillRect(83, 63 + i * 3, 4, 1); }
    // Rollweg und Vorfeld
    g.fillStyle = '#7a7a7a'; g.fillRect(4, 40, 88, 18); g.fillRect(44, 56, 8, 6);
    g.fillStyle = '#e0c020'; for (let x = 6; x < 90; x += 6) g.fillRect(x, 48, 3, 1);
    // Terminal und Hangars
    this.block(g, 4, 6, 42, 26, 8, '#d8d8d8', '#b8c0c8', { winCol: '#2c5a94' });
    this.block(g, 52, 10, 18, 22, 7, '#8090a0', '#a8a8a8', { win: false });
    this.block(g, 73, 10, 18, 22, 7, '#8090a0', '#a8a8a8', { win: false });
    g.fillStyle = '#5a5a5a'; g.fillRect(55, 28, 12, 4); g.fillRect(76, 28, 12, 4);
    // Tower
    this.block(g, 4, 34, 8, 12, 6, '#2c5a94', '#d8d8d8', {});
    // Flugzeuge am Vorfeld
    const plane = (x, y) => {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 2, 12, 3); g.fillRect(x + 6, y - 3, 3, 13);
      g.fillStyle = '#f4f4f4'; g.fillRect(x, y, 12, 3); g.fillRect(x + 4, y - 5, 3, 13); g.fillRect(x + 10, y - 2, 2, 7);
      g.fillStyle = '#c02020'; g.fillRect(x + 11, y - 2, 1, 7);
    };
    plane(20, 46); plane(60, 46);
    // Radar-Sockel (Antenne wird animiert)
    g.fillStyle = '#5a5a5a'; g.fillRect(RADAR_POS[0] - 3, RADAR_POS[1] - 3, 7, 7);
    void r;
  },

  // ---------------- Symbole & Objekte ----------------
  bolt() {
    return this.get('bolt', TS, TS, g => {
      g.fillStyle = '#000';
      const pts = [[9, 0], [3, 9], [7, 9], [5, 16], [13, 6], [9, 6], [12, 0]];
      g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x + 1, y) : g.moveTo(x + 1, y)); g.fill();
      g.fillStyle = '#ffe600';
      g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.fill();
    });
  },
};

const COAL_STACKS = [[30, 2], [38, 2], [46, 2], [54, 2]];
const RADAR_POS = [88, 88];
// Schornsteine der Industrie (relativ zum Zonenbild) je Dichte
const IND_STACKS = { 2: [[38, 4]], 3: [[33, 4], [39, 6]], 4: [[7, 0], [15, 0], [23, 1]] };

// ---------------- Objekte (Sprites) ----------------
const SPRITE_GFX = {
  train(g, x, y, dir, t) {
    // dir 0..3; Lok + Wagen werden vom Aufrufer an Spurpunkten gezeichnet
    void dir; void t;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 4, y - 3, 10, 8);
    g.fillStyle = '#c02818'; g.fillRect(x - 5, y - 4, 10, 8);
    g.fillStyle = '#2a2a2a'; g.fillRect(x - 3, y - 2, 6, 4);
    g.fillStyle = '#ffd040'; g.fillRect(x - 1, y - 1, 2, 2);
  },
  wagon(g, x, y, col) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 4, y - 3, 10, 8);
    g.fillStyle = col; g.fillRect(x - 5, y - 4, 10, 8);
    g.fillStyle = shade(col, 0.3); g.fillRect(x - 4, y - 3, 8, 2);
  },
};
