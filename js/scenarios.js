'use strict';
/* Die acht Szenarien des Originals. Da die Original-Stadtdateien nicht vorliegen,
 * werden die Städte passend zu Geografie und Problemlage nachgebaut. */

const SCENARIOS = [
  {
    id: 'dullsville', name: 'Dullsville, USA', year: 1900, funds: 5000, seed: 1101,
    disaster: null, disasterWait: 0, scoreType: 'metropolis', years: 30,
    text: 'Dullsville, USA, 1900: Seit Jahrhunderten hat sich in diesem verschlafenen Städtchen nichts verändert. ' +
      'Die Bürger sind gelangweilt. Deine Aufgabe: Mach aus Dullsville innerhalb von 30 Jahren eine Metropole (100.000 Einwohner)!',
  },
  {
    id: 'sf', name: 'San Francisco, Kalifornien', year: 1906, funds: 20000, seed: 2206,
    disaster: 'sf', disasterWait: 2, scoreType: 'metropolis', years: 5,
    text: 'San Francisco, 1906: Ein schweres Erdbeben erschüttert die Stadt, gefolgt von verheerenden Bränden. ' +
      'Bekämpfe die Feuer, räume die Trümmer und baue die Stadt in 5 Jahren wieder zur Metropole auf.',
  },
  {
    id: 'hamburg', name: 'Hamburg, Deutschland', year: 1944, funds: 20000, seed: 3344,
    disaster: 'hamburg', disasterWait: 20, scoreType: 'metropolis', years: 5,
    text: 'Hamburg, 1944: Brandbomben fallen auf die Stadt an der Elbe. Begrenze die Schäden, lösche die Brände ' +
      'und mache Hamburg in 5 Jahren wieder zu einer blühenden Metropole.',
  },
  {
    id: 'bern', name: 'Bern, Schweiz', year: 1965, funds: 20000, seed: 4465,
    disaster: null, disasterWait: 0, scoreType: 'traffic', years: 10,
    text: 'Bern, 1965: Die Straßen der Hauptstadt sind ständig verstopft. Die Bürger verlangen eine Lösung. ' +
      'Senke innerhalb von 10 Jahren das Verkehrsaufkommen deutlich (Verkehrsindex unter 80) – z. B. mit einem Schienennetz.',
  },
  {
    id: 'tokyo', name: 'Tokio, Japan', year: 1957, funds: 20000, seed: 5557,
    disaster: 'tokyo', disasterWait: 10, scoreType: 'score', years: 5,
    text: 'Tokio, 1957: Ein riesiges Monster ist aus der Bucht aufgetaucht und verwüstet die Stadt! ' +
      'Begrenze die Zerstörung und baue die Stadt wieder auf. Ziel: Stadtwertung über 500 nach 5 Jahren.',
  },
  {
    id: 'detroit', name: 'Detroit, Michigan', year: 1972, funds: 20000, seed: 6672,
    disaster: null, disasterWait: 0, scoreType: 'crime', years: 10,
    text: 'Detroit, 1972: Die Autoindustrie steckt in der Krise, die Kriminalität ist explodiert. ' +
      'Senke die Kriminalitätsrate innerhalb von 10 Jahren (Kriminalitätsindex unter 60).',
  },
  {
    id: 'boston', name: 'Boston, Massachusetts', year: 2010, funds: 20000, seed: 7710,
    disaster: 'boston', disasterWait: 5, scoreType: 'score', years: 5,
    text: 'Boston, 2010: Im Atomkraftwerk der Stadt kommt es zur Kernschmelze! Radioaktive Strahlung verseucht ' +
      'ganze Stadtteile. Erreiche nach 5 Jahren eine Stadtwertung über 500.',
  },
  {
    id: 'rio', name: 'Rio de Janeiro, Brasilien', year: 2047, funds: 20000, seed: 8847,
    disaster: 'rio', disasterWait: 100, scoreType: 'score', years: 10,
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

// Kraftwerksreihe links am Raster: berührt die Straßen-Leitungs-Kreuzungen, genug Kapazität für alle Zonen
function scnPlants(city, type, x0, y0, extra, count) {
  let tiles = 0;
  for (const z of city.zones.values()) tiles += z.size * z.size;
  const cap = type === Z.NUCLEAR ? 2000 : 700;
  const n = count || Math.ceil(tiles * 1.1 / (cap - 20)) + (extra || 0);
  for (let i = 0; i < n; i++) scnPlant(city, type, x0 - 4, y0 + 1 + i * 8);
}

// Stadion, Seehafen und Flughafen neben der Kraftwerksreihe (ohne sie stagniert jede Großstadt)
function scnSpecials(city, x0, y0, which) {
  which = which || 'spa';
  const put = (type, x, y) => { scnClear(city, x, y, x + ZSIZE[type] - 1, y + ZSIZE[type] - 1); scnZone(city, type, x, y); };
  if (which.includes('s')) put(Z.STADIUM, x0 - 8, y0 + 1);
  if (which.includes('p')) put(Z.PORT, x0 - 8, y0 + 9);
  if (which.includes('a')) put(Z.AIRPORT, x0 - 10, y0 + 17);
}

// Zufällige Zone mit Sonderbauten (Polizei/Feuerwehr) für Rasterplätze
function scnMix(r, c, i, dens, opts) {
  opts = opts || {};
  return (bc, br, slot) => {
    if (rand(100) < (opts.empty || 12)) return null;
    if (!opts.noPolice && rand(45) === 0) return [Z.POLICE, 0, 0];
    if (rand(45) === 0) return [Z.FIRE, 0, 0];
    const t = weighted([[r, Z.RES], [c, Z.COM], [i, Z.IND]]);
    return [t, dens(t), t === Z.IND ? rand(1) : (opts.val !== undefined ? opts.val : rand(3))];
  };
}

function buildScenario(city, sc) {
  city.reset();
  generateTerrain(city, { seed: sc.seed, water: 1, trees: 1 });
  RNG.s = (sc.seed * 7919) >>> 0;
  const low = t => t === Z.RES ? 1 + rand(1) : t === Z.COM ? 1 + rand(2) : 1 + rand(1);
  const mid = t => t === Z.RES ? 1 + rand(2) : t === Z.COM ? 1 + rand(3) : 1 + rand(2);

  switch (sc.id) {
    case 'dullsville': {
      generateTerrain(city, { seed: sc.seed, water: 1, trees: 2 });
      RNG.s = 99;
      scnGrid(city, 44, 38, 4, 4, scnMix(7, 2, 2, t => rand(1), { empty: 30, val: 1 }));
      scnPlants(city, Z.COAL, 44, 38);
      break;
    }
    case 'sf': {
      scnWater(city, (x, y) => x < 14 + Math.sin(y / 9) * 4 || y < 10 + Math.sin(x / 7) * 3);
      scnGrid(city, 26, 16, 10, 14, scnMix(4, 3, 3, low));
      scnPlants(city, Z.COAL, 26, 16);
      scnSpecials(city, 26, 16, 'sp');
      break;
    }
    case 'hamburg': {
      generateTerrain(city, { seed: sc.seed, water: 0, trees: 1 });
      scnWater(city, (x, y) => Math.abs(y - (50 + Math.sin(x / 11) * 5)) < 3 + (x > 70 ? 2 : 0));
      const base = scnMix(4, 3, 2, low, { empty: 25 });
      const harbor = scnMix(2, 1, 5, low, { empty: 25 });
      scnGrid(city, 20, 14, 12, 18, (bc, br, slot) => Math.abs(14 + br * 4 - 50) < 12 ? harbor(bc, br, slot) : base(bc, br, slot), { keepWater: true });
      scnPlants(city, Z.COAL, 20, 14, 0, 3);
      scnPlants(city, Z.COAL, 20, 62, 0, 3);
      scnSpecials(city, 20, 14, 'sp');
      break;
    }
    case 'bern': {
      generateTerrain(city, { seed: sc.seed, water: 1, trees: 1 });
      scnGrid(city, 22, 18, 11, 14, scnMix(4, 3, 3, mid, { empty: 4 }));
      scnPlants(city, Z.COAL, 22, 18);
      scnSpecials(city, 22, 18);
      break;
    }
    case 'tokyo': {
      scnWater(city, (x, y) => y > 80 + Math.sin(x / 8) * 3 || x > 106 + Math.sin(y / 6) * 3);
      scnGrid(city, 20, 12, 12, 16, scnMix(4, 3, 3, low));
      scnPlants(city, Z.COAL, 20, 12);
      scnSpecials(city, 20, 12);
      break;
    }
    case 'detroit': {
      generateTerrain(city, { seed: sc.seed, water: 1, trees: 0 });
      scnWater(city, (x, y) => x > 110);
      const north = scnMix(2, 1, 6, t => t === Z.IND ? 2 + rand(1) : rand(1), { noPolice: true, empty: 20, val: 0 });
      const south = scnMix(7, 2, 1, t => rand(2), { noPolice: true, empty: 20, val: 0 });
      scnGrid(city, 20, 12, 12, 18, (bc, br, slot) => br < 7 ? north(bc, br, slot) : south(bc, br, slot));
      scnPlants(city, Z.COAL, 20, 12);
      scnSpecials(city, 20, 12);
      break;
    }
    case 'boston': {
      scnWater(city, (x, y) => x > 102 + Math.sin(y / 5) * 4 || (y > 86 && x > 60));
      scnGrid(city, 18, 12, 11, 17, scnMix(4, 3, 3, low));
      scnPlants(city, Z.NUCLEAR, 18, 12, 1);
      scnPlants(city, Z.COAL, 18, 60, 0, 1);
      scnSpecials(city, 18, 12);
      break;
    }
    case 'rio': {
      scnWater(city, (x, y) => x > 94 + Math.sin(y / 7) * 5 || y > 90);
      scnGrid(city, 16, 10, 11, 19, scnMix(4, 3, 3, low));
      scnPlants(city, Z.NUCLEAR, 16, 10, 1);
      scnSpecials(city, 16, 10);
      break;
    }
  }
  // Wald im Stadtgebiet ist schon geräumt; Verzierung
  for (let i = 0; i < W * H; i++) if (city.tile[i] !== T.ZONE && city.vari[i] === 0 && city.tile[i] < T.ROAD) city.vari[i] = rand(3);

  city.name = sc.name;
  city.funds = sc.funds;
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
      case 'rio': if (w % 24 === 0) { this.makeFlood(); this.makeFlood(); } break;
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
