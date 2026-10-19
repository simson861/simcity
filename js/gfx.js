'use strict';
/*
 * Grafik: alle Felder und Gebäude werden prozedural im Pixel-Stil gezeichnet
 * (16x16 Pixel pro Feld wie im Original) und zwischengespeichert.
 * Alles wird pixelgenau mit ganzzahligen Rechtecken gezeichnet (keine Kantenglättung).
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
  dirt: '#9c6b3a', dirtD: '#835829', dirtL: '#b07f4c', dirtB: '#6a4522',
  water: '#2b56c6', waterD: '#2146a8', waterL: '#5b86e6', waterC: '#9ab8f6', foam: '#c4d8ff', waterS: '#3866d4',
  sand: '#c8a868',
  tree: '#2d7a2e', treeD: '#1e5a22', treeL: '#4a9c44', treeH: '#72bc5c', floor: '#18461c',
  grass: '#58a443', grassD: '#47903a', grassL: '#76be58',
  asphalt: '#5e5e60', asphaltD: '#4c4c4e', curb: '#a2a29c', line: '#e8e4c8',
  ballast: '#8a7e6c', ballastD: '#6e6454', tie: '#5a3a1e', railc: '#d4d4d8',
  pole: '#5a3a1e', wire: '#141414',
  rubble: '#7d7468', rubbleD: '#5c544a', rubbleL: '#a39a8c',
  shadow: 'rgba(0,0,0,0.34)',
};

// Baumkronen-Masken (Pixel-Sprites)
const CROWNS = [
  ['.##.', '####', '####', '.##.'],
  ['.###.', '#####', '#####', '#####', '.###.'],
  ['.####.', '######', '######', '######', '######', '.####.'],
];

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

  // ---------------- Pixel-Helfer ----------------
  rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); },
  px(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); },

  /** Gefüllte Ellipse, pixelgenau (Mittelpunkt darf halbzahlig sein). */
  ellipse(g, cx, cy, rx, ry, c) {
    g.fillStyle = c;
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y < y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (dy * dy > 1) continue;
      const hw = rx * Math.sqrt(1 - dy * dy);
      const xa = Math.round(cx - hw), xb = Math.round(cx + hw);
      if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
  },
  disc(g, cx, cy, r, c) { this.ellipse(g, cx, cy, r, r, c); },

  /** Pixelweise füllen: fn(x, y) liefert Farbe oder null. */
  pixels(g, x0, y0, w, h, fn) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const c = fn(x, y);
      if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }
    }
  },

  /** Baumkrone; (x, y) = linke obere Ecke der Maske. */
  crown(g, x, y, size, r, onGrass) {
    const m = CROWNS[size];
    const n = m.length;
    g.fillStyle = onGrass ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.36)';
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) if (m[yy][xx] === '#') g.fillRect(x + xx + 1, y + yy + 1, 1, 1);
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
      if (m[yy][xx] !== '#') continue;
      const t = (xx + yy) / (2 * (n - 1));
      const q = r ? r() : 0.5;
      let c;
      if (t < 0.22) c = q < 0.6 ? PAL.treeH : PAL.treeL;
      else if (t < 0.45) c = q < 0.7 ? PAL.treeL : PAL.tree;
      else if (t < 0.78) c = q < 0.85 ? PAL.tree : PAL.treeL;
      else c = q < 0.7 ? PAL.treeD : PAL.tree;
      g.fillStyle = c; g.fillRect(x + xx, y + yy, 1, 1);
    }
  },

  /** Einzelner Baum mit Mittelpunkt (cx, cy). */
  tree(g, cx, cy, size, r, onGrass) {
    const n = CROWNS[size].length;
    this.crown(g, Math.round(cx - n / 2), Math.round(cy - n / 2), size, r, onGrass);
  },

  // ---------------- Grundflächen ----------------
  dirt(g, seed, ox, oy, w, h) {
    ox = ox || 0; oy = oy || 0; w = w || TS; h = h || TS;
    g.fillStyle = PAL.dirt; g.fillRect(ox, oy, w, h);
    const r = srng(seed * 7 + 3);
    const n = (w * h) / 16;
    for (let i = 0; i < n; i++) {
      const q = r();
      g.fillStyle = q < 0.55 ? PAL.dirtD : PAL.dirtL;
      const x = ox + Math.floor(r() * w), y = oy + Math.floor(r() * h);
      g.fillRect(x, y, 1, 1);
      if (q < 0.12 && x + 1 < ox + w) { g.fillStyle = PAL.dirtB; g.fillRect(x + 1, y, 1, 1); }
    }
  },

  grass(g, seed, ox, oy, w, h, base) {
    base = base || PAL.grass;
    g.fillStyle = base; g.fillRect(ox, oy, w, h);
    const r = srng(seed * 13 + 1);
    const dk = shade(base, -0.16), lt = shade(base, 0.18);
    for (let i = 0; i < (w * h) / 10; i++) {
      g.fillStyle = r() < 0.55 ? dk : lt;
      g.fillRect(ox + Math.floor(r() * w), oy + Math.floor(r() * h), 1, 1);
    }
  },

  /** Wasser ohne Ufer. */
  waterBase(g, frame) {
    g.fillStyle = PAL.water; g.fillRect(0, 0, TS, TS);
    const sh = [0, 1, 2, 1][frame & 3];
    const waves = [[1, 1, 3], [9, 3, 4], [4, 6, 3], [12, 8, 3], [1, 10, 4], [8, 12, 3], [13, 14, 2], [5, 15, 2]];
    for (let i = 0; i < waves.length; i++) {
      const [wx, wy, len] = waves[i];
      const xx = (wx + (i & 1 ? sh : -sh) + 16) % 16;
      for (let k = 0; k < len; k++) {
        const x = (xx + k) % 16;
        g.fillStyle = (k === 1 && (frame + i) % 3 === 0) ? PAL.waterC : PAL.waterL;
        g.fillRect(x, wy, 1, 1);
        if (wy + 1 < TS) { g.fillStyle = PAL.waterD; g.fillRect((x + 1) % 16, wy + 1, 1, 1); }
      }
    }
  },

  tileDirt(v) { return this.get('dirt' + v, TS, TS, g => this.dirt(g, v + 1)); },

  /** Diagonal-Bits nur behalten, wenn beide angrenzenden Seiten frei sind. */
  normMask8(m) {
    if (m & 3) m &= ~16;
    if (m & 6) m &= ~32;
    if (m & 12) m &= ~64;
    if (m & 9) m &= ~128;
    return m;
  },

  /**
   * Abstand (in Pixeln) eines Punkts im Feld zum "offenen" Rand.
   * open: Bits 0-3 Seiten N,O,S,W; 4-7 Ecken NO,SO,SW,NW. base = Randbreite.
   */
  edgeDist(open, cx, cy, base, amp) {
    const wob = t => amp * (0.62 * Math.sin(t * Math.PI / 8) + 0.38 * Math.sin(t * Math.PI / 4 + 0.6) - 0.38 * Math.sin(0.6));
    let e = 99;
    if (open & 1) e = Math.min(e, cy - (base + wob(cx)));
    if (open & 4) e = Math.min(e, (TS - cy) - (base + wob(cx + 5)));
    if (open & 8) e = Math.min(e, cx - (base + wob(cy + 3)));
    if (open & 2) e = Math.min(e, (TS - cx) - (base + wob(cy + 11)));
    const R = base + 5;
    const corner = (ax, ay) => R - Math.hypot(Math.max(0, R - ax), Math.max(0, R - ay)) - base;
    if ((open & 9) === 9) e = Math.min(e, corner(cx, cy));
    if ((open & 3) === 3) e = Math.min(e, corner(TS - cx, cy));
    if ((open & 6) === 6) e = Math.min(e, corner(TS - cx, TS - cy));
    if ((open & 12) === 12) e = Math.min(e, corner(cx, TS - cy));
    const nb = base - 0.6;
    if (open & 16) e = Math.min(e, Math.hypot(TS - cx, cy) - nb);
    if (open & 32) e = Math.min(e, Math.hypot(TS - cx, TS - cy) - nb);
    if (open & 64) e = Math.min(e, Math.hypot(cx, TS - cy) - nb);
    if (open & 128) e = Math.min(e, Math.hypot(cx, cy) - nb);
    return e;
  },

  /** Ufer über Wasser zeichnen (mask: gesetzte Bits = Land). */
  drawShore(g, mask, frame, seed) {
    if (!mask) return;
    const land = this.get('shoreDirt' + (seed % 3), TS, TS, gg => this.dirt(gg, 200 + seed % 3));
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const e = this.edgeDist(mask, x + 0.5, y + 0.5, 3, 1.1);
      if (e < -1) g.drawImage(land, x, y, 1, 1, x, y, 1, 1);
      else if (e < 0) this.px(g, x, y, PAL.dirtB);
      else if (e < 1) this.px(g, x, y, (x + y + frame) % 4 === 0 ? PAL.waterL : PAL.foam);
      else if (e < 2.2) this.px(g, x, y, (x * 3 + y + frame) % 5 === 0 ? PAL.waterL : PAL.waterS);
    }
  },

  tileWater(mask, frame) {
    // mask: Bit gesetzt = Land (0-3: N,O,S,W; 4-7: NO,SO,SW,NW)
    mask = this.normMask8(mask);
    return this.get('w' + mask + '_' + frame, TS, TS, g => {
      this.waterBase(g, frame);
      this.drawShore(g, mask, frame, mask);
    });
  },

  tileTrees(v, dense) {
    // dense: true/false (alt) oder 8-Bit-Maske der Nachbarn mit Wald
    let m = dense === true ? 255 : dense === false ? 0 : dense;
    const open = this.normMask8(~m & 255);
    return this.get('t' + v + '_' + open, TS, TS, g => {
      const r = srng(v * 31 + 5);
      this.dirt(g, v + 11);
      if (open !== 0) {
        g.fillStyle = PAL.floor;
        for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
          if (this.edgeDist(open, x + 0.5, y + 0.5, 2.5, 1.3) >= 2) g.fillRect(x, y, 1, 1);
        }
      } else { g.fillStyle = PAL.floor; g.fillRect(0, 0, TS, TS); }
      // Kronen im (kachelbaren) Raster
      const crowns = [];
      for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
        const jx = Math.floor(r() * 3) - 1, jy = Math.floor(r() * 3) - 1;
        const size = r() < 0.5 ? 1 : (r() < 0.6 ? 2 : 0);
        const px = cx * 4 + 2 + jx, py = cy * 4 + 2 + jy;
        for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
          const X = px + ox, Y = py + oy;
          if (X < -4 || X > 20 || Y < -4 || Y > 20) continue;
          if (open) {
            const ex = this.edgeDist(open, X + 0.5, Y + 0.5, 2.5, 1.3);
            if (ex < 1.2) continue;
          }
          crowns.push([X, Y, size]);
        }
      }
      crowns.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const rr = srng(v * 77 + open * 3 + 1);
      for (const [X, Y, s] of crowns) this.tree(g, X, Y, s, rr, false);
    });
  },

  tileRubble(v) {
    return this.get('rb' + v, TS, TS, g => {
      this.dirt(g, v + 21);
      const r = srng(v * 17 + 9);
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(r() * 13), y = Math.floor(r() * 13), w = 1 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 2);
        this.rect(g, x + 1, y + 1, w, h, 'rgba(0,0,0,0.3)');
        this.rect(g, x, y, w, h, [PAL.rubble, PAL.rubbleD, PAL.rubbleL][Math.floor(r() * 3)]);
        this.px(g, x, y, PAL.rubbleL);
      }
      for (let i = 0; i < 3; i++) this.rect(g, Math.floor(r() * 12), Math.floor(r() * 14), 3, 1, '#4a3a2a');
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
      const r = srng(77);
      g.fillStyle = 'rgba(120,90,50,0.45)'; g.fillRect(0, 0, TS, TS);
      for (let i = 0; i < 10; i++) this.px(g, Math.floor(r() * 16), Math.floor(r() * 16), PAL.dirtD);
      for (let i = 0; i < 4; i++) this.rect(g, (i * 5 + frame * 3) % 14, i * 4 + 1, 3, 1, '#7c9cd8');
    });
  },

  tileRad() {
    return this.get('rad', TS, TS, g => {
      this.dirt(g, 55);
      g.fillStyle = 'rgba(190,255,0,0.35)'; g.fillRect(0, 0, TS, TS);
      this.disc(g, 8, 8, 6, '#111');
      this.disc(g, 8, 8, 5, '#ffd800');
      this.pixels(g, 3, 3, 10, 10, (x, y) => {
        const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.hypot(dx, dy);
        if (d < 1.6 || d > 4.6) return null;
        const a = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2 / 3);
        return a < Math.PI / 3 && d > 2 ? '#111' : null;
      });
      this.rect(g, 7, 7, 2, 2, '#111');
    });
  },

  tilePark(v) {
    return this.get('park' + v, TS, TS, g => {
      this.grass(g, v + 40, 0, 0, TS, TS);
      if (v === 4) { // Brunnen
        this.disc(g, 8.5, 8.5, 6.5, 'rgba(0,0,0,0.25)');
        this.disc(g, 8, 8, 6.5, '#b8b4ac');
        this.disc(g, 8, 8, 5, '#3c74e0');
        this.disc(g, 8, 8, 2, '#c8dcff');
        this.rect(g, 7, 4, 2, 3, '#e8f0ff'); this.px(g, 6, 5, '#e8f0ff'); this.px(g, 9, 5, '#e8f0ff');
        return;
      }
      const r = srng(v * 7 + 70);
      g.fillStyle = '#cbb98c';
      if (v === 1) { g.fillRect(0, 7, TS, 2); }
      else if (v === 2) { g.fillRect(7, 0, 2, TS); }
      const spots = v === 1 ? [[4, 3], [12, 3], [8, 13]] : v === 2 ? [[3, 4], [13, 9], [3, 13]] : [[4, 4], [11, 6], [6, 12]];
      for (const [x, y] of spots) this.tree(g, x + Math.floor(r() * 2), y, r() < 0.5 ? 1 : 2, r, true);
      this.px(g, 1 + Math.floor(r() * 14), 1 + Math.floor(r() * 14), '#e04080');
      this.px(g, 1 + Math.floor(r() * 14), 1 + Math.floor(r() * 14), '#ffe040');
      this.px(g, 1 + Math.floor(r() * 14), 1 + Math.floor(r() * 14), '#f0f0f0');
      if (v === 3) { this.rect(g, 11, 12, 4, 1, '#7a4a2a'); this.rect(g, 11, 13, 1, 1, '#5a3a1a'); this.rect(g, 14, 13, 1, 1, '#5a3a1a'); }
    });
  },

  // ---------------- Verkehrswege ----------------
  /** Liegt Pixel (x, y) auf dem Asphalt der Straße mit Maske m? */
  roadInside(m, x, y) {
    const cx = x + 0.5, cy = y + 0.5;
    // Kurven: Viertelkreis um die gemeinsame Ecke
    const cv = { 3: [16, 0], 6: [16, 16], 12: [0, 16], 9: [0, 0] }[m];
    if (cv) {
      const inBand = (v) => v >= 3 && v < 13;
      if (x >= 0 && x < TS && y >= 0 && y < TS) {
        const d = Math.hypot(cx - cv[0], cy - cv[1]);
        return d >= 3 && d <= 13;
      }
      // außerhalb: nur die Fortsetzung der Arme
      if (y < 0) return !!(m & 1) && inBand(cx);
      if (y >= TS) return !!(m & 4) && inBand(cx);
      if (x < 0) return !!(m & 8) && inBand(cy);
      return !!(m & 2) && inBand(cy);
    }
    const a = 3, b = 13;
    const inX = cx >= a && cx < b, inY = cy >= a && cy < b;
    if (inX && inY) return true;
    if (inX && cy < a) return !!(m & 1);
    if (inX && cy >= b) return !!(m & 4);
    if (inY && cx < a) return !!(m & 8);
    if (inY && cx >= b) return !!(m & 2);
    return false;
  },

  // Asphalt (Kurven gerundet, Bordstein, Mittellinie)
  drawRoadArms(g, mask) {
    if (mask === 0) mask = 10;
    const m = mask;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (!this.roadInside(m, x, y)) {
        // leichte Kante/Schatten unterhalb des Asphalts
        if (this.roadInside(m, x, y - 1) || this.roadInside(m, x - 1, y - 1)) this.px(g, x, y, 'rgba(0,0,0,0.22)');
        continue;
      }
      const edge = !this.roadInside(m, x - 1, y) || !this.roadInside(m, x + 1, y) || !this.roadInside(m, x, y - 1) || !this.roadInside(m, x, y + 1);
      let c = PAL.asphalt;
      if (edge) c = PAL.curb;
      else if (((x * 7 + y * 13 + m) % 11) === 0) c = PAL.asphaltD;
      this.px(g, x, y, c);
    }
    // Markierung
    g.fillStyle = PAL.line;
    const cv = { 3: [16, 0], 6: [16, 16], 12: [0, 16], 9: [0, 0] }[m];
    if (cv) {
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x + 0.5 - cv[0], y + 0.5 - cv[1]);
        if (Math.abs(d - 8) < 0.5) {
          const a = Math.atan2(Math.abs(y + 0.5 - cv[1]), Math.abs(x + 0.5 - cv[0]));
          if (Math.floor(a * 8 / (Math.PI / 2) * 1.5) % 2 === 0) g.fillRect(x, y, 1, 1);
        }
      }
      return;
    }
    const H = (m & 10) === 10 || ((m & 10) && !(m & 5));
    const V = (m & 5) === 5 || ((m & 5) && !(m & 10));
    if (H && !V) { for (let x = 1; x < TS; x += 4) g.fillRect(x, 7, 2, 1); return; }
    if (V && !H) { for (let y = 1; y < TS; y += 4) g.fillRect(7, y, 1, 2); return; }
    if ((m & 10) === 10 && (m & 5) !== 5) {        // T mit durchgehender Ost-West-Straße
      for (let x = 1; x < TS; x += 4) g.fillRect(x, 7, 2, 1);
    } else if ((m & 5) === 5 && (m & 10) !== 10) {  // T mit durchgehender Nord-Süd-Straße
      for (let y = 1; y < TS; y += 4) g.fillRect(7, y, 1, 2);
    } else {                                        // Kreuzung: Haltelinien
      g.fillStyle = '#d8d8d0';
      if (m & 1) g.fillRect(8, 2, 4, 1);
      if (m & 4) g.fillRect(4, 13, 4, 1);
      if (m & 8) g.fillRect(2, 4, 1, 4);
      if (m & 2) g.fillRect(13, 8, 1, 4);
      g.fillStyle = PAL.line;
      if (m & 1) g.fillRect(7, 0, 1, 2);
      if (m & 4) g.fillRect(7, 14, 1, 2);
      if (m & 8) g.fillRect(0, 7, 2, 1);
      if (m & 2) g.fillRect(14, 7, 2, 1);
    }
  },

  tileRoad(mask) {
    return this.get('road' + mask, TS, TS, g => { this.dirt(g, 90 + (mask & 3)); this.drawRoadArms(g, mask); });
  },

  drawRailArms(g, mask) {
    if (mask === 0) mask = 10;
    const cv = { 3: [16, 0], 6: [16, 16], 12: [0, 16], 9: [0, 0] }[mask];
    if (cv) {
      // Gleisbogen
      this.pixels(g, 0, 0, TS, TS, (x, y) => {
        const dx = x + 0.5 - cv[0], dy = y + 0.5 - cv[1], d = Math.hypot(dx, dy);
        if (d < 4 || d > 12) return null;
        if (Math.abs(d - 5.5) < 0.62 || Math.abs(d - 10.5) < 0.62) return PAL.railc;
        const a = Math.atan2(Math.abs(dy), Math.abs(dx)) / (Math.PI / 2) * 16;
        if (d > 4.4 && d < 11.6 && (Math.floor(a) % 3) === 0) return PAL.tie;
        return (x + y) % 5 === 0 ? PAL.ballastD : PAL.ballast;
      });
      return;
    }
    const horiz = (mask & 10) !== 0, vert = (mask & 5) !== 0;
    g.fillStyle = PAL.ballast;
    if (mask & 1) g.fillRect(4, 0, 8, 8);
    if (mask & 4) g.fillRect(4, 8, 8, 8);
    if (mask & 8) g.fillRect(0, 4, 8, 8);
    if (mask & 2) g.fillRect(8, 4, 8, 8);
    g.fillRect(4, 4, 8, 8);
    g.fillStyle = PAL.ballastD;
    for (let i = 0; i < 16; i++) { const x = (i * 7) % 16, y = (i * 11 + 3) % 16; if (this.railBallast(mask, x, y)) g.fillRect(x, y, 1, 1); }
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
    // Schienenschatten
    g.fillStyle = 'rgba(0,0,0,0.25)';
    if (horiz) { g.fillRect(mask & 8 ? 0 : 4, 6, (mask & 8 ? 4 : 0) + 8 + (mask & 2 ? 4 : 0), 1); g.fillRect(mask & 8 ? 0 : 4, 11, (mask & 8 ? 4 : 0) + 8 + (mask & 2 ? 4 : 0), 1); }
  },

  railBallast(mask, x, y) {
    const inX = x >= 4 && x < 12, inY = y >= 4 && y < 12;
    return (inX && inY) || (inX && y < 4 && mask & 1) || (inX && y >= 12 && mask & 4) || (inY && x < 4 && mask & 8) || (inY && x >= 12 && mask & 2);
  },

  tileRail(mask) {
    return this.get('rail' + mask, TS, TS, g => { this.dirt(g, 110 + (mask & 3)); this.drawRailArms(g, mask); });
  },

  /** Holzmast mit Querträger (o: Leitung waagrecht = 0, senkrecht = 1). */
  drawPole(g, x, y, o) {
    this.rect(g, x + 1, y + 1, 2, 3, PAL.shadow);
    this.rect(g, x, y, 2, 3, PAL.pole);
    this.px(g, x, y, '#8a6a3a');
    if (o === 0) { this.rect(g, x, y - 1, 2, 1, '#3a2a1a'); }
    else { this.rect(g, x - 1, y, 4, 1, '#3a2a1a'); }
  },

  drawWireArms(g, mask, noPole) {
    if (mask === 0) mask = 10;
    // Schatten der Drähte
    g.fillStyle = 'rgba(0,0,0,0.2)';
    if (mask & 8) { g.fillRect(0, 8, 8, 1); g.fillRect(0, 11, 8, 1); }
    if (mask & 2) { g.fillRect(8, 8, 8, 1); g.fillRect(8, 11, 8, 1); }
    if (mask & 1) { g.fillRect(8, 2, 1, 8); g.fillRect(11, 2, 1, 8); }
    if (mask & 4) { g.fillRect(8, 10, 1, 6); g.fillRect(11, 10, 1, 6); }
    g.fillStyle = PAL.wire;
    if (mask & 8) { g.fillRect(0, 6, 8, 1); g.fillRect(0, 9, 8, 1); }
    if (mask & 2) { g.fillRect(8, 6, 8, 1); g.fillRect(8, 9, 8, 1); }
    if (mask & 1) { g.fillRect(6, 0, 1, 8); g.fillRect(9, 0, 1, 8); }
    if (mask & 4) { g.fillRect(6, 8, 1, 8); g.fillRect(9, 8, 1, 8); }
    if (!noPole) {
      this.rect(g, 8, 8, 4, 4, PAL.shadow);
      this.rect(g, 6, 6, 4, 4, PAL.pole);
      this.rect(g, 6, 6, 4, 1, '#3a2a1a'); this.rect(g, 6, 9, 4, 1, '#3a2a1a');
      this.rect(g, 7, 7, 2, 2, '#9a7a4a');
      this.px(g, 6, 6, '#c8c8c8'); this.px(g, 9, 6, '#c8c8c8'); this.px(g, 6, 9, '#c8c8c8'); this.px(g, 9, 9, '#c8c8c8');
    }
  },

  tileWire(mask) {
    return this.get('wire' + mask, TS, TS, g => { this.dirt(g, 130 + (mask & 3)); this.drawWireArms(g, mask); });
  },

  // Kreuzungen: o = 0 → Hauptweg waagrecht
  tileRoadWire(o) {
    return this.get('rw' + o, TS, TS, g => {
      this.dirt(g, 150 + o);
      this.drawRoadArms(g, o === 0 ? 10 : 5);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      if (o === 0) { g.fillRect(8, 2, 1, 14); g.fillRect(11, 2, 1, 14); } else { g.fillRect(2, 8, 14, 1); g.fillRect(2, 11, 14, 1); }
      g.fillStyle = PAL.wire;
      if (o === 0) { g.fillRect(6, 0, 1, TS); g.fillRect(9, 0, 1, TS); this.drawPole(g, 7, 0, 1); this.drawPole(g, 7, 13, 1); }
      else { g.fillRect(0, 6, TS, 1); g.fillRect(0, 9, TS, 1); this.drawPole(g, 0, 7, 0); this.drawPole(g, 14, 7, 0); }
    });
  },

  tileRoadRail(o) {
    return this.get('rr' + o, TS, TS, g => {
      this.dirt(g, 160 + o);
      this.drawRoadArms(g, o === 0 ? 10 : 5);
      g.fillStyle = PAL.tie;
      if (o === 0) { for (let y = 1; y < TS; y += 3) g.fillRect(4, y, 8, 2); g.fillStyle = PAL.railc; g.fillRect(5, 0, 1, TS); g.fillRect(10, 0, 1, TS); }
      else { for (let x = 1; x < TS; x += 3) g.fillRect(x, 4, 2, 8); g.fillStyle = PAL.railc; g.fillRect(0, 5, TS, 1); g.fillRect(0, 10, TS, 1); }
      // Andreaskreuze / Schranken
      const post = (x, y) => { this.px(g, x + 1, y + 1, PAL.shadow); this.px(g, x, y, '#f0f0f0'); this.px(g, x, y - 1, '#e02020'); };
      if (o === 0) { post(2, 2); post(13, 14); } else { post(1, 13); post(14, 2); }
    });
  },

  tileRailWire(o) {
    return this.get('lw' + o, TS, TS, g => {
      this.dirt(g, 170 + o);
      this.drawRailArms(g, o === 0 ? 10 : 5);
      g.fillStyle = PAL.wire;
      if (o === 0) { g.fillRect(6, 0, 1, TS); g.fillRect(9, 0, 1, TS); this.drawPole(g, 7, 0, 1); this.drawPole(g, 7, 13, 1); }
      else { g.fillRect(0, 6, TS, 1); g.fillRect(0, 9, TS, 1); this.drawPole(g, 0, 7, 0); this.drawPole(g, 14, 7, 0); }
    });
  },

  tileBridge(kind, o, frame, mask) {
    mask = this.normMask8(mask || 0);
    return this.get('br' + kind + o + '_' + frame + '_' + mask, TS, TS, g => {
      this.waterBase(g, frame);
      this.drawShore(g, mask, frame, mask);
      if (kind === 'wire') {
        // Mast im Wasser
        this.rect(g, 5, 9, 7, 3, 'rgba(0,0,0,0.3)');
        this.rect(g, 4, 7, 7, 3, '#8a8a88'); this.rect(g, 4, 7, 7, 1, '#b4b4b0'); this.rect(g, 4, 9, 7, 1, '#5e5e5c');
        this.drawWireArms(g, o === 0 ? 10 : 5);
        return;
      }
      const H = o === 0;
      // Pfeiler (unter der Fahrbahn sichtbar) mit Schatten
      if (H) {
        this.rect(g, 0, 13, TS, 2, 'rgba(0,0,0,0.3)');
        this.rect(g, 6, 13, 4, 3, '#86867e'); this.rect(g, 6, 13, 1, 3, '#b0b0a8'); this.rect(g, 9, 13, 1, 3, '#5e5e58');
        this.rect(g, 10, 14, 3, 2, 'rgba(0,0,0,0.35)');
        this.rect(g, 5, 15, 6, 1, PAL.foam);
      } else {
        this.rect(g, 0, 6, 2, 4, '#7a7a76'); this.rect(g, 14, 6, 2, 4, '#7a7a76');
        this.rect(g, 0, 6, 2, 1, '#a0a09a'); this.rect(g, 14, 6, 2, 1, '#a0a09a');
        this.rect(g, 14, 2, 2, TS - 2, 'rgba(0,0,0,0.3)');
      }
      const deck = kind === 'road' ? '#8c8c88' : '#6b5638';
      if (H) {
        this.rect(g, 0, 2, TS, 11, deck);
        this.rect(g, 0, 12, TS, 1, shade(deck, -0.35));
      } else {
        this.rect(g, 2, 0, 12, TS, deck);
        this.rect(g, 13, 0, 1, TS, shade(deck, -0.35));
      }
      if (kind === 'road') {
        g.fillStyle = PAL.asphalt;
        if (H) g.fillRect(0, 3, TS, 9); else g.fillRect(3, 0, 10, TS);
        g.fillStyle = PAL.line;
        if (H) for (let x = 1; x < TS; x += 4) g.fillRect(x, 7, 2, 1); else for (let y = 1; y < TS; y += 4) g.fillRect(7, y, 1, 2);
      } else {
        g.fillStyle = PAL.tie;
        if (H) { for (let x = 1; x < TS; x += 3) g.fillRect(x, 4, 2, 8); g.fillStyle = PAL.railc; g.fillRect(0, 5, TS, 1); g.fillRect(0, 10, TS, 1); }
        else { for (let y = 1; y < TS; y += 3) g.fillRect(4, y, 8, 2); g.fillStyle = PAL.railc; g.fillRect(5, 0, 1, TS); g.fillRect(10, 0, 1, TS); }
      }
      // Geländer mit Pfosten
      g.fillStyle = '#e4e4de';
      if (H) { g.fillRect(0, 2, TS, 1); g.fillRect(0, 11, TS, 1); }
      else { g.fillRect(2, 0, 1, TS); g.fillRect(12, 0, 1, TS); }
      g.fillStyle = '#4a4a48';
      if (H) for (let x = 0; x < TS; x += 4) { g.fillRect(x, 1, 1, 2); g.fillRect(x, 11, 1, 2); }
      else for (let y = 0; y < TS; y += 4) { g.fillRect(1, y, 2, 1); g.fillRect(12, y, 2, 1); }
    });
  },

  // ---------------- Gebäude-Bausteine ----------------
  /**
   * Block in 3/4-Ansicht: Dach oben, Fassade (Höhe hgt) unten, Schatten rechts.
   * opt.win: 'grid' (Standard) | 'band' | 'glass' | 'shop' | false
   */
  block(g, x, y, w, d, hgt, roof, wall, opt) {
    opt = opt || {};
    const top = y + d - hgt, rd = d - hgt;
    if (opt.shadow !== false) {
      const sw = Math.min(Math.max(2, Math.round(hgt * 0.5)), 9);
      const s0 = Math.min(Math.ceil(sw / 2), d - 1);
      g.fillStyle = PAL.shadow;
      g.fillRect(x + w, y + s0, sw, d - s0);
      g.fillRect(x + 2, y + d, w - 2, 1);
    }
    // Fassade
    this.rect(g, x, top, w, hgt, wall);
    const r = srng((x * 31 + y * 17 + w * 7 + hgt) | 0);
    const wc = opt.winCol || shade(wall, -0.5);
    const lit = opt.lit;
    const litC = '#ffe890';
    const style = opt.win === undefined ? 'grid' : opt.win;
    if (style && hgt >= 3) {
      const yb = y + d - 2;
      if (style === 'grid') {
        const fl = opt.floor || 3, st = opt.step || 2, ww = opt.ww || 1, wh = opt.wh || 1;
        for (let wy = top + 2; wy + wh - 1 <= yb - (hgt > 5 ? 1 : 0); wy += fl) {
          for (let wx = x + 1 + (opt.wx0 || 0); wx + ww - 1 < x + w - 1; wx += st) {
            this.rect(g, wx, wy, ww, wh, lit && r() < 0.25 ? litC : wc);
          }
        }
      } else if (style === 'band') {
        for (let wy = top + 2; wy <= yb - 1; wy += 3) {
          this.rect(g, x + 1, wy, w - 2, opt.wh || 1, wc);
          if (lit) for (let wx = x + 1; wx < x + w - 1; wx++) if (r() < 0.12) this.px(g, wx, wy, litC);
        }
      } else if (style === 'glass') {
        this.rect(g, x + 1, top + 1, w - 2, hgt - 2, wc);
        const hl = shade(wc, 0.35);
        for (let wy = top + 3; wy < yb; wy += 3) this.rect(g, x + 1, wy, w - 2, 1, shade(wc, -0.35));
        for (let wx = x + 3; wx < x + w - 1; wx += 3) this.rect(g, wx, top + 1, 1, hgt - 2, shade(wc, -0.2));
        // Spiegelung
        for (let i = 0; i < hgt - 2; i++) { const xx = x + 1 + Math.floor((i * 0.6)) % (w - 2); if (i % 7 < 3) this.px(g, xx, top + 1 + i, hl); }
        if (lit) for (let wy = top + 2; wy < yb; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 3) if (r() < 0.12) this.rect(g, wx + 1, wy, 1, 1, litC);
      } else if (style === 'shop') {
        this.rect(g, x + 1, yb - 2, w - 2, 2, wc);
        for (let wx = x + 3; wx < x + w - 2; wx += 4) this.px(g, wx, yb - 2, wall);
      }
      if (opt.shopFloor && hgt >= 6) { this.rect(g, x + 1, yb - 1, w - 2, 1, opt.shopFloor); }
    }
    this.rect(g, x, top, w, 1, shade(wall, 0.28));
    this.rect(g, x + w - 1, top, 1, hgt, shade(wall, -0.22));
    this.rect(g, x, y + d - 1, w, 1, shade(wall, -0.35));
    if (opt.door) { const dx = x + Math.floor(w / 2) - 1; this.rect(g, dx, y + d - 3, 2, 2, shade(wall, -0.6)); }
    // Dach
    if (rd > 0) {
      this.rect(g, x, y, w, rd, roof);
      if (rd > 1) {
        this.rect(g, x, y, w, 1, shade(roof, 0.25)); this.rect(g, x, y, 1, rd, shade(roof, 0.25));
        this.rect(g, x + w - 1, y, 1, rd, shade(roof, -0.2));
        this.rect(g, x, y + rd - 1, w, 1, shade(roof, -0.3));
      }
      if (opt.roofDetail && w > 7 && rd > 5) {
        const n = Math.max(1, Math.floor(w * rd / 140));
        for (let i = 0; i < n; i++) {
          const ax = x + 2 + Math.floor(r() * (w - 6)), ay = y + 2 + Math.floor(r() * (rd - 5));
          this.rect(g, ax + 1, ay + 1, 2, 2, shade(roof, -0.3));
          this.rect(g, ax, ay, 2, 2, shade(roof, 0.12)); this.px(g, ax, ay, shade(roof, 0.3));
        }
        if (w >= 12 && rd >= 8) {
          const bx = x + w - 6, by = y + 2;
          this.rect(g, bx + 1, by + 1, 3, 3, 'rgba(0,0,0,0.3)');
          this.rect(g, bx, by, 3, 3, shade(roof, -0.15)); this.rect(g, bx, by, 3, 1, shade(roof, 0.3));
        }
      }
      if (opt.tank && w >= 8 && rd >= 6) {
        const tx = x + 2, ty = y + 1;
        this.rect(g, tx + 1, ty + 4, 1, 1, '#3a2a1a'); this.rect(g, tx + 3, ty + 4, 1, 1, '#3a2a1a');
        this.rect(g, tx, ty, 5, 4, '#7a5a3a'); this.rect(g, tx, ty, 5, 1, '#9a7a5a'); this.rect(g, tx + 1, ty - 1, 3, 1, '#5a4030');
      }
      if (opt.heli && w >= 10 && rd >= 8) {
        const hx = x + Math.floor(w / 2), hy = y + Math.floor(rd / 2);
        this.disc(g, hx, hy, 4, '#5a5a5c');
        this.rect(g, hx - 2, hy - 2, 1, 4, '#f0f0f0'); this.rect(g, hx + 1, hy - 2, 1, 4, '#f0f0f0'); this.rect(g, hx - 1, hy - 1, 2, 1, '#f0f0f0');
      }
    }
  },

  antenna(g, x, y, h) {
    this.rect(g, x, y, 1, h, '#8a8a8a');
    this.px(g, x, y, '#ff3030');
    this.rect(g, x + 1, y + 2, 1, h - 2, 'rgba(0,0,0,0.3)');
  },

  /** Kleines Haus mit Satteldach. */
  house(g, x, y, w, roof, wall, r, opt) {
    opt = opt || {};
    const d = opt.d || Math.round(w * 0.9);
    const fh = opt.fh || (w >= 12 ? 4 : 3);
    const rd = d - fh;
    // Schatten
    this.rect(g, x + w, y + 2, 2, d - 2, PAL.shadow);
    this.rect(g, x + 2, y + d, w - 1, 1, PAL.shadow);
    // Fassade
    this.rect(g, x, y + rd, w, fh, wall);
    this.rect(g, x, y + d - 1, w, 1, shade(wall, -0.3));
    this.rect(g, x + w - 1, y + rd, 1, fh, shade(wall, -0.2));
    const win = opt.winCol || '#5a7ab0';
    const doorX = x + (opt.doorLeft ? 2 : w - 4);
    this.rect(g, doorX, y + d - 3, 1, 2, '#5a3a22');
    for (let wx = x + 1; wx < x + w - 1; wx += 3) {
      if (wx === doorX || wx + 1 === doorX) continue;
      this.rect(g, wx, y + rd + 1, Math.min(2, x + w - 1 - wx), 1, win);
    }
    // Satteldach (Traufe zeigt nach vorn)
    const half = Math.floor(rd / 2);
    this.rect(g, x - 1, y, w + 2, rd, roof);
    this.rect(g, x - 1, y, w + 2, half, shade(roof, 0.22));
    this.rect(g, x - 1, y + half, w + 2, 1, shade(roof, 0.45));
    this.rect(g, x - 1, y + rd - 1, w + 2, 1, shade(roof, -0.35));
    this.rect(g, x - 1, y, 1, rd, shade(roof, 0.05));
    this.rect(g, x + w, y, 1, rd, shade(roof, -0.25));
    if (r && r() < 0.55) { const cx = x + w - 4; this.rect(g, cx, y, 2, 2, '#7a4a3a'); this.px(g, cx, y, '#9a6a5a'); }
  },

  /** Kleiner Pkw (waagrecht). */
  car(g, x, y, col, vert) {
    if (vert) {
      this.rect(g, x + 1, y + 1, 2, 4, 'rgba(0,0,0,0.3)');
      this.rect(g, x, y, 2, 4, col); this.rect(g, x, y + 1, 2, 1, '#2a3040'); this.rect(g, x, y + 3, 2, 1, shade(col, -0.3));
    } else {
      this.rect(g, x + 1, y + 1, 4, 2, 'rgba(0,0,0,0.3)');
      this.rect(g, x, y, 4, 2, col); this.rect(g, x + 1, y, 1, 2, '#2a3040'); this.px(g, x, y, shade(col, 0.4));
    }
  },

  parking(g, x, y, w, h, r, fill) {
    this.rect(g, x, y, w, h, '#5a5a5c');
    this.rect(g, x, y, w, 1, '#77777a');
    g.fillStyle = '#d8d8d0';
    g.fillStyle = '#9a9a96';
    for (let px = x + 1; px < x + w - 1; px += 5) { g.fillRect(px, y + 1, 1, 4); if (h > 11) g.fillRect(px, y + h - 5, 1, 4); }
    const cars = ['#d03030', '#3050d0', '#e8e8e8', '#30a030', '#e0b020', '#202020', '#8a8a90'];
    for (let px = x + 3; px < x + w - 3; px += 5) {
      if (r() < (fill || 0.6)) this.car(g, px, y + 1, cars[Math.floor(r() * cars.length)], true);
      if (h > 11 && r() < (fill || 0.6)) this.car(g, px, y + h - 5, cars[Math.floor(r() * cars.length)], true);
    }
  },

  pool(g, x, y, w, h) {
    this.rect(g, x, y, w, h, '#e8e8e0');
    this.rect(g, x + 1, y + 1, w - 2, h - 2, '#48a8f0');
    this.rect(g, x + 1, y + 1, w - 2, 1, '#2a80d0');
    this.px(g, x + 2, y + 3, '#c8ecff');
  },

  zoneLetter(g, ox, oy, letter, col) {
    g.fillStyle = '#111'; g.fillRect(ox + 2, oy + 2, 13, 13);
    g.fillStyle = col; g.fillRect(ox + 1, oy + 1, 13, 13);
    g.fillStyle = shade(col, 0.35); g.fillRect(ox + 1, oy + 1, 13, 1); g.fillRect(ox + 1, oy + 1, 1, 13);
    g.fillStyle = shade(col, -0.3); g.fillRect(ox + 1, oy + 13, 13, 1); g.fillRect(ox + 13, oy + 1, 1, 13);
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
    g.fillStyle = shade(col, 0.4);
    for (let i = 1; i < s - 1; i += 3) { g.fillRect(i, 1, 2, 1); g.fillRect(i, s - 2, 2, 1); g.fillRect(1, i, 1, 2); g.fillRect(s - 2, i, 1, 2); }
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
    const v = z.var & 1;
    const r = srng(v * 1000 + z.den * 37 + z.val * 101 + z.type * 7 + (z.special || 0) * 13 + 1);
    switch (z.type) {
      case Z.RES: return z.special ? this.drawHospitalChurch(g, z.special, r, v) : (z.den === 0 ? this.drawHouses(g, z, r) : this.drawResidential(g, z.den, z.val, r, v));
      case Z.COM: return z.den === 0 ? this.drawEmpty(g, 'C', '#3a6ad8', r) : this.drawCommercial(g, z.den, z.val, r, v);
      case Z.IND: return z.den === 0 ? this.drawEmpty(g, 'I', '#d8b818', r) : this.drawIndustrial(g, z.den, z.val, r, v);
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
    { ground: 'dirt', roofs: ['#6e5a48', '#686868', '#7a4c3c'], wall: '#a89a84', walls: ['#a89a84', '#9a8a78', '#b0a090'], win: '#3a3a40' },
    { ground: '#7f9a48', roofs: ['#a8442e', '#86643e', '#6e7088'], wall: '#d4c4a4', walls: ['#c8a888', '#d4c4a4', '#b88a6a'], win: '#3c4c64' },
    { ground: '#5aa845', roofs: ['#c45232', '#3a66a8', '#8e5a4a'], wall: '#ecdcc0', walls: ['#ecdcc0', '#e8d0b0', '#f0e8d8'], win: '#3a5a8a' },
    { ground: '#4cb440', roofs: ['#e6e6e6', '#3c8cc4', '#c84a42'], wall: '#f6f2ea', walls: ['#f6f2ea', '#f0e8f0', '#e8f0f4'], win: '#2a6ab0' },
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
    // Einfahrt
    this.rect(g, ox + 11, oy + 12, 3, 4, val === 0 ? PAL.dirtD : '#a8a49a');
    this.house(g, ox + 3, oy + 2, 10, roof, p.walls[seed % 3], r, { winCol: p.win, doorLeft: seed & 1 });
    if (val >= 1) { this.px(g, ox + 1, oy + 14, '#2f7d32'); this.px(g, ox + 2, oy + 14, '#2f7d32'); }
    if (val >= 2) this.tree(g, ox + 2, oy + 13, 0, r, true);
    if (val === 3 && seed % 2) this.pool(g, ox + 1, oy + 12, 6, 4);
    if (val >= 1 && seed % 3 === 0) this.car(g, ox + 11, oy + 13, ['#d03030', '#3050d0', '#e8e8e8'][seed % 3]);
  },

  groundFor(g, p, seed, s) {
    if (p.ground === 'dirt') this.dirt(g, seed, 0, 0, s, s);
    else this.grass(g, seed, 0, 0, s, s, p.ground);
  },

  drawResidential(g, den, val, r, v) {
    const p = this.RES_PAL[val];
    const s = 48;
    this.groundFor(g, p, Math.floor(r() * 50), s);
    const roof = () => p.roofs[Math.floor(r() * 3)];
    const wall = () => p.walls[Math.floor(r() * 3)];
    const path = val === 0 ? PAL.dirtD : '#b8b0a0';
    const lit = val >= 1;
    const treeAt = (x, y, sz) => { if (val >= 1) this.tree(g, x, y, sz === undefined ? 1 : sz, r, val >= 1); };
    if (den === 1) {
      if (v === 0) {
        this.rect(g, 0, 22, s, 3, path);
        const spots = [[3, 3], [26, 3], [3, 27], [26, 27]];
        for (const [x, y] of spots) this.house(g, x + 1 + Math.floor(r() * 2), y + Math.floor(r() * 2), 15, roof(), wall(), r, { winCol: p.win, d: 14, fh: 5, doorLeft: r() < 0.5 });
        if (val >= 2) { treeAt(22, 6); treeAt(22, 30); }
        if (val === 3) this.pool(g, 36, 43, 8, 4);
        else if (val >= 1) { this.car(g, 4, 44, '#d03030'); this.car(g, 28, 20, '#3050d0'); }
      } else {
        // Reihenhäuser
        this.rect(g, 0, 20, s, 3, path);
        const rf = roof(), wl = wall();
        for (let i = 0; i < 4; i++) this.house(g, 3 + i * 11, 4, 10, i % 2 ? shade(rf, -0.12) : rf, wl, null, { winCol: p.win, d: 14, fh: 5 });
        for (let i = 0; i < 3; i++) this.house(g, 3 + i * 15, 27, 12, roof(), wall(), r, { winCol: p.win, d: 13, fh: 5, doorLeft: i & 1 });
        treeAt(44, 30, 0); treeAt(44, 42, 0);
        if (val === 3) this.pool(g, 4, 42, 7, 4);
      }
    } else if (den === 2) {
      if (v === 0) {
        this.block(g, 3, 3, 18, 18, 8, roof(), wall(), { roofDetail: true, winCol: p.win, lit, door: true });
        this.block(g, 26, 3, 18, 18, 8, roof(), wall(), { roofDetail: true, winCol: p.win, lit, door: true });
        this.block(g, 5, 27, 34, 17, 7, roof(), wall(), { roofDetail: true, winCol: p.win, lit, step: 3, ww: 2 });
        treeAt(43, 30); treeAt(43, 40);
      } else {
        this.block(g, 3, 3, 28, 17, 8, roof(), wall(), { roofDetail: true, winCol: p.win, lit, door: true, step: 3, ww: 2 });
        this.block(g, 31, 3, 14, 38, 8, roof(), wall(), { roofDetail: true, winCol: p.win, lit, door: true });
        if (val >= 1) { treeAt(8, 28); treeAt(18, 34); treeAt(9, 40); }
        else { this.rect(g, 4, 26, 22, 16, '#6a6058'); }
        if (val === 3) this.pool(g, 17, 25, 10, 6);
      }
    } else if (den === 3) {
      if (v === 0) {
        this.block(g, 3, 2, 19, 32, 15, roof(), wall(), { roofDetail: true, winCol: p.win, lit, step: 3, ww: 2, door: true });
        this.block(g, 26, 8, 19, 30, 14, roof(), wall(), { roofDetail: true, winCol: p.win, lit, step: 3, ww: 2, door: true, tank: val <= 1 });
        this.rect(g, 0, 42, s, 2, path);
        treeAt(6, 44, 0); treeAt(18, 44, 0); treeAt(32, 44, 0);
      } else {
        const rf = roof(), wl = wall();
        this.block(g, 3, 2, 42, 16, 10, rf, wl, { roofDetail: true, winCol: p.win, lit, step: 3, ww: 2 });
        if (val >= 1) { this.tree(g, 24, 24, 2, r, true); this.tree(g, 20, 34, 1, r, true); this.tree(g, 28, 36, 1, r, true); }
        if (val >= 2) { this.disc(g, 24, 30, 3, '#d0d0c8'); this.disc(g, 24, 30, 2, '#4a8ae0'); }
        this.block(g, 3, 14, 13, 32, 11, rf, wl, { roofDetail: true, winCol: p.win, lit, door: true });
        this.block(g, 32, 14, 13, 32, 11, rf, wl, { roofDetail: true, winCol: p.win, lit, door: true });
      }
    } else {
      if (v === 0) {
        this.block(g, 4, 1, 17, 38, 24, roof(), wall(), { roofDetail: true, winCol: p.win, lit: true, heli: false, tank: val === 0 });
        this.block(g, 26, 6, 18, 38, 26, roof(), wall(), { roofDetail: true, winCol: p.win, lit: true, step: 3, ww: 2 });
        if (val === 3) this.pool(g, 4, 42, 12, 5);
        else treeAt(10, 44, 0);
      } else {
        const rf = roof(), wl = wall();
        this.block(g, 2, 26, 44, 18, 6, rf, wl, { roofDetail: false, winCol: p.win, lit: true, step: 3, ww: 2 });
        this.block(g, 12, 0, 24, 40, 28, rf, wl, { roofDetail: true, winCol: p.win, lit: true, step: 3, ww: 2, heli: val === 3 });
        if (val >= 2) { this.tree(g, 5, 29, 0, r, true); this.tree(g, 42, 29, 0, r, true); }
      }
    }
  },

  drawHospitalChurch(g, kind, r, v) {
    void v;
    this.grass(g, 300 + kind, 0, 0, 48, 48);
    if (kind === 1) {
      // Krankenhaus: weißer H-Bau, rotes Kreuz, Krankenwagen
      this.rect(g, 0, 40, 48, 8, '#9a9a96'); this.rect(g, 0, 40, 48, 1, '#b8b8b4');
      this.block(g, 3, 4, 12, 32, 10, '#e8e8ec', '#f4f4f4', { winCol: '#4a7ac0', step: 2 });
      this.block(g, 33, 4, 12, 32, 10, '#e8e8ec', '#f4f4f4', { winCol: '#4a7ac0', step: 2 });
      this.block(g, 13, 8, 22, 24, 12, '#dcdce4', '#ffffff', { winCol: '#4a7ac0', step: 2, door: true });
      // Kreuz auf dem Dach
      this.rect(g, 18, 9, 12, 10, '#ffffff');
      this.rect(g, 22, 10, 4, 8, '#e01818'); this.rect(g, 19, 12, 10, 4, '#e01818');
      // Krankenwagen
      this.rect(g, 7, 43, 9, 4, 'rgba(0,0,0,0.3)');
      this.rect(g, 6, 42, 9, 4, '#f8f8f8'); this.rect(g, 7, 43, 3, 1, '#e01818'); this.rect(g, 12, 42, 2, 2, '#4a7ac0'); this.px(g, 10, 42, '#3060ff');
      this.car(g, 30, 43, '#3050d0'); this.car(g, 36, 43, '#e8e8e8');
      this.tree(g, 24, 37, 0, r, true);
    } else {
      // Kirche: Kirchenschiff mit Satteldach, Turm mit Spitze, Friedhof
      this.rect(g, 0, 44, 48, 3, '#a8a49a');
      this.rect(g, 21, 38, 6, 7, '#a8a49a');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const gx = 3 + i * 4, gy = 32 + j * 5;
        this.px(g, gx + 1, gy + 1, PAL.shadow); this.rect(g, gx, gy - 1, 1, 2, '#d8d8d8');
      }
      this.tree(g, 5, 8, 2, r, true); this.tree(g, 42, 30, 2, r, true); this.tree(g, 41, 8, 1, r, true);
      // Schiff
      this.rect(g, 33, 12, 4, 26, PAL.shadow);
      this.rect(g, 15, 24, 18, 14, '#d8c8a8');
      this.rect(g, 15, 24, 18, 1, '#ece0c8'); this.rect(g, 32, 24, 1, 14, '#b0a080');
      for (let x = 17; x < 31; x += 4) { this.rect(g, x, 27, 2, 4, '#4a6ad0'); this.px(g, x, 27, '#e0c040'); this.px(g, x + 1, 29, '#d04040'); }
      this.rect(g, 22, 33, 4, 5, '#5a3a22'); this.rect(g, 22, 33, 4, 1, '#3a2010');
      // Dach (steil, in die Tiefe)
      this.rect(g, 14, 8, 20, 16, '#7a3a2a');
      for (let y = 8; y < 24; y += 2) this.rect(g, 14, y, 20, 1, '#8a4a36');
      this.rect(g, 23, 8, 2, 16, '#a85a40'); this.rect(g, 14, 23, 20, 1, '#4a2018');
      // Turm
      this.rect(g, 21, 4, 8, 38, PAL.shadow);
      this.rect(g, 19, 22, 10, 18, '#e0d4bc'); this.rect(g, 28, 22, 1, 18, '#b0a080'); this.rect(g, 19, 22, 10, 1, '#f4ecdc');
      this.rect(g, 22, 25, 4, 4, '#3a3a3a'); this.disc(g, 24, 27, 1.5, '#e0c040');
      this.rect(g, 22, 33, 4, 7, '#5a3a22'); this.rect(g, 23, 34, 2, 6, '#7a4a2a');
      // Spitze
      for (let i = 0; i < 12; i++) { const hw = Math.ceil((i + 1) * 5 / 12); this.rect(g, 24 - hw, 10 + i, hw * 2, 1, i % 3 === 0 ? '#3a6a5a' : '#4a8a72'); this.px(g, 24 + hw - 1, 10 + i, '#2a4a40'); }
      this.rect(g, 23, 3, 2, 7, '#ffd040'); this.rect(g, 21, 5, 6, 2, '#ffd040'); this.px(g, 25, 4, '#b08a20');
    }
  },

  COM_PAL: [
    { ground: '#8a8478', roofs: ['#7a6e62', '#6a6a6a', '#8a6248'], walls: ['#9a5a44', '#a89c8c', '#8a6a52'], glass: '#3a3a42' },
    { ground: '#9a9a92', roofs: ['#8a8a8a', '#a08060', '#6a7a8a'], walls: ['#c8b48c', '#c4bcac', '#b07a5a'], glass: '#34445c' },
    { ground: '#a8a8a4', roofs: ['#b0b0b8', '#5a7aa0', '#c0a080'], walls: ['#d8d4cc', '#c8c8c8', '#d0c0a0'], glass: '#2c5a94' },
    { ground: '#b4b4b4', roofs: ['#e0e4ea', '#4a8ac8', '#c8c8d8'], walls: ['#eef0f4', '#d8e0ea', '#e8e4dc'], glass: '#2a70c0' },
  ],

  drawCommercial(g, den, val, r, v) {
    const p = this.COM_PAL[val];
    const s = 48;
    g.fillStyle = p.ground; g.fillRect(0, 0, s, s);
    g.fillStyle = shade(p.ground, -0.12);
    for (let i = 0; i < 10; i++) g.fillRect(Math.floor(r() * 46), Math.floor(r() * 46), 2, 1);
    g.fillStyle = shade(p.ground, 0.12);
    for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 46), Math.floor(r() * 46), 1, 1);
    const roof = () => p.roofs[Math.floor(r() * 3)];
    const wall = () => p.walls[Math.floor(r() * 3)];
    const lit = val >= 1;
    const awn = ['#e04040', '#40a040', '#e0c020', '#4060e0', '#e07020'];
    const awning = (x, y, w) => {
      const c = awn[Math.floor(r() * awn.length)];
      for (let i = 0; i < w; i++) this.px(g, x + i, y, (i >> 1) % 2 ? c : '#f0f0f0');
      this.rect(g, x, y + 1, w, 1, shade(c, -0.3));
    };
    const glassy = val >= 2;
    if (den === 1) {
      if (v === 0) {
        this.block(g, 3, 3, 18, 15, 5, roof(), wall(), { winCol: p.glass, win: 'shop', roofDetail: true });
        this.block(g, 26, 3, 19, 15, 5, roof(), wall(), { winCol: p.glass, win: 'shop', roofDetail: true });
        awning(3, 13, 18); awning(26, 13, 19);
        this.parking(g, 3, 24, 42, 20, r, 0.5);
      } else {
        // Tankstelle
        this.rect(g, 2, 22, 44, 23, '#6a6a6c');
        this.block(g, 3, 3, 20, 15, 5, roof(), wall(), { winCol: p.glass, win: 'shop', door: true });
        awning(3, 13, 20);
        this.rect(g, 28, 32, 16, 3, PAL.shadow);
        this.rect(g, 30, 26, 2, 6, '#909090'); this.rect(g, 40, 26, 2, 6, '#909090');
        this.rect(g, 27, 22, 18, 5, '#f0f0f0'); this.rect(g, 27, 26, 18, 1, '#d02020'); this.rect(g, 27, 22, 18, 1, '#ffffff');
        for (const x of [29, 35, 41]) { this.rect(g, x, 30, 2, 3, '#d02020'); this.px(g, x, 30, '#ffe040'); }
        this.car(g, 32, 36, '#3050d0'); this.car(g, 8, 36, '#e0b020');
        this.rect(g, 4, 23, 1, 9, '#606060'); this.rect(g, 2, 21, 6, 4, '#e0c020'); this.rect(g, 3, 22, 4, 2, '#d02020');
      }
    } else if (den === 2) {
      if (v === 0) {
        const fac = ['#b05a44', '#c8b48c', '#6a8aa8', '#a8a090'];
        for (let i = 0; i < 3; i++) {
          const x = 2 + i * 15;
          this.block(g, x, 3, 14, 22, 9, roof(), val >= 2 ? wall() : fac[Math.floor(r() * 4)], { winCol: p.glass, roofDetail: true, lit, step: 3, ww: 2, shadow: i === 2 });
          awning(x, 22, 14);
        }
        this.parking(g, 3, 30, 42, 15, r, 0.55);
      } else {
        this.block(g, 3, 3, 22, 26, 11, roof(), wall(), { winCol: p.glass, roofDetail: true, lit, win: glassy ? 'band' : 'grid', door: true });
        this.block(g, 29, 12, 16, 16, 6, roof(), wall(), { winCol: p.glass, win: 'shop' });
        awning(29, 25, 16);
        this.parking(g, 3, 33, 42, 12, r, 0.5);
      }
    } else if (den === 3) {
      if (v === 0) {
        this.block(g, 4, 2, 24, 32, 16, roof(), wall(), { winCol: p.glass, roofDetail: true, lit, win: glassy ? 'band' : 'grid', step: 3, ww: 2, door: true });
        this.block(g, 31, 10, 14, 24, 9, roof(), wall(), { winCol: p.glass, roofDetail: true, lit });
        this.parking(g, 3, 37, 42, 8, r, 0.6);
      } else {
        // Kaufhaus
        const w = wall();
        this.block(g, 3, 3, 42, 30, 12, roof(), w, { winCol: p.glass, roofDetail: true, lit, win: 'band' });
        this.rect(g, 3, 24, 42, 3, '#c02828'); this.rect(g, 3, 24, 42, 1, '#e04848');
        for (let x = 8; x < 42; x += 6) this.rect(g, x, 25, 3, 1, '#ffe060');
        this.rect(g, 3, 30, 42, 2, p.glass); this.rect(g, 21, 30, 6, 3, '#202020');
        this.parking(g, 3, 37, 42, 8, r, 0.7);
      }
    } else if (den === 4) {
      if (v === 0) {
        this.block(g, 5, 1, 22, 42, 26, roof(), wall(), { winCol: p.glass, roofDetail: true, lit: true, win: glassy ? 'glass' : 'grid', step: 3, ww: 2 });
        this.block(g, 31, 16, 14, 26, 11, roof(), wall(), { winCol: p.glass, roofDetail: true, lit: true });
        this.antenna(g, 10, 0, 6);
      } else {
        this.block(g, 3, 2, 18, 40, 24, roof(), wall(), { winCol: p.glass, roofDetail: true, lit: true, win: glassy ? 'glass' : 'band' });
        this.block(g, 26, 6, 18, 38, 22, roof(), wall(), { winCol: p.glass, roofDetail: true, lit: true, win: glassy ? 'glass' : 'band' });
        this.rect(g, 21, 30, 5, 3, shade(p.ground, -0.2));
      }
    } else {
      // Wolkenkratzer
      const st = val >= 2 ? 'glass' : 'grid';
      const wl = val >= 2 ? (val === 3 ? '#9ab8d8' : '#b8c0c8') : wall();
      const rf = roof();
      if (v === 0) {
        this.block(g, 31, 10, 14, 36, 28, rf, val >= 2 ? '#c8d0d8' : wall(), { winCol: p.glass, roofDetail: true, lit: true, win: 'band' });
        this.block(g, 3, 20, 26, 26, 14, rf, wl, { winCol: p.glass, lit: true, win: st, step: 3, ww: 2 });
        this.block(g, 6, 8, 20, 14, 10, rf, wl, { winCol: p.glass, lit: true, win: st, step: 3, ww: 2, shadow: false });
        this.block(g, 9, 0, 14, 10, 7, rf, wl, { winCol: p.glass, lit: true, win: st, shadow: false });
        this.antenna(g, 15, 0, 3); this.px(g, 16, 1, '#ff3030');
      } else {
        this.block(g, 2, 0, 20, 46, 34, rf, wl, { winCol: p.glass, roofDetail: true, lit: true, win: st, step: 3, ww: 2, heli: val === 3 });
        this.block(g, 26, 6, 19, 40, 28, roof(), val >= 2 ? '#d8dce4' : wall(), { winCol: p.glass, roofDetail: true, lit: true, win: val >= 2 ? 'band' : 'grid' });
        this.antenna(g, 35, 0, 7);
      }
    }
  },

  drawIndustrial(g, den, val, r, v) {
    const s = 48;
    const ground = val ? '#7c7a70' : '#6e5e4a';
    g.fillStyle = ground; g.fillRect(0, 0, s, s);
    g.fillStyle = shade(ground, -0.15);
    for (let i = 0; i < 30; i++) g.fillRect(Math.floor(r() * 47), Math.floor(r() * 47), 1 + Math.floor(r() * 2), 1);
    g.fillStyle = shade(ground, 0.12);
    for (let i = 0; i < 10; i++) g.fillRect(Math.floor(r() * 47), Math.floor(r() * 47), 1, 1);
    const wall = val ? '#a8a49a' : '#8e7a62';
    const roofA = val ? '#7a8088' : '#6a5a48';
    const roofB = val ? '#9a6a4a' : '#5a4a3a';
    const accent = val ? '#3a6aa8' : '#a84a2a';
    // Sägezahndach-Halle
    const shed = (x, y, w, d, h) => {
      h = h || 6;
      this.block(g, x, y, w, d, h, roofA, wall, { win: 'band', winCol: shade(wall, -0.4) });
      for (let xx = x + 2; xx < x + w - 2; xx += 4) {
        this.rect(g, xx, y + 1, 1, d - h - 2, '#c8d4dc');
        this.rect(g, xx + 1, y + 1, 1, d - h - 2, shade(roofA, -0.3));
      }
      this.rect(g, x + 2, y + d - 4, 5, 3, '#3a3a3a'); this.rect(g, x + 2, y + d - 4, 5, 1, accent);
    };
    const tank = (x, y, rad) => {
      this.disc(g, x + 2, y + 2, rad, 'rgba(0,0,0,0.35)');
      const c = val ? '#c8c8c0' : '#a09070';
      this.rect(g, x - rad, y, rad * 2, Math.ceil(rad / 2), shade(c, -0.25));
      this.disc(g, x, y, rad, c);
      this.disc(g, x - 1, y - 1, Math.max(1, rad - 2), shade(c, 0.25));
      this.px(g, x, y, shade(c, -0.3));
    };
    const stack = (x, y) => {
      this.rect(g, x + 3, y + 3, 3, 10, PAL.shadow);
      this.rect(g, x, y, 3, 12, '#8a4a34'); this.rect(g, x + 2, y, 1, 12, '#6a3424');
      this.rect(g, x, y + 2, 3, 1, '#e8e8e8'); this.rect(g, x, y + 5, 3, 1, '#e8e8e8');
      this.rect(g, x, y, 3, 1, '#1a1a1a');
    };
    const crates = (x, y, n) => {
      const cc = ['#b08040', '#8a6030', '#a0a0a0', accent];
      for (let i = 0; i < n; i++) {
        const cx = x + (i % 4) * 4, cy = y + Math.floor(i / 4) * 4;
        this.rect(g, cx + 1, cy + 1, 3, 3, PAL.shadow);
        this.rect(g, cx, cy, 3, 3, cc[Math.floor(r() * 4)]); this.px(g, cx, cy, '#e0c890');
      }
    };
    const truck = (x, y, c) => {
      this.rect(g, x + 1, y + 1, 10, 4, PAL.shadow);
      this.rect(g, x, y, 7, 4, '#e0e0d8'); this.rect(g, x, y, 7, 1, '#ffffff');
      this.rect(g, x + 7, y + 1, 3, 3, c); this.px(g, x + 9, y + 1, '#2a3040');
    };
    const pipe = (x0, y0, x1, y1) => {
      this.rect(g, Math.min(x0, x1), Math.min(y0, y1) + 1, Math.abs(x1 - x0) + 2, Math.abs(y1 - y0) + 2, 'rgba(0,0,0,0.3)');
      this.rect(g, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 2, Math.abs(y1 - y0) + 2, '#b0a898');
    };
    if (den === 1) {
      if (v === 0) {
        this.block(g, 4, 5, 26, 20, 6, roofA, wall, { win: false });
        for (let xx = 5; xx < 29; xx += 2) this.rect(g, xx, 6, 1, 12, shade(roofA, -0.18));
        this.rect(g, 8, 21, 6, 4, '#3a3a3a'); this.rect(g, 18, 21, 6, 4, '#3a3a3a');
        crates(5, 31, 8); crates(34, 6, 6);
        truck(26, 38, accent); this.rect(g, 33, 26, 12, 8, '#5a4a3a');
      } else {
        this.block(g, 3, 4, 16, 16, 5, roofB, wall, { win: false, door: true });
        this.block(g, 23, 4, 20, 14, 5, roofA, wall, { win: 'band', winCol: shade(wall, -0.4) });
        tank(11, 32, 5); tank(23, 34, 4);
        crates(32, 26, 8); truck(30, 39, accent);
      }
    } else if (den === 2) {
      shed(3, 4, 28, 24);
      this.block(g, 34, 22, 11, 18, 7, roofB, wall, { door: true });
      if (v === 0) { tank(12, 38, 5); tank(24, 39, 4); }
      else { crates(4, 33, 8); truck(18, 40, accent); }
      stack(38, 4);
    } else if (den === 3) {
      shed(3, 3, 24, 20);
      shed(3, 26, 24, 19, 5);
      if (v === 0) { tank(37, 30, 6); pipe(30, 14, 41, 14); }
      else { tank(36, 26, 4); tank(40, 38, 4); pipe(28, 34, 34, 34); }
      stack(33, 4); stack(39, 6);
    } else {
      this.block(g, 2, 8, 30, 36, 11, roofB, wall, { roofDetail: true, win: 'band', winCol: shade(wall, -0.4) });
      this.rect(g, 4, 22, 26, 2, accent);
      if (v === 0) { tank(40, 12, 6); tank(40, 32, 6); pipe(33, 20, 37, 20); pipe(33, 30, 37, 30); }
      else { tank(39, 14, 5); this.block(g, 34, 26, 12, 18, 8, roofA, wall, { win: 'band' }); pipe(36, 20, 42, 20); }
      stack(7, 0); stack(15, 0); stack(23, 1);
    }
  },

  // ---------------- Sonderbauten ----------------
  star(g, cx, cy, ro, ri, c) {
    const P = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : ro;
      P.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    this.pixels(g, Math.floor(cx - ro - 1), Math.floor(cy - ro - 1), Math.ceil(ro * 2 + 2), Math.ceil(ro * 2 + 2), (x, y) => {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? c : null;
    });
  },

  drawPolice(g, r) {
    g.fillStyle = '#9c9c98'; g.fillRect(0, 0, 48, 48);
    this.grass(g, 501, 0, 0, 48, 6);
    this.tree(g, 4, 3, 0, r, true); this.tree(g, 44, 3, 0, r, true);
    this.block(g, 4, 5, 40, 28, 9, '#2c4a8a', '#d8dce4', { roofDetail: false, winCol: '#2c4a8a', step: 3, ww: 2, door: true });
    this.rect(g, 4, 25, 40, 1, '#2c4a8a');
    this.star(g, 24, 14, 6.5, 2.8, '#1a2a50');
    this.star(g, 23.5, 13.5, 6, 2.6, '#ffd040');
    this.px(g, 23, 13, '#fff0a0');
    // Fahnenmast
    this.rect(g, 6, 35, 1, 1, PAL.shadow); this.rect(g, 3, 26, 1, 10, '#d0d0d0');
    this.rect(g, 4, 26, 4, 3, '#2050c0');
    this.rect(g, 2, 36, 44, 10, '#58585a');
    for (let i = 0; i < 3; i++) {
      const x = 6 + i * 13;
      this.rect(g, x + 1, 39, 9, 5, 'rgba(0,0,0,0.3)');
      this.rect(g, x, 38, 9, 5, '#f4f4f4'); this.rect(g, x + 2, 38, 4, 5, '#1a1a3a'); this.rect(g, x + 3, 39, 2, 3, '#4a6aa0');
      this.px(g, x + 3, 38, '#ff2020'); this.px(g, x + 4, 38, '#2060ff');
    }
  },

  drawFireStation(g, r) {
    g.fillStyle = '#9c9c98'; g.fillRect(0, 0, 48, 48);
    this.grass(g, 502, 0, 0, 48, 5);
    this.tree(g, 44, 2, 0, r, true);
    // Schlauchturm
    this.block(g, 3, 1, 9, 32, 20, '#8a2418', '#c86a4a', { win: false });
    this.rect(g, 5, 16, 2, 3, '#3a3a3a'); this.rect(g, 5, 22, 2, 3, '#3a3a3a');
    this.block(g, 12, 6, 33, 27, 10, '#a82418', '#d8c0a0', { win: false });
    this.rect(g, 22, 9, 12, 3, '#ffffff'); this.rect(g, 26, 7, 4, 7, '#ffffff');
    this.rect(g, 23, 10, 10, 1, '#e02018'); this.rect(g, 27, 8, 2, 5, '#e02018');
    // Tore
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 10;
      this.rect(g, x, 25, 8, 7, '#2a2a2a'); this.rect(g, x, 25, 8, 1, '#5a5a5a');
      this.rect(g, x + 1, 27, 6, 5, '#c81810'); this.rect(g, x + 2, 28, 4, 1, '#9ad');
    }
    // Löschfahrzeuge
    for (let i = 0; i < 2; i++) {
      const x = 8 + i * 20;
      this.rect(g, x + 1, 39, 15, 6, PAL.shadow);
      this.rect(g, x, 37, 15, 6, '#d82018'); this.rect(g, x, 37, 15, 1, '#ff5040');
      this.rect(g, x + 1, 38, 10, 1, '#e8e8e8'); this.rect(g, x + 1, 40, 10, 1, '#9a1810');
      this.rect(g, x + 12, 38, 2, 2, '#9ad'); this.px(g, x + 12, 37, '#3060ff');
    }
  },

  drawStadium(g, full, r) {
    const s = 64;
    this.grass(g, 600, 0, 0, s, s, '#5a9a40');
    // Parkplatz-Ecken
    this.rect(g, 0, 56, 14, 8, '#6a6a6c'); this.rect(g, 50, 56, 14, 8, '#6a6a6c');
    this.ellipse(g, 34, 34, 30, 27, 'rgba(0,0,0,0.35)');
    this.ellipse(g, 32, 32, 30, 27, '#8a8680');
    const tiers = ['#d0ccc4', '#a8a49c', '#c4c0b8', '#9a968e', '#b8b4ac'];
    for (let i = 0; i < 5; i++) this.ellipse(g, 32, 32, 29 - i * 2, 26 - i * 2, tiers[i]);
    if (full) {
      const cols = ['#e04040', '#4040e0', '#f0f0f0', '#f0d040', '#40c040', '#f08020'];
      this.pixels(g, 2, 5, 60, 54, (x, y) => {
        const dx = (x + 0.5 - 32) / 28, dy = (y + 0.5 - 32) / 25, d = dx * dx + dy * dy;
        if (d > 1 || d < 0.48) return null;
        return r() < 0.42 ? cols[Math.floor(r() * cols.length)] : null;
      });
    }
    this.ellipse(g, 32, 32, 19, 16, '#6a665e');
    // Spielfeld
    this.rect(g, 15, 19, 34, 26, '#3c9a2c');
    for (let x = 15; x < 49; x += 6) this.rect(g, x, 19, 3, 26, '#48aa36');
    g.fillStyle = '#fff';
    g.fillRect(17, 21, 30, 1); g.fillRect(17, 42, 30, 1); g.fillRect(17, 21, 1, 22); g.fillRect(46, 21, 1, 22);
    g.fillRect(32, 21, 1, 22);
    this.pixels(g, 27, 27, 11, 11, (x, y) => Math.abs(Math.hypot(x + 0.5 - 32.5, y + 0.5 - 32) - 3.6) < 0.55 ? '#fff' : null);
    g.fillRect(17, 28, 3, 1); g.fillRect(17, 36, 3, 1); g.fillRect(19, 28, 1, 9);
    g.fillRect(44, 28, 3, 1); g.fillRect(44, 36, 3, 1); g.fillRect(44, 28, 1, 9);
    if (full) {
      for (let i = 0; i < 6; i++) this.rect(g, 20 + Math.floor(r() * 11), 24 + Math.floor(r() * 16), 1, 2, '#ff2020');
      for (let i = 0; i < 6; i++) this.rect(g, 34 + Math.floor(r() * 11), 24 + Math.floor(r() * 16), 1, 2, '#2020ff');
      this.px(g, 32, 32, '#ffffff');
    }
    // Flutlichtmasten
    for (const [x, y] of [[5, 6], [57, 6], [5, 55], [57, 55]]) {
      this.rect(g, x + 1, y + 1, 3, 3, PAL.shadow);
      this.rect(g, x, y, 3, 2, '#e8e8e0'); this.rect(g, x, y + 2, 3, 1, '#5a5a5a');
    }
  },

  drawPort(g, r) {
    const s = 64;
    g.fillStyle = '#8c8c86'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) this.px(g, Math.floor(r() * 34), Math.floor(r() * 64), '#7e7e78');
    // Hafenbecken
    for (let ty = 0; ty < 4; ty++) for (let tx = 2; tx < 4; tx++) g.drawImage(this.tileWater(0, (tx + ty) & 3), tx * 16, ty * 16);
    this.rect(g, 34, 0, 3, 64, '#5a5048'); this.rect(g, 34, 0, 1, 64, '#8a7a68');
    for (let y = 2; y < 64; y += 6) this.rect(g, 36, y, 2, 2, '#2a2a2a');
    // Pier
    this.rect(g, 37, 27, 24, 2, 'rgba(0,0,0,0.3)');
    this.rect(g, 37, 22, 24, 6, '#9a8a70'); this.rect(g, 37, 22, 24, 1, '#b8a888');
    for (let x = 39; x < 61; x += 5) this.rect(g, x, 28, 1, 2, '#5a4a38');
    // Schiff
    this.rect(g, 43, 43, 19, 8, 'rgba(0,0,0,0.3)');
    this.rect(g, 41, 40, 19, 8, '#8a2a1a'); this.rect(g, 41, 40, 19, 1, '#b04030');
    this.rect(g, 59, 41, 2, 6, '#8a2a1a'); this.rect(g, 61, 42, 1, 4, '#8a2a1a');
    this.rect(g, 42, 41, 6, 6, '#e8e8e8'); this.rect(g, 42, 41, 6, 1, '#ffffff'); this.rect(g, 43, 43, 4, 1, '#2a3040');
    this.rect(g, 49, 41, 4, 3, '#2050a0'); this.rect(g, 53, 41, 4, 3, '#e0a020'); this.rect(g, 49, 44, 4, 3, '#c03020'); this.rect(g, 53, 44, 4, 3, '#309040');
    this.rect(g, 41, 47, 19, 1, '#2a2a2a');
    // Lagerhalle
    this.block(g, 3, 2, 28, 15, 6, '#7a6a5a', '#b0a088', { win: false });
    for (let x = 5; x < 30; x += 2) this.rect(g, x, 3, 1, 8, '#6a5a4a');
    this.rect(g, 8, 13, 6, 4, '#3a3a3a'); this.rect(g, 19, 13, 6, 4, '#3a3a3a');
    // Container
    const cc = ['#c03020', '#2050a0', '#e0a020', '#309040', '#d06020'];
    for (let y = 22; y < 52; y += 5) for (let x = 3; x < 28; x += 7) {
      if (r() < 0.2) continue;
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 1, y + 1, 6, 4);
      const c = cc[Math.floor(r() * 5)];
      this.rect(g, x, y, 6, 4, c); this.rect(g, x, y, 6, 1, shade(c, 0.3));
      for (let k = 1; k < 6; k += 2) this.px(g, x + k, y + 2, shade(c, -0.3));
    }
    // Kräne
    for (const y of [8, 34]) {
      this.rect(g, 31, y + 3, 16, 3, 'rgba(0,0,0,0.3)');
      this.rect(g, 28, y, 3, 9, '#e0b818'); this.rect(g, 30, y, 1, 9, '#a88a10');
      this.rect(g, 26, y + 1, 20, 2, '#e0b818'); this.rect(g, 26, y + 2, 20, 1, '#a88a10');
      this.rect(g, 27, y - 1, 2, 2, '#3a3a3a');
      this.rect(g, 42, y + 3, 1, 5, '#2a2a2a'); this.rect(g, 41, y + 8, 3, 1, '#2a2a2a');
    }
    this.rect(g, 3, 56, 28, 5, '#d8d8d0'); this.rect(g, 3, 60, 28, 1, '#a8a8a0');
    for (let x = 5; x < 30; x += 4) this.rect(g, x, 57, 2, 2, '#9a9a94');
  },

  drawCoal(g, r) {
    const s = 64;
    g.fillStyle = '#6a6460'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) this.px(g, Math.floor(r() * 64), Math.floor(r() * 64), r() < 0.5 ? '#5a5450' : '#7a746e');
    // Kohlehalde
    this.ellipse(g, 15, 51, 13, 9, 'rgba(0,0,0,0.35)');
    this.ellipse(g, 13, 49, 12, 9, '#1a1a1a');
    this.ellipse(g, 11, 47, 8, 6, '#2c2c2c');
    for (let i = 0; i < 20; i++) this.px(g, 3 + Math.floor(r() * 20), 42 + Math.floor(r() * 12), r() < 0.5 ? '#4a4a4a' : '#0a0a0a');
    this.ellipse(g, 10, 45, 3, 2, '#3a3a3a');
    // Förderband
    for (let x = 20; x < 30; x++) this.rect(g, x, 44 - Math.floor((x - 20) / 2), 2, 2, x % 2 ? '#4a4a4a' : '#6a6a6a');
    // Turbinenhaus
    this.block(g, 26, 20, 34, 32, 13, '#5a5450', '#a8a094', { roofDetail: true, win: 'band', winCol: '#4a4a52' });
    this.rect(g, 26, 38, 34, 2, '#c03020');
    this.block(g, 30, 53, 26, 10, 5, '#4a4440', '#8a847a', { win: 'grid', door: true });
    this.block(g, 2, 4, 20, 26, 10, '#5a5450', '#9a948a', { win: 'band', winCol: '#4a4a52' });
    // Leitungsmasten
    this.rect(g, 2, 33, 1, 6, '#3a3a3a'); this.rect(g, 0, 33, 5, 1, '#3a3a3a');
    // Schornsteine
    for (const [x, y] of COAL_STACKS) {
      this.rect(g, x + 4, y + 5, 4, 18, PAL.shadow);
      this.rect(g, x, y, 5, 22, '#c0b8b0'); this.rect(g, x + 4, y, 1, 22, '#8a847c'); this.rect(g, x, y, 1, 22, '#dcd4cc');
      this.rect(g, x, y + 2, 5, 2, '#c03020'); this.rect(g, x, y + 7, 5, 2, '#c03020');
      this.rect(g, x, y, 5, 1, '#1a1a1a');
    }
  },

  drawNuclear(g, r) {
    const s = 64;
    this.grass(g, 701, 0, 0, s, s, '#6a9a50');
    this.rect(g, 0, 44, 64, 20, '#a0a09c');
    for (let i = 0; i < 30; i++) this.px(g, Math.floor(r() * 64), 44 + Math.floor(r() * 20), '#909090');
    // Kühlturm (seitlich, hyperbolisch)
    const [tx, ty] = NUCLEAR_STEAM;
    for (let y = 0; y < 30; y++) {
      const t = y / 29;
      const hw = 9 + 5 * Math.pow(t - 0.35, 2) * 3.2;
      const xa = Math.round(tx - hw), w = Math.round(hw * 2);
      this.rect(g, xa + 4, ty + y + 2, w, 1, 'rgba(0,0,0,0.3)');
      this.rect(g, xa, ty + y, w, 1, '#c8c8c0');
      this.rect(g, xa, ty + y, Math.max(2, Math.round(w * 0.3)), 1, '#e4e4dc');
      this.rect(g, xa + Math.round(w * 0.75), ty + y, w - Math.round(w * 0.75), 1, '#a4a49c');
    }
    this.ellipse(g, tx, ty, 10, 3, '#d8d8d0');
    this.ellipse(g, tx, ty, 8.5, 2.2, '#3a3a3a');
    this.rect(g, tx - 13, ty + 28, 26, 2, '#8a8a84');
    // Reaktorkuppel
    this.rect(g, 38, 27, 20, 12, '#c8ccd4'); this.rect(g, 38, 27, 20, 1, '#e8eaf0');
    this.rect(g, 57, 27, 1, 12, '#9aa0b0');
    this.ellipse(g, 50, 30, 11, 11, 'rgba(0,0,0,0.3)');
    this.pixels(g, 36, 15, 22, 13, (x, y) => {
      const dx = (x + 0.5 - 48) / 10, dy = (y + 0.5 - 27) / 11;
      if (dx * dx + dy * dy > 1 || y >= 27) return null;
      const l = -dx * 0.6 - dy * 0.8;
      return l > 0.75 ? '#ffffff' : l > 0.45 ? '#e4e8f0' : l > 0.1 ? '#c4cad8' : '#9aa0b4';
    });
    this.block(g, 6, 47, 26, 14, 6, '#6a7080', '#c8ccd4', { win: 'band', winCol: '#4a5a7a' });
    this.block(g, 38, 47, 20, 14, 6, '#6a7080', '#c8ccd4', { win: 'grid', winCol: '#4a5a7a', door: true });
    // Warnzeichen
    this.rect(g, 49, 3, 11, 11, '#111');
    this.rect(g, 50, 4, 9, 9, '#ffd800');
    this.disc(g, 54.5, 8.5, 3.2, '#111'); this.disc(g, 54.5, 8.5, 1.2, '#ffd800'); this.px(g, 54, 8, '#111');
    // Zaun
    for (let x = 0; x < 64; x += 2) this.px(g, x, 63, '#5a5a5a');
  },

  drawAirport(g, r) {
    const s = 96;
    this.grass(g, 801, 0, 0, s, s, '#6aa04a');
    // Rollbahn
    this.rect(g, 2, 62, 92, 16, '#3e3e40');
    this.rect(g, 2, 62, 92, 1, '#5a5a5c'); this.rect(g, 2, 77, 92, 1, '#2a2a2c');
    g.fillStyle = '#fff';
    for (let x = 16; x < 80; x += 8) g.fillRect(x, 69, 5, 1);
    for (let i = 0; i < 4; i++) { g.fillRect(5, 64 + i * 3, 6, 1); g.fillRect(85, 64 + i * 3, 6, 1); }
    g.fillRect(2, 63, 92, 1); g.fillRect(2, 76, 92, 1);
    this.rect(g, 13, 66, 1, 6, '#fff'); this.rect(g, 82, 66, 1, 6, '#fff');
    // Befeuerung
    for (let x = 4; x < 94; x += 6) { this.px(g, x, 61, '#ffe040'); this.px(g, x, 78, '#ffe040'); }
    // Rollweg und Vorfeld
    this.rect(g, 4, 38, 88, 20, '#7a7a7c'); this.rect(g, 4, 38, 88, 1, '#9a9a9c');
    this.rect(g, 44, 56, 8, 6, '#7a7a7c');
    g.fillStyle = '#e0c020'; for (let x = 6; x < 90; x += 6) g.fillRect(x, 52, 3, 1);
    this.rect(g, 47, 53, 1, 9, '#e0c020');
    // Terminal und Hangars
    this.block(g, 4, 5, 42, 28, 9, '#d8d8d8', '#b8c0c8', { winCol: '#2c5a94', win: 'band', door: true, roofDetail: true });
    for (let x = 10; x < 44; x += 10) { this.rect(g, x, 33, 2, 6, '#c8c8c8'); this.rect(g, x + 2, 33, 1, 6, '#8a8a8a'); }
    const hangar = (x, y) => {
      this.block(g, x, y, 18, 24, 8, '#8090a0', '#a8a8a8', { win: false });
      for (let yy = y + 1; yy < y + 15; yy += 2) this.rect(g, x + 1, yy, 16, 1, '#7080a0');
      this.rect(g, x + 2, y + 18, 14, 6, '#4a4a4a'); for (let xx = x + 3; xx < x + 16; xx += 2) this.rect(g, xx, y + 18, 1, 6, '#5a5a5a');
    };
    hangar(52, 8); hangar(74, 8);
    // Tower
    this.block(g, 4, 30, 8, 10, 4, '#a8a8a8', '#d8d8d8', { win: false });
    this.rect(g, 5, 21, 6, 10, '#d8d8d8'); this.rect(g, 10, 21, 1, 10, '#a8a8a8');
    this.rect(g, 4, 18, 8, 4, '#2c5a94'); this.rect(g, 4, 18, 8, 1, '#6a9ad4'); this.rect(g, 3, 17, 10, 1, '#5a5a5a');
    // Flugzeuge am Vorfeld
    const plane = (x, y) => {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 2, 14, 3); g.fillRect(x + 6, y - 3, 3, 13);
      g.fillStyle = '#f4f4f4'; g.fillRect(x, y, 14, 3); g.fillRect(x + 5, y - 5, 3, 13); g.fillRect(x + 11, y - 2, 2, 7);
      g.fillStyle = '#c8c8c8'; g.fillRect(x, y + 2, 14, 1);
      g.fillStyle = '#c02020'; g.fillRect(x + 12, y - 2, 1, 7); g.fillRect(x, y + 1, 1, 1);
      g.fillStyle = '#2a3a5a'; g.fillRect(x + 1, y, 1, 1);
    };
    plane(18, 44); plane(58, 44);
    // Radar-Sockel (Antenne wird animiert)
    this.rect(g, RADAR_POS[0] - 2, RADAR_POS[1] - 2, 7, 7, PAL.shadow);
    this.rect(g, RADAR_POS[0] - 3, RADAR_POS[1] - 3, 7, 7, '#5a5a5a');
    this.rect(g, RADAR_POS[0] - 3, RADAR_POS[1] - 3, 7, 1, '#7a7a7a');
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
// Kühlturm-Öffnung des Atomkraftwerks (Dampf wird dort animiert)
const NUCLEAR_STEAM = [18, 8];
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
