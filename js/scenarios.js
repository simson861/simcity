'use strict';
/* Die acht Szenarien des Originals. Da die Original-Stadtdateien nicht vorliegen,
 * werden die Städte passend zu Geografie und Problemlage nachgebaut. */

const SCENARIOS = [
  {
    id: 'dullsville', tax: 7, name: 'Dullsville, USA', year: 1900, funds: 5000, seed: 1101,
    disaster: null, disasterWait: 0, scoreType: 'metropolis', years: 30,
    text: 'Dullsville, USA, 1900: Seit Jahrhunderten hat sich in diesem verschlafenen Städtchen nichts verändert. ' +
      'Die Bürger sind gelangweilt. Deine Aufgabe: Mach aus Dullsville innerhalb von 30 Jahren eine Metropole (100.000 Einwohner)!',
  },
  {
    id: 'sf', tax: 5, name: 'San Francisco, Kalifornien', year: 1906, funds: 20000, seed: 2206,
    // disasterWait/Ablauf wie im Original (Wochen bis zum Ereignis bzw. Dauer der Angriffe/Fluten)
    disaster: 'sf', disasterWait: 10, scoreType: 'metropolis', years: 5,
    text: 'San Francisco, 1906: Ein schweres Erdbeben erschüttert die Stadt, gefolgt von verheerenden Bränden. ' +
      'Bekämpfe die Feuer, räume die Trümmer und baue die Stadt in 5 Jahren wieder zur Metropole auf.',
  },
  {
    id: 'hamburg', tax: 5, name: 'Hamburg, Deutschland', year: 1944, funds: 20000, seed: 3344,
    disaster: 'hamburg', disasterWait: 40, scoreType: 'metropolis', years: 5,
    text: 'Hamburg, 1944: Brandbomben fallen auf die Stadt an der Elbe. Begrenze die Schäden, lösche die Brände ' +
      'und mache Hamburg in 5 Jahren wieder zu einer blühenden Metropole.',
  },
  {
    id: 'bern', tax: 5, name: 'Bern, Schweiz', year: 1965, funds: 20000, seed: 4465,
    disaster: null, disasterWait: 0, scoreType: 'traffic', years: 10,
    text: 'Bern, 1965: Die Straßen der Hauptstadt sind ständig verstopft. Die Bürger verlangen eine Lösung. ' +
      'Senke innerhalb von 10 Jahren das Verkehrsaufkommen deutlich (Verkehrsindex unter 80) – z. B. mit einem Schienennetz.',
  },
  {
    id: 'tokyo', tax: 5, name: 'Tokio, Japan', year: 1957, funds: 20000, seed: 5557,
    disaster: 'tokyo', disasterWait: 3, scoreType: 'score', years: 5,
    text: 'Tokio, 1957: Ein riesiges Monster ist aus der Bucht aufgetaucht und verwüstet die Stadt! ' +
      'Begrenze die Zerstörung und baue die Stadt wieder auf. Ziel: Stadtwertung über 500 nach 5 Jahren.',
  },
  {
    id: 'detroit', tax: 7, name: 'Detroit, Michigan', year: 1972, funds: 20000, seed: 6672,
    disaster: null, disasterWait: 0, scoreType: 'crime', years: 10,
    text: 'Detroit, 1972: Die Autoindustrie steckt in der Krise, die Kriminalität ist explodiert. ' +
      'Senke die Kriminalitätsrate innerhalb von 10 Jahren (Kriminalitätsindex unter 60).',
  },
  {
    id: 'boston', tax: 5, name: 'Boston, Massachusetts', year: 2010, funds: 20000, seed: 7710,
    disaster: 'boston', disasterWait: 5, scoreType: 'score', years: 5,
    text: 'Boston, 2010: Im Atomkraftwerk der Stadt kommt es zur Kernschmelze! Radioaktive Strahlung verseucht ' +
      'ganze Stadtteile. Erreiche nach 5 Jahren eine Stadtwertung über 500.',
  },
  {
    id: 'rio', tax: 5, name: 'Rio de Janeiro, Brasilien', year: 2047, funds: 20000, seed: 8847,
    disaster: 'rio', disasterWait: 96, scoreType: 'score', years: 10,
    text: 'Rio de Janeiro, 2047: Durch den Treibhauseffekt ist der Meeresspiegel gestiegen. Immer wieder ' +
      'überschwemmt das Meer die Küstenstadt. Erreiche nach 10 Jahren eine Stadtwertung über 500.',
  },
];

// ---------- Stadtbaukasten ----------
function scnWater(city, fn) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) city.tile[idx(x, y)] = T.WATER;
}
function scnClear(city, x0, y0, x1, y1, keepWater) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = idx(x, y);
      if (city.tile[i] === T.ZONE) continue;
      if (!keepWater || city.tile[i] !== T.WATER) city.tile[i] = T.DIRT;
    }
}
function scnPut(city, x, y, k, v) {
  if (!inBounds(x, y)) return;
  const cur = city.tile[idx(x, y)];
  if (cur === T.ZONE) return;
  if (cur === T.WATER) {
    if (k === T.ROAD || k === T.ROADWIRE) k = T.ROADBRIDGE;
    else if (k === T.RAIL) k = T.RAILBRIDGE;
    else if (k === T.WIRE) k = T.WIREWATER;
    else return;
    v = 0;
  }
  city.tile[idx(x, y)] = k;
  city.vari[idx(x, y)] = v || 0;
}
function scnZoneFree(city, x0, y0, s) {
  if (x0 < 0 || y0 < 0 || x0 + s > W || y0 + s > H) return false;
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
    const k = city.tile[idx(x, y)];
    if (k !== T.DIRT && k !== T.TREES && k !== T.RUBBLE) return false;
  }
  return true;
}
function scnZone(city, type, x0, y0, den, val) {
  if (!scnZoneFree(city, x0, y0, ZSIZE[type])) return null;
  const z = city.createZone(type, x0, y0, den || 0, val || 0);
  if (type === Z.RES && !den) {
    const n = rand(8);
    for (let i = 0; i < n; i++) z.houses[i] = 1 + (val || 0) * 3 + rand(2);
  }
  return z;
}

/**
 * Straßenraster: Blöcke 7x4 (zwei 3x3-Zonen), Straßen rundherum,
 * Strom wird über Straßen-Leitungs-Kreuzungen zwischen den Blöcken weitergeleitet.
 * pick(bc, br, slot) -> [typ, dichte, wert] oder null
 */
function scnGrid(city, x0, y0, cols, rows, pick, opts) {
  opts = opts || {};
  scnClear(city, x0, y0, x0 + cols * 7, y0 + rows * 4, opts.keepWater);
  for (let br = 0; br <= rows; br++) for (let x = x0; x <= x0 + cols * 7; x++) scnPut(city, x, y0 + br * 4, T.ROAD);
  for (let bc = 0; bc <= cols; bc++) for (let y = y0; y <= y0 + rows * 4; y++) scnPut(city, x0 + bc * 7, y, T.ROAD);
  if (!opts.noPower) {
    for (let br = 0; br <= rows; br++) for (let bc = 0; bc < cols; bc++) {
      const by = y0 + br * 4, bx = x0 + bc * 7;
      for (const dx of [2, 5]) if (city.kind(bx + dx, by) === T.ROAD) scnPut(city, bx + dx, by, T.ROADWIRE, 0);
    }
    for (let bc = 0; bc <= cols; bc++) for (let br = 0; br < rows; br++) {
      const bx = x0 + bc * 7, by = y0 + br * 4;
      if (city.kind(bx, by + 2) === T.ROAD) scnPut(city, bx, by + 2, T.ROADWIRE, 1);
    }
  }
  for (let br = 0; br < rows; br++) for (let bc = 0; bc < cols; bc++) {
    for (let slot = 0; slot < 2; slot++) {
      let p = pick(bc, br, slot);
      // leere Plätze werden unbebaute Zonen (leiten Strom weiter)
      if (!p) p = [weighted([[5, Z.RES], [2, Z.COM], [2, Z.IND]]), 0, 0];
      scnZone(city, p[0], x0 + bc * 7 + 1 + slot * 3, y0 + br * 4 + 1, p[1], p[2]);
    }
  }
}

function weighted(list) {
  let sum = 0;
  for (const e of list) sum += e[0];
  let r = randf() * sum;
  for (const e of list) { r -= e[0]; if (r <= 0) return e[1]; }
  return list[list.length - 1][1];
}

// Kraftwerk links neben den Raster setzen (berührt Straßen-Leitungs-Kreuzung)
function scnPlant(city, type, x0, y0) {
  scnClear(city, x0, y0, x0 + 3, y0 + 3);
  return scnZone(city, type, x0, y0);
}

/* ---------- Blockstadt ----------
 * Die Szenario-Städte werden aus Blöcken von 7x7 (bzw. 10x7, 13x7) Feldern gebaut: Straße rundherum,
 * innen 2 Reihen Bauplätze à 3x3 (jede Zone grenzt an eine Straße). Ein Block kann auch ein Sonderbau
 * (Kraftwerk, Flughafen …) sein. Straßen-Leitungs-Kreuzungen auf jeder Blockkante leiten den Strom
 * zwischen den Blöcken weiter. Parks und Bäume zwischen den Zonen heben den Bodenwert (Geländedichte),
 * eine kompakte Form hält die Entfernung zum Stadtzentrum klein – beides wie im Original
 * entscheidend dafür, dass sich Wohngebiete halten.
 *
 * o = { cx, cy: Stadtzentrum (Felder), cols, rows: Blockraster, bw: Blockbreite, keepWater, belt: Waldgürtel,
 *       active(b) -> bool, block(b) -> null | Z.COAL | Z.NUCLEAR | Z.AIRPORT | Z.STADIUM | Z.PORT | 'park' | 'trees',
 *       place: [[Typ, score(b)], …], plants: { type, ok(b), each: [region(b), …] },
 *       isInd(b) oder indShare + indPref(b): Industrieviertel,
 *       pick(s) -> [Typ, Dichte, Wert] | 'park' | 'trees' | null (freier Bauplatz) }
 * b/s: { bc, br, slot, row, col, x, y, dx, dy, d } – dx/dy/d: Abstand der Block- bzw. Platzmitte zum Zentrum
 */
function scnCity(city, o) {
  const BW = o.bw || 7, BH = 7, SC = (BW - 1) / 3;   // Blockbreite 7 (2 Plätze) oder 10 (3 Plätze)
  const x0 = o.cx - Math.floor(o.cols * BW / 2), y0 = o.cy - Math.floor(o.rows * BH / 2);
  const blocks = [];
  for (let br = 0; br < o.rows; br++) for (let bc = 0; bc < o.cols; bc++) {
    const bx = x0 + bc * BW, by = y0 + br * BH;
    if (bx < 0 || by < 0 || bx + BW >= W || by + BH >= H) continue;
    const b = { bc, br, x: bx, y: by, dx: bx + BW / 2 - o.cx, dy: by + BH / 2 - o.cy };
    b.d = Math.abs(b.dx) + Math.abs(b.dy);
    if (!o.active || o.active(b)) blocks.push(b);
  }
  // Sonderbauten: fest vorgegeben (o.block) und Kraftwerke automatisch nach Bedarf (o.plants)
  for (const b of blocks) { b.ind = o.isInd ? !!o.isInd(b) : false; b.special = o.block ? o.block(b) : null; }
  // Industrieviertel: Anteil o.indShare der Blöcke, bevorzugt nach o.indPref (größer = eher Industrie)
  if (o.indShare) {
    const free = blocks.filter(b => !b.special);
    const n = Math.round(free.length * o.indShare);
    free.sort((p, q) => o.indPref(q) - o.indPref(p)).forEach((b, i) => { b.ind = i < n; });
  }
  // Sonderbauten nach Vorliebe: o.place = [[Typ, score(b)], …] – jeweils der Block mit der höchsten Wertung
  for (const [type, score] of o.place || []) {
    const cand = blocks.filter(b => !b.special);
    if (!cand.length) continue;
    cand.sort((p, q) => score(q) - score(p));
    cand[0].special = type;
  }
  if (o.plants) {
    const cap = o.plants.type === Z.NUCLEAR ? 2000 : 700;
    let need = 0, have = 0;
    for (const b of blocks) {
      if (!b.special) need += SC * 2 * 9 * (1 - (o.plants.free || 0.15)) + 4;
      else if (b.special === Z.COAL) have += 700;
      else if (b.special === Z.NUCLEAR) have += 2000;
      else if (typeof b.special === 'number') need += ZSIZE[b.special] * ZSIZE[b.special] + 4;
    }
    let n = Math.max(0, Math.ceil((need * 1.15 - have) / cap));
    // je Teilgebiet (z. B. beide Flussufer) mindestens ein Kraftwerk
    for (const region of o.plants.each || []) {
      const rb = blocks.filter(b => !b.special && region(b)).sort((p, q) => q.d - p.d);
      if (rb.length) { rb[0].special = o.plants.type; n--; }
    }
    const cand = blocks.filter(b => !b.special && o.plants.ok(b)).sort((p, q) => q.d - p.d);
    for (const b of cand) { if (n-- <= 0) break; b.special = o.plants.type; }
  }
  for (const b of blocks) scnClear(city, b.x, b.y, b.x + BW, b.y + BH, o.keepWater);
  const road = (x, y, v) => {
    const k = city.kind(x, y);
    if (k === T.ROAD || k === T.ROADBRIDGE || k === T.ROADWIRE) return;
    scnPut(city, x, y, T.ROAD, v);
  };
  for (const b of blocks) {
    for (let i = 0; i <= BW; i++) { road(b.x + i, b.y); road(b.x + i, b.y + BH); }
    for (let i = 0; i <= BH; i++) { road(b.x, b.y + i); road(b.x + BW, b.y + i); }
  }
  // Leitungskreuzungen gegenüber jeder Platzmitte: waagrechte Straßen bei x+2, x+5 …, senkrechte bei y+2, y+5
  const cross = (x, y, v) => { if (city.kind(x, y) === T.ROAD) scnPut(city, x, y, T.ROADWIRE, v); };
  for (const b of blocks) {
    for (let d = 2; d < BW; d += 3) { cross(b.x + d, b.y, 0); cross(b.x + d, b.y + BH, 0); }
    for (let d = 2; d < BH; d += 3) { cross(b.x, b.y + d, 1); cross(b.x + BW, b.y + d, 1); }
  }
  const fill = (x, y, w, h, what) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const k = city.kind(xx, yy);
      if (k !== T.DIRT && k !== T.TREES && k !== T.RUBBLE) continue;
      if (what === 'park') scnPut(city, xx, yy, T.PARK, rand(4) === 0 ? 4 : rand(3));
      else scnPut(city, xx, yy, T.TREES, rand(3));
    }
  };
  for (const b of blocks) {
    const special = b.special;
    if (special === 'park' || special === 'trees') { fill(b.x + 1, b.y + 1, BW - 1, BH - 1, special); continue; }
    if (special) {
      scnZone(city, special, b.x + 1, b.y + 1);
      if (ZSIZE[special] === 4) {
        // Leitungen vom 4x4-Bau zu den Kreuzungen rechts und unten
        for (let x = b.x + 5; x < b.x + BW; x++) scnPut(city, x, b.y + 2, T.WIRE);
        scnPut(city, b.x + 2, b.y + 5, T.WIRE); scnPut(city, b.x + 2, b.y + 6, T.WIRE);
      }
      fill(b.x + 1, b.y + 1, BW - 1, BH - 1, 'trees');
      continue;
    }
    for (let slot = 0; slot < SC * 2; slot++) {
      const col = slot % SC, row = (slot / SC) | 0;
      const sx = b.x + 1 + col * 3, sy = b.y + 1 + row * 3;
      const s = { bc: b.bc, br: b.br, slot, col, row, x: sx, y: sy, dx: sx + 1 - o.cx, dy: sy + 1 - o.cy, block: b };
      s.d = Math.abs(s.dx) + Math.abs(s.dy);
      const p = o.pick(s);
      if (!p) continue;
      if (p === 'park' || p === 'trees') { fill(sx, sy, 3, 3, p); continue; }
      scnZone(city, p[0], sx, sy, p[1], p[2]);
    }
  }
  // Grüngürtel: freier Boden rund um die Stadt wird Wald (hebt den Bodenwert der Randblöcke)
  if (o.belt) {
    const inCity = new Uint8Array(W * H);
    for (const b of blocks) for (let y = b.y; y <= b.y + BH; y++) for (let x = b.x; x <= b.x + BW; x++) if (inBounds(x, y)) inCity[idx(x, y)] = 1;
    for (const b of blocks) {
      for (let y = b.y - o.belt; y <= b.y + BH + o.belt; y++) for (let x = b.x - o.belt; x <= b.x + BW + o.belt; x++) {
        if (!inBounds(x, y) || inCity[idx(x, y)]) continue;
        if (city.tile[idx(x, y)] === T.DIRT && rand(9) > 0) scnPut(city, x, y, T.TREES, rand(3));
      }
    }
  }
  scnFixPower(city);
  return blocks;
}

/** Stromanschluss sicherstellen: Zonen ohne leitende Verbindung zu einem Kraftwerk bekommen eine
 *  Leitung quer durch den benachbarten Park/freien Platz bis zur nächsten Leitungskreuzung. */
function scnFixPower(city) {
  for (let pass = 0; pass < 40; pass++) {
    const reach = new Uint8Array(W * H), st = [];
    for (const z of city.zones.values()) if (!needsPower(z)) { st.push(idx(zoneCX(z), zoneCY(z))); }
    while (st.length) {
      const i = st.pop();
      if (reach[i]) continue;
      reach[i] = 1;
      const x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inBounds(nx, ny) && !reach[idx(nx, ny)] && isCondK(city.tile[idx(nx, ny)])) st.push(idx(nx, ny));
      }
    }
    let changed = false;
    for (const z of city.zones.values()) {
      if (!needsPower(z) || reach[idx(zoneCX(z), zoneCY(z))] || z.size !== 3) continue;
      // in alle vier Richtungen: Leitung über Straße/Park/Bäume/Boden bis zu erreichtem Leiter (max. 8 Felder)
      let ok = false;
      for (let d = 0; d < 4 && !ok; d++) {
        let x = zoneCX(z) + DX[d] * 2, y = zoneCY(z) + DY[d] * 2;
        const path = [];
        for (let n = 0; n < 14; n++, x += DX[d], y += DY[d]) {
          if (!inBounds(x, y)) break;
          const i = idx(x, y), k = city.tile[i];
          if (reach[i]) { ok = true; break; }
          if (k === T.ZONE || isCondK(k)) continue;      // leitet schon selbst
          if (k !== T.ROAD && k !== T.PARK && k !== T.TREES && k !== T.DIRT && k !== T.WATER) break;
          path.push([x, y, k]);
        }
        if (!ok) continue;
        changed = true;
        for (const [px, py, k] of path) {
          if (k === T.ROAD) {
            const horiz = isRoadK(city.kind(px - 1, py)) || isRoadK(city.kind(px + 1, py));
            scnPut(city, px, py, T.ROADWIRE, horiz ? 0 : 1);
          } else scnPut(city, px, py, T.WIRE, 0);
        }
      }
    }
    if (!changed) break;
  }
}

/** Standard-Zonierung für die Blockstadt: Geschäftskern, Wohnring mit Parks, eigenes Industrieviertel
 *  (Blöcke mit b.ind), Polizei/Feuerwehr in regelmäßigem Raster. */
function scnZoning(o) {
  return (s) => {
    const b = s.block;
    const st = !o.stations || o.stations(b);
    if (st && o.police && (b.bc + b.br * 2) % o.police === 0 && s.row === 1 && s.col === 1) return [Z.POLICE, 0, 0];
    if (st && o.fire && (b.bc * 2 + b.br + 3) % o.fire === 0 && s.row === 0 && s.col === 0) return [Z.FIRE, 0, 0];
    const r = randf();
    if (b.ind) {
      if (r < (o.indTrees === undefined ? 0.15 : o.indTrees)) return 'trees';
      if (o.empty && randf() < o.empty) return null;
      return [Z.IND, o.den(Z.IND, s), rand(1)];
    }
    if (r < o.parks) return 'park';
    if (o.empty && randf() < o.empty) return null;
    let t;
    if (o.striped) {
      // obere Reihe jedes Blocks Wohnen, untere Gewerbe: Fahrten starten (wie im Original) an der Straße
      // oberhalb der Zone und finden das Ziel gleich gegenüber – kaum Verkehr und Abgase in Wohnstraßen
      if (s.row === 1) t = randf() < (s.d < o.core ? 0.9 : o.striped) ? Z.COM : Z.RES;
      else t = s.d < o.core && randf() < 0.35 ? Z.COM : Z.RES;
    } else if (o.blockType) {
      // ganze Blöcke einer Nutzung: Wohnviertel und Geschäftsviertel getrennt – lange Pendelfahrten
      t = o.blockType(b);
    } else {
      const m = s.d < o.core ? o.coreMix : o.mix;
      t = weighted([[m[0], Z.RES], [m[1], Z.COM], [m[2] || 0, Z.IND]]);
    }
    return [t, o.den(t, s), t === Z.IND ? rand(1) : o.val(t, s)];
  };
}

function buildScenario(city, sc) {
  city.reset();
  generateTerrain(city, { seed: sc.seed, water: 1, trees: 1 });
  RNG.s = (sc.seed * 7919) >>> 0;
  // Bodenwertklasse 0..3 (nur Grafik) nach Abstand zum Zentrum
  const valByD = (d) => d < 14 ? 3 : d < 26 ? 2 : d < 38 ? 1 : 0;
  // übliche Dichten: Wohnen 16–32 Einw./Zone, Gewerbe 2–4, Industrie 2–3
  const stdDen = (t, s) => t === Z.RES ? (s.d < 20 ? 2 + rand(1) : s.d < 32 ? 1 + rand(2) : rand(2))
    : t === Z.COM ? (s.d < 20 ? 3 + rand(1) : 2 + rand(1)) : 2 + rand(1);
  const std = {
    police: 7, fire: 7, parks: 0.22, core: 16, coreMix: [4, 6], mix: [7, 2], striped: 0.8, empty: 0.05,
    den: stdDen, val: (t, s) => valByD(s.d),
  };
  const zoning = (extra) => scnZoning(Object.assign({}, std, extra || {}));

  switch (sc.id) {
    case 'dullsville': {
      // verschlafenes Landstädtchen: kleiner Kern, viel Wald und Felder ringsum
      generateTerrain(city, { seed: sc.seed, water: 1, trees: 2 });
      RNG.s = 99;
      const dull = zoning({
        police: 0, fire: 0, parks: 0.15, empty: 0.25, core: 0, mix: [7, 2, 1], indTrees: 0.3,
        den: t => t === Z.RES ? 0 : rand(1), val: () => 1,
      });
      scnCity(city, {
        cx: 60, cy: 50, cols: 4, rows: 4,
        active: b => b.d < 24,
        isInd: b => b.br === 3 && b.bc >= 2,
        block: b => b.bc === 0 && b.br === 1 ? Z.COAL : null,
        pick: s => {
          if (s.bc === 2 && s.br === 1 && s.slot === 0) return [Z.FIRE, 0, 0];
          if (s.bc === 1 && s.br === 2 && s.slot === 3) return [Z.POLICE, 0, 0];
          return dull(s);
        },
      });
      break;
    }
    case 'sf': {
      // Halbinsel: Bucht im Westen und Norden; Industrie und Hafen am Nordostufer
      scnWater(city, (x, y) => x < 14 + Math.sin(y / 9) * 4 || y < 10 + Math.sin(x / 7) * 3);
      scnCity(city, {
        cx: 60, cy: 52, cols: 13, rows: 12,
        active: b => b.d < 46 && b.x > 18 && b.y > 12, belt: 5,
        indShare: 0.26, indPref: b => -b.dy + b.dx * 0.6,
        place: [[Z.PORT, b => -b.dy + b.dx * 0.3], [Z.AIRPORT, b => b.dy - Math.abs(b.dx) * 0.5], [Z.STADIUM, b => -b.dx - Math.abs(b.dy)]],
        plants: { type: Z.COAL, ok: b => b.ind },
        pick: zoning({ empty: 0.1 }),
      });
      break;
    }
    case 'hamburg': {
      // Elbe quer durch die Stadt, Hafen und Werften am Südufer
      generateTerrain(city, { seed: sc.seed, water: 0, trees: 1 });
      const elbe = (x) => 50 + Math.sin(x / 11) * 5;
      scnWater(city, (x, y) => Math.abs(y - elbe(x)) < 3 + (x > 70 ? 2 : 0));
      scnCity(city, {
        cx: 60, cy: 47, cols: 15, rows: 13, keepWater: true,
        active: b => b.d < 50 && Math.abs(b.y + 3.5 - elbe(b.x + 3.5)) > 5, belt: 4,
        indShare: 0.26, indPref: b => (b.y + 3.5 > elbe(b.x + 3.5) ? 40 : 0) - Math.abs(b.y + 3.5 - elbe(b.x + 3.5)) + b.dx * 0.3,
        place: [[Z.PORT, b => (b.y + 3.5 > elbe(b.x + 3.5) ? 30 : 0) - Math.abs(b.y + 3.5 - elbe(b.x + 3.5)) + b.dx * 0.5],
          [Z.AIRPORT, b => -b.dy - Math.abs(b.dx) * 0.3], [Z.STADIUM, b => -Math.abs(b.d - 16) - Math.abs(b.dx)]],
        plants: { type: Z.COAL, ok: b => b.ind, each: [b => b.y + 3.5 < elbe(b.x + 3.5)] },
        pick: zoning({ empty: 0.1, den: (t, s) => t === Z.RES ? (s.d < 30 ? 2 + rand(1) : 1 + rand(1)) : t === Z.COM ? 2 + rand(2) : 2 + rand(1) }),
      });
      break;
    }
    case 'bern': {
      // dicht bebaute Hauptstadt ohne Bahn: große Blöcke, Wohn- und Geschäftsviertel getrennt –
      // die Pendler verstopfen die wenigen Straßen
      generateTerrain(city, { seed: sc.seed, water: 1, trees: 1 });
      scnCity(city, {
        cx: 60, cy: 50, cols: 7, rows: 13, bw: 13,
        active: b => b.d < 44, belt: 5,
        indShare: 0.3, indPref: b => b.dx + Math.abs(b.dy) * 0.2,
        place: [[Z.PORT, b => b.dx - Math.abs(b.dy) * 0.5], [Z.AIRPORT, b => b.dy + b.dx * 0.3], [Z.STADIUM, b => -b.dx - Math.abs(b.dy)]],
        plants: { type: Z.COAL, ok: b => b.ind },
        pick: zoning({
          striped: 0, parks: 0.32, empty: 0.02, police: 4, fire: 3,
          blockType: b => b.d < 10 || (b.bc + b.br) % 6 === 0 ? Z.COM : Z.RES,
          den: t => t === Z.RES ? 3 + rand(1) : t === Z.COM ? 3 + rand(1) : 2 + rand(1),
        }),
      });
      break;
    }
    case 'tokyo': {
      // Hafenstadt an der Bucht im Süden und Osten
      scnWater(city, (x, y) => y > 86 + Math.sin(x / 8) * 3 || x > 108 + Math.sin(y / 6) * 3);
      scnCity(city, {
        cx: 58, cy: 46, cols: 13, rows: 13,
        active: b => b.d < 40 && b.y + 7 < 84 && b.x + 7 < 104, belt: 5,
        indShare: 0.26, indPref: b => b.dy + b.dx,
        place: [[Z.PORT, b => b.dy + b.dx], [Z.AIRPORT, b => -b.dx], [Z.STADIUM, b => -b.dy - Math.abs(b.dx)]],
        plants: { type: Z.COAL, ok: b => b.ind },
        pick: zoning(),
      });
      break;
    }
    case 'detroit': {
      // Autostadt: riesige Industrie im Norden, heruntergekommene Wohnviertel, keine Polizei
      generateTerrain(city, { seed: sc.seed, water: 1, trees: 0 });
      scnWater(city, x => x > 110);
      scnCity(city, {
        cx: 58, cy: 52, cols: 13, rows: 13,
        active: b => b.d < 40,
        indShare: 0.4, indPref: b => -b.dy + Math.abs(b.dx) * 0.1,
        place: [[Z.PORT, b => b.dx], [Z.AIRPORT, b => b.dy + b.dx * 0.5], [Z.STADIUM, b => b.dy - Math.abs(b.dx)]],
        plants: { type: Z.COAL, ok: b => b.ind },
        pick: zoning({
          police: 0, fire: 9, parks: 0.03, indTrees: 0.02, empty: 0.12, core: 12, mix: [7, 2],
          den: t => t === Z.RES ? rand(2) : t === Z.COM ? 1 + rand(2) : 2 + rand(1),
          val: (t, s) => Math.max(0, valByD(s.d) - 1),
        }),
      });
      break;
    }
    case 'boston': {
      scnWater(city, (x, y) => x > 104 + Math.sin(y / 5) * 4 || (y > 88 && x > 60));
      scnCity(city, {
        cx: 56, cy: 48, cols: 13, rows: 13,
        active: b => b.d < 40 && b.x + 7 < 100 && b.y + 7 < 88, belt: 5,
        indShare: 0.26, indPref: b => -b.dx - b.dy * 0.3,
        place: [[Z.NUCLEAR, b => -b.dx - b.dy * 0.3], [Z.PORT, b => b.dx], [Z.AIRPORT, b => b.dy], [Z.STADIUM, b => -b.dy - Math.abs(b.dx)]],
        plants: { type: Z.COAL, ok: b => b.ind },
        pick: zoning(),
      });
      break;
    }
    case 'rio': {
      // Küstenstadt: Strand im Osten und Süden – die Fluten kommen vom Meer
      scnWater(city, (x, y) => x > 96 + Math.sin(y / 7) * 5 || y > 92);
      scnCity(city, {
        cx: 54, cy: 48, cols: 13, rows: 13,
        active: b => b.d < 40 && b.x + 7 < 92 && b.y + 7 < 90, belt: 5,
        indShare: 0.26, indPref: b => -b.dx + Math.abs(b.dy) * 0.2,
        place: [[Z.PORT, b => b.dx + b.dy], [Z.AIRPORT, b => b.dy - b.dx], [Z.STADIUM, b => -b.dy - Math.abs(b.dx)]],
        plants: { type: Z.NUCLEAR, ok: b => b.ind },
        pick: zoning(),
      });
      break;
    }
  }
  // Wald im Stadtgebiet ist schon geräumt; Verzierung
  for (let i = 0; i < W * H; i++) if (city.tile[i] !== T.ZONE && city.vari[i] === 0 && city.tile[i] < T.ROAD) city.vari[i] = rand(3);

  city.name = sc.name;
  city.funds = sc.funds;
  city.cityTax = sc.tax || 7;
  city.startYear = sc.year;
  city.cityTime = 0;
  city.level = 0;
  city.scenario = sc.id;
  city.disasterEvent = sc.disaster || 0;
  city.disasterWait = sc.disasterWait;
  city.scoreType = sc.scoreType;
  city.scoreWait = sc.years * 48;
  city.fullAnalysis();
  // Stadtzentrum ist jetzt bekannt – Bodenwerte erneut berechnen
  city.populationDensityScan();
  city.pollutionTerrainLandValueScan();
  // Verkehr „einschwingen“ (die Originaldateien enthalten eine Verkehrskarte): einige Wochen Fahrten
  // ohne Zonenwachstum, danach Abgase, Bodenwert und Kriminalität mit Verkehr berechnen
  for (let n = 0; n < 16; n++) {
    for (const z of city.zones.values()) {
      const pop = city.zonePop(z);
      if (z.type === Z.RES ? pop > rand(35) : (z.type === Z.COM || z.type === Z.IND) && pop > rand(5)) {
        city.makeTraffic(z, z.type);
      }
    }
    city.decTraffic();
  }
  city.pollutionTerrainLandValueScan();
  city.pollutionTerrainLandValueScan();
  city.crimeScan();
  city.fillHistory();
  city.resValve = 400; city.comValve = 300; city.indValve = 300;
  city.totalPop = Math.floor(city.stats.resPop / 8 + city.stats.comPop + city.stats.indPop);
  city.cityPop = city.population();
  city.lastCityPop = city.cityPop;
  city.doPopNum(); city.cityPopDelta = 0;
  city.computeBudgetRequests();
  city.getTrafficAverage();
  city.mapVersion++;
}

Object.assign(City.prototype, {
  scenarioDisaster() {
    const w = this.disasterWait;
    switch (this.disasterEvent) {
      case 'sf': if (w === 1) this.makeEarthquake(); break;
      case 'hamburg': if (w % 10 === 0) this.makeFireBombs(); break;
      case 'tokyo': if (w === 1) this.makeMonster(); break;
      case 'boston': if (w === 1) this.makeMeltdown(); break;
      case 'rio': if (w % 24 === 0) this.makeFlood(); break;
    }
    if (this.disasterWait > 0) this.disasterWait--;
    else this.disasterEvent = 0;
  },

  scenarioCheck() {
    if (!this.scenario || this.scoreWait <= 0) return;
    this.scoreWait--;
    if (this.scoreWait > 0) return;
    let win = false;
    switch (this.scoreType) {
      case 'metropolis': win = this.population() >= 100000; break;
      case 'traffic': win = this.getTrafficAverage() < 80; break;
      case 'crime': win = this.crimeAverage < 60; break;
      case 'score': win = this.cityScore > 500; break;
    }
    this.emit('scenarioEnd', { win });
  },
});
