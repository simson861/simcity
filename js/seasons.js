'use strict';
/*
 * Jahreszeiten und Wetter (Erweiterung, nicht im Original).
 * Die Kachel- und Gebäudebilder werden je Jahreszeit einmal umgefärbt und zwischengespeichert:
 * Schnee im Winter, Blüten im Frühling, buntes Laub im Herbst. Dazu Wetter-Animationen
 * (Schneefall, Regen, fallende Blätter). Das Wetter hängt nur vom Spieldatum ab und ist
 * damit im Multiplayer für alle gleich.
 */

const Seasons = {
  enabled: true,
  variants: new WeakMap(),     // Original-Canvas → { Variante: Canvas }
  particles: [],
  partKind: null,
  lastTime: 0,

  /** Variante für einen Monat (0 = Januar). null = Sommer (Originalfarben). */
  variantOf(month) {
    if (!this.enabled) return null;
    if (month === 0 || month === 1) return 'w';        // Winter, geschlossene Schneedecke
    if (month === 11) return 'wl';                     // Dezember: erster Schnee in Flecken
    if (month === 2) return 'wm';                      // März: Schneeschmelze, Restflecken
    if (month === 3 || month === 4) return 'sp';       // Frühling, Blüten
    if (month >= 8 && month <= 10) return 'a';         // Herbst, buntes Laub
    return null;
  },

  name(month) {
    return ['Winter', 'Winter', 'Frühling', 'Frühling', 'Frühling', 'Sommer', 'Sommer', 'Sommer', 'Herbst', 'Herbst', 'Herbst', 'Winter'][month];
  },
  icon(month) {
    return ['❄', '❄', '🌱', '🌸', '🌸', '☀', '☀', '☀', '🍂', '🍂', '🍂', '❄'][month];
  },

  /** Bild in der Variante der aktuellen Jahreszeit (zwischengespeichert). */
  apply(img, v) {
    if (!v || !img) return img;
    let m = this.variants.get(img);
    if (!m) { m = {}; this.variants.set(img, m); }
    if (!m[v]) m[v] = this.recolor(img, v);
    return m[v];
  },

  recolor(src, v) {
    const c = mkCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    let data;
    try { data = g.getImageData(0, 0, c.width, c.height); } catch (e) { return src; }
    const d = data.data;
    const w = c.width;
    const winter = v === 'w' || v === 'wl' || v === 'wm';
    // Schneedeckung: geschlossen, oder in zusammenhängenden Flecken (4×4-Pixel-Blöcke, weich gemischt)
    const cover = v === 'w' ? 1 : v === 'wl' ? 0.6 : v === 'wm' ? 0.35 : 0;
    const cell = (bx, by) => {
      let h = (bx * 374761393 + by * 668265263) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) % 1000) / 1000;
    };
    // weiches Wertrauschen (Gitter 6 px, bilinear) für rundliche Schneeflecken
    const smooth = (x, y) => {
      const gx = x / 6, gy = y / 6, x0 = Math.floor(gx), y0 = Math.floor(gy);
      let fx = gx - x0, fy = gy - y0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = cell(x0, y0), b2 = cell(x0 + 1, y0), c2 = cell(x0, y0 + 1), d2 = cell(x0 + 1, y0 + 1);
      return (a + (b2 - a) * fx) * (1 - fy) + (c2 + (d2 - c2) * fx) * fy;
    };
    for (let p = 0, i = 0; p < d.length; p += 4, i++) {
      if (d[p + 3] < 16) continue;
      const x = i % w, y = (i / w) | 0;
      const r = d[p], gr = d[p + 1], b = d[p + 2];
      const lum = (r * 3 + gr * 6 + b) / 10;
      const h = (x * 73856093 ^ y * 19349663 ^ i * 83492791) >>> 0;
      const rnd = (h % 1000) / 1000;
      const green = gr > r + 8 && gr > b + 8;
      // Nur echter Erdboden (keine Schwellen, kein Schotter, keine Dächer/Fassaden)
      const ground = r > gr && gr > b && r - b >= 70 && r - b <= 125 && r - gr >= 25 && r - gr <= 65 && lum >= 85 && lum <= 185;
      const blue = b > r + 30 && b > gr + 5;
      let o = null;
      if (winter) {
        // Flecken: Blockrauschen, an den Rändern zur Hälfte gemischt
        const n = cover >= 1 ? 0 : smooth(x, y);
        const snowy = n < cover;
        const edge = !snowy && n < cover + 0.06;
        const snow = [226 + rnd * 18, 231 + rnd * 16, 240 + rnd * 10];
        const mixSnow = (k) => [r + (snow[0] - r) * k, gr + (snow[1] - gr) * k, b + (snow[2] - b) * k];
        if (green && lum < 100) {
          // Baumkronen: Laubbäume kahl (graubraunes Geäst), einige Nadelbäume bleiben grün, Schnee auf den Kronen
          const bare = (h % 7) !== 0;
          const base = bare ? [92 + lum * 0.12, 80 + lum * 0.1, 66] : [34 + lum * 0.15, 62 + lum * 0.2, 48];
          o = (snowy && lum > 72) ? mixSnow(0.85) : base;   // Schnee nur auf den hellen Kronenpartien
        } else if (green || ground) {
          if (snowy) o = mixSnow(0.92);
          else if (edge) o = mixSnow(0.5);
          else if (green) o = [r * 0.75 + 30, gr * 0.6 + 28, b * 0.6 + 14];       // winterlich fahles Gras
          else if (v === 'wm') o = [r * 0.82, gr * 0.82, b * 0.85];              // nasser Boden bei Schneeschmelze
        } else if (blue && v === 'w') {
          o = [r * 0.45 + 120, gr * 0.45 + 135, b * 0.5 + 125];                  // Eis
        }
      } else if (v === 'a') {
        if (green) {
          if (lum < 105) {
            const pal = [[208, 112, 34], [178, 58, 30], [222, 176, 52], [146, 92, 42], [196, 140, 40]];
            const q = pal[h % pal.length], f = 0.55 + lum / 160;
            o = [q[0] * f, q[1] * f, q[2] * f];
          } else {
            o = [lum * 0.95 + 18, lum * 0.85 + 10, lum * 0.35];                   // trockenes Gras
          }
        }
      } else if (v === 'sp') {
        if (green) {
          if (lum < 100 && rnd < 0.07) o = rnd < 0.035 ? [250, 190, 214] : [255, 250, 250]; // Blüten
          else o = [r * 0.9, Math.min(255, gr * 1.12 + 6), b * 0.85];
        }
      }
      if (o) { d[p] = o[0]; d[p + 1] = o[1]; d[p + 2] = o[2]; }
    }
    g.putImageData(data, 0, 0);
    return c;
  },

  // ---------------- Wetter ----------------
  /** Wetter für die aktuelle Zeit: 'snow' | 'rain' | 'leaves' | null (gleich für alle Spieler). */
  weather(city) {
    if (!this.enabled) return null;
    const m = city.month;
    const bucket = Math.floor(city.cityTime / 2) + city.startYear * 977;
    let h = (bucket * 2654435761) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    const r = (h % 1000) / 1000;
    if (m === 11 || m <= 1) return r < 0.55 ? 'snow' : null;
    if (m === 2) return r < 0.25 ? 'snow' : r < 0.45 ? 'rain' : null;
    if (m <= 4) return r < 0.3 ? 'rain' : null;
    if (m <= 7) return r < 0.12 ? 'rain' : null;
    return r < 0.35 ? 'rain' : r < 0.7 ? 'leaves' : null;
  },

  drawWeather(ctx, w, h, time, paused, city) {
    const kind = this.weather(city);
    const dt = paused ? 0 : Math.min(0.1, (time - (this.lastTime || time)) / 1000);
    this.lastTime = time;
    if (!kind) { this.particles.length = 0; this.partKind = null; return; }
    if (kind !== this.partKind) { this.particles.length = 0; this.partKind = kind; }
    const want = Math.round(w * h / (kind === 'rain' ? 2600 : kind === 'snow' ? 3200 : 26000));
    const P = this.particles;
    while (P.length < want) P.push(this.newParticle(kind, w, h, true));
    if (P.length > want) P.length = want;
    // leichte Abdunklung bei Regen, Aufhellung bei Schnee
    if (kind === 'rain') { ctx.fillStyle = 'rgba(20,30,60,0.16)'; ctx.fillRect(0, 0, w, h); }
    else if (kind === 'snow') { ctx.fillStyle = 'rgba(230,240,255,0.08)'; ctx.fillRect(0, 0, w, h); }
    const t = time / 1000;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.y += p.vy * dt;
      p.x += (p.vx + (kind !== 'rain' ? Math.sin(t * p.f + p.ph) * p.sway : 0)) * dt;
      if (p.y > h + 12 || p.x < -20 || p.x > w + 20) { P[i] = this.newParticle(kind, w, h, false); continue; }
      if (kind === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(p.x | 0, p.y | 0, p.s, p.s);
      } else if (kind === 'rain') {
        ctx.strokeStyle = 'rgba(190,210,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
      } else {
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * p.f + p.ph);
        ctx.fillRect(-2, -1, 4, 2);
        ctx.restore();
      }
    }
  },

  newParticle(kind, w, h, anywhere) {
    const x = Math.random() * (w + 40) - 20;
    const y = anywhere ? Math.random() * h : -10;
    if (kind === 'snow') return { x, y, vx: -6 + Math.random() * 12, vy: 22 + Math.random() * 38, s: Math.random() < 0.3 ? 3 : 2, sway: 14, f: 0.8 + Math.random(), ph: Math.random() * 6 };
    if (kind === 'rain') return { x, y, vx: -90, vy: 520 + Math.random() * 220 };
    const cols = ['#c8641e', '#b23a1e', '#dcb034', '#965c2a'];
    return { x, y, vx: 26 + Math.random() * 30, vy: 24 + Math.random() * 26, sway: 30, f: 1 + Math.random() * 2, ph: Math.random() * 6, c: cols[(Math.random() * 4) | 0] };
  },
};
