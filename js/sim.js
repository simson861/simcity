'use strict';
/*
 * Simulation – Ablauf wie im Original in 16 Phasen pro Zyklus.
 * Ein Zyklus entspricht einer Woche Spielzeit (48 pro Jahr).
 */

// Steuertabelle für die Nachfrage (setValves) – exakt wie im Original (Micropolis simulate.cpp)
const TAX_TABLE = [200, 150, 120, 100, 80, 50, 30, 0, -10, -40, -100, -150, -200, -250, -300, -350, -400, -450, -500, -550, -600];
const R_LEVELS = [0.7, 0.9, 1.2];
const F_LEVELS = [1.4, 1.2, 0.8];
const DIS_CHANCE = [10 * 48, 5 * 48, 60];
const MELTDOWN_TABLE = [30000, 20000, 10000];
// Scan-Häufigkeit je Tempo (langsam/mittel/schnell), wie im Original
const SPD_POWER = [1, 2, 4, 5], SPD_POL = [1, 2, 7, 17], SPD_CRM = [1, 1, 8, 18], SPD_POP = [1, 1, 9, 19], SPD_FIR = [1, 1, 10, 20];

const PROBLEM_NAMES = ['Kriminalität', 'Umweltverschmutzung', 'Wohnkosten', 'Steuern', 'Verkehr', 'Arbeitslosigkeit', 'Feuer'];

// Glättung wie smoothDitherMap im Original: (Summe 4 Nachbarn + Mitte) / 4
function smoothMap(src, dst, w, h) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let z = 0;
    const i = y * w + x;
    if (x > 0) z += src[i - 1];
    if (x < w - 1) z += src[i + 1];
    if (y > 0) z += src[i - w];
    if (y < h - 1) z += src[i + w];
    z = (z + src[i]) >> 2;
    dst[i] = z > 255 ? 255 : z;
  }
}
// Glättung der Wachen-Karten: (Mitte + Nachbarn/4) / 2
function smoothStation(src, w, h) {
  const tmp = new Int32Array(src);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let e = 0;
    const i = y * w + x;
    if (x > 0) e += tmp[i - 1];
    if (x < w - 1) e += tmp[i + 1];
    if (y > 0) e += tmp[i - w];
    if (y < h - 1) e += tmp[i + w];
    src[i] = (tmp[i] + (e >> 2)) >> 1;
  }
}

Object.assign(City.prototype, {

  // ================= Hauptschleife: eine Phase =================
  simPhase() {
    const p = this.phase;
    const sp = clamp(this.speed, 1, 3);
    switch (p) {
      case 0:
        this.simCycle++;
        this.cityTime++;
        if ((this.simCycle & 1) === 0) this.setValves();
        this.clearCensus();
        break;
      case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8:
        this.mapScan(p - 1);
        break;
      case 9:
        this.finishCensus();
        if (this.cityTime % 4 === 0) this.take10Census();
        if (this.cityTime % 48 === 0) this.take120Census();   // 120-Jahre-Grafik: ein Wert pro Jahr
        if (this.cityTime % 48 === 0) { this.collectTax(); this.evaluate(); }
        this.scenarioCheck();
        this.emit('census');
        break;
      case 10:
        if (this.simCycle % 5 === 0) this.decRateOfGrowth();
        this.decTraffic();
        this.sendMessages();
        break;
      case 11:
        if (this.powerDirty || this.simCycle % SPD_POWER[sp] === 0) this.powerScan();
        break;
      case 12:
        if (this.simCycle % SPD_POL[sp] === 0) this.pollutionTerrainLandValueScan();
        break;
      case 13:
        if (this.simCycle % SPD_CRM[sp] === 0) this.crimeScan();
        break;
      case 14:
        if (this.simCycle % SPD_POP[sp] === 0) this.populationDensityScan();
        break;
      case 15:
        if (this.simCycle % SPD_FIR[sp] === 0) this.fireAnalysis();
        this.doDisasters();
        break;
    }
    this.phase = (p + 1) & 15;
  },

  /** Alle Analysekarten einmal komplett berechnen (nach Laden/Neustart). */
  fullAnalysis() {
    this.powerScan();
    this.clearCensus();
    const saveRandom = RNG.s;
    this.censusOnly = true;
    for (let i = 0; i < 8; i++) this.mapScan(i);
    this.censusOnly = false;
    RNG.s = saveRandom;
    this.finishCensus();
    this.populationDensityScan();
    this.pollutionTerrainLandValueScan();
    this.crimeScan();
    this.fireAnalysis();
    this.pollutionTerrainLandValueScan();
  },

  clearCensus() {
    this.cen = City.emptyCensus();
    this.fireStMap.fill(0);
    this.policeStMap.fill(0);
  },

  finishCensus() {
    this.stats = this.cen;
    this.cen = City.emptyCensus();
  },

  // ================= Kartenabtastung =================
  mapScan(part) {
    const x0 = part * 15, x1 = Math.min(W, x0 + 15);
    const cen = this.cen;
    for (let x = x0; x < x1; x++) {
      for (let y = 0; y < H; y++) {
        const i = idx(x, y);
        const k = this.tile[i];
        switch (k) {
          case T.FIRE:
            cen.firePop++;
            if (!this.censusOnly && (rand16() & 3) === 0) this.doFire(x, y);
            break;
          case T.FLOOD:
            if (!this.censusOnly) this.doFlood(x, y);
            break;
          case T.RAD:
            if (!this.censusOnly && (rand16() & 4095) === 0) this.setTile(x, y, T.DIRT, 0);
            break;
          case T.ZONE: {
            const z = this.zones.get(this.zid[i]);
            if (z && x === zoneCX(z) && y === zoneCY(z)) this.doZone(z);
            break;
          }
          default:
            // Straßen-Schienen-Kreuzungen zählen (wie im Original) als Schiene
            if (isRailK(k)) this.doRail(x, y, k);
            else if (isRoadK(k)) this.doRoad(x, y, k);
        }
      }
    }
  },

  doRoad(x, y, k) {
    // Brücke zählt 5 Felder (1 + 4), starker Verkehr doppelt – wie doRoad() im Original
    this.cen.roadTotal += k === T.ROADBRIDGE ? 5 : 1;
    if (k !== T.ROADBRIDGE && this.trafficDensity[(x >> 1) + (y >> 1) * HW] >= 192) this.cen.roadTotal++;
    if (this.censusOnly) return;
    if (this.roadEffect < 30 && (rand16() & 511) === 0 && k !== T.ROADWIRE && this.roadEffect < (rand16() & 31)) {
      if (k === T.ROADBRIDGE) this.setTile(x, y, T.WATER, 0);
      else this.setTile(x, y, T.RUBBLE, rand(2));
    }
  },

  doRail(x, y, k) {
    this.cen.railTotal++;
    if (this.censusOnly) return;
    if (this.totalPop > 20 && !this.findSprite(SPR.TRAIN) && rand(25) === 0 && k === T.RAIL) this.makeSprite(SPR.TRAIN, x, y);
    if (this.roadEffect < 30 && (rand16() & 511) === 0 && k !== T.RAILWIRE && this.roadEffect < (rand16() & 31)) {
      if (k === T.RAILBRIDGE) this.setTile(x, y, T.WATER, 0);
      else this.setTile(x, y, T.RUBBLE, rand(2));
    }
  },

  // ---------- Feuer & Flut ----------
  doFire(x, y) {
    for (let d = 0; d < 4; d++) {
      if ((rand16() & 7) !== 0) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (!inBounds(nx, ny)) continue;
      const nk = this.tile[idx(nx, ny)];
      if (!isBurnK(nk)) continue;
      if (nk === T.ZONE) this.burnZone(this.zoneAt(nx, ny), nx, ny);
      else this.setTile(nx, ny, T.FIRE, rand(3));
    }
    const e = this.fireEffectMap[(x >> 3) + (y >> 3) * EW];
    let rate = 10;
    if (e) { rate = 3; if (e > 20) rate = 2; if (e > 100) rate = 1; }
    if (rand(rate) === 0) this.setTile(x, y, T.RUBBLE, rand(3));
  },

  /** Feuer greift auf eine Zone über (fireZone im Original). Vereinfachung des Zonenmodells: Im Original
   *  brennt nur das erreichte Feld, die Zone stirbt erst, wenn das Feuer ihre Mitte erreicht – hier brennt
   *  die Zone sofort ab: Trümmer, Brandherde am erreichten Feld und in der Mitte. */
  burnZone(z, fx, fy) {
    if (!z) return;
    const ri = (zoneCX(z) >> 3) + (zoneCY(z) >> 3) * EW;
    this.rateOfGrowth[ri] = clamp(this.rateOfGrowth[ri] - 20, -200, 200);
    // Original: Zonenmitte mit Feldnummer > IZB explodiert (bebaute Industrie und alle Sonderbauten)
    const explode = z.type > Z.IND || (z.type === Z.IND && z.den > 0);
    this.removeZone(z, T.RUBBLE);
    this.setTile(fx, fy, T.FIRE, rand(3));
    this.setTile(zoneCX(z), zoneCY(z), T.FIRE, rand(3));
    if (explode) this.makeExplosionAt(zoneCX(z), zoneCY(z));
  },

  doFlood(x, y) {
    if (this.floodCnt > 0) {
      for (let d = 0; d < 4; d++) {
        if ((rand16() & 7) !== 0) continue;
        const nx = x + DX[d], ny = y + DY[d];
        if (!inBounds(nx, ny)) continue;
        const nk = this.tile[idx(nx, ny)];
        if (nk === T.DIRT || isBurnK(nk) || nk === T.RUBBLE) {
          if (nk === T.ZONE) this.removeZone(this.zoneAt(nx, ny), T.RUBBLE);
          this.setTile(nx, ny, T.FLOOD, rand(3));
        }
      }
    } else if ((rand16() & 15) === 0) {
      this.setTile(x, y, T.DIRT, rand(2));
    }
  },

  // ================= Zonen =================
  doZone(z) {
    const cx = zoneCX(z), cy = zoneCY(z);
    let powered = this.power[idx(cx, cy)] === 1;
    if (!needsPower(z)) powered = true;
    z.powered = powered;
    if (powered) this.cen.poweredZones++; else this.cen.unpoweredZones++;
    switch (z.type) {
      case Z.RES: this.doResidential(z, powered); break;
      case Z.COM: this.doCommercial(z, powered); break;
      case Z.IND: this.doIndustrial(z, powered); break;
      default: this.doSpecialZone(z, powered);
    }
  },

  housesCount(z) { let n = 0; for (const h of z.houses) if (h) n++; return n; },

  resZonePop(z) { return z.den === 0 ? this.housesCount(z) : 8 + 8 * z.den; },

  zonePop(z) {
    if (z.type === Z.RES) return z.special ? 0 : this.resZonePop(z);
    if (z.type === Z.COM || z.type === Z.IND) return z.den;
    return 0;
  },

  landPollutionValue(z) {
    const h = (zoneCX(z) >> 1) + (zoneCY(z) >> 1) * HW;
    const v = this.landValue[h] - this.pollution[h];
    if (v < 30) return 0;
    if (v < 80) return 1;
    if (v < 150) return 2;
    return 3;
  },

  incRateOfGrowth(z, amount) {
    const i = (zoneCX(z) >> 3) + (zoneCY(z) >> 3) * EW;
    this.rateOfGrowth[i] = clamp(this.rateOfGrowth[i] + amount * 4, -200, 200);
  },

  doResidential(z, powered) {
    if (z.special) { this.doHospitalChurch(z); return; }
    this.cen.resZonePop++;
    const tpop = this.resZonePop(z);
    this.cen.resPop += tpop;
    if (this.censusOnly) return;
    let trfGood = 1;
    if (tpop > rand(35)) trfGood = this.makeTraffic(z, Z.RES);
    if (trfGood === -1) { this.doResOut(z, tpop, this.landPollutionValue(z)); return; }
    if (z.den === 0 || (rand16() & 7) === 0) {
      const loc = this.evalRes(z, trfGood);
      let zscore = this.resValve + loc;
      if (!powered) zscore = -500;
      if (zscore > -350 && zscore - 26380 > rand16s()) {
        if (tpop === 0 && (rand16() & 3) === 0) { this.makeHospital(z); return; }
        this.doResIn(z, tpop, this.landPollutionValue(z));
        return;
      }
      if (zscore < 350 && zscore + 26380 < rand16s()) this.doResOut(z, tpop, this.landPollutionValue(z));
    }
  },

  evalRes(z, traf) {
    if (traf < 0) return -3000;
    const h = (zoneCX(z) >> 1) + (zoneCY(z) >> 1) * HW;
    let v = this.landValue[h] - this.pollution[h];
    v = v < 0 ? 0 : Math.min(v * 32, 6000);
    return v - 3000;
  },

  doResIn(z, pop, value) {
    const h = (zoneCX(z) >> 1) + (zoneCY(z) >> 1) * HW;
    if (this.pollution[h] > 128) return;
    if (z.den === 0) {
      if (pop < 8) { this.buildHouse(z, value); this.incRateOfGrowth(z, 1); return; }
      if (this.popDensity[h] > 64) { z.den = 1; z.val = value; z.houses.fill(0); this.incRateOfGrowth(z, 8); this.mapVersion++; }
      return;
    }
    if (z.den < 4) { z.den++; z.val = value; this.incRateOfGrowth(z, 8); this.mapVersion++; }
  },

  doResOut(z, pop, value) {
    if (!pop) return;
    if (z.den > 1) { z.den--; z.val = value; this.incRateOfGrowth(z, -8); this.mapVersion++; return; }
    if (z.den === 1) {
      z.den = 0;
      for (let i = 0; i < 8; i++) z.houses[i] = 1 + value * 3 + rand(2);
      this.incRateOfGrowth(z, -8);
      this.mapVersion++;
      return;
    }
    this.incRateOfGrowth(z, -1);
    for (let i = 0; i < 8; i++) if (z.houses[i]) { z.houses[i] = 0; this.mapVersion++; return; }
  },

  // Häuser-Positionen im 3x3-Grundriss (ohne Mitte)
  buildHouse(z, value) {
    let best = -1, hscore = 0;
    for (let i = 0; i < 8; i++) {
      if (z.houses[i]) continue;
      const [hx, hy] = HOUSE_POS[i];
      const x = z.x + hx, y = z.y + hy;
      let score = 1;
      for (let d = 0; d < 4; d++) {
        const k = this.kind(x + DX[d], y + DY[d]);
        if (k > 0 && k !== T.WATER && k !== T.TREES) score++;
      }
      if (score > hscore) { hscore = score; best = i; }
      else if (score === hscore && (rand16() & 7) === 0) best = i;
    }
    if (best >= 0) { z.houses[best] = 1 + value * 3 + rand(2); this.mapVersion++; }
  },

  makeHospital(z) {
    if (this.needHospital > 0) { z.special = 1; this.needHospital = 0; this.mapVersion++; return; }
    if (this.needChurch > 0) { z.special = 2; this.needChurch = 0; this.mapVersion++; }
  },

  doHospitalChurch(z) {
    if (z.special === 1) {
      this.cen.hospitalPop++;
      if (!this.censusOnly && this.needHospital === -1 && rand(20) === 0) { z.special = 0; this.mapVersion++; }
    } else {
      this.cen.churchPop++;
      if (!this.censusOnly && this.needChurch === -1 && rand(20) === 0) { z.special = 0; this.mapVersion++; }
    }
  },

  doCommercial(z, powered) {
    this.cen.comZonePop++;
    const tpop = z.den;
    this.cen.comPop += tpop;
    if (this.censusOnly) return;
    let trfGood = 1;
    if (tpop > rand(5)) trfGood = this.makeTraffic(z, Z.COM);
    if (trfGood === -1) { this.doComOut(z, tpop, this.landPollutionValue(z)); return; }
    if ((rand16() & 7) === 0) {
      const loc = trfGood < 0 ? -3000 : this.comRate[(zoneCX(z) >> 3) + (zoneCY(z) >> 3) * EW];
      let zscore = this.comValve + loc;
      if (!powered) zscore = -500;
      if (trfGood && zscore > -350 && zscore - 26380 > rand16s()) { this.doComIn(z, tpop, this.landPollutionValue(z)); return; }
      if (zscore < 350 && zscore + 26380 < rand16s()) this.doComOut(z, tpop, this.landPollutionValue(z));
    }
  },

  doComIn(z, pop, value) {
    const h = (zoneCX(z) >> 1) + (zoneCY(z) >> 1) * HW;
    if (pop > (this.landValue[h] >> 5)) return;
    if (pop < 5) { z.den = pop + 1; z.val = value; this.incRateOfGrowth(z, 8); this.mapVersion++; }
  },

  doComOut(z, pop, value) {
    if (pop > 1) { z.den = pop - 1; z.val = value; this.incRateOfGrowth(z, -8); this.mapVersion++; return; }
    if (pop === 1) { z.den = 0; this.incRateOfGrowth(z, -8); this.mapVersion++; }
  },

  doIndustrial(z, powered) {
    this.cen.indZonePop++;
    const tpop = z.den;
    this.cen.indPop += tpop;
    if (this.censusOnly) return;
    let trfGood = 1;
    if (tpop > rand(5)) trfGood = this.makeTraffic(z, Z.IND);
    if (trfGood === -1) { this.doIndOut(z, tpop, rand16() & 1); return; }
    if ((rand16() & 7) === 0) {
      const loc = trfGood < 0 ? -3000 : 0;
      let zscore = this.indValve + loc;
      if (!powered) zscore = -500;
      if (zscore > -350 && zscore - 26380 > rand16s()) { this.doIndIn(z, tpop, rand16() & 1); return; }
      if (zscore < 350 && zscore + 26380 < rand16s()) this.doIndOut(z, tpop, rand16() & 1);
    }
  },

  doIndIn(z, pop, value) {
    if (pop < 4) { z.den = pop + 1; z.val = value; this.incRateOfGrowth(z, 8); this.mapVersion++; }
  },

  doIndOut(z, pop, value) {
    if (pop > 1) { z.den = pop - 1; z.val = value; this.incRateOfGrowth(z, -8); this.mapVersion++; return; }
    if (pop === 1) { z.den = 0; this.incRateOfGrowth(z, -8); this.mapVersion++; }
  },

  doSpecialZone(z, powered) {
    const cx = zoneCX(z), cy = zoneCY(z);
    const ei = (cx >> 3) + (cy >> 3) * EW;
    switch (z.type) {
      case Z.COAL: this.cen.coalPop++; break;
      case Z.NUCLEAR:
        if (!this.censusOnly && this.disastersEnabled && rand(MELTDOWN_TABLE[this.level]) === 0) { this.doMeltdown(z); break; }
        this.cen.nuclearPop++;
        break;
      case Z.FIRE: {
        this.cen.firestPop++;
        let e = this.fireEffect;
        if (!powered) e >>= 1;
        if (this.findPerimeterRoad(z) < 0) e >>= 1;
        this.fireStMap[ei] += e;
        break;
      }
      case Z.POLICE: {
        this.cen.policePop++;
        let e = this.policeEffect;
        if (!powered) e >>= 1;
        if (this.findPerimeterRoad(z) < 0) e >>= 1;
        this.policeStMap[ei] += e;
        break;
      }
      case Z.STADIUM:
        this.cen.stadiumPop++;
        if (this.censusOnly) break;
        if (z.game > 0) z.game--;
        if (powered && ((this.cityTime + cx + cy) & 31) === 0) z.game = 4;
        break;
      case Z.PORT:
        this.cen.portPop++;
        if (!this.censusOnly && powered && !this.findSprite(SPR.SHIP)) this.generateShip();
        break;
      case Z.AIRPORT:
        this.cen.airportPop++;
        if (this.censusOnly || !powered) break;
        // doAirport(): 1/6 Flugzeug, sonst 1/13 Hubschrauber (jeweils nur einer gleichzeitig)
        if (rand(5) === 0) { if (!this.findSprite(SPR.PLANE)) this.makeSprite(SPR.PLANE, cx + 2, cy + 3); }
        else if (rand(12) === 0 && !this.findSprite(SPR.COPTER)) this.makeSprite(SPR.COPTER, cx, cy);
        break;
    }
  },

  // ================= Verkehr =================
  // Straße am Zonenrand suchen – Reihenfolge wie im Original: oben (l→r), rechts (o→u), unten (r→l), links (u→o);
  // Ecken zählen nicht. Für 3x3-Zonen exakt die zwölf Felder von findPerimeterRoad().
  findPerimeterRoad(z) {
    const s = z.size, x0 = z.x, y0 = z.y;
    const test = (x, y) => inBounds(x, y) && isDriveK(this.tile[idx(x, y)]);
    for (let x = x0; x < x0 + s; x++) if (test(x, y0 - 1)) return idx(x, y0 - 1);
    for (let y = y0; y < y0 + s; y++) if (test(x0 + s, y)) return idx(x0 + s, y);
    for (let x = x0 + s - 1; x >= x0; x--) if (test(x, y0 + s)) return idx(x, y0 + s);
    for (let y = y0 + s - 1; y >= y0; y--) if (test(x0 - 1, y)) return idx(x0 - 1, y);
    return -1;
  },

  /** Rückgabe 1 = Ziel erreicht, 0 = kein Ziel, -1 = keine Straße */
  makeTraffic(z, type) {
    const start = this.findPerimeterRoad(z);
    if (start < 0) return -1;
    const stack = [];
    if (this.tryDrive(start % W, (start / W) | 0, type, stack)) {
      this.addToTrafficDensity(stack);
      return 1;
    }
    return 0;
  },

  tryDrive(x, y, dest, stack) {
    let dirLast = -1;
    for (let dist = 0; dist < 30; dist++) {
      const dir = this.tryGo(x, y, dirLast);
      if (dir >= 0) {
        x += DX[dir]; y += DY[dir];
        dirLast = (dir + 2) & 3;
        if (dist & 1) stack.push(idx(x, y));
        if (this.driveDone(x, y, dest)) return true;
      } else {
        if (stack.length > 0) { stack.pop(); dist += 3; }
        else return false;
      }
    }
    return false;
  },

  // Wie tryGo() im Original: keine Umkehr; in der Sackgasse -1 (tryDrive geht dann zurück,
  // ohne die Position zu ändern – die Fahrt scheitert damit praktisch).
  tryGo(x, y, dirLast) {
    const ok = [false, false, false, false];
    let count = 0, only = -1;
    for (let d = 0; d < 4; d++) {
      if (d === dirLast) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (inBounds(nx, ny) && isDriveK(this.tile[idx(nx, ny)])) { ok[d] = true; count++; only = d; }
    }
    if (count === 0) return -1;
    if (count === 1) return only;
    let i = rand16() & 3;
    while (!ok[i]) i = (i + 1) & 3;
    return i;
  },

  driveDone(x, y, dest) {
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inBounds(nx, ny) || this.tile[idx(nx, ny)] !== T.ZONE) continue;
      const z = this.zones.get(this.zid[idx(nx, ny)]);
      if (!z) continue;
      const resBuilt = z.type === Z.RES && (z.special || z.den > 0 || this.housesCount(z) > 0);
      if (dest === Z.RES) { if (z.type !== Z.RES) return true; }
      else if (dest === Z.COM) { if (resBuilt || z.type === Z.COM || z.type === Z.IND || z.type === Z.PORT) return true; }
      else { if (resBuilt) return true; }
    }
    return false;
  },

  addToTrafficDensity(stack) {
    for (const i of stack) {
      const k = this.tile[i];
      // nur Straßenfelder (Schiene und Bahnübergang erzeugen keinen Verkehr – wichtig für Bern)
      if (k !== T.ROAD && k !== T.ROADWIRE && k !== T.ROADBRIDGE) continue;
      const x = i % W, y = (i / W) | 0;
      const h = (x >> 1) + (y >> 1) * HW;
      let t = this.trafficDensity[h] + 50;
      if (t > 240) t = 240;
      this.trafficDensity[h] = t;
      if (t >= 240 && rand(5) === 0) {
        this.trafficMaxX = x; this.trafficMaxY = y;
        const c = this.findSprite(SPR.COPTER);
        if (c) { c.destX = x * 16 + 8; c.destY = y * 16 + 8; }
      }
    }
  },

  decTraffic() {
    const t = this.trafficDensity;
    for (let i = 0; i < t.length; i++) {
      let z = t[i];
      if (z) {
        if (z > 24) z -= z > 200 ? 34 : 24;
        else z = 0;
        t[i] = z;
      }
    }
  },

  decRateOfGrowth() {
    const r = this.rateOfGrowth;
    for (let i = 0; i < r.length; i++) {
      if (r[i] > 0) r[i]--; else if (r[i] < 0) r[i]++;
    }
  },

  // ================= Strom =================
  powerScan() {
    this.powerDirty = false;
    this.power.fill(0);
    let maxPower = 0;
    const plants = [];
    for (const z of this.zones.values()) {
      if (z.type === Z.COAL) { maxPower += 700; plants.push(z); }
      else if (z.type === Z.NUCLEAR) { maxPower += 2000; plants.push(z); }
    }
    let num = 0;
    let brown = false;
    const stack = [];
    outer:
    for (const p of plants) {
      stack.push(idx(zoneCX(p), zoneCY(p)));
      while (stack.length) {
        const i = stack.pop();
        if (this.power[i]) continue;
        if (num >= maxPower) { brown = true; break outer; }
        this.power[i] = 1;
        num++;
        const x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (!inBounds(nx, ny)) continue;
          const n = idx(nx, ny);
          if (!this.power[n] && isCondK(this.tile[n])) stack.push(n);
        }
      }
    }
    this.powerCapacity = maxPower;
    this.powerUsed = num;
    if (brown && !this.brownout) this.message('Brownout: Kraftwerkskapazität erschöpft! Baue ein weiteres Kraftwerk.');
    this.brownout = brown;
    for (const z of this.zones.values()) z.powered = !needsPower(z) || this.power[idx(zoneCX(z), zoneCY(z))] === 1;
  },

  // ================= Umwelt, Bodenwert =================
  pollutionValue(x, y, k) {
    if (isRoadK(k)) {
      const t = this.trafficDensity[(x >> 1) + (y >> 1) * HW];
      return t >= 192 ? 75 : t >= 64 ? 50 : 0;
    }
    if (k === T.FIRE) return 90;
    if (k === T.RAD) return 255;
    if (k === T.ZONE) {
      const z = this.zones.get(this.zid[idx(x, y)]);
      if (!z) return 0;
      if (z.type === Z.IND && z.den > 0) return 50;
      if (z.type === Z.PORT || z.type === Z.AIRPORT || z.type === Z.COAL) return 100;
    }
    return 0;
  },

  cityCenterDistance(x, y) {
    const d = Math.abs(x - this.cityCenterX) + Math.abs(y - this.cityCenterY);
    return Math.min(d | 0, 64);
  },

  pollutionTerrainLandValueScan() {
    const qtem = new Int32Array(QW * QH);
    const t1 = new Uint8Array(HW * HH), t2 = new Uint8Array(HW * HH);
    let lvTotal = 0, lvCount = 0;
    for (let hy = 0; hy < HH; hy++) for (let hx = 0; hx < HW; hx++) {
      let plevel = 0, lvflag = 0;
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
        const x = hx * 2 + xx, y = hy * 2 + yy;
        const k = this.tile[idx(x, y)];
        if (k === T.DIRT) continue;
        if (isNaturalK(k)) { qtem[(x >> 2) + (y >> 2) * QW] += 15; continue; }
        plevel += this.pollutionValue(x, y, k);
        if (k >= T.ROAD) lvflag++;
      }
      const h = hx + hy * HW;
      t1[h] = plevel > 255 ? 255 : plevel;
      if (lvflag) {
        let dis = 34 - (this.cityCenterDistance(hx * 2, hy * 2) >> 1);
        dis <<= 2;
        dis += this.terrainDensity[(hx >> 1) + (hy >> 1) * QW];
        dis -= this.pollution[h];
        if (this.crime[h] > 190) dis -= 20;
        dis = clamp(dis, 1, 250);
        this.landValue[h] = dis;
        lvTotal += dis; lvCount++;
      } else this.landValue[h] = 0;
    }
    this.landValueAverage = lvCount ? Math.floor(lvTotal / lvCount) : 0;
    smoothMap(t1, t2, HW, HH);
    smoothMap(t2, t1, HW, HH);
    let pcount = 0, ptotal = 0, pmax = 0;
    for (let i = 0; i < HW * HH; i++) {
      const z = t1[i];
      this.pollution[i] = z;
      if (z) {
        pcount++; ptotal += z;
        if (z > pmax || (z === pmax && (rand16() & 3) === 0)) {
          pmax = z; this.pollutionMaxX = (i % HW) * 2; this.pollutionMaxY = ((i / HW) | 0) * 2;
        }
      }
    }
    this.pollutionAverage = pcount ? Math.floor(ptotal / pcount) : 0;
    // Geländedichte glätten
    for (let y = 0; y < QH; y++) for (let x = 0; x < QW; x++) {
      const i = x + y * QW;
      let e = 0;
      if (x > 0) e += qtem[i - 1];
      if (x < QW - 1) e += qtem[i + 1];
      if (y > 0) e += qtem[i - QW];
      if (y < QH - 1) e += qtem[i + QW];
      this.terrainDensity[i] = Math.min(255, ((e >> 2) + qtem[i]) >> 1);
    }
  },

  crimeScan() {
    this.policeEffectMap.set(this.policeStMap);
    for (let n = 0; n < 3; n++) smoothStation(this.policeEffectMap, EW, EH);
    let numz = 0, total = 0, cmax = 0;
    for (let hy = 0; hy < HH; hy++) for (let hx = 0; hx < HW; hx++) {
      const h = hx + hy * HW;
      const lv = this.landValue[h];
      if (lv) {
        numz++;
        let z = 128 - lv + this.popDensity[h];
        z = Math.min(z, 300);
        z -= this.policeEffectMap[(hx >> 2) + (hy >> 2) * EW];
        z = clamp(z, 0, 250);
        this.crime[h] = z;
        total += z;
        if (z > cmax || (z === cmax && (rand16() & 3) === 0)) { cmax = z; this.crimeMaxX = hx * 2; this.crimeMaxY = hy * 2; }
      } else this.crime[h] = 0;
    }
    this.crimeAverage = numz ? Math.floor(total / numz) : 0;
  },

  fireAnalysis() {
    this.fireEffectMap.set(this.fireStMap);
    for (let n = 0; n < 3; n++) smoothStation(this.fireEffectMap, EW, EH);
  },

  popDensityOf(z) {
    if (z.type === Z.RES) return z.special ? 0 : this.resZonePop(z);
    if (z.type === Z.COM || z.type === Z.IND) return z.den * 8;
    return 0;
  },

  populationDensityScan() {
    const t1 = new Uint8Array(HW * HH), t2 = new Uint8Array(HW * HH);
    let xt = 0, yt = 0, zt = 0;
    for (const z of this.zones.values()) {
      const cx = zoneCX(z), cy = zoneCY(z);
      const pd = Math.min(this.popDensityOf(z) * 8, 254);
      t1[(cx >> 1) + (cy >> 1) * HW] = pd;
      xt += cx; yt += cy; zt++;
    }
    smoothMap(t1, t2, HW, HH);
    smoothMap(t2, t1, HW, HH);
    smoothMap(t1, t2, HW, HH);
    for (let i = 0; i < HW * HH; i++) this.popDensity[i] = Math.min(255, t2[i] * 2);
    if (zt) { this.cityCenterX = Math.floor(xt / zt); this.cityCenterY = Math.floor(yt / zt); }
    else { this.cityCenterX = W / 2; this.cityCenterY = H / 2; }
    for (let ey = 0; ey < EH; ey++) for (let ex = 0; ex < EW; ex++) {
      const d = this.cityCenterDistance(ex * 8, ey * 8);
      this.comRate[ex + ey * EW] = 64 - (d >> 1) * 4;
    }
  },

  // ================= Nachfrage (R/C/I-Ventile) =================
  setValves() {
    const s = this.stats;
    const h = this.hist;
    const normResPop = s.resPop / 8;
    this.totalPop = Math.floor(normResPop + s.comPop + s.indPop);
    const employment = normResPop > 0 ? (h.com[1] + h.ind[1]) / normResPop : 1;
    const migration = normResPop * (employment - 1);
    const births = normResPop * 0.02;
    const projectedResPop = normResPop + migration + births;
    let temp = h.com[1] + h.ind[1];
    let laborBase = temp > 0 ? h.res[1] / temp : 1;
    laborBase = clamp(laborBase, 0, 1.3);
    const internalMarket = (normResPop + s.comPop + s.indPop) / 3.7;
    const projectedComPop = internalMarket * laborBase;
    temp = [1.2, 1.1, 0.98][this.level];
    let projectedIndPop = s.indPop * laborBase * temp;
    if (projectedIndPop < 5) projectedIndPop = 5;
    let resRatio = normResPop > 0 ? projectedResPop / normResPop : 1.3;
    let comRatio = s.comPop > 0 ? projectedComPop / s.comPop : projectedComPop;
    let indRatio = s.indPop > 0 ? projectedIndPop / s.indPop : projectedIndPop;
    resRatio = Math.min(resRatio, 2); comRatio = Math.min(comRatio, 2); indRatio = Math.min(indRatio, 2);
    const z = Math.min(this.cityTax + this.level, 20);
    resRatio = (resRatio - 1) * 600 + TAX_TABLE[z];
    comRatio = (comRatio - 1) * 600 + TAX_TABLE[z];
    indRatio = (indRatio - 1) * 600 + TAX_TABLE[z];
    this.resValve = clamp(this.resValve + Math.trunc(resRatio), -2000, 2000);
    this.comValve = clamp(this.comValve + Math.trunc(comRatio), -1500, 1500);
    this.indValve = clamp(this.indValve + Math.trunc(indRatio), -1500, 1500);
    if (this.resCap && this.resValve > 0) this.resValve = 0;
    if (this.comCap && this.comValve > 0) this.comValve = 0;
    if (this.indCap && this.indValve > 0) this.indValve = 0;
    this.emit('valves');
  },

  // ================= Statistik =================
  take10Census() {
    const h = this.hist, s = this.stats;
    for (const key in h) h[key].copyWithin(1, 0, 119);
    h.res[0] = s.resPop >> 3;
    h.com[0] = s.comPop;
    h.ind[0] = s.indPop;
    this.crimeRamp += (this.crimeAverage - this.crimeRamp) / 4;
    h.crime[0] = Math.min(255, Math.round(this.crimeRamp));
    this.pollutionRamp += (this.pollutionAverage - this.pollutionRamp) / 4;
    h.pollution[0] = Math.min(255, Math.round(this.pollutionRamp));
    h.money[0] = clamp(Math.round(this.cashFlow / 20) + 128, 0, 255);
    // Bedarf an Krankenhäusern und Kirchen (im Original ebenfalls in take10Census)
    const want = s.resPop >> 8;
    this.needHospital = want > s.hospitalPop ? 1 : want < s.hospitalPop ? -1 : 0;
    this.needChurch = want > s.churchPop ? 1 : want < s.churchPop ? -1 : 0;
  },

  take120Census() {
    const h = this.hist, s = this.stats;
    for (const key in h) h[key].copyWithin(121, 120, 239);
    h.res[120] = s.resPop >> 3;
    h.com[120] = s.comPop;
    h.ind[120] = s.indPop;
    h.crime[120] = h.crime[0];
    h.pollution[120] = h.pollution[0];
    h.money[120] = h.money[0];
  },

  /** Historie mit aktuellen Werten füllen (Szenarien, geladene Städte ohne Historie). */
  fillHistory() {
    const h = this.hist, s = this.stats;
    h.res.fill(s.resPop >> 3); h.com.fill(s.comPop); h.ind.fill(s.indPop);
    h.crime.fill(this.crimeAverage); h.pollution.fill(this.pollutionAverage); h.money.fill(128);
    this.crimeRamp = this.crimeAverage; this.pollutionRamp = this.pollutionAverage;
  },

  // ================= Haushalt =================
  computeBudgetRequests() {
    const s = this.stats;
    this.policeFund = s.policePop * 100;
    this.fireFund = s.firestPop * 100;
    this.roadFund = Math.floor((s.roadTotal + s.railTotal * 2) * R_LEVELS[this.level]);
    this.taxFund = Math.floor(this.totalPop * this.landValueAverage / 120 * this.cityTax * F_LEVELS[this.level]);
  },

  collectTax() {
    this.computeBudgetRequests();
    this.prevFunds = this.funds;
    if (this.totalPop > 0) {
      if (this.autoBudget) {
        this.roadPct = 1; this.firePct = 1; this.policePct = 1;
        this.finishBudget(true);
      } else {
        this.emit('budget', { yearEnd: true });   // UI pausiert und ruft finishBudget()
      }
    } else {
      this.roadEffect = MAX_ROAD_EFFECT; this.policeEffect = MAX_POLICE_EFFECT; this.fireEffect = MAX_FIRE_EFFECT;
      this.cashFlow = 0;
    }
  },

  /** Ausgaben nach aktuellen Prozentsätzen berechnen (ohne zu buchen). */
  budgetPlan() {
    const req = {
      road: Math.round(this.roadFund * this.roadPct),
      fire: Math.round(this.fireFund * this.firePct),
      police: Math.round(this.policeFund * this.policePct),
    };
    let avail = this.funds + this.taxFund;
    const spend = { road: 0, fire: 0, police: 0 };
    for (const key of ['road', 'fire', 'police']) {
      const v = Math.max(0, Math.min(req[key], avail));
      spend[key] = v; avail -= v;
    }
    return { req, spend, total: spend.road + spend.fire + spend.police };
  },

  updateFundEffects(spend) {
    spend = spend || this.budgetPlan().spend;
    this.roadEffect = this.roadFund ? Math.floor(MAX_ROAD_EFFECT * spend.road / this.roadFund) : MAX_ROAD_EFFECT;
    this.fireEffect = this.fireFund ? Math.floor(MAX_FIRE_EFFECT * spend.fire / this.fireFund) : MAX_FIRE_EFFECT;
    this.policeEffect = this.policeFund ? Math.floor(MAX_POLICE_EFFECT * spend.police / this.policeFund) : MAX_POLICE_EFFECT;
    this.roadEffect = clamp(this.roadEffect, 0, MAX_ROAD_EFFECT);
    this.fireEffect = clamp(this.fireEffect, 0, MAX_FIRE_EFFECT);
    this.policeEffect = clamp(this.policeEffect, 0, MAX_POLICE_EFFECT);
  },

  finishBudget(auto) {
    const plan = this.budgetPlan();
    this.roadSpend = plan.spend.road; this.fireSpend = plan.spend.fire; this.policeSpend = plan.spend.police;
    if (auto && plan.total < plan.req.road + plan.req.fire + plan.req.police) {
      this.message('Die Stadtkasse ist leer! Nicht alle Ausgaben gedeckt.', undefined, undefined, true);
      if (this.roadFund) this.roadPct = plan.spend.road / this.roadFund;
      if (this.fireFund) this.firePct = plan.spend.fire / this.fireFund;
      if (this.policeFund) this.policePct = plan.spend.police / this.policeFund;
    }
    this.cashFlow = this.taxFund - plan.total;
    this.funds += this.cashFlow;
    this.updateFundEffects(plan.spend);
    this.emit('funds');
  },

  // ================= Bewertung =================
  evaluate() {
    if (this.totalPop > 0) {
      this.getAssessedValue();
      this.doPopNum();
      this.doProblems();
      this.getScore();
      this.doVotes();
    } else {
      this.cityScore = 500; this.cityYes = 0; this.cityAssessedValue = 0; this.cityClass = 0;
      this.problemOrder = [];
    }
    this.emit('evaluation');
  },

  getAssessedValue() {
    const s = this.stats;
    const z = s.roadTotal * 5 + s.railTotal * 10 + s.policePop * 1000 + s.firestPop * 1000 + s.hospitalPop * 400 +
      s.stadiumPop * 3000 + s.portPop * 5000 + s.airportPop * 10000 + s.coalPop * 3000 + s.nuclearPop * 6000;
    this.cityAssessedValue = z * 1000;
  },

  doPopNum() {
    const old = this.cityPop;
    this.cityPop = this.population();
    this.cityPopDelta = old === 0 ? 0 : this.cityPop - old;
    const p = this.cityPop;
    this.cityClass = p > 500000 ? 5 : p > 100000 ? 4 : p > 50000 ? 3 : p > 10000 ? 2 : p > 2000 ? 1 : 0;
  },

  getTrafficAverage() {
    let total = 0, count = 1;          // Original beginnt bei 1
    for (let i = 0; i < HW * HH; i++) if (this.landValue[i]) { total += this.trafficDensity[i]; count++; }
    this.trafficAverage = Math.floor(Math.floor(total / count) * 2.4);
    return this.trafficAverage;
  },

  getUnemployment() {
    const s = this.stats;
    const b = (s.comPop + s.indPop) * 8;
    if (b === 0) return 0;
    const r = s.resPop / b;
    // wie im Original nur nach oben begrenzt: Arbeitskräftemangel ergibt negative Werte (verbessert die Wertung)
    return Math.min(Math.trunc((r - 1) * 255), 255);
  },

  getFireSeverity() { return Math.min(this.stats.firePop * 5, 255); },

  doProblems() {
    const p = this.problemTable;
    p[0] = this.crimeAverage;
    p[1] = this.pollutionAverage;
    p[2] = Math.floor(this.landValueAverage * 0.7);
    p[3] = this.cityTax * 10;
    p[4] = this.getTrafficAverage();
    p[5] = this.getUnemployment();
    p[6] = this.getFireSeverity();
    // Abstimmung über Probleme (Bürgerbefragung)
    const v = this.problemVotes;
    v.fill(0);
    let x = 0, z = 0, count = 0;
    while (z < 100 && count < 600) {
      if (rand(300) < p[x]) { v[x]++; z++; }
      x = (x + 1) % 11;               // Original durchläuft PROBNUM+1 = 11 Plätze (4 davon leer)
      count++;
    }
    const order = [0, 1, 2, 3, 4, 5, 6].filter(i => v[i] > 0).sort((a, b) => v[b] - v[a]);
    this.problemOrder = order.slice(0, 4);
  },

  getScore() {
    const old = this.cityScore;
    let x = 0;
    for (let i = 0; i < 7; i++) x += this.problemTable[i];
    x = Math.floor(x / 3);
    x = Math.min(x, 256);
    let z = clamp((256 - x) * 4, 0, 1000);
    const t = Math.trunc;                // ganzzahlige Rechnung wie im Original
    if (this.resCap) z = t(z * 0.85);
    if (this.comCap) z = t(z * 0.85);
    if (this.indCap) z = t(z * 0.85);
    if (this.roadEffect < MAX_ROAD_EFFECT) z -= MAX_ROAD_EFFECT - this.roadEffect;
    if (this.policeEffect < MAX_POLICE_EFFECT) z = t(z * (0.9 + this.policeEffect / (10.0001 * MAX_POLICE_EFFECT)));
    if (this.fireEffect < MAX_FIRE_EFFECT) z = t(z * (0.9 + this.fireEffect / (10.0001 * MAX_FIRE_EFFECT)));
    if (this.resValve < -1000) z = t(z * 0.85);
    if (this.comValve < -1000) z = t(z * 0.85);
    if (this.indValve < -1000) z = t(z * 0.85);
    let SM = 1;
    if (this.cityPop === 0 || this.cityPopDelta === 0 || this.cityPopDelta === this.cityPop) SM = 1;
    else if (this.cityPopDelta > 0) SM = this.cityPopDelta / this.cityPop + 1;
    else SM = 0.95 + this.cityPopDelta / (this.cityPop - this.cityPopDelta);
    z = t(z * SM);
    z -= this.getFireSeverity();
    z -= this.cityTax;
    const TM = this.stats.unpoweredZones + this.stats.poweredZones;
    if (TM) z = t(z * this.stats.poweredZones / TM);
    z = clamp(z, 0, 1000);
    this.cityScore = (this.cityScore + z) >> 1;
    this.cityScoreDelta = this.cityScore - old;
  },

  doVotes() {
    let yes = 0;
    for (let i = 0; i < 100; i++) if (rand(1000) < this.cityScore) yes++;
    this.cityYes = yes;
  },

  // ================= Meldungen =================
  sendMessages() {
    this.checkGrowth();
    const s = this.stats;
    const totalZonePop = s.resZonePop + s.comZonePop + s.indZonePop;
    switch (this.cityTime & 63) {
      case 1: if (Math.floor(totalZonePop / 4) >= s.resZonePop) this.message('Mehr Wohngebiete benötigt.'); break;
      case 5: if (Math.floor(totalZonePop / 8) >= s.comZonePop) this.message('Mehr Gewerbegebiete benötigt.'); break;
      case 10: if (Math.floor(totalZonePop / 8) >= s.indZonePop) this.message('Mehr Industriegebiete benötigt.'); break;
      case 14: if (totalZonePop > 10 && totalZonePop * 2 > s.roadTotal) this.message('Mehr Straßen benötigt.'); break;
      case 18: if (totalZonePop > 50 && totalZonePop > s.railTotal) this.message('Unzureichendes Schienennetz.'); break;
      case 22: if (totalZonePop > 10 && s.coalPop + s.nuclearPop === 0) this.message('Baue ein Kraftwerk!'); break;
      case 26:
        this.resCap = s.resPop > 500 && s.stadiumPop === 0;
        if (this.resCap) this.message('Die Bürger fordern ein Stadion.');
        break;
      case 28:
        this.indCap = s.indPop > 70 && s.portPop === 0;
        if (this.indCap) this.message('Die Industrie benötigt einen Seehafen.');
        break;
      case 30:
        this.comCap = s.comPop > 100 && s.airportPop === 0;
        if (this.comCap) this.message('Der Handel benötigt einen Flughafen.');
        break;
      case 32: {
        const TM = s.unpoweredZones + s.poweredZones;
        if (TM && s.poweredZones / TM < 0.7) this.message('Stromausfälle gemeldet. Prüfe die Stromkarte.');
        break;
      }
      case 35: if (this.pollutionAverage > 60) this.message('Die Umweltverschmutzung ist sehr hoch.', this.pollutionMaxX, this.pollutionMaxY); break;
      case 42: if (this.crimeAverage > 100) this.message('Die Kriminalität ist sehr hoch.', this.crimeMaxX, this.crimeMaxY); break;
      case 45: if (this.totalPop > 60 && s.firestPop === 0) this.message('Die Bürger fordern eine Feuerwache.'); break;
      case 48: if (this.totalPop > 60 && s.policePop === 0) this.message('Die Bürger fordern ein Polizeirevier.'); break;
      case 51: if (this.cityTax > 12) this.message('Die Bürger klagen: Die Steuern sind zu hoch.'); break;
      case 54: if (this.roadEffect < 20 && s.roadTotal > 30) this.message('Straßen verfallen wegen fehlender Mittel.'); break;
      case 57: if (this.fireEffect < 700 && this.totalPop > 20) this.message('Die Feuerwehr braucht mehr Geld.'); break;
      case 60: if (this.policeEffect < 700 && this.totalPop > 20) this.message('Die Polizei braucht mehr Geld.'); break;
      case 63: if (this.getTrafficAverage() > 60) this.message('Häufige Staus gemeldet.', this.trafficMaxX, this.trafficMaxY); break;
    }
  },

  checkGrowth() {
    if ((this.cityTime & 3) !== 0) return;
    const pop = this.population();
    const last = this.lastCityPop;
    if (last) {
      const steps = [
        [2000, 'Die Bevölkerung hat 2.000 erreicht. Aus dem Dorf ist eine Kleinstadt geworden!'],
        [10000, 'Die Bevölkerung hat 10.000 erreicht. Aus der Kleinstadt ist eine Stadt geworden!'],
        [50000, 'Die Bevölkerung hat 50.000 erreicht. Die Stadt ist jetzt eine Hauptstadt!'],
        [100000, 'Die Bevölkerung hat 100.000 erreicht. Die Stadt ist jetzt eine Metropole!'],
        [500000, 'Die Bevölkerung hat 500.000 erreicht. Die Stadt ist jetzt eine Megalopolis!'],
      ];
      for (const [n, text] of steps) {
        if (last < n && pop >= n) this.emit('milestone', { text, pop: n });
      }
    }
    this.lastCityPop = pop;
  },
});

// Positionen der 8 Einzelhäuser im 3x3-Wohngebiet (ohne Mitte)
const HOUSE_POS = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
