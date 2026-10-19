'use strict';
/* Bewegte Objekte (Zug, Hubschrauber, Flugzeug, Schiff, Monster, Tornado, Explosion)
 * und Katastrophen. Koordinaten der Objekte in Weltpixeln (16 pro Feld). */

const SPR = { TRAIN: 1, COPTER: 2, PLANE: 3, SHIP: 4, MONSTER: 5, TORNADO: 6, EXPLOSION: 7, DUST: 8 };

Object.assign(City.prototype, {

  findSprite(type) { return this.sprites.find(s => s.type === type && !s.dead) || null; },

  makeSprite(type, tx, ty) {
    const s = { type, x: tx * 16 + 8, y: ty * 16 + 8, frame: 0, count: 0, dir: 0, dead: false };
    switch (type) {
      case SPR.TRAIN:
        s.tx = tx; s.ty = ty; s.prog = 0; s.dir = -1; s.trail = []; s.count = 1500;
        break;
      case SPR.SHIP:
        s.tx = tx; s.ty = ty; s.prog = 0; s.dir = rand(3); s.count = 1200;
        break;
      case SPR.COPTER:
        s.count = 1500; s.destX = s.x; s.destY = s.y; s.leaving = false;
        s.origX = s.x; s.origY = s.y;          // Landeplatz (Flughafen)
        break;
      case SPR.PLANE:
        s.count = 600; s.dir = 1;
        s.destX = clamp(s.x + (rand(1) ? 1 : -1) * (300 + rand(600)), -200, W * 16 + 200);
        s.destY = clamp(s.y + rand(800) - 400, -200, H * 16 + 200);
        s.alt = 0;
        break;
      case SPR.MONSTER:
        s.count = 1000; s.destX = this.pollutionMaxX * 16 + 8; s.destY = this.pollutionMaxY * 16 + 8;
        s.lastTile = -1; s.phase = 0;
        break;
      case SPR.TORNADO:
        s.count = 200; s.vx = 0; s.vy = 0; s.lastTile = -1;
        break;
      case SPR.EXPLOSION: case SPR.DUST:
        s.count = 0;
        break;
    }
    this.sprites.push(s);
    return s;
  },

  /** Bewegt alle Objekte um einen Takt weiter. */
  moveSprites() {
    for (const s of this.sprites) {
      if (s.dead) continue;
      s.frame++;
      switch (s.type) {
        case SPR.TRAIN: this.doTrain(s); break;
        case SPR.SHIP: this.doShip(s); break;
        case SPR.COPTER: this.doCopter(s); break;
        case SPR.PLANE: this.doPlane(s); break;
        case SPR.MONSTER: this.doMonster(s); break;
        case SPR.TORNADO: this.doTornado(s); break;
        case SPR.EXPLOSION: this.doExplosion(s); break;
        case SPR.DUST: if (s.frame > 16) s.dead = true; break;
      }
    }
    this.checkCollisions();
    if (this.sprites.some(s => s.dead)) this.sprites = this.sprites.filter(s => !s.dead);
    if (this.shake > 0) this.shake--;
  },

  /** Zusammenstöße wie im Original: Flugzeug/Hubschrauber (nur bei aktivierten Katastrophen);
   *  Monster und Tornado bringen Flugzeug, Hubschrauber, Schiff und Zug zur Explosion. */
  checkCollisions() {
    const near = (a, b, d) => Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d;
    const plane = this.findSprite(SPR.PLANE), copter = this.findSprite(SPR.COPTER);
    if (this.disastersEnabled && plane && copter && !plane.crashing && plane.alt > 0.5 && near(plane, copter, 10)) {
      copter.dead = true;
      plane.crashing = true;
      const tx = (copter.x / 16) | 0, ty = (copter.y / 16) | 0;
      this.makeExplosionAt(tx, ty);
      this.message('Zusammenstoß in der Luft! Flugzeugabsturz!', tx, ty, true);
    }
    const msgs = {
      [SPR.SHIP]: 'Schiffsunglück gemeldet!', [SPR.TRAIN]: 'Zugunglück!',
      [SPR.COPTER]: 'Hubschrauberabsturz gemeldet!', [SPR.PLANE]: 'Flugzeugabsturz!',
    };
    for (const t of [SPR.MONSTER, SPR.TORNADO]) {
      const o = this.findSprite(t);
      if (!o) continue;
      for (const v of this.sprites) {
        if (v.dead || !msgs[v.type] || v.crashing || !near(v, o, 14)) continue;
        const tx = (v.x / 16) | 0, ty = (v.y / 16) | 0;
        if (v.type === SPR.PLANE) { v.crashing = true; v.alt = Math.min(v.alt, 0.3); }
        else { v.dead = true; this.makeExplosionAt(tx, ty); }
        this.message(msgs[v.type], tx, ty, true);
      }
    }
  },

  // ---------- Zug: fährt auf Schienen, wählt zufällig an Weichen ----------
  doTrain(s) {
    // Gleis weg (abgerissen/zerstört): der Zug hält und verschwindet – wie im Original kein Unglück
    if (!isRailK(this.kind(s.tx, s.ty))) { s.dead = true; return; }
    if (s.dir < 0) { s.dir = this.pickDir(s.tx, s.ty, -1, this.railLink); if (s.dir < 0) { s.dead = true; return; } }
    s.prog += 0.125;
    if (s.prog >= 1) {
      s.trail.unshift([s.tx, s.ty]);
      if (s.trail.length > 4) s.trail.pop();
      s.tx += DX[s.dir]; s.ty += DY[s.dir]; s.prog = 0;
      if (!inBounds(s.tx, s.ty) || !isRailK(this.kind(s.tx, s.ty))) { s.dead = true; return; }
      const nd = this.pickDir(s.tx, s.ty, (s.dir + 2) & 3, this.railLink);
      s.dir = nd >= 0 ? nd : (s.dir + 2) & 3;
      if (--s.count <= 0 && rand(20) === 0) s.dead = true;
    }
    s.x = (s.tx + DX[s.dir] * s.prog) * 16 + 8;
    s.y = (s.ty + DY[s.dir] * s.prog) * 16 + 8;
  },

  /** Zufällige Richtung (geradeaus bevorzugt), die nicht zurückführt. */
  pickDir(x, y, back, linkFn) {
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === back) continue;
      if (linkFn.call(this, x + DX[d], y + DY[d], d)) opts.push(d);
    }
    if (!opts.length) return -1;
    const straight = (back + 2) & 3;
    if (back >= 0 && opts.includes(straight) && rand(2) > 0) return straight;
    return opts[rand(opts.length - 1)];
  },

  // ---------- Schiff ----------
  generateShip() {
    if (rand(3) !== 0) return;
    // Startpunkt: Wasser am Kartenrand, sonst beliebiges Wasser
    for (let tries = 0; tries < 100; tries++) {
      let x, y;
      const side = rand(3);
      if (side === 0) { x = rand(W - 1); y = 0; }
      else if (side === 1) { x = rand(W - 1); y = H - 1; }
      else if (side === 2) { x = 0; y = rand(H - 1); }
      else { x = W - 1; y = rand(H - 1); }
      if (this.kind(x, y) === T.WATER) { this.makeSprite(SPR.SHIP, x, y); return; }
    }
    for (let tries = 0; tries < 200; tries++) {
      const x = rand(W - 1), y = rand(H - 1);
      if (this.kind(x, y) === T.WATER) { this.makeSprite(SPR.SHIP, x, y); return; }
    }
  },

  doShip(s) {
    const water = (nx, ny) => isWaterK(this.kind(nx, ny));
    s.prog += 0.05;
    if (s.prog >= 1) {
      s.tx += DX[s.dir]; s.ty += DY[s.dir]; s.prog = 0;
      if (!inBounds(s.tx, s.ty)) { s.dead = true; return; }
      if (!water(s.tx, s.ty)) { s.dead = true; return; }
      s.count--;
      const back = (s.dir + 2) & 3;
      const opts = [];
      for (let d = 0; d < 4; d++) if (d !== back && water(s.tx + DX[d], s.ty + DY[d])) opts.push(d);
      if (!opts.length) { s.dir = back; }
      else if (opts.includes(s.dir) && rand(5) > 0) { /* geradeaus */ }
      else s.dir = opts[rand(opts.length - 1)];
      if (s.count <= 0 && (s.tx === 0 || s.ty === 0 || s.tx === W - 1 || s.ty === H - 1)) s.dead = true;
      if (s.count < -400) s.dead = true;
    }
    s.x = (s.tx + DX[s.dir] * s.prog) * 16 + 8;
    s.y = (s.ty + DY[s.dir] * s.prog) * 16 + 8;
  },

  // ---------- Hubschrauber (Verkehrsbeobachtung) ----------
  doCopter(s) {
    if (s.count > 0) s.count--;
    if (s.count <= 0) {
      // wie im Original: zum Monster/Tornado (dort stürzt er meist ab), sonst zurück zum Flughafen und landen
      const o = this.findSprite(SPR.MONSTER) || this.findSprite(SPR.TORNADO);
      s.leaving = !o;
      if (o) { s.destX = o.x; s.destY = o.y; }
      else { s.destX = s.origX !== undefined ? s.origX : s.x; s.destY = s.origY !== undefined ? s.origY : s.y; }
    }
    const dx = s.destX - s.x, dy = s.destY - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
      if (s.leaving) { s.dead = true; return; }
      // Verkehr melden
      const tx = (s.x / 16) | 0, ty = (s.y / 16) | 0;
      if (inBounds(tx, ty)) {
        const t = this.trafficDensity[(tx >> 1) + (ty >> 1) * HW];
        if (t > 170 && rand(7) === 0) this.message('Starker Verkehr gemeldet.', tx, ty);
      }
      if (rand(30) === 0) {
        s.destX = clamp(s.x + rand(400) - 200, 16, W * 16 - 16);
        s.destY = clamp(s.y + rand(400) - 200, 16, H * 16 - 16);
      }
    } else {
      const sp = 1.5;
      s.x += dx / d * sp; s.y += dy / d * sp;
      s.dir = Math.atan2(dy, dx);
    }
    if (s.x < -100 || s.y < -100 || s.x > W * 16 + 100 || s.y > H * 16 + 100) s.dead = true;
  },

  // ---------- Flugzeug ----------
  doPlane(s) {
    const dx = s.destX - s.x, dy = s.destY - s.y;
    const d = Math.hypot(dx, dy);
    s.dir = Math.atan2(dy, dx);
    if (s.crashing) {
      s.alt -= 0.03;
      s.x += Math.cos(s.dir) * 1.5; s.y += Math.sin(s.dir) * 1.5;
      if (s.alt <= 0) {
        s.dead = true;
        const tx = (s.x / 16) | 0, ty = (s.y / 16) | 0;
        if (inBounds(tx, ty)) {
          this.makeExplosionAt(tx, ty);
          for (let n = 0; n < 4; n++) this.makeExplosionAt(tx + rand(4) - 2, ty + rand(4) - 2);
        }
      }
      return;
    }
    s.alt = Math.min(1, s.alt + 0.01);
    if (d < 4) {
      s.count -= 50;
      if (s.count <= 0) { s.dead = true; return; }
      s.destX = rand(W * 16 + 400) - 200; s.destY = rand(H * 16 + 400) - 200;
    } else {
      s.x += dx / d * 3; s.y += dy / d * 3;
    }
    s.count--;
    if (s.count < -600) s.dead = true;
  },

  // ---------- Monster ----------
  doMonster(s) {
    s.count--;
    const dx = s.destX - s.x, dy = s.destY - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 6 || (s.frame % 400 === 0)) {
      if (s.count <= 0 || s.phase >= 4) {
        // zum nächsten Rand zurückziehen
        s.phase = 99;
        const ex = s.x < W * 8 ? -40 : W * 16 + 40;
        s.destX = ex; s.destY = s.y;
        if (d < 6) { s.dead = true; return; }
      } else {
        s.phase++;
        if (s.phase === 1 || rand(1) === 0) { s.destX = this.pollutionMaxX * 16 + 8; s.destY = this.pollutionMaxY * 16 + 8; }
        else { s.destX = (10 + rand(W - 20)) * 16; s.destY = (10 + rand(H - 20)) * 16; }
      }
    } else {
      const sp = 0.8;
      s.x += dx / d * sp + (rand(2) - 1) * 0.3;
      s.y += dy / d * sp + (rand(2) - 1) * 0.3;
      s.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    }
    this.destroyUnder(s, 1);
    if (s.x < -60 || s.y < -60 || s.x > W * 16 + 60 || s.y > H * 16 + 60) s.dead = true;
  },

  // ---------- Tornado ----------
  doTornado(s) {
    s.count--;
    if (s.count <= 0) { s.dead = true; return; }
    if (s.frame % 8 === 0) {
      s.vx = clamp(s.vx + (rand(4) - 2) * 0.4, -1.6, 1.6);
      s.vy = clamp(s.vy + (rand(4) - 2) * 0.4, -1.6, 1.6);
    }
    s.x += s.vx; s.y += s.vy;
    if (s.x < 8 || s.y < 8 || s.x > W * 16 - 8 || s.y > H * 16 - 8) { s.vx = -s.vx; s.vy = -s.vy; }
    this.destroyUnder(s, 0);
  },

  destroyUnder(s, radius) {
    const tx = Math.floor(s.x / 16), ty = Math.floor(s.y / 16);
    const key = tx + ty * W;
    if (key === s.lastTile) return;
    s.lastTile = key;
    for (let y = ty - radius; y <= ty + radius; y++) for (let x = tx - radius; x <= tx + radius; x++) {
      if (inBounds(x, y)) this.destroyTile(x, y);
    }
  },

  // ---------- Explosion ----------
  makeExplosionAt(x, y) {
    if (!inBounds(x, y)) return;
    const s = this.makeSprite(SPR.EXPLOSION, x, y);
    this.emit('explosion', { x, y });
    return s;
  },

  // Explosion zerstört selbst nichts, legt aber am Ende Feuer in der Mitte und den vier Diagonalfeldern (Original)
  doExplosion(s) {
    if (s.frame >= 24) {
      s.dead = true;
      const tx = (s.x / 16) | 0, ty = (s.y / 16) | 0;
      this.startFire(tx, ty);
      this.startFire(tx - 1, ty - 1); this.startFire(tx + 1, ty - 1);
      this.startFire(tx - 1, ty + 1); this.startFire(tx + 1, ty + 1);
    }
  },

  /** Feuer auf brennbarem Feld oder freiem Boden (nicht auf Trümmern, Wasser, Brücken). */
  startFire(x, y) {
    if (!inBounds(x, y)) return;
    const k = this.tile[idx(x, y)];
    if (k === T.ZONE) { this.burnZone(this.zoneAt(x, y), x, y); return; }
    if (k === T.DIRT || isBurnK(k)) this.setTile(x, y, T.FIRE, rand(3));
  },

  /** Feld durch Monster/Tornado zerstören (destroyMapTile im Original): wird zu Trümmern;
   *  Straßenbrücken stürzen ein, Schienenbrücken/Unterwasserkabel bleiben. Bebaute Zonen explodieren
   *  (Vereinfachung: die ganze Zone wird zerstört, im Original nur das getroffene Feld). */
  destroyTile(x, y) {
    const k = this.tile[idx(x, y)];
    switch (k) {
      case T.WATER: case T.DIRT: case T.RUBBLE: case T.FIRE: case T.RAD: case T.FLOOD:
      case T.RAILBRIDGE: case T.WIREWATER: return;
      case T.ROADBRIDGE: this.setTile(x, y, T.WATER, 0); return;
      case T.ZONE: {
        const z = this.zoneAt(x, y);
        if (!z) return;
        const ri = (zoneCX(z) >> 3) + (zoneCY(z) >> 3) * EW;
        this.rateOfGrowth[ri] = clamp(this.rateOfGrowth[ri] - 20, -200, 200);
        const boom = !(z.type === Z.RES && z.den === 0 && !z.special);
        this.removeZone(z, T.RUBBLE);
        if (boom) this.makeExplosionAt(x, y);
        return;
      }
      default: this.setTile(x, y, T.RUBBLE, rand(3));
    }
  },

  // ================= Katastrophen =================
  doDisasters() {
    if (this.floodCnt > 0) this.floodCnt--;
    if (this.disasterEvent) this.scenarioDisaster();
    if (!this.disastersEnabled) return;
    if (rand(DIS_CHANCE[this.level]) === 0) {
      switch (rand(8)) {
        case 0: case 1: this.setFire(); break;
        case 2: case 3: this.makeFlood(); break;
        case 4: break;
        case 5: this.makeTornado(); break;
        case 6: this.makeEarthquake(); break;
        case 7: case 8: if (this.pollutionAverage > 60) this.makeMonster(); break;
      }
    }
  },

  /** Zufallsfeuer (setFire im Original): EIN Versuch; trifft nur Gebäudefelder bebauter Zonen (nicht die Mitte). */
  setFire() {
    const x = rand(W - 1), y = rand(H - 1);
    if (this.tile[idx(x, y)] !== T.ZONE) return false;
    const z = this.zoneAt(x, y);
    if (!z || (x === zoneCX(z) && y === zoneCY(z))) return false;
    if (z.type === Z.RES && z.den === 0 && !z.special && this.housesCount(z) === 0) return false;
    this.burnZone(z, x, y);
    this.message('Feuer gemeldet!', x, y, true);
    return true;
  },

  /** Feuer aus dem Katastrophen-Menü (makeFire im Original): 40 Versuche, beliebiges brennbares Feld außer Zonenmitten. */
  makeFire() {
    for (let t = 0; t < 40; t++) {
      const x = rand(W - 1), y = rand(H - 1);
      const k = this.tile[idx(x, y)];
      if (!isBurnK(k)) continue;
      if (k === T.ZONE) {
        const z = this.zoneAt(x, y);
        if (!z || (x === zoneCX(z) && y === zoneCY(z))) continue;
        this.burnZone(z, x, y);
      } else this.setTile(x, y, T.FIRE, rand(3));
      this.message('Feuer gemeldet!', x, y, true);
      return true;
    }
    return false;
  },

  makeFlood() {
    for (let t = 0; t < 300; t++) {
      const x = rand(W - 1), y = rand(H - 1);
      if (this.tile[idx(x, y)] !== T.WATER) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inBounds(nx, ny)) continue;
        const k = this.tile[idx(nx, ny)];
        if (k === T.DIRT || (isBurnK(k) && k !== T.ZONE)) {
          this.setTile(nx, ny, T.FLOOD, 0);
          this.floodCnt = 30;
          this.message('Überschwemmung gemeldet!', nx, ny, true);
          return true;
        }
      }
    }
    return false;
  },

  makeTornado() {
    let s = this.findSprite(SPR.TORNADO);
    if (s) { s.count = 200; return; }
    const x = 10 + rand(W - 20), y = 10 + rand(H - 20);
    s = this.makeSprite(SPR.TORNADO, x, y);
    this.message('Tornado gesichtet!', x, y, true);
  },

  /** Erdbeben wie im Original: strength Zufallsfelder; getroffen werden nur Gebäudefelder von Zonen
   *  (nicht die Mitte), 3 von 4 werden zu Trümmern, jedes 4. fängt Feuer. Vereinfachung im Zonenmodell:
   *  „Trümmer“ = das Gebäude verliert eine Dichtestufe, „Feuer“ = die Zone brennt ab. */
  makeEarthquake() {
    const strength = 300 + rand(700);
    this.shake = 90;
    this.emit('earthquake');
    this.message('Schweres Erdbeben gemeldet!', this.cityCenterX, this.cityCenterY, true);
    for (let n = 0; n < strength; n++) {
      const x = rand(W - 1), y = rand(H - 1);
      if (this.tile[idx(x, y)] !== T.ZONE) continue;
      const z = this.zoneAt(x, y);
      if (!z || (x === zoneCX(z) && y === zoneCY(z))) continue;
      if ((n & 3) === 0) this.burnZone(z, x, y);
      else this.quakeDamage(z);
    }
  },

  /** Ein Gebäude stürzt teilweise ein: eine Ausbaustufe weniger. */
  quakeDamage(z) {
    const v = z.val || 0;
    if (z.type === Z.RES) {
      if (z.special) return;
      if (z.den > 0 || this.housesCount(z) > 0) this.doResOut(z, this.resZonePop(z), v);
    } else if (z.type === Z.COM) this.doComOut(z, z.den, v);
    else if (z.type === Z.IND) this.doIndOut(z, z.den, v);
  },

  makeMonster() {
    let s = this.findSprite(SPR.MONSTER);
    if (s) { s.count = 1000; s.phase = 0; s.destX = this.pollutionMaxX * 16; s.destY = this.pollutionMaxY * 16; return; }
    // aus dem Wasser auftauchen
    let mx = -1, my = -1;
    for (let t = 0; t < 300; t++) {
      const x = 5 + rand(W - 10), y = 5 + rand(H - 10);
      if (this.tile[idx(x, y)] === T.WATER) { mx = x; my = y; break; }
    }
    if (mx < 0) { mx = rand(1) ? 1 : W - 2; my = 10 + rand(H - 20); }
    s = this.makeSprite(SPR.MONSTER, mx, my);
    this.message('Ein Monster wurde gesichtet!', mx, my, true);
  },

  makeAirCrash() {
    let s = this.findSprite(SPR.PLANE);
    if (!s) {
      const x = 10 + rand(W - 20), y = 10 + rand(H - 20);
      s = this.makeSprite(SPR.PLANE, x, y);
      s.alt = 1;
    }
    s.crashing = true;
    s.alt = Math.max(s.alt, 0.6);
    this.message('Flugzeugabsturz!', (s.x / 16) | 0, (s.y / 16) | 0, true);
  },

  makeMeltdown() {
    for (const z of this.zones.values()) {
      if (z.type === Z.NUCLEAR) { this.doMeltdown(z); return true; }
    }
    return false;
  },

  /** Kernschmelze wie im Original: 4 Explosionen an den Ecken, das Kraftwerk brennt (4x4),
   *  200 Zufallsfelder im Umkreis von 20x15 werden radioaktiv (brennbare Felder und freier Boden, keine Zonen). */
  doMeltdown(z) {
    const cx = zoneCX(z), cy = zoneCY(z);
    this.removeZone(z, T.RUBBLE);
    for (let y = z.y; y < z.y + 4; y++) for (let x = z.x; x < z.x + 4; x++) this.setTile(x, y, T.FIRE, rand(3));
    this.makeExplosionAt(z.x, z.y); this.makeExplosionAt(z.x + 3, z.y);
    this.makeExplosionAt(z.x, z.y + 3); this.makeExplosionAt(z.x + 3, z.y + 3);
    for (let n = 0; n < 200; n++) {
      const x = cx - 20 + rand(40), y = cy - 15 + rand(30);
      if (!inBounds(x, y)) continue;
      const k = this.tile[idx(x, y)];
      if (k === T.ZONE) continue;
      if (isBurnK(k) || k === T.DIRT) this.setTile(x, y, T.RAD, 0);
    }
    this.message('Kernschmelze im Atomkraftwerk!!!', cx, cy, true);
  },

  /** Brandbomben (Hamburg) wie im Original: 2–3 Einzelexplosionen an zufälligen Stellen der Karte. */
  makeFireBombs() {
    const n = 2 + (rand16() & 1);
    let lx = 0, ly = 0;
    for (let i = 0; i < n; i++) {
      lx = rand(W - 1); ly = rand(H - 1);
      this.makeExplosionAt(lx, ly);
    }
    this.message('Brandbomben gemeldet!', lx, ly, true);
  },
});
