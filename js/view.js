'use strict';
/* Darstellung der Stadt im Hauptfenster und der Übersichtskarte. */

// Nachbarn: N, O, S, W, NO, SO, SW, NW
const NB8X = [0, 1, 0, -1, 1, 1, -1, -1], NB8Y = [-1, 0, 1, 0, -1, 1, 1, -1];
// Kurvenmittelpunkte (Feldpixel) je Straßenmaske, passend zu GFX.drawRoadArms
const ROAD_CURVE = { 3: [16, 0], 6: [16, 16], 12: [0, 16], 9: [0, 0] };

class View {
  constructor(canvas, city) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.city = city;
    this.zoom = 2;                  // 1, 2 oder 3 (Pixel pro Kachelpixel)
    this.camX = W / 2; this.camY = H / 2;   // Kamera-Mittelpunkt in Feldern
    this.cursor = null;             // {x, y, size, ok, line}
    this.frame = 0;
    this.overlay = null;            // optional: Kartenebene im Hauptfenster
    this.resize();
  }

  get ts() { return TS * this.zoom; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.imageSmoothingEnabled = false;
    this.clampCam();
  }

  clampCam() {
    const vw = this.canvas.width / this.ts, vh = this.canvas.height / this.ts;
    const mx = Math.max(vw / 2, Math.min(W - vw / 2, this.camX));
    const my = Math.max(vh / 2, Math.min(H - vh / 2, this.camY));
    this.camX = vw >= W ? W / 2 : mx;
    this.camY = vh >= H ? H / 2 : my;
  }

  centerOn(x, y) { this.camX = x + 0.5; this.camY = y + 0.5; this.clampCam(); }

  // Bildschirm -> Feld
  screenToTile(sx, sy) {
    const ts = this.ts;
    const wx = (sx - this.canvas.width / 2) / ts + this.camX;
    const wy = (sy - this.canvas.height / 2) / ts + this.camY;
    return [Math.floor(wx), Math.floor(wy), wx, wy];
  }

  setZoom(z, sx, sy) {
    z = clamp(z, 1, 3);
    if (z === this.zoom) return;
    let before = null;
    if (sx !== undefined) before = this.screenToTile(sx, sy);
    this.zoom = z;
    if (before) {
      const after = this.screenToTile(sx, sy);
      this.camX += before[2] - after[2];
      this.camY += before[3] - after[3];
    }
    this.clampCam();
  }

  // ---------------- Kacheln ----------------
  tileImage(x, y, frame) {
    const c = this.city;
    const i = idx(x, y);
    const k = c.tile[i], v = c.vari[i];
    switch (k) {
      case T.DIRT: return GFX.tileDirt(v % 3);
      case T.WATER: return GFX.tileWater(this.landMask(x, y), (frame + ((x * 3 + y * 5) & 3)) & 3);
      case T.TREES: {
        let m = 0;
        for (let d = 0; d < 8; d++) { const nk = c.kind(x + NB8X[d], y + NB8Y[d]); if (nk === T.TREES || nk === -1) m |= 1 << d; }
        return GFX.tileTrees((x * 7 + y * 13) & 3, m);
      }
      case T.RUBBLE: return GFX.tileRubble(v % 3);
      case T.FIRE: return GFX.tileFire((frame + x + y) & 3);
      case T.FLOOD: return GFX.tileFlood(frame & 3);
      case T.RAD: return GFX.tileRad();
      case T.ROAD: return GFX.tileRoad(c.roadMask(x, y));
      case T.RAIL: return GFX.tileRail(c.railMask(x, y));
      case T.WIRE: return GFX.tileWire(c.wireMask(x, y));
      case T.ROADWIRE: return GFX.tileRoadWire(v);
      case T.ROADRAIL: return GFX.tileRoadRail(v);
      case T.RAILWIRE: return GFX.tileRailWire(v);
      case T.PARK: return GFX.tilePark(v % 5);
      case T.ROADBRIDGE: return GFX.tileBridge('road', this.bridgeOrient(x, y, isRoadK), frame & 3, this.landMask(x, y));
      case T.RAILBRIDGE: return GFX.tileBridge('rail', this.bridgeOrient(x, y, isRailK), frame & 3, this.landMask(x, y));
      case T.WIREWATER: return GFX.tileBridge('wire', this.bridgeOrient(x, y, isWireK, true), frame & 3, this.landMask(x, y));
    }
    return GFX.tileDirt(0);
  }

  // Ufermaske: Bit gesetzt = Land (0-3: N,O,S,W; 4-7: NO,SO,SW,NW)
  landMask(x, y) {
    const c = this.city;
    let m = 0;
    for (let d = 0; d < 8; d++) {
      const nk = c.kind(x + NB8X[d], y + NB8Y[d]);
      if (nk >= 0 && !isWaterK(nk) && nk !== T.FLOOD) m |= 1 << d;
    }
    return m;
  }

  bridgeOrient(x, y, test, zonesToo) {
    const c = this.city;
    const t = (xx, yy) => { const k = c.kind(xx, yy); return test(k) || (zonesToo && k === T.ZONE); };
    if (t(x, y - 1) || t(x, y + 1)) { if (!(t(x - 1, y) || t(x + 1, y))) return 1; }
    return 0;
  }

  render(time, paused) {
    const ctx = this.ctx, c = this.city;
    const ts = this.ts;
    const cw = this.canvas.width, ch = this.canvas.height;
    const animFrame = paused ? this.lastAnim || 0 : Math.floor(time / 250);
    this.lastAnim = animFrame;
    this.frame++;
    let shx = 0, shy = 0;
    if (c.shake > 0) { shx = (Math.random() * 2 - 1) * 4 * this.zoom; shy = (Math.random() * 2 - 1) * 4 * this.zoom; }
    const offX = Math.round(cw / 2 - this.camX * ts + shx);
    const offY = Math.round(ch / 2 - this.camY * ts + shy);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;

    const x0 = Math.max(0, Math.floor(-offX / ts) - 1), y0 = Math.max(0, Math.floor(-offY / ts) - 1);
    const x1 = Math.min(W - 1, Math.ceil((cw - offX) / ts)), y1 = Math.min(H - 1, Math.ceil((ch - offY) / ts));
    const drawn = new Set();
    const blink = Math.floor(time / 500) % 2 === 0;
    const zonesVisible = [];

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        const k = c.tile[i];
        const sx = offX + x * ts, sy = offY + y * ts;
        if (k === T.ZONE) {
          const id = c.zid[i];
          if (drawn.has(id)) continue;
          drawn.add(id);
          const z = c.zones.get(id);
          if (!z) continue;
          const img = GFX.zoneImage(z);
          ctx.drawImage(img, offX + z.x * ts, offY + z.y * ts, z.size * ts, z.size * ts);
          zonesVisible.push(z);
          continue;
        }
        ctx.drawImage(this.tileImage(x, y, animFrame), sx, sy, ts, ts);
        if ((k === T.ROAD || k === T.ROADBRIDGE) && c.vari[i]) {
          const lvl = roadLevel(c, i);
          const m = k === T.ROAD ? c.roadMask(x, y) : (this.bridgeOrient(x, y, isRoadK) ? 5 : 10);
          ctx.drawImage(GFX.roadUpgrade(m, lvl, k === T.ROADBRIDGE), sx, sy, ts, ts);
        }
        if (isRoadK(k) && k !== T.ROADBRIDGE || k === T.ROADBRIDGE) this.drawTraffic(ctx, x, y, sx, sy, time, paused);
      }
    }

    // Zonen-Effekte: Rauch, Radar, fehlender Strom
    for (const z of zonesVisible) this.drawZoneFx(ctx, z, offX, offY, time, blink, paused);

    // Kartenebene im Hauptfenster
    if (this.overlay) this.drawOverlay(ctx, offX, offY, x0, y0, x1, y1);

    // Objekte
    this.drawSprites(ctx, offX, offY, time);

    // Zusätzliche Ebenen (z. B. Mauszeiger anderer Spieler im Multiplayer)
    if (this.afterDraw) this.afterDraw(ctx, offX, offY, ts, time);

    // Cursor
    if (this.cursor) {
      const cu = this.cursor;
      ctx.lineWidth = 2;
      ctx.strokeStyle = cu.ok === false ? '#ff3030' : '#ffff40';
      const s = cu.size || 1;
      ctx.strokeRect(offX + cu.x * ts + 1, offY + cu.y * ts + 1, s * ts - 2, s * ts - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(offX + cu.x * ts - 0.5, offY + cu.y * ts - 0.5, s * ts + 1, s * ts + 1);
    }
  }

  drawTraffic(ctx, x, y, sx, sy, time, paused) {
    const c = this.city;
    const t = c.trafficDensity[(x >> 1) + (y >> 1) * HW];
    if (t < 64) return;
    const k = c.tile[idx(x, y)];
    let mask;
    if (k === T.ROAD) mask = c.roadMask(x, y);
    else if (k === T.ROADBRIDGE) mask = this.bridgeOrient(x, y, isRoadK) ? 5 : 10;
    else mask = c.vari[idx(x, y)] === 0 ? 10 : 5;
    if (mask === 0) return;
    const z = this.zoom;
    const n = t >= 192 ? 3 : 1;
    const ph = paused ? 0 : time / 60;
    const cols = ['#e83030', '#f0f0f0', '#3060e8', '#f0d020', '#40c040'];
    for (let j = 0; j < n; j++) {
      const off = ((ph + j * 16 / n + (x * 5 + y * 3)) % 16 + 16) % 16;
      const col = cols[(x + y + j) % 5];
      ctx.fillStyle = col;
      // Kurve: Fahrzeuge folgen dem Bogen
      const cv = k === T.ROAD ? ROAD_CURVE[mask] : null;
      if (cv) {
        const aMid = Math.atan2(8 - cv[1], 8 - cv[0]);
        for (const [rad, dir] of [[5.5, 1], [10.5, -1]]) {
          const a = aMid + dir * (off / 16 - 0.5) * Math.PI / 2;
          const px = Math.round(cv[0] + Math.cos(a) * rad - 1), py = Math.round(cv[1] + Math.sin(a) * rad - 1);
          ctx.fillRect(sx + px * z, sy + py * z, 2 * z, 2 * z);
        }
        continue;
      }
      // waagrechte Fahrspuren
      if (mask & 10) {
        if (mask & 8 || mask & 2) {
          ctx.fillRect(sx + off * z, sy + 9 * z, 2 * z, 2 * z);
          ctx.fillRect(sx + (15 - off) * z, sy + 4 * z, 2 * z, 2 * z);
        }
      }
      if (mask & 5) {
        if (mask & 1 || mask & 4) {
          ctx.fillRect(sx + 4 * z, sy + off * z, 2 * z, 2 * z);
          ctx.fillRect(sx + 9 * z, sy + (15 - off) * z, 2 * z, 2 * z);
        }
      }
    }
  }

  drawZoneFx(ctx, z, offX, offY, time, blink, paused) {
    const zm = this.zoom, ts = this.ts;
    const ox = offX + z.x * ts, oy = offY + z.y * ts;
    const t = paused ? 0 : time;
    // Rauch
    let stacks = null;
    if (z.type === Z.IND && z.den >= 2 && z.powered) stacks = IND_STACKS[z.den];
    if (z.type === Z.COAL) stacks = COAL_STACKS.map(([x, y]) => [x + 1, y]);
    if (stacks) {
      for (let si = 0; si < stacks.length; si++) {
        const [sx, sy] = stacks[si];
        for (let p = 0; p < 4; p++) {
          const ph = ((t / 900 + p / 4 + si * 0.37) % 1);
          const px = ox + (sx + 1 + ph * 6) * zm, py = oy + (sy - ph * 14) * zm;
          const rr = (1.5 + ph * 3.5) * zm;
          ctx.fillStyle = `rgba(${z.type === Z.COAL ? '70,70,70' : '120,120,110'},${0.75 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // Radar
    if (z.type === Z.AIRPORT) {
      const a = z.powered ? t / 300 : 0;
      const cx = ox + RADAR_POS[0] * zm, cy = oy + RADAR_POS[1] * zm;
      ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 2 * zm;
      ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 4 * zm, cy - Math.sin(a) * 4 * zm); ctx.lineTo(cx + Math.cos(a) * 4 * zm, cy + Math.sin(a) * 4 * zm); ctx.stroke();
    }
    // Atomkraftwerk: Dampf
    if (z.type === Z.NUCLEAR) {
      for (let p = 0; p < 4; p++) {
        const ph = ((t / 1400 + p / 4) % 1);
        ctx.fillStyle = `rgba(240,240,240,${0.6 * (1 - ph)})`;
        ctx.beginPath(); ctx.arc(ox + (NUCLEAR_STEAM[0] + ph * 8) * zm, oy + (NUCLEAR_STEAM[1] - ph * 16) * zm, (4 + ph * 6) * zm, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Fehlender Strom: blinkender Blitz
    if (needsPower(z) && !z.powered && blink) {
      ctx.drawImage(GFX.bolt(), offX + zoneCX(z) * ts, offY + zoneCY(z) * ts, ts, ts);
    }
  }

  drawSprites(ctx, offX, offY, time) {
    const c = this.city, zm = this.zoom;
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(zm, zm);
    for (const s of c.sprites) {
      switch (s.type) {
        case SPR.TRAIN: this.drawTrain(ctx, s); break;
        case SPR.SHIP: this.drawShip(ctx, s); break;
        case SPR.COPTER: this.drawCopter(ctx, s, time); break;
        case SPR.PLANE: this.drawPlane(ctx, s); break;
        case SPR.MONSTER: this.drawMonster(ctx, s, time); break;
        case SPR.TORNADO: this.drawTornado(ctx, s, time); break;
        case SPR.EXPLOSION: this.drawExplosion(ctx, s); break;
        case SPR.DUST: this.drawDust(ctx, s); break;
      }
    }
    ctx.restore();
  }

  drawTrain(ctx, s) {
    const cols = ['#4a6a9a', '#8a6a3a', '#5a8a4a'];
    // Wagen an den letzten Positionen (interpoliert)
    let prevX = s.x, prevY = s.y;
    for (let i = 0; i < Math.min(2, s.trail.length); i++) {
      const [tx, ty] = s.trail[i];
      const nx = i === 0 ? s.tx : s.trail[i - 1][0], ny = i === 0 ? s.ty : s.trail[i - 1][1];
      const wx = (tx + (nx - tx) * s.prog) * 16 + 8, wy = (ty + (ny - ty) * s.prog) * 16 + 8;
      SPRITE_GFX.wagon(ctx, Math.round(wx), Math.round(wy), cols[i]);
      prevX = wx; prevY = wy;
    }
    void prevX; void prevY;
    SPRITE_GFX.train(ctx, Math.round(s.x), Math.round(s.y), s.dir);
  }

  drawShip(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate([-Math.PI / 2, 0, Math.PI / 2, Math.PI][s.dir] || 0);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-14, -3, 4, 6);
    ctx.fillStyle = '#7a1e12'; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(7, -4); ctx.lineTo(11, 0); ctx.lineTo(7, 4); ctx.lineTo(-10, 4); ctx.fill();
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(-8, -3, 6, 6);
    ctx.fillStyle = '#e0a020'; ctx.fillRect(-1, -2, 3, 4); ctx.fillRect(3, -2, 3, 4);
    ctx.fillStyle = '#222'; ctx.fillRect(-6, -1, 2, 2);
    ctx.restore();
  }

  drawCopter(ctx, s, time) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(s.x + 6, s.y + 10, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.dir || 0);
    ctx.fillStyle = '#e8c020'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8c020'; ctx.fillRect(-12, -1, 8, 2);
    ctx.fillStyle = '#7ab8f0'; ctx.fillRect(2, -2, 2, 4);
    ctx.strokeStyle = 'rgba(30,30,30,0.8)'; ctx.lineWidth = 1;
    const a = time / 40;
    ctx.beginPath(); ctx.moveTo(-Math.cos(a) * 9, -Math.sin(a) * 9); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-Math.sin(a) * 9, Math.cos(a) * 9); ctx.lineTo(Math.sin(a) * 9, -Math.cos(a) * 9); ctx.stroke();
    ctx.restore();
  }

  drawPlane(ctx, s) {
    const alt = s.alt === undefined ? 1 : s.alt;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.translate(s.x + alt * 14, s.y + alt * 14);
    ctx.rotate(s.dir);
    this.planeShape(ctx);
    ctx.restore();
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.dir);
    const sc = 0.8 + alt * 0.4;
    ctx.scale(sc, sc);
    ctx.fillStyle = s.crashing ? '#ff8040' : '#f4f4f4';
    this.planeShape(ctx);
    ctx.fillStyle = '#c02020'; ctx.fillRect(-10, -1, 4, 2);
    ctx.restore();
  }

  planeShape(ctx) {
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(8, -1.5); ctx.lineTo(2, -1.5); ctx.lineTo(-2, -10); ctx.lineTo(-5, -10); ctx.lineTo(-3, -1.5);
    ctx.lineTo(-9, -1.5); ctx.lineTo(-11, -5); ctx.lineTo(-12, -5); ctx.lineTo(-11, 0);
    ctx.lineTo(-12, 5); ctx.lineTo(-11, 5); ctx.lineTo(-9, 1.5); ctx.lineTo(-3, 1.5); ctx.lineTo(-5, 10); ctx.lineTo(-2, 10); ctx.lineTo(2, 1.5); ctx.lineTo(8, 1.5);
    ctx.closePath(); ctx.fill();
  }

  drawMonster(ctx, s, time) {
    const step = Math.floor(time / 200) % 2;
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y));
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(6, 14, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    const flip = s.dir === 3 ? -1 : 1;
    ctx.scale(flip, 1);
    // Schwanz
    ctx.fillStyle = '#2e6a2a';
    ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(-20, 12 + step * 2); ctx.lineTo(-6, 10); ctx.fill();
    // Körper
    ctx.fillStyle = '#3d8a35'; ctx.beginPath(); ctx.ellipse(0, 2, 10, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9ad06a'; ctx.beginPath(); ctx.ellipse(3, 4, 5, 9, 0, 0, Math.PI * 2); ctx.fill();
    // Beine
    ctx.fillStyle = '#2e6a2a';
    ctx.fillRect(-7, 11 + step * 2, 6, 6); ctx.fillRect(2, 13 - step * 2, 6, 6);
    // Kopf
    ctx.fillStyle = '#3d8a35'; ctx.beginPath(); ctx.ellipse(6, -13, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(6, -14, 9, 6);
    ctx.fillStyle = '#ff2020'; ctx.fillRect(8, -16, 2, 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(11, -9, 1, 2); ctx.fillRect(13, -9, 1, 2);
    // Rückenzacken
    ctx.fillStyle = '#d8e8a0';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-9, -8 + i * 6); ctx.lineTo(-14, -6 + i * 6); ctx.lineTo(-9, -4 + i * 6); ctx.fill(); }
    // Arme
    ctx.fillStyle = '#2e6a2a'; ctx.fillRect(7, -3 + step, 6, 3);
    // Feueratem
    if (step && (Math.floor(time / 400) % 3 === 0)) {
      ctx.fillStyle = 'rgba(255,160,0,0.85)'; ctx.beginPath(); ctx.moveTo(15, -11); ctx.lineTo(28, -16); ctx.lineTo(28, -6); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,120,0.9)'; ctx.beginPath(); ctx.moveTo(15, -11); ctx.lineTo(23, -13); ctx.lineTo(23, -9); ctx.fill();
    }
    ctx.restore();
  }

  drawTornado(ctx, s, time) {
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y));
    for (let i = 0; i < 9; i++) {
      const w = 3 + i * 1.6, yy = 10 - i * 4;
      const ox = Math.sin(time / 90 + i * 0.7) * (1 + i * 0.5);
      ctx.fillStyle = `rgba(${110 + i * 8},${110 + i * 8},${120 + i * 8},0.8)`;
      ctx.beginPath(); ctx.ellipse(ox, yy, w, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(120,90,60,0.6)';
    for (let i = 0; i < 6; i++) {
      const a = time / 70 + i;
      ctx.fillRect(Math.cos(a) * 8, 10 + Math.sin(a) * 3, 2, 2);
    }
    ctx.restore();
  }

  drawExplosion(ctx, s) {
    const f = s.frame / 24;
    const r = 4 + f * 18;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = `rgba(255,${Math.round(240 - f * 200)},40,${1 - f * 0.7})`;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,200,${Math.max(0, 1 - f * 2)})`;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(60,60,60,${f * 0.6})`;
    for (let i = 0; i < 6; i++) { const a = i * 1.05; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8 - f * 6, r * 0.35, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  drawDust(ctx, s) {
    const f = s.frame / 16, r = (s.size || 3) * 8;
    ctx.save();
    ctx.translate(s.x, s.y);
    for (let i = 0; i < 8; i++) {
      const a = i * 0.785 + f;
      ctx.fillStyle = `rgba(170,140,100,${0.8 * (1 - f)})`;
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * (0.3 + f * 0.6), Math.sin(a) * r * (0.3 + f * 0.6), r * 0.35 * (0.6 + f), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawOverlay(ctx, offX, offY, x0, y0, x1, y1) {
    const ts = this.ts;
    const hx0 = x0 >> 1, hy0 = y0 >> 1, hx1 = x1 >> 1, hy1 = y1 >> 1;
    for (let hy = hy0; hy <= hy1; hy++) for (let hx = hx0; hx <= hx1; hx++) {
      const col = MapRender.cellColor(this.city, this.overlay, hx * 2, hy * 2);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(offX + hx * 2 * ts, offY + hy * 2 * ts, ts * 2, ts * 2);
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------- Übersichtskarte ----------------
const MapRender = {
  ZONE_COL: ['', '#30c030', '#3070f0', '#e8d020', '#2040a0', '#e02020', '#c8c8c8', '#4880b0', '#505050', '#a8a8b0', '#9a9a9a'],

  tileColor(c, x, y) {
    const i = idx(x, y), k = c.tile[i];
    switch (k) {
      case T.DIRT: return '#9a6b3c';
      case T.WATER: return '#2d5fcf';
      case T.TREES: return '#2f7d32';
      case T.RUBBLE: return '#8a8070';
      case T.FIRE: return '#ff5000';
      case T.FLOOD: return '#5a86ea';
      case T.RAD: return '#c8ff00';
      case T.PARK: return '#5ab845';
      case T.ROAD: case T.ROADBRIDGE: case T.ROADRAIL: case T.ROADWIRE: return '#383838';
      case T.RAIL: case T.RAILBRIDGE: case T.RAILWIRE: return '#6a4a2a';
      case T.WIRE: case T.WIREWATER: return '#d8d8a0';
      case T.ZONE: {
        const z = c.zones.get(c.zid[i]);
        if (!z) return '#fff';
        let col = this.ZONE_COL[z.type];
        if (z.type <= 3) {
          const dense = z.type === Z.RES ? (z.special ? 2 : z.den) : z.den;
          if (dense === 0 && !(z.type === Z.RES && z.houses && z.houses.some(h => h))) col = shade(col, 0.55);
          else col = shade(col, -0.08 * dense);
        }
        return col;
      }
    }
    return '#000';
  },

  heat(v, max) {
    // 0 → transparent, dann gelb → orange → rot
    const t = clamp(v / max, 0, 1);
    if (t <= 0.02) return null;
    const r = 255, g = Math.round(255 * (1 - t * 0.9)), b = Math.round(60 * (1 - t));
    return `rgb(${r},${g},${b})`;
  },

  cellColor(c, mode, x, y) {
    const h = (x >> 1) + (y >> 1) * HW;
    const e = (x >> 3) + (y >> 3) * EW;
    switch (mode) {
      case 'popdens': return this.heat(c.popDensity[h], 220);
      case 'traffic': return this.heat(c.trafficDensity[h], 220);
      case 'pollution': return this.heat(c.pollution[h], 200);
      case 'crime': return this.heat(c.crime[h], 220);
      case 'landvalue': {
        const v = c.landValue[h];
        if (!v) return null;
        const t = v / 250;
        return `rgb(${Math.round(80 + 100 * (1 - t))},${Math.round(80 + 175 * t)},${Math.round(60 + 60 * t)})`;
      }
      case 'growth': {
        const v = c.rateOfGrowth[e];
        if (v === 0) return null;
        return v > 0 ? `rgba(40,200,80,${Math.min(1, 0.25 + v / 120)})` : `rgba(230,40,40,${Math.min(1, 0.25 - v / 120)})`;
      }
      case 'fire': return this.cover(c.fireEffectMap[e], '#ff4020');
      case 'police': return this.cover(c.policeEffectMap[e], '#3060ff');
    }
    return null;
  },

  cover(v, col) {
    if (v <= 0) return null;
    const a = Math.min(0.9, v / 400);
    const n = parseInt(col.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  },

  /** Zeichnet die ganze Karte in ein Canvas (Maßstab sc Pixel pro Feld). */
  draw(ctx, c, mode, sc) {
    const img = ctx.createImageData(W * sc, H * sc);
    const data = img.data;
    const put = (x, y, col) => {
      let r, g, b;
      if (col[0] === '#') { const n = parseInt(col.slice(1), 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
      else { const m = col.match(/[\d.]+/g); r = +m[0]; g = +m[1]; b = +m[2]; }
      for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++) {
        const p = ((y * sc + yy) * W * sc + x * sc + xx) * 4;
        data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
      }
    };
    const mix = (a, b, t) => {
      const pa = parseInt(a.slice(1), 16);
      const m = b.match(/[\d.]+/g);
      const al = m.length > 3 ? +m[3] : 1;
      const f = t * al;
      const r = ((pa >> 16) & 255) * (1 - f) + (+m[0]) * f, g = ((pa >> 8) & 255) * (1 - f) + (+m[1]) * f, bb = (pa & 255) * (1 - f) + (+m[2]) * f;
      return `rgb(${r | 0},${g | 0},${bb | 0})`;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = c.tile[idx(x, y)];
      let col;
      if (!mode || mode === 'all') col = this.tileColor(c, x, y);
      else if (mode === 'res' || mode === 'com' || mode === 'ind') {
        const want = { res: Z.RES, com: Z.COM, ind: Z.IND }[mode];
        const z = k === T.ZONE ? c.zones.get(c.zid[idx(x, y)]) : null;
        if (z && z.type === want) col = this.tileColor(c, x, y);
        else col = isWaterK(k) ? '#203c78' : (isRoadK(k) || isRailK(k)) ? '#555' : '#2a2a2a';
      } else if (mode === 'power') {
        if (k === T.ZONE) {
          const z = c.zones.get(c.zid[idx(x, y)]);
          col = !needsPower(z) ? '#ffffff' : (z.powered ? '#ffd020' : '#e02020');
        } else if (isWireK(k)) col = c.power[idx(x, y)] ? '#ffe880' : '#a0a0a0';
        else col = isWaterK(k) ? '#203c78' : '#2a2a2a';
      } else if (mode === 'transport') {
        if (isRoadK(k)) {
          const t = c.trafficDensity[(x >> 1) + (y >> 1) * HW];
          col = t >= 192 ? '#ff4040' : t >= 64 ? '#ffb040' : '#d0d0d0';
        } else if (isRailK(k)) col = '#a07040';
        else col = isWaterK(k) ? '#203c78' : '#2a2a2a';
      } else {
        const base = isWaterK(k) ? '#203c78' : (k === T.ZONE || isRoadK(k)) ? '#4a4a4a' : '#2e2e2e';
        const oc = this.cellColor(c, mode, x, y);
        col = oc ? mix(base, oc, 0.85) : base;
      }
      put(x, y, col);
    }
    ctx.putImageData(img, 0, 0);
  },
};
