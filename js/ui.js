'use strict';
/* Benutzeroberfläche: Menüs, Werkzeugleiste, Fenster (Karte, Grafiken, Haushalt,
 * Bewertung, Abfrage), Meldungen, Startbildschirm, Speichern/Laden. */

const TOOLS = [
  { id: 'bulldozer', name: 'Bulldozer', cost: 1, key: 'b', line: true },
  { id: 'query', name: 'Abfrage', cost: 0, key: 'q' },
  { id: 'road', name: 'Straße', cost: 10, key: 'r', line: true, note: 'Brücke $50' },
  { id: 'rail', name: 'Schiene', cost: 20, key: 't', line: true, note: 'Tunnel $100' },
  { id: 'wire', name: 'Stromleitung', cost: 5, key: 'l', line: true, note: 'über Wasser $25' },
  { id: 'park', name: 'Park', cost: 10, key: 'p', line: true },
  { id: 'res', name: 'Wohngebiet', cost: 100, key: '1', zone: Z.RES },
  { id: 'com', name: 'Gewerbegebiet', cost: 100, key: '2', zone: Z.COM },
  { id: 'ind', name: 'Industriegebiet', cost: 100, key: '3', zone: Z.IND },
  { id: 'police', name: 'Polizeirevier', cost: 500, key: '4', zone: Z.POLICE },
  { id: 'fire', name: 'Feuerwache', cost: 500, key: '5', zone: Z.FIRE },
  { id: 'stadium', name: 'Stadion', cost: 3000, key: '6', zone: Z.STADIUM },
  { id: 'port', name: 'Seehafen', cost: 3000, key: '7', zone: Z.PORT },
  { id: 'coal', name: 'Kohlekraftwerk', cost: 3000, key: '8', zone: Z.COAL },
  { id: 'nuclear', name: 'Atomkraftwerk', cost: 5000, key: '9', zone: Z.NUCLEAR },
  { id: 'airport', name: 'Flughafen', cost: 10000, key: '0', zone: Z.AIRPORT },
  { id: 'pan', name: 'Karte verschieben', cost: 0, key: 'h', wide: true },
];

const MAP_MODES = [
  ['all', 'Stadtplan'], ['res', 'Wohngebiete'], ['com', 'Gewerbegebiete'], ['ind', 'Industriegebiete'],
  ['power', 'Stromnetz'], ['transport', 'Verkehrsnetz'], ['popdens', 'Bevölkerungsdichte'], ['growth', 'Wachstumsrate'],
  ['traffic', 'Verkehrsdichte'], ['pollution', 'Umweltverschmutzung'], ['crime', 'Kriminalität'], ['landvalue', 'Bodenwert'],
  ['fire', 'Feuerwehr-Abdeckung'], ['police', 'Polizei-Abdeckung'],
];

const SPEED_NAMES = ['Pause', 'Langsam', 'Mittel', 'Schnell'];

const UI = {
  city: null, view: null,
  tool: 'road',
  modal: 0,
  wins: {},
  zTop: 100,
  mapMode: 'all',
  mapOnMain: false,
  graphRange: 10,
  graphSel: { res: true, com: true, ind: true, money: true, crime: true, pollution: true },
  lastMsg: null,
  cheatBuf: '',

  init(city, view) {
    this.city = city; this.view = view;
    city.on((t, d) => this.onCityEvent(t, d));
    this.buildMenus();
    this.buildTools();
    this.bindMap();
    this.bindKeys();
    document.getElementById('st-msg').addEventListener('click', () => {
      if (this.lastMsg && this.lastMsg.x !== undefined) this.view.centerOn(this.lastMsg.x, this.lastMsg.y);
    });
    document.getElementById('fileinput').addEventListener('change', e => this.importFile(e));
    window.addEventListener('resize', () => this.view.resize());
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.menu')) this.closeMenus();
      Sound.init();
    }, true);
  },

  get paused() { return this.city.speed === 0 || this.modal > 0; },

  // =================== Menüs ===================
  buildMenus() {
    const mb = document.getElementById('menubar');
    mb.innerHTML = '';
    const c = this.city;
    const menus = [
      ['Datei', [
        ['Neue Stadt…', () => this.startScreen()],
        ['Szenario laden…', () => this.scenarioDialog()],
        ['Stadt laden…', () => this.loadDialog()],
        ['-'],
        ['Speichern', () => this.saveCity(false), 'Strg+S'],
        ['Speichern unter…', () => this.saveCity(true)],
        ['Als Datei exportieren', () => this.exportFile()],
        ['Aus Datei importieren…', () => document.getElementById('fileinput').click()],
        ['-'],
        ['Stadt umbenennen…', () => this.renameCity()],
        ['Über SimCity…', () => this.about()],
      ]],
      ['Optionen', [
        ['Auto-Abriss', () => { c.autoBulldoze = !c.autoBulldoze; }, null, () => c.autoBulldoze],
        ['Auto-Budget', () => { c.autoBudget = !c.autoBudget; }, null, () => c.autoBudget],
        ['Auto-Gehe-zu', () => { c.autoGoto = !c.autoGoto; }, null, () => c.autoGoto],
        ['Ton', () => { c.soundOn = !c.soundOn; Sound.enabled = c.soundOn; }, null, () => c.soundOn],
        ['-'],
        ['Vergrößern', () => this.view.setZoom(this.view.zoom + 1), '+'],
        ['Verkleinern', () => this.view.setZoom(this.view.zoom - 1), '−'],
      ]],
      ['Katastrophen', [
        ['Feuer', () => c.makeFire()],
        ['Überschwemmung', () => c.makeFlood()],
        ['Flugzeugabsturz', () => c.makeAirCrash()],
        ['Tornado', () => c.makeTornado()],
        ['Erdbeben', () => c.makeEarthquake()],
        ['Monster', () => c.makeMonster()],
        ['Kernschmelze', () => { if (!c.makeMeltdown()) this.status('Kein Atomkraftwerk vorhanden.'); }],
        ['-'],
        ['Zufällige Katastrophen', () => { c.disastersEnabled = !c.disastersEnabled; }, null, () => c.disastersEnabled],
      ]],
      ['Fenster', [
        ['Übersichtskarte', () => this.openMap(), 'M'],
        ['Grafiken', () => this.openGraphs(), 'G'],
        ['Haushalt', () => this.openBudget(false), 'B'],
        ['Bewertung', () => this.openEvaluation(), 'E'],
      ]],
      ['Tempo', [
        ['Pause', () => this.setSpeed(0), 'Leertaste', () => c.speed === 0],
        ['Langsam', () => this.setSpeed(1), null, () => c.speed === 1],
        ['Mittel', () => this.setSpeed(2), null, () => c.speed === 2],
        ['Schnell', () => this.setSpeed(3), null, () => c.speed === 3],
      ]],
    ];
    for (const [title, items] of menus) {
      const m = document.createElement('div');
      m.className = 'menu';
      const t = document.createElement('div');
      t.className = 'mtitle'; t.textContent = title;
      const list = document.createElement('div');
      list.className = 'mlist';
      t.addEventListener('pointerdown', e => {
        e.preventDefault();
        const open = m.classList.contains('open');
        this.closeMenus();
        if (!open) { this.refreshMenu(list, items); m.classList.add('open'); }
      });
      t.addEventListener('pointerenter', () => {
        if (document.querySelector('.menu.open') && !m.classList.contains('open')) {
          this.closeMenus(); this.refreshMenu(list, items); m.classList.add('open');
        }
      });
      m.appendChild(t); m.appendChild(list);
      mb.appendChild(m);
    }
    const mt = document.createElement('div');
    mt.id = 'menutitle';
    mb.appendChild(mt);
  },

  refreshMenu(list, items) {
    list.innerHTML = '';
    for (const it of items) {
      if (it[0] === '-') { const s = document.createElement('div'); s.className = 'msep'; list.appendChild(s); continue; }
      const d = document.createElement('div');
      d.className = 'mitem' + (it[3] && it[3]() ? ' checked' : '');
      d.textContent = it[0];
      if (it[2]) { const k = document.createElement('span'); k.className = 'key'; k.textContent = it[2]; d.appendChild(k); }
      d.addEventListener('pointerup', e => { e.stopPropagation(); this.closeMenus(); it[1](); this.updateStatus(); });
      list.appendChild(d);
    }
  },

  closeMenus() { document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); },

  setSpeed(s) { this.city.speed = s; this.updateStatus(); },

  // =================== Werkzeuge ===================
  buildTools() {
    const box = document.getElementById('tools');
    box.innerHTML = '';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool' + (t.wide ? ' wide' : '');
      b.title = `${t.name}${t.cost ? ' – $' + t.cost : ''}${t.note ? ' (' + t.note + ')' : ''}  [Taste ${t.key.toUpperCase()}]`;
      b.dataset.tool = t.id;
      const cv = this.toolIcon(t);
      b.appendChild(cv);
      b.addEventListener('click', () => this.selectTool(t.id));
      box.appendChild(b);
    }
    this.selectTool(this.tool);
  },

  toolIcon(t) {
    const cv = mkCanvas(40, 36);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const fake = (type, den, val, extra) => Object.assign({ type, den, val, var: 1, special: 0, size: ZSIZE[type], game: 0, houses: [0, 0, 0, 0, 0, 0, 0, 0] }, extra || {});
    const drawZ = (z) => { const img = GFX.zoneImage(z); g.drawImage(img, 0, 0, img.width, img.height, 2, 0, 36, 36); };
    switch (t.id) {
      case 'bulldozer':
        g.fillStyle = '#9a6b3c'; g.fillRect(0, 26, 40, 10);
        g.fillStyle = '#e8b818'; g.fillRect(10, 12, 20, 12); g.fillRect(14, 4, 10, 9);
        g.fillStyle = '#7ab8f0'; g.fillRect(16, 6, 6, 5);
        g.fillStyle = '#333'; g.fillRect(8, 22, 26, 7);
        g.fillStyle = '#666'; for (let x = 10; x < 34; x += 4) g.fillRect(x, 24, 2, 3);
        g.fillStyle = '#888'; g.fillRect(2, 14, 4, 15); g.fillRect(5, 18, 6, 2);
        break;
      case 'query':
        g.fillStyle = '#fff'; g.fillRect(8, 2, 24, 32);
        g.strokeStyle = '#000'; g.strokeRect(8.5, 2.5, 23, 31);
        g.fillStyle = '#000080'; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center'; g.fillText('?', 20, 28);
        break;
      case 'road': g.drawImage(GFX.tileRoad(15), 0, 0, 16, 16, 2, 0, 36, 36); break;
      case 'rail': g.drawImage(GFX.tileRail(10), 0, 0, 16, 16, 2, 0, 36, 36); break;
      case 'wire': g.drawImage(GFX.tileWire(10), 0, 0, 16, 16, 2, 0, 36, 36); break;
      case 'park': g.drawImage(GFX.tilePark(0), 0, 0, 16, 16, 2, 0, 36, 36); break;
      case 'res': drawZ(fake(Z.RES, 0, 0)); break;
      case 'com': drawZ(fake(Z.COM, 0, 0)); break;
      case 'ind': drawZ(fake(Z.IND, 0, 0)); break;
      case 'pan':
        g.fillStyle = '#000'; g.font = '24px sans-serif'; g.textAlign = 'center'; g.fillText('✋', 20, 28);
        break;
      default: drawZ(fake(t.zone, 0, 0));
    }
    return cv;
  },

  selectTool(id) {
    this.tool = id;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    const t = TOOLS.find(x => x.id === id);
    document.getElementById('toolname').textContent = t.name;
    document.getElementById('toolcost').textContent = t.cost ? fmtMoney(t.cost) + (t.note ? '' : '') : ' ';
    this.view.canvas.style.cursor = id === 'pan' ? 'grab' : id === 'query' ? 'help' : 'crosshair';
  },

  // =================== Karteneingabe ===================
  bindMap() {
    const cv = this.view.canvas;
    let drag = null;     // {mode:'pan'|'tool', ...}
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      Sound.init();
      cv.setPointerCapture(e.pointerId);
      const [sx, sy] = pos(e);
      if (e.button === 1 || e.button === 2 || this.tool === 'pan') {
        drag = { mode: 'pan', sx, sy, cx: this.view.camX, cy: this.view.camY };
        cv.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;
      const [tx, ty] = this.view.screenToTile(sx, sy);
      const tool = TOOLS.find(t => t.id === this.tool);
      if (this.tool === 'query') { this.query(tx, ty); return; }
      drag = { mode: 'tool', lx: tx, ly: ty, errShown: false, spent: 0 };
      this.applyAt(tool, tx, ty, drag);
    });
    cv.addEventListener('pointermove', e => {
      const [sx, sy] = pos(e);
      const [tx, ty] = this.view.screenToTile(sx, sy);
      this.updateCursor(tx, ty);
      if (!drag) return;
      if (drag.mode === 'pan') {
        const ts = this.view.ts;
        this.view.camX = drag.cx - (sx - drag.sx) / ts;
        this.view.camY = drag.cy - (sy - drag.sy) / ts;
        this.view.clampCam();
        return;
      }
      const tool = TOOLS.find(t => t.id === this.tool);
      if (!tool.line) return;
      if (tx === drag.lx && ty === drag.ly) return;
      // Linie im 4er-Raster interpolieren (keine diagonalen Lücken)
      let x = drag.lx, y = drag.ly;
      let guard = 0;
      while ((x !== tx || y !== ty) && guard++ < 400) {
        const dx = tx - x, dy = ty - y;
        if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
        this.applyAt(tool, x, y, drag);
      }
      drag.lx = tx; drag.ly = ty;
    });
    const end = () => {
      if (drag && drag.mode === 'pan') this.selectTool(this.tool);
      if (drag && drag.mode === 'tool' && drag.spent) this.status(`Kosten: ${fmtMoney(drag.spent)}`);
      drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { this.view.cursor = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = pos(e);
      this.view.setZoom(this.view.zoom + (e.deltaY < 0 ? 1 : -1), sx, sy);
    }, { passive: false });
  },

  applyAt(tool, x, y, drag) {
    if (!inBounds(x, y)) return;
    const c = this.city;
    const r = c.applyTool(tool.id, x, y);
    if (r.ok) {
      if (r.noop) return;
      drag.spent += r.cost || 0;
      if (tool.id === 'bulldozer') { if (r.zone || (drag.spent % 5) === 1) Sound.bulldoze(); }
      else if (r.zone) Sound.zone();
      else Sound.build();
      if (c.powerDirty) c.powerScan();
    } else if (r.err && !drag.errShown) {
      drag.errShown = true;
      this.status(r.err, true);
      Sound.error();
    }
  },

  updateCursor(tx, ty) {
    const tool = TOOLS.find(t => t.id === this.tool);
    if (!tool || tool.id === 'pan') { this.view.cursor = null; return; }
    if (tool.zone) {
      const [x0, y0] = this.city.zoneOrigin(tool.zone, tx, ty);
      const chk = this.city.checkZoneSite(tool.zone, x0, y0);
      this.view.cursor = { x: x0, y: y0, size: ZSIZE[tool.zone], ok: chk.ok };
    } else {
      this.view.cursor = { x: tx, y: ty, size: 1 };
    }
  },

  bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const k = e.key;
      // Cheat: FUND
      this.cheatBuf = (this.cheatBuf + k.toUpperCase()).slice(-4);
      if (this.cheatBuf === 'FUND') {
        this.city.funds += 10000;
        this.city.emit('funds');
        Sound.cash();
        this.status('$10.000 aus dem Nichts… (Cheat)');
        this.cheatBuf = '';
        return;
      }
      const v = this.view;
      const step = 4;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') { e.preventDefault(); this.saveCity(false); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (k) {
        case 'ArrowLeft': v.camX -= step; v.clampCam(); e.preventDefault(); return;
        case 'ArrowRight': v.camX += step; v.clampCam(); e.preventDefault(); return;
        case 'ArrowUp': v.camY -= step; v.clampCam(); e.preventDefault(); return;
        case 'ArrowDown': v.camY += step; v.clampCam(); e.preventDefault(); return;
        case '+': case '=': v.setZoom(v.zoom + 1); return;
        case '-': v.setZoom(v.zoom - 1); return;
        case ' ': e.preventDefault(); this.setSpeed(this.city.speed === 0 ? (this.lastSpeed || 2) : (this.lastSpeed = this.city.speed, 0)); return;
        case 'Escape': this.closeTopWindow(); return;
        case 'M': case 'm': this.toggleWin('map', () => this.openMap()); return;
        case 'G': case 'g': this.toggleWin('graphs', () => this.openGraphs()); return;
        case 'B': this.toggleWin('budget', () => this.openBudget(false)); return;
        case 'E': case 'e': this.toggleWin('eval', () => this.openEvaluation()); return;
      }
      const t = TOOLS.find(x => x.key === k.toLowerCase());
      if (t) this.selectTool(t.id);
    });
  },

  toggleWin(id, open) { if (this.wins[id]) this.closeWin(id); else open(); },

  // =================== Statusleiste ===================
  status(text, alert) {
    const el = document.getElementById('st-msg');
    el.textContent = text;
    el.classList.toggle('alert', !!alert);
  },

  updateStatus() {
    const c = this.city;
    document.getElementById('st-name').textContent = c.name;
    document.getElementById('st-date').textContent = c.dateString();
    const f = document.getElementById('st-funds');
    f.textContent = fmtMoney(c.funds);
    f.classList.toggle('neg', c.funds < 0);
    document.getElementById('st-pop').textContent = 'Einw.: ' + fmtNum(c.population());
    document.getElementById('st-speed').textContent = this.modal > 0 ? 'Angehalten' : SPEED_NAMES[c.speed];
    document.getElementById('menutitle').textContent = c.name + ' – ' + CLASS_NAMES[c.cityClass];
  },

  drawRCI() {
    const cv = document.getElementById('rci');
    const g = cv.getContext('2d');
    const c = this.city;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    const mid = 46;
    g.fillStyle = '#404040'; g.fillRect(4, mid, 64, 1);
    const bars = [[c.resValve / 2000, '#30d030', 'R'], [c.comValve / 1500, '#4080ff', 'C'], [c.indValve / 1500, '#f0d020', 'I']];
    bars.forEach(([v, col, l], i) => {
      const x = 8 + i * 21;
      const h = Math.round(clamp(v, -1, 1) * 38);
      g.fillStyle = col;
      if (h > 0) g.fillRect(x, mid - h, 14, h); else g.fillRect(x, mid + 1, 14, -h);
      g.fillStyle = '#fff'; g.font = 'bold 10px Tahoma, sans-serif'; g.textAlign = 'center';
      g.fillText(l, x + 7, h >= 0 ? mid + 12 : mid - 4);
    });
  },

  // =================== Fenster ===================
  win(id, title, body, opts) {
    opts = opts || {};
    if (this.wins[id]) { this.focusWin(this.wins[id]); return this.wins[id]; }
    const w = document.createElement('div');
    w.className = 'win';
    const tb = document.createElement('div');
    tb.className = 'wtitle';
    const ts = document.createElement('span'); ts.textContent = title;
    tb.appendChild(ts);
    if (!opts.noClose) {
      const cb = document.createElement('button');
      cb.className = 'wclose'; cb.textContent = '×';
      cb.addEventListener('click', () => this.closeWin(id));
      tb.appendChild(cb);
    }
    const bd = document.createElement('div');
    bd.className = 'wbody';
    bd.appendChild(body);
    w.appendChild(tb); w.appendChild(bd);
    document.getElementById('windows').appendChild(w);
    // Position
    const app = document.getElementById('app').getBoundingClientRect();
    const r = w.getBoundingClientRect();
    let x = opts.x !== undefined ? opts.x : (app.width - r.width) / 2;
    let y = opts.y !== undefined ? opts.y : (app.height - r.height) / 2;
    if (opts.right) x = app.width - r.width - 8;
    x = clamp(x, 0, Math.max(0, app.width - r.width));
    y = clamp(y, 26, Math.max(26, app.height - r.height));
    w.style.left = x + 'px'; w.style.top = y + 'px';
    // Ziehen
    let d = null;
    tb.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('wclose')) return;
      d = { x: e.clientX, y: e.clientY, l: w.offsetLeft, t: w.offsetTop };
      tb.setPointerCapture(e.pointerId);
    });
    tb.addEventListener('pointermove', e => {
      if (!d) return;
      w.style.left = clamp(d.l + e.clientX - d.x, -r.width + 60, app.width - 40) + 'px';
      w.style.top = clamp(d.t + e.clientY - d.y, 24, app.height - 30) + 'px';
    });
    tb.addEventListener('pointerup', () => { d = null; });
    w.addEventListener('pointerdown', () => this.focusWin(w));
    w.dataset.id = id;
    w.onClose = opts.onClose;
    if (opts.modal) { this.modal++; w.modal = true; }
    this.wins[id] = w;
    this.focusWin(w);
    this.updateStatus();
    return w;
  },

  focusWin(w) {
    document.querySelectorAll('.win').forEach(x => x.classList.add('inactive'));
    w.classList.remove('inactive');
    w.style.zIndex = ++this.zTop;
  },

  closeWin(id) {
    const w = this.wins[id];
    if (!w) return;
    delete this.wins[id];
    w.remove();
    if (w.modal) this.modal = Math.max(0, this.modal - 1);
    if (w.onClose) w.onClose();
    this.updateStatus();
  },

  closeTopWindow() {
    let top = null;
    for (const id in this.wins) { const w = this.wins[id]; if (!top || +w.style.zIndex > +top.style.zIndex) top = w; }
    if (top && !top.querySelector('.wclose')) return;
    if (top) this.closeWin(top.dataset.id);
  },

  el(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
  },

  /** Einfacher Dialog mit Text und Schaltflächen. */
  dialog(id, title, html, buttons, opts) {
    const body = this.el(html);
    const bar = document.createElement('div');
    bar.className = 'row'; bar.style.justifyContent = 'flex-end'; bar.style.marginTop = '8px';
    for (const [label, fn, def] of buttons) {
      const b = document.createElement('button');
      b.className = 'btn' + (def ? ' def' : '');
      b.textContent = label;
      b.addEventListener('click', () => { this.closeWin(id); if (fn) fn(); });
      bar.appendChild(b);
    }
    body.appendChild(bar);
    return this.win(id, title, body, Object.assign({ modal: true }, opts || {}));
  },

  // =================== Übersichtskarte ===================
  openMap() {
    const body = document.createElement('div');
    body.className = 'row';
    body.style.alignItems = 'flex-start';
    const cv = mkCanvas(W * 2, H * 2);
    cv.className = 'sunken';
    cv.style.padding = '0'; cv.style.cursor = 'pointer';
    cv.style.width = (W * 2) + 'px'; cv.style.height = (H * 2) + 'px';
    const side = document.createElement('div');
    side.className = 'col';
    for (const [m, label] of MAP_MODES) {
      const b = document.createElement('button');
      b.className = 'btn small mapbtn' + (m === this.mapMode ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.mapMode = m;
        side.querySelectorAll('.mapbtn').forEach(x => x.classList.toggle('on', x === b));
        this.view.overlay = this.mapOnMain && this.isOverlayMode(m) ? m : null;
        this.drawMapWin(true);
      });
      side.appendChild(b);
    }
    const lab = document.createElement('label');
    lab.className = 'note';
    lab.innerHTML = '<input type="checkbox"> im Stadtfenster zeigen';
    const chk = lab.querySelector('input');
    chk.checked = this.mapOnMain;
    chk.addEventListener('change', () => { this.mapOnMain = chk.checked; this.view.overlay = chk.checked && this.isOverlayMode(this.mapMode) ? this.mapMode : null; });
    side.appendChild(lab);
    const legend = document.createElement('div');
    legend.className = 'note'; legend.id = 'map-legend'; legend.style.width = '136px';
    side.appendChild(legend);
    body.appendChild(cv); body.appendChild(side);
    let dragging = false;
    const go = e => {
      const r = cv.getBoundingClientRect();
      this.view.camX = (e.clientX - r.left) / r.width * W;
      this.view.camY = (e.clientY - r.top) / r.height * H;
      this.view.clampCam();
    };
    cv.addEventListener('pointerdown', e => { dragging = true; cv.setPointerCapture(e.pointerId); go(e); });
    cv.addEventListener('pointermove', e => { if (dragging) go(e); });
    cv.addEventListener('pointerup', () => { dragging = false; });
    this.mapCanvas = cv;
    this.mapImg = mkCanvas(W * 2, H * 2);
    this.win('map', 'Übersichtskarte', body, { x: 112, y: 30, onClose: () => { this.mapCanvas = null; this.view.overlay = null; } });
    this.drawMapWin(true);
  },

  isOverlayMode(m) { return ['popdens', 'growth', 'traffic', 'pollution', 'crime', 'landvalue', 'fire', 'police'].includes(m); },

  drawMapWin(force) {
    if (!this.mapCanvas) return;
    const c = this.city;
    const now = performance.now();
    const age = now - (this.mapDrawnAt || 0);
    if (force || (this.mapVersionDrawn !== c.mapVersion && age > 400) || (this.mapMode !== 'all' && age > 1000)) {
      MapRender.draw(this.mapImg.getContext('2d'), c, this.mapMode, 2);
      this.mapVersionDrawn = c.mapVersion;
      this.mapDrawnAt = now;
    }
    const g = this.mapCanvas.getContext('2d');
    g.drawImage(this.mapImg, 0, 0);
    // Sichtbereich
    const v = this.view;
    const vw = v.canvas.width / v.ts, vh = v.canvas.height / v.ts;
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.strokeRect(Math.round((v.camX - vw / 2) * 2) + 0.5, Math.round((v.camY - vh / 2) * 2) + 0.5, Math.round(vw * 2), Math.round(vh * 2));
    const lg = document.getElementById('map-legend');
    if (lg) {
      const L = {
        power: '<b style="color:#c90">■</b> versorgt<br><b style="color:#d00">■</b> ohne Strom',
        transport: '<b style="color:#d00">■</b> Stau<br><b style="color:#f90">■</b> dichter Verkehr',
        growth: '<b style="color:#2a2">■</b> Wachstum<br><b style="color:#d22">■</b> Rückgang',
        landvalue: 'grün = hoch<br>braun = niedrig',
        fire: 'rot = gut abgedeckt', police: 'blau = gut abgedeckt',
      };
      lg.innerHTML = L[this.mapMode] || (this.isOverlayMode(this.mapMode) ? 'gelb = niedrig<br>rot = hoch' : '');
    }
  },

  // =================== Grafiken ===================
  openGraphs() {
    const body = document.createElement('div');
    const cv = mkCanvas(380, 200);
    cv.className = 'sunken'; cv.style.padding = '0'; cv.style.background = '#000';
    const bar = document.createElement('div');
    bar.className = 'btnbar';
    const series = [['res', 'Wohnen', '#30d030'], ['com', 'Gewerbe', '#4080ff'], ['ind', 'Industrie', '#f0d020'],
      ['money', 'Geldfluss', '#40f0f0'], ['crime', 'Kriminalität', '#ff4040'], ['pollution', 'Umwelt', '#c08040']];
    for (const [k, label, col] of series) {
      const b = document.createElement('button');
      b.className = 'btn small' + (this.graphSel[k] ? ' on' : '');
      b.innerHTML = `<span style="color:${col};text-shadow:0 0 1px #000">■</span> ${label}`;
      b.addEventListener('click', () => { this.graphSel[k] = !this.graphSel[k]; b.classList.toggle('on', this.graphSel[k]); this.drawGraphs(); });
      bar.appendChild(b);
    }
    const rb = document.createElement('div');
    rb.className = 'row';
    for (const yrs of [10, 120]) {
      const b = document.createElement('button');
      b.className = 'btn small' + (this.graphRange === yrs ? ' on' : '');
      b.textContent = yrs + ' Jahre';
      b.addEventListener('click', () => { this.graphRange = yrs; rb.querySelectorAll('.btn').forEach(x => x.classList.toggle('on', x === b)); this.drawGraphs(); });
      rb.appendChild(b);
    }
    body.appendChild(cv); body.appendChild(bar); body.appendChild(rb);
    this.graphCanvas = cv;
    this.graphSeries = series;
    this.win('graphs', 'Grafiken', body, { right: true, y: 30, onClose: () => { this.graphCanvas = null; } });
    this.drawGraphs();
  },

  drawGraphs() {
    const cv = this.graphCanvas;
    if (!cv) return;
    const g = cv.getContext('2d');
    const c = this.city, h = c.hist;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#203020'; g.lineWidth = 1;
    for (let y = 20; y < cv.height; y += 30) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(cv.width, y + 0.5); g.stroke(); }
    for (let x = 0; x < cv.width; x += 38) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, cv.height); g.stroke(); }
    const off = this.graphRange === 10 ? 0 : 120;
    let rciMax = 1;
    for (const k of ['res', 'com', 'ind']) for (let i = 0; i < 120; i++) rciMax = Math.max(rciMax, h[k][off + i]);
    const ph = cv.height - 10;
    for (const [k, , col] of this.graphSeries) {
      if (!this.graphSel[k]) continue;
      const max = ['res', 'com', 'ind'].includes(k) ? rciMax : 256;
      g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 120; i++) {
        const v = h[k][off + i];
        const x = cv.width - 2 - i * (cv.width - 4) / 119;
        const y = 5 + ph - (v / max) * ph;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = '#80a080'; g.font = '10px Tahoma, sans-serif';
    g.fillText('heute', cv.width - 32, cv.height - 3);
    g.fillText(`vor ${this.graphRange} Jahren`, 3, cv.height - 3);
  },

  // =================== Haushalt ===================
  openBudget(yearEnd) {
    const c = this.city;
    if (this.wins.budget) { this.focusWin(this.wins.budget); return; }
    if (!yearEnd) c.computeBudgetRequests();
    const body = document.createElement('div');
    body.style.width = '400px';
    body.innerHTML = `
      ${yearEnd ? '<div class="news"><b>Haushaltsabschluss ' + (c.year - 1) + '</b><br>Lege Steuersatz und Mittel für das kommende Jahr fest.</div>' : ''}
      <h3>Steuern</h3>
      <div class="row"><span style="width:110px">Steuersatz:</span><input type="range" id="b-tax" min="0" max="20" step="1"><b id="b-taxv"></b></div>
      <div class="grid2" style="margin-left:4px"><span>Steuereinnahmen (Jahr):</span><span class="r" id="b-taxfund"></span></div>
      <h3>Ausgaben</h3>
      <div class="sunken" style="background:#d8d8d8">
      <div class="row" style="font-weight:bold"><span style="width:96px"></span><span style="width:80px;text-align:right">angefordert</span><span style="width:120px;text-align:center">Anteil</span><span style="width:70px;text-align:right">bewilligt</span></div>
      ${['road:Verkehr', 'fire:Feuerwehr', 'police:Polizei'].map(s => { const [k, n] = s.split(':'); return `
      <div class="row"><span style="width:96px">${n}</span><span style="width:80px;text-align:right" id="b-${k}req"></span>
      <input type="range" id="b-${k}" min="0" max="100" step="1" style="width:90px"><b id="b-${k}p" style="width:30px"></b><span style="width:70px;text-align:right" id="b-${k}sp"></span></div>`; }).join('')}
      </div>
      <h3>Bilanz</h3>
      <div class="grid2" style="margin-left:4px">
        <span>Kassenstand Vorjahr:</span><span class="r" id="b-prev"></span>
        <span>Geldfluss:</span><span class="r" id="b-flow"></span>
        <span>Aktueller Kassenstand:</span><span class="r" id="b-cur"></span>
      </div>
      <div class="row" style="margin-top:6px"><label><input type="checkbox" id="b-auto"> Auto-Budget</label></div>
      <div class="row" style="justify-content:flex-end"><button class="btn def" id="b-ok">${yearEnd ? 'Mit diesen Werten weiter' : 'Schließen'}</button></div>`;
    const $ = s => body.querySelector(s);
    const upd = () => {
      c.cityTax = +$('#b-tax').value;
      c.roadPct = +$('#b-road').value / 100;
      c.firePct = +$('#b-fire').value / 100;
      c.policePct = +$('#b-police').value / 100;
      c.taxFund = Math.floor(c.totalPop * c.landValueAverage / 120 * c.cityTax * F_LEVELS[c.level]);
      const plan = c.budgetPlan();
      $('#b-taxv').textContent = c.cityTax + ' %';
      $('#b-taxfund').textContent = fmtMoney(c.taxFund);
      for (const k of ['road', 'fire', 'police']) {
        $('#b-' + k + 'req').textContent = fmtMoney(c[k + 'Fund']);
        $('#b-' + k + 'p').textContent = Math.round(c[k + 'Pct'] * 100) + '%';
        $('#b-' + k + 'sp').textContent = fmtMoney(plan.spend[k]);
      }
      const flow = c.taxFund - plan.total;
      $('#b-prev').textContent = fmtMoney(yearEnd ? c.prevFunds : c.funds);
      $('#b-flow').textContent = (flow >= 0 ? '+' : '') + fmtMoney(flow);
      $('#b-flow').style.color = flow >= 0 ? '#006000' : '#a00000';
      $('#b-cur').textContent = fmtMoney(c.funds + (yearEnd ? flow : 0));
      if (!yearEnd) c.updateFundEffects(plan.spend);
    };
    $('#b-tax').value = c.cityTax;
    $('#b-road').value = Math.round(c.roadPct * 100);
    $('#b-fire').value = Math.round(c.firePct * 100);
    $('#b-police').value = Math.round(c.policePct * 100);
    $('#b-auto').checked = c.autoBudget;
    $('#b-auto').addEventListener('change', e => { c.autoBudget = e.target.checked; });
    body.querySelectorAll('input[type=range]').forEach(i => i.addEventListener('input', upd));
    upd();
    $('#b-ok').addEventListener('click', () => this.closeWin('budget'));
    this.win('budget', 'Haushalt', body, {
      modal: yearEnd,
      noClose: yearEnd,
      onClose: () => {
        if (yearEnd) {
          c.finishBudget(false);
          if (c.funds < 0) this.status('Die Stadtkasse ist leer!', true);
        }
      },
    });
  },

  // =================== Bewertung ===================
  openEvaluation() {
    const body = document.createElement('div');
    body.id = 'eval-body';
    body.style.width = '420px';
    this.win('eval', 'Bewertung', body, { y: 40 });
    this.fillEvaluation();
  },

  fillEvaluation() {
    const body = document.getElementById('eval-body');
    if (!body) return;
    const c = this.city;
    const total = c.problemVotes.reduce((a, b) => a + b, 0) || 1;
    const probs = c.problemOrder.length
      ? c.problemOrder.map(i => `<div class="row"><span style="flex:1">${PROBLEM_NAMES[i]}</span><b style="white-space:nowrap">${Math.round(c.problemVotes[i] * 100 / total)} %</b></div>`).join('')
      : '<i>Keine Angaben</i>';
    body.innerHTML = `
      <div class="row" style="align-items:flex-start;gap:14px">
        <div class="sunken" style="flex:1">
          <h3 style="margin-top:0">Öffentliche Meinung</h3>
          Macht der Bürgermeister einen guten Job?
          <div class="row"><span style="width:50px">Ja</span><b>${c.cityYes} %</b></div>
          <div class="row"><span style="width:50px">Nein</span><b>${100 - c.cityYes} %</b></div>
          <h3>Die größten Probleme</h3>${probs}
        </div>
        <div class="sunken" style="flex:1.2">
          <h3 style="margin-top:0">Statistik</h3>
          <div class="grid2">
            <span>Einwohner:</span><span class="r">${fmtNum(c.cityPop)}</span>
            <span>Zuwanderung:</span><span class="r">${c.cityPopDelta >= 0 ? '+' : ''}${fmtNum(c.cityPopDelta)}</span>
            <span>Grundstückswert:</span><span class="r">${fmtMoney(c.cityAssessedValue)}</span>
            <span>Kategorie:</span><span class="r">${CLASS_NAMES[c.cityClass]}</span>
            <span>Schwierigkeit:</span><span class="r">${LEVEL_NAMES[c.level]}</span>
          </div>
          <h3>Gesamtwertung (0–1000)</h3>
          <div class="grid2">
            <span>Aktuelle Wertung:</span><span class="r">${c.cityScore}</span>
            <span>Veränderung:</span><span class="r">${c.cityScoreDelta >= 0 ? '+' : ''}${c.cityScoreDelta}</span>
          </div>
        </div>
      </div>
      <p class="note">Die Bewertung wird einmal pro Jahr (im Januar) erstellt.</p>`;
  },

  // =================== Abfrage ===================
  query(x, y) {
    if (!inBounds(x, y)) return;
    const c = this.city;
    const i = idx(x, y), k = c.tile[i];
    const h = (x >> 1) + (y >> 1) * HW, e = (x >> 3) + (y >> 3) * EW;
    let name;
    const z = k === T.ZONE ? c.zones.get(c.zid[i]) : null;
    if (z) {
      name = ZNAME[z.type];
      if (z.type === Z.RES && z.special) name = z.special === 1 ? 'Krankenhaus' : 'Kirche';
      if ((z.type === Z.RES || z.type === Z.COM || z.type === Z.IND) && z.den === 0 && !(z.houses && z.houses.some(v => v))) name += ' (unbebaut)';
      if (z.type === Z.RES && z.den === 0 && z.houses && z.houses.some(v => v)) name += ' (Einzelhäuser)';
    } else {
      name = {
        [T.DIRT]: 'Freies Gelände', [T.WATER]: 'Wasser', [T.TREES]: 'Wald', [T.RUBBLE]: 'Trümmer', [T.FIRE]: 'Feuer!',
        [T.FLOOD]: 'Überschwemmung', [T.RAD]: 'Radioaktiv verseucht', [T.ROAD]: 'Straße', [T.RAIL]: 'Schiene',
        [T.WIRE]: 'Stromleitung', [T.ROADWIRE]: 'Straße mit Stromleitung', [T.RAILWIRE]: 'Schiene mit Stromleitung',
        [T.ROADRAIL]: 'Bahnübergang', [T.PARK]: 'Park', [T.ROADBRIDGE]: 'Brücke', [T.RAILBRIDGE]: 'Eisenbahntunnel',
        [T.WIREWATER]: 'Unterwasserkabel',
      }[k] || '?';
    }
    const cat = (v, a, b, cc, names) => names[v < a ? 0 : v < b ? 1 : v < cc ? 2 : 3];
    const dens = cat(c.popDensity[h], 64, 128, 192, ['Niedrig', 'Mittel', 'Hoch', 'Sehr hoch']);
    const lv = cat(c.landValue[h], 30, 80, 150, ['Slum', 'Unterschicht', 'Mittelschicht', 'Oberschicht']);
    const cr = cat(c.crime[h], 64, 128, 192, ['Sicher', 'Gering', 'Mäßig', 'Gefährlich']);
    const po = cat(c.pollution[h], 64, 128, 192, ['Keine', 'Mäßig', 'Stark', 'Sehr stark']);
    const rg = c.rateOfGrowth[e];
    const gr = rg > 100 ? 'Schnelles Wachstum' : rg > 20 ? 'Langsames Wachstum' : rg < -20 ? 'Abnehmend' : 'Stabil';
    let extra = '';
    if (z) {
      if (needsPower(z)) extra += `<span>Strom:</span><span class="r">${z.powered ? 'versorgt' : '<span style="color:#c00">nicht versorgt</span>'}</span>`;
      const pop = c.zonePop(z);
      if (z.type === Z.RES && !z.special) extra += `<span>Bewohner:</span><span class="r">${fmtNum(pop * 20)}</span>`;
      if (z.type === Z.COM || z.type === Z.IND) extra += `<span>Arbeitsplätze:</span><span class="r">${fmtNum(pop * 160)}</span>`;
      if (z.type === Z.COAL || z.type === Z.NUCLEAR) extra += `<span>Netzauslastung:</span><span class="r">${fmtNum(c.powerUsed)} / ${fmtNum(c.powerCapacity)}</span>`;
    }
    const t = c.trafficDensity[h];
    this.closeWin('query');
    this.dialog('query', 'Abfrage', `
      <div style="width:250px">
        <div class="center" style="font-weight:bold;font-size:14px;margin-bottom:6px">${name}</div>
        <div class="grid2 sunken">
          <span>Dichte:</span><span class="r">${dens}</span>
          <span>Bodenwert:</span><span class="r">${lv}</span>
          <span>Kriminalität:</span><span class="r">${cr}</span>
          <span>Umweltverschmutzung:</span><span class="r">${po}</span>
          <span>Wachstum:</span><span class="r">${gr}</span>
          ${isRoadK(k) ? `<span>Verkehr:</span><span class="r">${t >= 192 ? 'Stau' : t >= 64 ? 'Dicht' : 'Gering'}</span>` : ''}
          ${extra}
        </div>
        <div class="note center">Feld ${x}, ${y}</div>
      </div>`, [['OK', null, true]], { modal: false });
  },

  // =================== Ereignisse aus der Simulation ===================
  onCityEvent(type, d) {
    const c = this.city;
    switch (type) {
      case 'message': {
        this.lastMsg = d;
        this.status(d.text, d.important);
        if (d.important) {
          if (/Monster/.test(d.text)) Sound.monster();
          else if (/Erdbeben/.test(d.text)) Sound.quake();
          else Sound.siren();
          if (c.autoGoto && d.x !== undefined) this.view.centerOn(d.x, d.y);
          this.newsPopup(d);
        } else if (/Verkehr|Stau/.test(d.text)) Sound.honk();
        break;
      }
      case 'milestone':
        Sound.fanfare();
        this.status(d.text);
        this.dialog('milestone', 'Herzlichen Glückwunsch!', `<div class="news"><div class="head">Stadtnachrichten</div>${d.text}</div>`, [['OK', null, true]]);
        break;
      case 'budget':
        if (d.yearEnd) this.openBudget(true);
        break;
      case 'evaluation':
        this.fillEvaluation();
        break;
      case 'census':
        this.drawGraphs();
        break;
      case 'explosion':
        if (!this.lastBoom || performance.now() - this.lastBoom > 300) { Sound.explosion(); this.lastBoom = performance.now(); }
        break;
      case 'bulldozeZone':
        break;
      case 'scenarioEnd':
        this.scenarioEnd(d.win);
        break;
    }
  },

  newsPopup(d) {
    const id = 'news';
    this.closeWin(id);
    const body = this.el(`<div class="news"><div class="head">Eilmeldung</div>${d.text}<br><span class="note">${c2date(this.city)}</span></div>`);
    const bar = document.createElement('div');
    bar.className = 'row'; bar.style.justifyContent = 'flex-end';
    if (d.x !== undefined) {
      const g = document.createElement('button');
      g.className = 'btn'; g.textContent = 'Gehe zu';
      g.addEventListener('click', () => this.view.centerOn(d.x, d.y));
      bar.appendChild(g);
    }
    const ok = document.createElement('button');
    ok.className = 'btn def'; ok.textContent = 'OK';
    ok.addEventListener('click', () => this.closeWin(id));
    bar.appendChild(ok);
    body.appendChild(bar);
    this.win(id, 'Meldung', body, { right: true, y: 280 });
    clearTimeout(this.newsTimer);
    this.newsTimer = setTimeout(() => this.closeWin(id), 9000);
  },

  scenarioEnd(win) {
    Sound[win ? 'fanfare' : 'siren']();
    const sc = SCENARIOS.find(s => s.id === this.city.scenario);
    const html = win
      ? `<div class="news"><div class="head">Sieg!</div>Glückwunsch, Bürgermeister! Du hast die Aufgabe in <b>${sc ? sc.name : 'der Stadt'}</b> gemeistert.
         Die dankbaren Bürger überreichen dir den <b>Schlüssel der Stadt</b>.</div>`
      : `<div class="news"><div class="head">Abgewählt!</div>Die Bürger von <b>${sc ? sc.name : 'der Stadt'}</b> sind mit deiner Arbeit nicht zufrieden.
         Du wurdest aus dem Amt gejagt – ein wütender Mob begleitet dich zur Stadtgrenze.</div>`;
    this.city.scenario = null;
    this.dialog('scend', win ? 'Gewonnen!' : 'Verloren!', html, [
      ['Neues Spiel', () => this.startScreen()],
      ['Weiterspielen', null, true],
    ]);
  },

  // =================== Startbildschirm / Neue Stadt ===================
  startScreen() {
    for (const id in this.wins) this.closeWin(id);
    const bg = document.createElement('div');
    bg.id = 'start-bg';
    const box = document.createElement('div');
    box.className = 'win';
    box.style.position = 'relative';
    box.innerHTML = `<div class="wtitle"><span>Willkommen</span></div>
      <div class="wbody" style="padding:14px 18px">
        <div class="logo">SimCity<small>Der Stadtsimulator · Nachbau der Version von 1989</small></div>
        <div class="col" style="margin-top:18px;align-items:stretch">
          <button class="btn def" data-a="new">Neue Stadt gründen</button>
          <button class="btn" data-a="scen">Szenario laden</button>
          <button class="btn" data-a="load">Gespeicherte Stadt laden</button>
          <button class="btn" data-a="import">Stadt aus Datei importieren</button>
          ${this.hasRunningCity ? '<button class="btn" data-a="back">Zurück zur aktuellen Stadt</button>' : ''}
        </div>
      </div>`;
    bg.appendChild(box);
    document.getElementById('app').appendChild(bg);
    this.modal++;
    const close = () => { bg.remove(); this.modal = Math.max(0, this.modal - 1); };
    box.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      close();
      if (a === 'new') this.newCityDialog();
      else if (a === 'scen') this.scenarioDialog(true);
      else if (a === 'load') this.loadDialog(true);
      else if (a === 'import') { this.startScreen(); document.getElementById('fileinput').click(); }
    }));
  },

  newCityDialog() {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="row" style="align-items:flex-start;gap:12px">
        <div class="col">
          <canvas id="nc-map" width="${W * 2}" height="${H * 2}" class="sunken" style="padding:0"></canvas>
          <button class="btn" id="nc-gen">Neue Landschaft erzeugen</button>
        </div>
        <div class="col" style="width:200px">
          <h3 style="margin-top:0">Stadtname</h3>
          <input id="nc-name" value="Neustadt" maxlength="24" style="font:inherit;padding:2px">
          <h3>Schwierigkeit</h3>
          ${LEVEL_NAMES.map((n, i) => `<label><input type="radio" name="nc-lvl" value="${i}" ${i === 0 ? 'checked' : ''}> ${n} (${fmtMoney(LEVEL_FUNDS[i])})</label>`).join('')}
          <h3>Landschaft</h3>
          <label>Wasser <select id="nc-water"><option value="0">wenig</option><option value="1" selected>normal</option><option value="2">viel</option></select></label>
          <label>Wald <select id="nc-trees"><option value="0">wenig</option><option value="1" selected>normal</option><option value="2">viel</option></select></label>
          <label><input type="checkbox" id="nc-island"> Insel</label>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:8px">
        <button class="btn" id="nc-back">Zurück</button>
        <button class="btn def" id="nc-ok">Stadt gründen</button>
      </div>`;
    const $ = s => body.querySelector(s);
    const temp = new City();
    let seed = (Math.random() * 1e9) >>> 0;
    const gen = () => {
      generateTerrain(temp, { seed, water: +$('#nc-water').value, trees: +$('#nc-trees').value, island: $('#nc-island').checked });
      MapRender.draw($('#nc-map').getContext('2d'), temp, 'all', 2);
    };
    this.win('newcity', 'Neue Stadt', body, { modal: true, noClose: true });
    gen();
    $('#nc-gen').addEventListener('click', () => { seed = (Math.random() * 1e9) >>> 0; gen(); });
    ['#nc-water', '#nc-trees', '#nc-island'].forEach(s => $(s).addEventListener('change', gen));
    $('#nc-back').addEventListener('click', () => { this.closeWin('newcity'); this.startScreen(); });
    $('#nc-ok').addEventListener('click', () => {
      const lvl = +body.querySelector('input[name=nc-lvl]:checked').value;
      const c = this.city;
      const listeners = c.listeners;
      c.reset();
      c.listeners = listeners;
      generateTerrain(c, { seed, water: +$('#nc-water').value, trees: +$('#nc-trees').value, island: $('#nc-island').checked });
      RNG.s = (Date.now() >>> 0) || 7;
      c.name = $('#nc-name').value.trim() || 'Neustadt';
      c.level = lvl;
      c.funds = LEVEL_FUNDS[lvl];
      c.prevFunds = c.funds;
      c.fullAnalysis();
      this.closeWin('newcity');
      this.afterLoad();
      this.status(`Willkommen in ${c.name}! Baue ein Kraftwerk, Straßen und die ersten Zonen.`);
    });
  },

  scenarioDialog(fromStart) {
    const body = document.createElement('div');
    body.style.width = '460px';
    body.innerHTML = `<p>Wähle ein Szenario. Jede Stadt steckt in einer Krise – löse sie innerhalb der Frist!</p>
      <div class="scen-list">${SCENARIOS.map((s, i) => `<button class="btn" data-i="${i}"><b>${s.name}</b><br><span class="note">${s.year} · ${s.years} Jahre</span></button>`).join('')}</div>
      <div class="sunken" id="sc-text" style="margin-top:8px;min-height:70px">Wähle ein Szenario aus der Liste.</div>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="sc-back">Abbrechen</button><button class="btn def" id="sc-ok" disabled>Szenario starten</button></div>`;
    let sel = -1;
    body.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
      sel = +b.dataset.i;
      body.querySelectorAll('[data-i]').forEach(x => x.classList.toggle('on', x === b));
      body.querySelector('#sc-text').textContent = SCENARIOS[sel].text;
      body.querySelector('#sc-ok').disabled = false;
    }));
    body.querySelector('#sc-back').addEventListener('click', () => { this.closeWin('scen'); if (fromStart) this.startScreen(); });
    body.querySelector('#sc-ok').addEventListener('click', () => {
      if (sel < 0) return;
      this.closeWin('scen');
      const sc = SCENARIOS[sel];
      const c = this.city;
      const listeners = c.listeners;
      buildScenario(c, sc);
      c.listeners = listeners;
      RNG.s = (Date.now() >>> 0) || 7;
      this.afterLoad();
      this.dialog('scinfo', sc.name, `<div class="news" style="max-width:420px"><div class="head">${sc.name} · ${sc.year}</div>${sc.text}</div>`, [['Los geht\'s!', null, true]]);
    });
    this.win('scen', 'Szenario laden', body, { modal: true, noClose: true });
  },

  afterLoad() {
    const c = this.city;
    this.hasRunningCity = true;
    // Kamera auf das Stadtzentrum
    if (c.zones.size > 0) this.view.centerOn(c.cityCenterX, c.cityCenterY);
    else this.view.centerOn(W / 2, H / 2);
    Sound.enabled = c.soundOn;
    this.mapVersionDrawn = -1;
    this.updateStatus();
    this.fillEvaluation();
    this.drawGraphs();
    this.drawMapWin(true);
  },

  // =================== Speichern / Laden ===================
  savesIndex() {
    try { return JSON.parse(localStorage.getItem('simcity89-index') || '[]'); } catch (e) { return []; }
  },

  saveCity(ask) {
    const c = this.city;
    let name = c.saveName || c.name;
    if (ask || !c.saveName) {
      const n = prompt('Name des Spielstands:', name);
      if (!n) return;
      name = n.trim();
    }
    c.saveName = name;
    try {
      const data = JSON.stringify(c.serialize());
      localStorage.setItem('simcity89-save-' + name, data);
      const idxs = this.savesIndex().filter(s => s.name !== name);
      idxs.unshift({ name, city: c.name, date: c.dateString(), pop: c.population(), saved: new Date().toLocaleString('de-DE') });
      localStorage.setItem('simcity89-index', JSON.stringify(idxs));
      this.status(`Spielstand „${name}“ gespeichert.`);
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + e.message + '\nTipp: Nutze „Als Datei exportieren“.');
    }
  },

  loadDialog(fromStart) {
    const saves = this.savesIndex();
    const body = document.createElement('div');
    body.innerHTML = `<div class="saves sunken">${saves.length ? saves.map((s, i) => `
      <div class="row"><span><b>${s.name}</b><br><span class="note">${s.city} · ${s.date} · ${fmtNum(s.pop)} Einw. · gespeichert ${s.saved}</span></span>
      <span><button class="btn small" data-load="${i}">Laden</button><button class="btn small" data-del="${i}">Löschen</button></span></div>`).join('') : '<i>Keine gespeicherten Städte im Browser.</i>'}</div>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="ld-file">Aus Datei…</button><button class="btn" id="ld-back">Abbrechen</button></div>`;
    body.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
      const s = saves[+b.dataset.load];
      try {
        const o = JSON.parse(localStorage.getItem('simcity89-save-' + s.name));
        this.loadObject(o);
        this.city.saveName = s.name;
        this.closeWin('load');
      } catch (e) { alert('Laden fehlgeschlagen: ' + e.message); }
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const s = saves[+b.dataset.del];
      if (!confirm(`Spielstand „${s.name}“ löschen?`)) return;
      localStorage.removeItem('simcity89-save-' + s.name);
      localStorage.setItem('simcity89-index', JSON.stringify(saves.filter(x => x !== s)));
      this.closeWin('load'); this.loadDialog(fromStart);
    }));
    body.querySelector('#ld-file').addEventListener('click', () => document.getElementById('fileinput').click());
    body.querySelector('#ld-back').addEventListener('click', () => { this.closeWin('load'); if (fromStart && !this.hasRunningCity) this.startScreen(); });
    this.win('load', 'Stadt laden', body, { modal: true });
  },

  loadObject(o) {
    const c = this.city;
    c.deserialize(o);
    c.fullAnalysis();
    this.afterLoad();
    this.status(`${c.name} geladen.`);
  },

  exportFile() {
    const c = this.city;
    const blob = new Blob([JSON.stringify(c.serialize())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || 'stadt').replace(/[^\wäöüÄÖÜß-]+/g, '_') + '.city.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  importFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        this.loadObject(JSON.parse(r.result));
        document.getElementById('start-bg') && document.getElementById('start-bg').remove();
        this.modal = 0;
        for (const id in this.wins) this.closeWin(id);
      } catch (err) { alert('Datei konnte nicht geladen werden: ' + err.message); }
    };
    r.readAsText(f);
    e.target.value = '';
  },

  renameCity() {
    const n = prompt('Neuer Name der Stadt:', this.city.name);
    if (n && n.trim()) { this.city.name = n.trim(); this.updateStatus(); }
  },

  about() {
    this.dialog('about', 'Über SimCity', `<div style="max-width:380px">
      <div class="logo" style="font-size:32px">SimCity</div>
      <p>Ein originalgetreuer Nachbau des Stadtsimulators von 1989 – mit den Simulationsregeln des Originals
      (Zonenwachstum, Verkehr, Strom, Umwelt, Kriminalität, Bodenwert, Haushalt, Bewertung), allen Werkzeugen,
      Katastrophen und den acht klassischen Szenarien.</p>
      <p class="note">Steuerung: Linksklick baut, Ziehen baut Linien, Rechtsklick/Mittelklick + Ziehen verschiebt die Karte,
      Mausrad zoomt. Tasten: Pfeile verschieben, +/− zoomen, Leertaste Pause, Esc schließt Fenster,
      M Karte, G Grafiken, B Haushalt, E Bewertung, Werkzeuge über die im Tooltip genannten Tasten.</p>
      <p class="note">Alle Grafiken und Klänge werden im Programm erzeugt – es werden keine Original-Dateien verwendet.</p></div>`,
    [['OK', null, true]]);
  },
};

function c2date(c) { return c.dateString(); }
