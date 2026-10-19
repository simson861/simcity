'use strict';
/*
 * SimCity 1989 – Nachbau
 * Kern: Konstanten, Zufallsgenerator, Stadtzustand und Bauwerkzeuge.
 *
 * Die Simulationsregeln orientieren sich eng am Original (veröffentlicht als
 * „Micropolis“-Quelltext): Kartengröße 120x100, Zonen 3x3, Sonderbauten 4x4
 * bzw. 6x6, Karten in halber/viertel/achtel Auflösung usw.
 */

const W = 120, H = 100;                 // Kartengröße in Feldern
const HW = W >> 1, HH = H >> 1;         // halbe Auflösung (2x2 Felder)
const QW = W >> 2, QH = H >> 2;         // viertel Auflösung (4x4 Felder)
const EW = Math.ceil(W / 8), EH = Math.ceil(H / 8); // achtel Auflösung (8x8)

// Feldarten
const T = {
  DIRT: 0, WATER: 1, TREES: 2, RUBBLE: 3, FIRE: 4, FLOOD: 5, RAD: 6,
  ROAD: 7, RAIL: 8, WIRE: 9, ROADWIRE: 10, RAILWIRE: 11, ROADRAIL: 12,
  PARK: 13, ZONE: 14, ROADBRIDGE: 15, RAILBRIDGE: 16, WIREWATER: 17,
};

// Zonen / Gebäude
const Z = { RES: 1, COM: 2, IND: 3, POLICE: 4, FIRE: 5, STADIUM: 6, PORT: 7, COAL: 8, NUCLEAR: 9, AIRPORT: 10 };
const ZSIZE = [0, 3, 3, 3, 3, 3, 4, 4, 4, 4, 6];
const ZCOST = [0, 100, 100, 100, 500, 500, 3000, 3000, 3000, 5000, 10000];
const ZNAME = ['', 'Wohngebiet', 'Gewerbegebiet', 'Industriegebiet', 'Polizeirevier', 'Feuerwache',
  'Stadion', 'Seehafen', 'Kohlekraftwerk', 'Atomkraftwerk', 'Flughafen'];

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]; // N O S W

const LEVEL_NAMES = ['Leicht', 'Mittel', 'Schwer'];
const LEVEL_FUNDS = [20000, 10000, 5000];
const CLASS_NAMES = ['Dorf', 'Kleinstadt', 'Stadt', 'Hauptstadt', 'Metropole', 'Megalopolis'];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

// Straßenausbau: Stufe 0 = Straße, 1 = Hauptstraße, 2 = Schnellstraße (gespeichert in vari von ROAD/ROADBRIDGE)
const ROAD_LEVEL_NAMES = ['Straße', 'Hauptstraße', 'Schnellstraße'];
const ROAD_UPGRADE_COST = [40, 80];          // Ausbau auf Stufe 1 bzw. 2 (Brücken ×2,5)
const ROAD_TRAFFIC_ADD = [50, 30, 18];       // Verkehrslast je Durchfahrt (Original: 50)
function roadLevel(city, i) { const k = city.tile[i]; return (k === T.ROAD || k === T.ROADBRIDGE) ? Math.min(2, city.vari[i]) : 0; }

const MAX_ROAD_EFFECT = 32, MAX_POLICE_EFFECT = 1000, MAX_FIRE_EFFECT = 1000;

function idx(x, y) { return y * W + x; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fmtMoney(n) { n = Math.round(n); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('de-DE'); }
function fmtNum(n) { return Math.round(n).toLocaleString('de-DE'); }

// ---------- Zufall (xorshift32, Zustand speicherbar) ----------
const RNG = { s: ((Date.now() * 2654435761) >>> 0) || 12345 };
function rnd32() {
  let s = RNG.s;
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
  RNG.s = s >>> 0;
  return RNG.s;
}
function randf() { return rnd32() / 4294967296; }
function rand(n) { return Math.floor(randf() * (n + 1)); }          // 0..n (inklusiv, wie im Original)
function rand16() { return rnd32() & 0xffff; }
function rand16s() { const r = rand16(); return r > 32767 ? r - 65536 : r; }

// ---------- Feld-Eigenschaften ----------
function isRoadK(k) { return k === T.ROAD || k === T.ROADWIRE || k === T.ROADRAIL || k === T.ROADBRIDGE; }
function isRailK(k) { return k === T.RAIL || k === T.RAILWIRE || k === T.ROADRAIL || k === T.RAILBRIDGE; }
function isWireK(k) { return k === T.WIRE || k === T.ROADWIRE || k === T.RAILWIRE || k === T.WIREWATER; }
function isDriveK(k) { return isRoadK(k) || isRailK(k); }
function isCondK(k) { return isWireK(k) || k === T.ZONE; }
// brennbar (BURNBIT im Original): Wald, Park, Leitungen, Straßen, Schienen und Kreuzungen an Land, Zonen – nicht Brücken
function isBurnK(k) {
  return k === T.TREES || k === T.PARK || k === T.WIRE || k === T.RAIL || k === T.RAILWIRE || k === T.ZONE ||
    k === T.ROAD || k === T.ROADWIRE || k === T.ROADRAIL;
}
function isWaterK(k) { return k === T.WATER || k === T.ROADBRIDGE || k === T.RAILBRIDGE || k === T.WIREWATER; }
function isAutoClearK(k) { return k === T.TREES || k === T.RUBBLE || k === T.FLOOD; }
function isNaturalK(k) { return k === T.WATER || k === T.TREES || k === T.PARK; }
function needsPower(z) { return z.type !== Z.COAL && z.type !== Z.NUCLEAR; }

// Zonenmittelpunkt (wie im Original immer Feld (1,1) des Grundrisses)
function zoneCX(z) { return z.x + 1; }
function zoneCY(z) { return z.y + 1; }

class City {
  constructor() { this.reset(); }

  reset() {
    this.tile = new Uint8Array(W * H);
    this.vari = new Uint8Array(W * H);
    this.zid = new Int32Array(W * H).fill(-1);
    this.power = new Uint8Array(W * H);
    this.zones = new Map();
    this.nextZoneId = 1;

    this.trafficDensity = new Uint8Array(HW * HH);
    this.pollution = new Uint8Array(HW * HH);
    this.landValue = new Uint8Array(HW * HH);
    this.crime = new Uint8Array(HW * HH);
    this.popDensity = new Uint8Array(HW * HH);
    this.terrainDensity = new Uint8Array(QW * QH);
    this.rateOfGrowth = new Int16Array(EW * EH);
    this.fireStMap = new Int32Array(EW * EH);
    this.fireEffectMap = new Int32Array(EW * EH);
    this.policeStMap = new Int32Array(EW * EH);
    this.policeEffectMap = new Int32Array(EW * EH);
    this.comRate = new Int16Array(EW * EH);

    this.name = 'Neustadt';
    this.level = 0;
    this.funds = 20000;
    this.startYear = 1900;
    this.cityTime = 0;
    this.simCycle = 0;
    this.phase = 0;
    this.speed = 2;              // 0 Pause, 1 langsam, 2 mittel, 3 schnell

    this.cityTax = 7;
    this.roadPct = 1; this.firePct = 1; this.policePct = 1;
    this.roadEffect = MAX_ROAD_EFFECT; this.policeEffect = MAX_POLICE_EFFECT; this.fireEffect = MAX_FIRE_EFFECT;
    this.taxFund = 0; this.roadFund = 0; this.fireFund = 0; this.policeFund = 0;
    this.roadSpend = 0; this.fireSpend = 0; this.policeSpend = 0;
    this.cashFlow = 0; this.prevFunds = this.funds;

    this.resValve = 0; this.comValve = 0; this.indValve = 0;
    this.resCap = false; this.comCap = false; this.indCap = false;
    this.needHospital = 0; this.needChurch = 0;

    // abgeschlossene Zählung (Census)
    this.stats = City.emptyCensus();
    this.cen = City.emptyCensus();
    this.totalPop = 0;

    this.landValueAverage = 0; this.pollutionAverage = 0; this.crimeAverage = 0; this.trafficAverage = 0;
    this.pollutionMaxX = W / 2; this.pollutionMaxY = H / 2;
    this.crimeMaxX = W / 2; this.crimeMaxY = H / 2;
    this.trafficMaxX = -1; this.trafficMaxY = -1;
    this.cityCenterX = W / 2; this.cityCenterY = H / 2;
    this.crimeRamp = 0; this.pollutionRamp = 0;

    this.powerCapacity = 0; this.powerUsed = 0; this.powerDirty = true; this.brownout = false;

    this.hist = {
      res: new Int16Array(240), com: new Int16Array(240), ind: new Int16Array(240),
      crime: new Int16Array(240), pollution: new Int16Array(240), money: new Int16Array(240),
    };

    // Bewertung
    this.cityScore = 500; this.cityScoreDelta = 0;
    this.cityPop = 0; this.cityPopDelta = 0; this.lastCityPop = 0;
    this.cityClass = 0; this.cityYes = 0;
    this.cityAssessedValue = 0;
    this.problemTable = new Array(7).fill(0);
    this.problemVotes = new Array(7).fill(0);
    this.problemOrder = [];

    this.autoBulldoze = true; this.autoBudget = false; this.autoGoto = true;
    this.disastersEnabled = true; this.soundOn = true;

    this.sprites = [];
    this.floodCnt = 0;
    this.shake = 0;

    this.scenario = null;          // Szenario-ID oder null
    this.disasterEvent = 0; this.disasterWait = 0;
    this.scoreType = 0; this.scoreWait = 0;

    this.listeners = [];           // Ereignis-Empfänger (UI)
    this.lastMsgTime = {};
    this.mapVersion = 0;           // für Minikarte
  }

  static emptyCensus() {
    return {
      resPop: 0, comPop: 0, indPop: 0, resZonePop: 0, comZonePop: 0, indZonePop: 0,
      hospitalPop: 0, churchPop: 0, stadiumPop: 0, policePop: 0, firestPop: 0,
      coalPop: 0, nuclearPop: 0, portPop: 0, airportPop: 0,
      roadTotal: 0, railTotal: 0, firePop: 0, poweredZones: 0, unpoweredZones: 0,
    };
  }

  // ---------- Ereignisse an die Oberfläche ----------
  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data || {}); }

  /** Nachricht senden. important: Popup + Auto-Gehe-zu. */
  message(text, x, y, important) {
    const now = this.cityTime;
    const last = this.lastMsgTime[text];
    if (!important && last !== undefined && now - last < 12) return;
    this.lastMsgTime[text] = now;
    this.emit('message', { text, x, y, important: !!important });
  }

  // ---------- Datum ----------
  get year() { return this.startYear + Math.floor(this.cityTime / 48); }
  get month() { return Math.floor((this.cityTime % 48) / 4); }
  dateString() { return MONTHS[this.month] + ' ' + this.year; }

  population() { return (this.stats.resPop + (this.stats.comPop + this.stats.indPop) * 8) * 20; }

  // ---------- Felder ----------
  setTile(x, y, k, v) {
    const i = idx(x, y);
    const old = this.tile[i];
    this.tile[i] = k;
    this.vari[i] = v || 0;
    if (isCondK(old) || isCondK(k)) this.powerDirty = true;
    this.mapVersion++;
  }
  kind(x, y) { return inBounds(x, y) ? this.tile[idx(x, y)] : -1; }
  zoneAt(x, y) {
    if (!inBounds(x, y)) return null;
    const id = this.zid[idx(x, y)];
    return id >= 0 ? this.zones.get(id) : null;
  }

  // ---------- Verbindungen (für Grafik, Kreuzungen, Züge) ----------
  // Gibt zurück, ob das Feld (nx,ny) eine Straße in Richtung d (von uns aus gesehen) fortsetzt
  roadLink(nx, ny, d) {
    const k = this.kind(nx, ny);
    if (k === T.ROAD || k === T.ROADBRIDGE) return true;
    if (k === T.ROADWIRE || k === T.ROADRAIL) {
      const horiz = this.vari[idx(nx, ny)] === 0;
      return (d === 1 || d === 3) ? horiz : !horiz;
    }
    return false;
  }
  railLink(nx, ny, d) {
    const k = this.kind(nx, ny);
    if (k === T.RAIL || k === T.RAILBRIDGE) return true;
    if (k === T.RAILWIRE || k === T.ROADRAIL) {
      const v = this.vari[idx(nx, ny)];
      const railHoriz = k === T.RAILWIRE ? v === 0 : v === 1;
      return (d === 1 || d === 3) ? railHoriz : !railHoriz;
    }
    return false;
  }
  wireLink(nx, ny, d) {
    const k = this.kind(nx, ny);
    if (k === T.WIRE || k === T.WIREWATER || k === T.ZONE) return true;
    if (k === T.ROADWIRE || k === T.RAILWIRE) {
      const wireHoriz = this.vari[idx(nx, ny)] === 1;
      return (d === 1 || d === 3) ? wireHoriz : !wireHoriz;
    }
    return false;
  }
  linkMask(x, y, fn) {
    let m = 0;
    for (let d = 0; d < 4; d++) if (fn.call(this, x + DX[d], y + DY[d], d)) m |= 1 << d;
    return m;
  }
  roadMask(x, y) { return this.linkMask(x, y, this.roadLink); }
  railMask(x, y) { return this.linkMask(x, y, this.railLink); }
  wireMask(x, y) {
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      const k = this.kind(nx, ny);
      if (k === T.ZONE) { m |= 1 << d; continue; }
      if (this.wireLink(nx, ny, d)) m |= 1 << d;
    }
    return m;
  }

  // ---------- Bauen ----------
  canAfford(c) { return this.funds >= c; }
  spend(c) { this.funds -= c; this.emit('funds'); }

  /** Einheitliche Werkzeug-Anwendung auf ein Feld. Rückgabe: {ok, cost, err} */
  applyTool(tool, x, y) {
    switch (tool) {
      case 'bulldozer': return this.bulldoze(x, y);
      case 'road': return this.layLine(x, y, 'road');
      case 'rail': return this.layLine(x, y, 'rail');
      case 'wire': return this.layLine(x, y, 'wire');
      case 'park': return this.placePark(x, y);
      case 'upgrade': return this.upgradeRoad(x, y);
      case 'res': return this.placeZone(Z.RES, x, y);
      case 'com': return this.placeZone(Z.COM, x, y);
      case 'ind': return this.placeZone(Z.IND, x, y);
      case 'police': return this.placeZone(Z.POLICE, x, y);
      case 'fire': return this.placeZone(Z.FIRE, x, y);
      case 'stadium': return this.placeZone(Z.STADIUM, x, y);
      case 'port': return this.placeZone(Z.PORT, x, y);
      case 'coal': return this.placeZone(Z.COAL, x, y);
      case 'nuclear': return this.placeZone(Z.NUCLEAR, x, y);
      case 'airport': return this.placeZone(Z.AIRPORT, x, y);
    }
    return { ok: false };
  }

  // Ausrichtung eines bestehenden Strangs: 0 = waagrecht, 1 = senkrecht, -1 = Kurve/Kreuzung
  lineOrient(mask) {
    const v = mask & 5, h = mask & 10;
    if (v && h) return -1;
    return v ? 1 : 0;
  }

  layLine(x, y, what) {
    if (!inBounds(x, y)) return { ok: false };
    let k = this.tile[idx(x, y)];
    const base = { road: 10, rail: 20, wire: 5 }[what];
    const water = { road: 50, rail: 100, wire: 25 }[what];
    let extra = 0;
    if (isAutoClearK(k)) {
      if (!this.autoBulldoze) return { ok: false, err: 'Zuerst abreißen!' };
      extra = 1; k = T.DIRT;
    }
    let nk = -1, nv = 0, cost = base;
    if (what === 'road') {
      if (isRoadK(k)) return { ok: true, cost: 0, noop: true };
      if (k === T.DIRT) nk = T.ROAD;
      else if (k === T.WATER) {
        if (!this.bridgeOk(x, y, isRoadK)) return { ok: false, err: 'Brücken nur gerade bauen!' };
        nk = T.ROADBRIDGE; cost = water;
      } else if (k === T.WIRE) {
        const o = this.lineOrient(this.wireMask(x, y));
        if (o < 0) return { ok: false, err: 'Kreuzung nur rechtwinklig möglich!' };
        nk = T.ROADWIRE; nv = o === 1 ? 0 : 1;
      } else if (k === T.RAIL) {
        const o = this.lineOrient(this.railMask(x, y));
        if (o < 0) return { ok: false, err: 'Kreuzung nur rechtwinklig möglich!' };
        nk = T.ROADRAIL; nv = o === 1 ? 0 : 1;
      }
    } else if (what === 'rail') {
      if (isRailK(k)) return { ok: true, cost: 0, noop: true };
      if (k === T.DIRT) nk = T.RAIL;
      else if (k === T.WATER) {
        if (!this.bridgeOk(x, y, isRailK)) return { ok: false, err: 'Tunnel nur gerade bauen!' };
        nk = T.RAILBRIDGE; cost = water;
      } else if (k === T.ROAD) {
        const o = this.lineOrient(this.roadMask(x, y));
        if (o < 0) return { ok: false, err: 'Kreuzung nur rechtwinklig möglich!' };
        nk = T.ROADRAIL; nv = o;           // vari = Straßenausrichtung
      } else if (k === T.WIRE) {
        const o = this.lineOrient(this.wireMask(x, y));
        if (o < 0) return { ok: false, err: 'Kreuzung nur rechtwinklig möglich!' };
        nk = T.RAILWIRE; nv = o === 1 ? 0 : 1;
      }
    } else {
      if (isWireK(k)) return { ok: true, cost: 0, noop: true };
      if (k === T.DIRT) nk = T.WIRE;
      else if (k === T.WATER) { nk = T.WIREWATER; cost = water; }
      else if (k === T.ROAD) {
        const o = this.lineOrient(this.roadMask(x, y));
        if (o < 0) return { ok: false, err: 'Kreuzung nur rechtwinklig möglich!' };
        nk = T.ROADWIRE; nv = o;
      } else if (k === T.RAIL) {
        const o = this.lineOrient(this.railMask(x, y));
        if (o < 0) return { ok: false, err: 'Kreuzung nur rechtwinklig möglich!' };
        nk = T.RAILWIRE; nv = o;
      }
    }
    if (nk < 0) return { ok: false, err: 'Hier kann nicht gebaut werden.' };
    if (!this.canAfford(cost + extra)) return { ok: false, err: 'Nicht genug Geld!', money: true };
    this.spend(cost + extra);
    this.setTile(x, y, nk, nv);
    return { ok: true, cost: cost + extra };
  }

  // Brücke: darf nicht gleichzeitig waagrecht und senkrecht an Brücken/Straßen anschließen
  bridgeOk(x, y, test) {
    const h = test(this.kind(x - 1, y)) || test(this.kind(x + 1, y));
    const v = test(this.kind(x, y - 1)) || test(this.kind(x, y + 1));
    return !(h && v);
  }

  /** Straße um eine Stufe ausbauen (Hauptstraße → Schnellstraße). */
  upgradeRoad(x, y) {
    if (!inBounds(x, y)) return { ok: false };
    const i = idx(x, y), k = this.tile[i];
    if (k !== T.ROAD && k !== T.ROADBRIDGE) {
      if (isRoadK(k)) return { ok: false, err: 'Kreuzungen mit Schiene oder Leitung können nicht ausgebaut werden.' };
      return { ok: false, err: 'Hier ist keine Straße zum Ausbauen.' };
    }
    const lvl = roadLevel(this, i);
    if (lvl >= 2) return { ok: true, cost: 0, noop: true };
    const cost = Math.round(ROAD_UPGRADE_COST[lvl] * (k === T.ROADBRIDGE ? 2.5 : 1));
    if (!this.canAfford(cost)) return { ok: false, err: 'Nicht genug Geld!', money: true };
    this.spend(cost);
    this.setTile(x, y, k, lvl + 1);
    return { ok: true, cost };
  }

  placePark(x, y) {
    if (!inBounds(x, y)) return { ok: false };
    let k = this.tile[idx(x, y)], extra = 0;
    if (isAutoClearK(k)) {
      if (!this.autoBulldoze) return { ok: false, err: 'Zuerst abreißen!' };
      extra = 1; k = T.DIRT;
    }
    if (k !== T.DIRT) return { ok: false, err: 'Hier kann nicht gebaut werden.' };
    if (!this.canAfford(10 + extra)) return { ok: false, err: 'Nicht genug Geld!', money: true };
    this.spend(10 + extra);
    this.setTile(x, y, T.PARK, rand(4) === 0 ? 4 : rand(3));
    return { ok: true, cost: 10 + extra };
  }

  zoneOrigin(type, cx, cy) {
    const s = ZSIZE[type];
    const off = s === 6 ? 2 : 1;
    return [cx - off, cy - off];
  }

  checkZoneSite(type, x0, y0) {
    const s = ZSIZE[type];
    if (x0 < 0 || y0 < 0 || x0 + s > W || y0 + s > H) return { ok: false, err: 'Zu nah am Kartenrand.' };
    let clear = 0;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
      const k = this.tile[idx(x, y)];
      if (k === T.DIRT) continue;
      if (isAutoClearK(k) && this.autoBulldoze) { clear++; continue; }
      return { ok: false, err: isAutoClearK(k) ? 'Zuerst abreißen!' : 'Hier kann nicht gebaut werden.' };
    }
    return { ok: true, cost: ZCOST[type] + clear };
  }

  placeZone(type, cx, cy) {
    const [x0, y0] = this.zoneOrigin(type, cx, cy);
    const chk = this.checkZoneSite(type, x0, y0);
    if (!chk.ok) return chk;
    if (!this.canAfford(chk.cost)) return { ok: false, err: 'Nicht genug Geld!', money: true };
    this.spend(chk.cost);
    this.createZone(type, x0, y0);
    return { ok: true, cost: chk.cost, zone: true };
  }

  createZone(type, x0, y0, den, val) {
    const s = ZSIZE[type];
    const z = {
      id: this.nextZoneId++, type, x: x0, y: y0, size: s,
      den: den || 0, val: val || 0, special: 0, houses: null,
      powered: type === Z.COAL || type === Z.NUCLEAR, var: rand(7), game: 0,
    };
    if (type === Z.RES) z.houses = [0, 0, 0, 0, 0, 0, 0, 0];
    this.zones.set(z.id, z);
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
      this.setTile(x, y, T.ZONE, 0);
      this.zid[idx(x, y)] = z.id;
    }
    this.powerDirty = true;
    return z;
  }

  removeZone(z, fill) {
    for (let y = z.y; y < z.y + z.size; y++) for (let x = z.x; x < z.x + z.size; x++) {
      this.zid[idx(x, y)] = -1;
      this.setTile(x, y, fill === undefined ? T.DIRT : fill, rand(3));
    }
    this.zones.delete(z.id);
    this.powerDirty = true;
  }

  bulldoze(x, y) {
    if (!inBounds(x, y)) return { ok: false };
    const i = idx(x, y), k = this.tile[i];
    if (k === T.ZONE) {
      const z = this.zones.get(this.zid[i]);
      const cost = z.size * z.size;
      if (!this.canAfford(cost)) return { ok: false, err: 'Nicht genug Geld!', money: true };
      this.spend(cost);
      this.removeZone(z);
      const d = this.makeSprite(SPR.DUST, z.x, z.y);
      d.x = (z.x + z.size / 2) * 16; d.y = (z.y + z.size / 2) * 16; d.size = z.size;
      this.emit('bulldozeZone', { x: z.x + z.size / 2, y: z.y + z.size / 2, size: z.size });
      return { ok: true, cost, zone: true };
    }
    let nk;
    if (k === T.ROADBRIDGE || k === T.RAILBRIDGE || k === T.WIREWATER) nk = T.WATER;
    else if (k === T.TREES || k === T.RUBBLE || k === T.PARK || k === T.FLOOD || isRoadK(k) || isRailK(k) || isWireK(k)) nk = T.DIRT;
    else return { ok: false, err: k === T.FIRE ? 'Feuer kann nicht abgerissen werden.' : (k === T.RAD ? 'Radioaktiv verseucht!' : null) };
    if (!this.canAfford(1)) return { ok: false, err: 'Nicht genug Geld!', money: true };
    this.spend(1);
    this.setTile(x, y, nk, 0);
    return { ok: true, cost: 1 };
  }

  // ---------- Speichern / Laden ----------
  serialize() {
    const b64 = (arr) => {
      const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const keep = ['name', 'level', 'funds', 'startYear', 'cityTime', 'simCycle', 'cityTax', 'roadPct', 'firePct', 'policePct',
      'roadEffect', 'policeEffect', 'fireEffect', 'resValve', 'comValve', 'indValve', 'cityScore', 'cityScoreDelta',
      'cityPop', 'cityPopDelta', 'lastCityPop', 'cityClass', 'cityYes', 'cityAssessedValue', 'problemTable', 'problemVotes', 'problemOrder',
      'autoBulldoze', 'autoBudget', 'autoGoto', 'disastersEnabled', 'soundOn', 'scenario', 'disasterEvent', 'disasterWait',
      'scoreType', 'scoreWait', 'nextZoneId', 'cashFlow', 'taxFund', 'roadFund', 'fireFund', 'policeFund', 'crimeRamp', 'pollutionRamp',
      'cityCenterX', 'cityCenterY', 'stats', 'totalPop', 'speed', 'prevFunds'];
    const o = { format: 'simcity1989-nachbau', version: 1 };
    for (const key of keep) o[key] = this[key];
    o.tile = b64(this.tile); o.vari = b64(this.vari);
    o.zones = [...this.zones.values()];
    o.hist = {};
    for (const key in this.hist) o.hist[key] = Array.from(this.hist[key]);
    o.landValue = b64(this.landValue); o.pollution = b64(this.pollution); o.crime = b64(this.crime);
    o.popDensity = b64(this.popDensity); o.trafficDensity = b64(this.trafficDensity);
    return o;
  }

  deserialize(o) {
    if (!o || o.format !== 'simcity1989-nachbau') throw new Error('Unbekanntes Dateiformat');
    const listeners = this.listeners;
    this.reset();
    this.listeners = listeners;
    const unb64 = (s, target) => {
      const bin = atob(s);
      const u8 = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
      for (let i = 0; i < u8.length && i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    };
    for (const key in o) {
      if (['tile', 'vari', 'zones', 'hist', 'format', 'version', 'landValue', 'pollution', 'crime', 'popDensity', 'trafficDensity'].includes(key)) continue;
      this[key] = o[key];
    }
    unb64(o.tile, this.tile); unb64(o.vari, this.vari);
    for (const key of ['landValue', 'pollution', 'crime', 'popDensity', 'trafficDensity']) if (o[key]) unb64(o[key], this[key]);
    for (const z of o.zones) {
      this.zones.set(z.id, z);
      for (let y = z.y; y < z.y + z.size; y++) for (let x = z.x; x < z.x + z.size; x++) this.zid[idx(x, y)] = z.id;
    }
    for (const key in o.hist) this.hist[key].set(o.hist[key]);
    this.stats = Object.assign(City.emptyCensus(), o.stats || {});
    this.powerDirty = true;
    this.mapVersion++;
  }
}
