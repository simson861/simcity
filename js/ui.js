'use strict';
/* Benutzeroberfläche: Menüs, Werkzeugleiste, Fenster (Karte, Grafiken, Haushalt,
 * Bewertung, Abfrage), Meldungen, Startbildschirm, Speichern/Laden. */

const TOOLS = [
  { id: 'bulldozer', name: 'Bulldozer', cost: 1, key: 'b', line: true },
  { id: 'query', name: 'Abfrage', cost: 0, key: 'q' },
  { id: 'road', name: 'Straße', cost: 10, key: 'r', line: true, note: 'Brücke $50' },
  { id: 'upgrade', name: 'Straßenausbau', cost: 40, key: 'u', line: true, note: 'Hauptstraße $40, Schnellstraße +$80, Brücken ×2,5' },
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
  // [Schlüssel, Name, Gruppe]
  ['all', 'Stadtplan', 'Übersicht'], ['res', 'Wohngebiete', 'Übersicht'], ['com', 'Gewerbegebiete', 'Übersicht'], ['ind', 'Industriegebiete', 'Übersicht'],
  ['power', 'Stromnetz', 'Netze'], ['transport', 'Straßen & Verkehr', 'Netze'], ['rail', 'Schienennetz', 'Netze'],
  ['popdens', 'Bevölkerungsdichte', 'Analyse'], ['growth', 'Wachstumsrate', 'Analyse'], ['traffic', 'Verkehrsdichte', 'Analyse'],
  ['pollution', 'Umweltverschmutzung', 'Analyse'], ['crime', 'Kriminalität', 'Analyse'], ['landvalue', 'Bodenwert', 'Analyse'],
  ['fire', 'Feuerwehr-Abdeckung', 'Abdeckung'], ['police', 'Polizei-Abdeckung', 'Abdeckung'],
];
const MAP_SCALE = 3;   // Pixel pro Feld in der Übersichtskarte (CSS skaliert auf die Fensterbreite)

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
  msgLog: [],            // Meldungsverlauf (neueste zuerst)
  // Erweiterungspunkte für Online-Module (cloud.js, coop.js)
  menuExt: {},           // { Menütitel: [[Text, fn, Taste, checkedFn], …] }
  startButtons: [],      // [{ label, fn, show() }] zusätzliche Knöpfe im Startbildschirm
  toolHooks: [],         // fn(tool, x, y, drag) → true = Werkzeug wurde abgefangen
  tickHooks: [],         // fn(now) in jedem Bild
  actionGuards: [],      // fn(aktion) → true = Aktion blockiert ('speed', 'disaster', 'budget', 'newcity', 'load', 'rename', 'cheat')
  suppressClickUntil: 0, // verhindert "Durchklicken" nach Menüauswahl per Touch

  init(city, view) {
    this.city = city; this.view = view;
    city.on((t, d) => this.onCityEvent(t, d));
    this.buildMenus();
    this.buildTools();
    this.bindMap();
    this.bindKeys();
    document.getElementById('st-msg').addEventListener('click', e => {
      const m = this.lastMsg;
      if (m && m.x !== undefined && e.currentTarget.textContent === m.text) this.view.centerOn(m.x, m.y);
      else this.openLog();
    });
    document.getElementById('st-rci').addEventListener('click', () => this.demandInfo());
    this.initMinimap();
    document.getElementById('fileinput').addEventListener('change', e => this.importFile(e));
    const onResize = () => { this.view.resize(); this.closeMenus(); this.fitWindows(); };
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) new ResizeObserver(() => this.view.resize()).observe(document.getElementById('mapwrap'));
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.menu')) this.closeMenus();
      Sound.init();
    }, true);
    document.addEventListener('click', e => {
      if (e.isTrusted && performance.now() < this.suppressClickUntil) {
        this.suppressClickUntil = 0;   // nur den einen Klick direkt nach dem Antippen schlucken
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
  },

  // =================== Minikarte ===================
  initMinimap() {
    const box = document.getElementById('minimap');
    const cv = document.getElementById('minimap-cv');
    if (!box || !cv) return;
    this.miniImg = mkCanvas(W, H);
    const collapsed = this.lsGet('simcity89-minimap') === 'klein';
    box.classList.toggle('collapsed', collapsed);
    const tg = document.getElementById('minimap-toggle');
    const setLabel = () => { tg.textContent = box.classList.contains('collapsed') ? '+' : '–'; };
    setLabel();
    this.toggleMinimap = () => {
      box.classList.toggle('collapsed');
      setLabel();
      try { this.lsSet('simcity89-minimap', box.classList.contains('collapsed') ? 'klein' : 'gross'); } catch (e) { /* egal */ }
    };
    tg.addEventListener('click', e => { e.stopPropagation(); this.toggleMinimap(); });
    let drag = false;
    const go = e => {
      const r = cv.getBoundingClientRect();
      this.view.camX = clamp((e.clientX - r.left) / r.width, 0, 1) * W;
      this.view.camY = clamp((e.clientY - r.top) / r.height, 0, 1) * H;
      this.view.clampCam();
    };
    cv.addEventListener('pointerdown', e => { e.stopPropagation(); drag = true; cv.setPointerCapture(e.pointerId); go(e); });
    cv.addEventListener('pointermove', e => { if (drag) go(e); });
    const end = () => { drag = false; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    this.tickHooks.push(now => this.drawMinimap(now));
  },

  drawMinimap(now) {
    const cv = document.getElementById('minimap-cv');
    if (!cv || !this.miniImg) return;
    const c = this.city;
    if (this.miniVersion !== c.mapVersion && now - (this.miniAt || 0) > 500 || !this.miniAt) {
      MapRender.draw(this.miniImg.getContext('2d'), c, 'all', 1);
      this.miniVersion = c.mapVersion;
      this.miniAt = now;
    }
    // Maßstab 2 für scharfen Sichtrahmen
    if (cv.width !== W * 2) { cv.width = W * 2; cv.height = H * 2; }
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniImg, 0, 0, W * 2, H * 2);
    const v = this.view;
    const vw = v.canvas.width / v.ts, vh = v.canvas.height / v.ts;
    const x = Math.round((v.camX - vw / 2) * 2), y = Math.round((v.camY - vh / 2) * 2);
    const w = Math.round(vw * 2), h = Math.round(vh * 2);
    g.lineWidth = 2;
    g.strokeStyle = '#000'; g.strokeRect(x + 1, y + 1, w, h);
    g.strokeStyle = '#ffff40'; g.strokeRect(x, y, w, h);
  },

  /** Ist localStorage nutzbar? (In Sandbox-iframes oder bei blockierten Cookies nicht.) */
  storageOK() {
    if (this._storageOK !== undefined) return this._storageOK;
    try {
      const k = 'simcity89-test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      this._storageOK = true;
    } catch (e) { this._storageOK = false; }
    return this._storageOK;
  },
  lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  lsSet(k, v) { window.localStorage.setItem(k, v); },   // wirft bei Fehler – Aufrufer fängt ab
  lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* egal */ } },

  /** Darf die Aktion ausgeführt werden? (z. B. nur der Gastgeber im Multiplayer) – true = blockiert. */
  guard(action) {
    for (const g of this.actionGuards) if (g(action)) return true;
    return false;
  },

  get paused() { return this.city.speed === 0 || this.modal > 0; },

  // =================== Menüs ===================
  buildMenus() {
    const mb = document.getElementById('menubar');
    mb.innerHTML = '';
    const c = this.city;
    const dis = fn => () => { if (!this.guard('disaster')) fn(); };
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
        ['Über SimCity…', () => this.about(), 'F1'],
      ]],
      ['Optionen', [
        ['Auto-Abriss', () => { c.autoBulldoze = !c.autoBulldoze; }, null, () => c.autoBulldoze],
        ['Auto-Budget', () => { c.autoBudget = !c.autoBudget; }, null, () => c.autoBudget],
        ['Auto-Gehe-zu', () => { c.autoGoto = !c.autoGoto; }, null, () => c.autoGoto],
        ['Ton', () => { c.soundOn = !c.soundOn; Sound.enabled = c.soundOn; }, null, () => c.soundOn],
        ['-'],
        ['Vergrößern', () => this.view.zoomBy(1.25), '+'],
        ['Verkleinern', () => this.view.zoomBy(0.8), '−'],
        ['Zoom 100 %', () => this.view.zoomTo(1)],
      ]],
      ['Katastrophen', [
        ['Feuer', dis(() => c.makeFire())],
        ['Überschwemmung', dis(() => c.makeFlood())],
        ['Flugzeugabsturz', dis(() => c.makeAirCrash())],
        ['Tornado', dis(() => c.makeTornado())],
        ['Erdbeben', dis(() => c.makeEarthquake())],
        ['Monster', dis(() => c.makeMonster())],
        ['Kernschmelze', dis(() => { if (!c.makeMeltdown()) this.status('Kein Atomkraftwerk vorhanden.'); })],
        ['-'],
        ['Zufällige Katastrophen', dis(() => { c.disastersEnabled = !c.disastersEnabled; }), null, () => c.disastersEnabled],
      ]],
      ['Fenster', [
        ['Übersichtskarte', () => this.openMap(), 'M'],
        ['Grafiken', () => this.openGraphs(), 'G'],
        ['Haushalt', () => this.openBudget(false), 'Umschalt+B'],
        ['Bewertung', () => this.openEvaluation(), 'E'],
        ['Meldungen', () => this.openLog(), 'N'],
      ]],
      ['Tempo', [
        ['Pause', () => this.setSpeed(0), 'Leertaste', () => c.speed === 0],
        ['Langsam', () => this.setSpeed(1), null, () => c.speed === 1],
        ['Mittel', () => this.setSpeed(2), null, () => c.speed === 2],
        ['Schnell', () => this.setSpeed(3), null, () => c.speed === 3],
      ]],
    ];
    if (typeof Net !== 'undefined' && Net.available) {
      menus.push(['Online', [
        [Net.user ? 'Abmelden (' + Net.name + ')' : 'Mit Google anmelden…', () => (Net.user ? Net.signOut() : Net.signIn())],
      ]]);
    }
    for (const [title, items] of menus) {
      const ext = this.menuExt[title];
      if (ext && ext.length) items.push(['-'], ...ext);
    }
    for (const [title, items] of menus) {
      const m = document.createElement('div');
      m.className = 'menu';
      const t = document.createElement('div');
      t.className = 'mtitle'; t.textContent = title;
      const list = document.createElement('div');
      list.className = 'mlist';
      const openMenu = () => { this.closeMenus(); this.refreshMenu(list, items); m.classList.add('open'); this.placeMenu(list); };
      t.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (m.classList.contains('open')) this.closeMenus(); else openMenu();
      });
      t.addEventListener('pointerenter', e => {
        if (e.pointerType === 'mouse' && document.querySelector('.menu.open') && !m.classList.contains('open')) openMenu();
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
      d.addEventListener('pointerup', e => {
        e.stopPropagation();
        this.closeMenus();
        // Der nachfolgende "click" (Touch) soll nicht auf dem Element darunter landen
        if (e.pointerType !== 'mouse') this.suppressClickUntil = performance.now() + 350;
        it[1]();
        this.updateStatus();
      });
      list.appendChild(d);
    }
  },

  closeMenus() { document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); },

  /** Aufgeklapptes Menü im Bildschirm halten (schmale Displays). */
  placeMenu(list) {
    list.style.left = '0px';
    const r = list.getBoundingClientRect();
    const over = r.right - window.innerWidth + 2;
    if (over > 0) list.style.left = -Math.min(over, r.left) + 'px';
  },

  setSpeed(s) { if (this.guard('speed')) return; this.city.speed = s; this.updateStatus(); },

  /** Menüeinträge eines Moduls ergänzen (Menü wird neu aufgebaut). */
  addMenuItems(title, items) {
    this.menuExt[title] = (this.menuExt[title] || []).concat(items);
    this.buildMenus();
  },

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
      case 'upgrade':
        g.drawImage(GFX.tileRoad(10), 0, 0, 16, 16, 2, 0, 36, 36);
        g.drawImage(GFX.roadUpgrade(10, 2, false), 0, 0, 16, 16, 2, 0, 36, 36);
        g.fillStyle = '#fff'; g.fillRect(28, 2, 10, 10); g.fillStyle = '#208020';
        g.beginPath(); g.moveTo(33, 3); g.lineTo(37, 8); g.lineTo(34.5, 8); g.lineTo(34.5, 11); g.lineTo(31.5, 11); g.lineTo(31.5, 8); g.lineTo(29, 8); g.fill();
        break;
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
    document.getElementById('toolcost').innerHTML = t.cost
      ? fmtMoney(t.cost) + (t.line && t.id !== 'bulldozer' ? ' / Feld' : '') + (t.note ? `<br><span class="note">${t.note}</span>` : '')
      : '&nbsp;';
    this.view.canvas.style.cursor = id === 'pan' ? 'grab' : id === 'query' ? 'help' : 'crosshair';
  },

  // =================== Karteneingabe ===================
  /* Maus: Linksklick = Werkzeug, Rechts/Mitte = verschieben, Rad = Zoom.
   * Touch: ein Finger = Werkzeug (Linien durch Ziehen), zwei Finger = verschieben + Pinch-Zoom.
   * Bei Touch wird das Werkzeug erst nach kurzer Verzögerung bzw. Bewegung angewendet,
   * damit ein beginnender Zwei-Finger-Griff nichts baut. Flächen-Werkzeuge bauen beim Loslassen. */
  bindMap() {
    const cv = this.view.canvas;
    const v = this.view;
    let drag = null;          // {mode:'pan'|'tool'|'pending'|'pinch', ...}
    const touches = new Map(); // pointerId -> [sx, sy]
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const curTool = () => TOOLS.find(t => t.id === this.tool);

    const startPinch = () => {
      const pts = [...touches.values()];
      const [a, b] = pts;
      drag = {
        mode: 'pinch',
        mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2,
        dist: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])),
        cx: v.camX, cy: v.camY, z0: v.zoom,
      };
      this.hideTip();
      v.cursor = null;
    };
    const startTool = (d) => {
      // Werkzeug am Startfeld anwenden (Touch: nach Verzögerung)
      clearTimeout(d.timer);
      d.mode = 'tool';
      const tool = curTool();
      if (tool.line) this.applyAt(tool, d.lx, d.ly, d);
    };
    const blocked = () => {
      if (this.modal > 0) { this.status('Bitte zuerst das Dialogfenster schließen.'); Sound.error(); return true; }
      return false;
    };

    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      Sound.init();
      this.closeMenus();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      const [sx, sy] = pos(e);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, [sx, sy]);
        if (touches.size >= 2) {
          // Zweiter Finger: laufende Aktion abbrechen, Pinch/Verschieben beginnen
          if (drag && drag.timer) clearTimeout(drag.timer);
          if (drag && drag.mode === 'tool' && drag.spent) this.status(`Kosten: ${fmtMoney(drag.spent)}`);
          startPinch();
          return;
        }
      }
      if (e.button === 1 || e.button === 2 || this.tool === 'pan') {
        drag = { mode: 'pan', sx, sy, cx: v.camX, cy: v.camY };
        cv.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;
      const [tx, ty] = v.screenToTile(sx, sy);
      const tool = curTool();
      if (e.pointerType === 'touch') {
        this.updateCursor(tx, ty);
        this.showTip(sx, sy, true);
        drag = { mode: 'pending', sx, sy, lx: tx, ly: ty, errShown: false, spent: 0, touch: true };
        if (tool.line) {
          const d = drag;
          d.timer = setTimeout(() => { if (drag === d && d.mode === 'pending' && !blocked()) startTool(d); }, 140);
        }
        return;
      }
      if (this.tool === 'query') { this.query(tx, ty); return; }
      if (blocked()) return;
      drag = { mode: 'tool', lx: tx, ly: ty, errShown: false, spent: 0 };
      this.applyAt(tool, tx, ty, drag);
      this.showTip(sx, sy, false, drag);
    });

    cv.addEventListener('pointermove', e => {
      const [sx, sy] = pos(e);
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, [sx, sy]);
      if (drag && drag.mode === 'pinch') {
        if (touches.size < 2) return;
        const [a, b] = [...touches.values()];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const dist = Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1]));
        const ratio = dist / drag.dist;
        // stufenlos: Kartenpunkt unter der Fingermitte bleibt unter den Fingern
        const ts0 = TS * drag.z0;
        const wx = drag.cx + (drag.mx - v.canvas.width / 2) / ts0, wy = drag.cy + (drag.my - v.canvas.height / 2) / ts0;
        v.zoomAnim = null;
        v.zoom = clamp(drag.z0 * ratio, ZOOM_MIN, ZOOM_MAX);
        v.camX = wx - (mx - v.canvas.width / 2) / v.ts;
        v.camY = wy - (my - v.canvas.height / 2) / v.ts;
        v.clampCam();
        return;
      }
      if (e.pointerType === 'touch' && !drag) return;   // Touch ohne Aktion: nichts
      const [tx, ty] = v.screenToTile(sx, sy);
      this.updateCursor(tx, ty);
      if (!drag) { if (e.pointerType === 'mouse') this.showTip(sx, sy); return; }
      if (drag.mode === 'pan') {
        const ts = v.ts;
        v.camX = drag.cx - (sx - drag.sx) / ts;
        v.camY = drag.cy - (sy - drag.sy) / ts;
        v.clampCam();
        return;
      }
      const tool = curTool();
      if (drag.mode === 'pending') {
        this.showTip(sx, sy, true, drag);
        if (!tool.line) { drag.lx = tx; drag.ly = ty; return; }   // Fläche folgt dem Finger
        if (Math.hypot(sx - drag.sx, sy - drag.sy) < 8) return;
        if (blocked()) { drag = null; return; }
        startTool(drag);
      }
      this.showTip(sx, sy, drag.touch, drag);
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
      this.showTip(sx, sy, drag.touch, drag);
    });

    const end = (e, cancelled) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (drag && drag.mode === 'pinch') {
          if (touches.size === 0) drag = null;    // erst nach dem letzten Finger beenden
          return;
        }
      }
      if (!drag) return;
      if (drag.timer) clearTimeout(drag.timer);
      if (drag.mode === 'pan') this.selectTool(this.tool);
      if (drag.mode === 'pending' && !cancelled) {
        // Touch-Tipp: Abfrage oder Werkzeug an der (letzten) Position
        const tool = curTool();
        if (this.tool === 'query') this.query(drag.lx, drag.ly);
        else if (!blocked()) { drag.mode = 'tool'; this.applyAt(tool, drag.lx, drag.ly, drag); }
      }
      if (drag.mode === 'tool' && drag.spent) this.status(`Kosten: ${fmtMoney(drag.spent)}`);
      const wasTouch = drag.touch;
      drag = null;
      if (wasTouch) {
        // Rückmeldung kurz stehen lassen, dann Cursor und Hinweis ausblenden
        clearTimeout(this.tipTimer);
        this.tipTimer = setTimeout(() => { if (!drag) { v.cursor = null; this.hideTip(); } }, 900);
      }
    };
    cv.addEventListener('pointerup', e => end(e, false));
    cv.addEventListener('pointercancel', e => end(e, true));
    cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { v.cursor = null; this.hideTip(); } });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = pos(e);
      // stufenlos: Mausrad und Trackpad-Pinch (ctrlKey) skalieren fließend
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 40; else if (e.deltaMode === 2) dy *= 400;
      const k = e.ctrlKey ? 0.012 : 0.0022;
      v.zoomAnim = null;
      v.setZoom(v.zoom * Math.exp(-clamp(dy, -300, 300) * k), sx, sy);
    }, { passive: false });
    // iOS: Gesten-Zoom der Seite unterbinden
    for (const t of ['gesturestart', 'gesturechange']) cv.addEventListener(t, e => e.preventDefault());
  },

  applyAt(tool, x, y, drag) {
    if (!inBounds(x, y)) return;
    for (const h of this.toolHooks) if (h(tool, x, y, drag)) return;
    const c = this.city;
    const r = c.applyTool(tool.id, x, y);
    if (r.ok) {
      if (r.noop) return;
      drag.spent += r.cost || 0;
      drag.err = null;
      if (tool.id === 'bulldozer') { if (r.zone || (drag.spent % 5) === 1) Sound.bulldoze(); }
      else if (r.zone) Sound.zone();
      else Sound.build();
      if (c.powerDirty) c.powerScan();
    } else if (r.err) {
      drag.err = r.err;
      if (!drag.errShown) {
        drag.errShown = true;
        this.status(r.err, true);
        Sound.error();
      }
    }
  },

  updateCursor(tx, ty) {
    const tool = TOOLS.find(t => t.id === this.tool);
    if (!tool || tool.id === 'pan') { this.view.cursor = null; this.cursorInfo = null; return; }
    if (tool.zone) {
      const [x0, y0] = this.city.zoneOrigin(tool.zone, tx, ty);
      const chk = this.city.checkZoneSite(tool.zone, x0, y0);
      this.view.cursor = { x: x0, y: y0, size: ZSIZE[tool.zone], ok: chk.ok };
      this.cursorInfo = { cost: chk.ok ? chk.cost : tool.cost, err: chk.ok ? null : chk.err };
    } else {
      this.view.cursor = { x: tx, y: ty, size: 1 };
      this.cursorInfo = { cost: tool.cost, err: null, x: tx, y: ty };
    }
  },

  /** Kleiner Hinweis am Mauszeiger/Finger: Werkzeug, Kosten, Summe beim Ziehen, Fehler. */
  showTip(sx, sy, touch, d) {
    const tip = document.getElementById('cursortip');
    if (!tip) return;
    const tool = TOOLS.find(t => t.id === this.tool);
    if (!tool || tool.id === 'pan' || (tool.id === 'query' && !touch)) { this.hideTip(); return; }
    clearTimeout(this.tipTimer);
    const info = this.cursorInfo || { cost: tool.cost };
    let html = `<b>${tool.name}</b>`;
    if (tool.cost) html += ' ' + fmtMoney(info.cost || tool.cost);
    if (d && d.spent && tool.line) html += `<br>Summe: ${fmtMoney(d.spent)}`;
    const err = (d && d.err) || info.err;
    if (err) html += `<br><span class="bad">${err}</span>`;
    else if (tool.cost && this.city.funds < (info.cost || tool.cost)) html += '<br><span class="bad">Nicht genug Geld!</span>';
    tip.innerHTML = html;
    tip.style.display = 'block';
    const wrap = tip.parentElement.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = sx + 16, y = sy + 18;
    if (touch) { x = sx - tw / 2; y = sy - th - 56; }   // über dem Finger
    if (x + tw > wrap.width - 2) x = sx - tw - 10;
    if (y + th > wrap.height - 2) y = sy - th - 10;
    if (y < 2) y = sy + 40;
    tip.style.left = Math.max(2, x) + 'px';
    tip.style.top = Math.max(2, y) + 'px';
  },
  hideTip() { const tip = document.getElementById('cursortip'); if (tip) tip.style.display = 'none'; },

  bindKeys() {
    window.addEventListener('keydown', e => {
      const tg = e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') {
        if (e.key === 'Escape') this.closeTopWindow();
        return;
      }
      const k = e.key;
      if (!k || (k.length > 1 && !/^(Arrow\w+|Escape|F1)$/.test(k))) return;   // Umschalt, Strg … ignorieren
      if (document.getElementById('start-bg')) return;   // Startbildschirm: keine Spieltasten
      // Cheat: FUND
      this.cheatBuf = (this.cheatBuf + k.toUpperCase()).slice(-4);
      if (this.cheatBuf === 'FUND' && !this.guard('cheat')) {
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
        case '+': case '=': v.zoomBy(1.25); return;
        case '-': v.zoomBy(0.8); return;
        case ' ': e.preventDefault(); this.setSpeed(this.city.speed === 0 ? (this.lastSpeed || 2) : (this.lastSpeed = this.city.speed, 0)); return;
        case 'Escape': this.closeTopWindow(); return;
        case 'M': case 'm': this.toggleWin('map', () => this.openMap()); return;
        case 'K': case 'k': if (this.toggleMinimap) this.toggleMinimap(); return;
        case 'G': case 'g': this.toggleWin('graphs', () => this.openGraphs()); return;
        case 'B': this.toggleWin('budget', () => this.openBudget(false)); return;
        case 'E': case 'e': this.toggleWin('eval', () => this.openEvaluation()); return;
        case 'N': case 'n': this.toggleWin('log', () => this.openLog()); return;
        case 'F1': case '?': e.preventDefault(); this.toggleWin('about', () => this.about()); return;
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
    el.title = text + (this.lastMsg && this.lastMsg.text === text && this.lastMsg.x !== undefined
      ? '\n(Klicken, um zum Ort zu springen)' : '\n(Klicken für alle Meldungen)');
    el.classList.toggle('alert', !!alert);
  },

  /** Nachfrage (R/C/I) als Text: [Stufe, Pfeil] */
  demandText(v, max) {
    const f = v / max;
    if (f > 0.5) return ['sehr hoch', '▲▲'];
    if (f > 0.1) return ['hoch', '▲'];
    if (f >= -0.1) return ['ausgeglichen', '•'];
    if (f >= -0.5) return ['gering', '▼'];
    return ['sehr gering', '▼▼'];
  },

  demandInfo() {
    const c = this.city;
    const rows = [['Wohngebiete', c.resValve, 2000, c.resCap, '#30d030'], ['Gewerbegebiete', c.comValve, 1500, c.comCap, '#4080ff'],
      ['Industriegebiete', c.indValve, 1500, c.indCap, '#c0a000']];
    const html = `<div style="width:min(280px, calc(100vw - 40px))"><div class="grid2 sunken">${rows.map(([n, v, m, cap, col]) =>
      `<span><b style="color:${col}">■</b> ${n}</span><span class="r">${this.demandText(v, m)[0]}</span>` +
      (cap ? `<span class="note" style="grid-column:span 2">${{ Wohngebiete: 'Bremse: Stadion fehlt', Gewerbegebiete: 'Bremse: Flughafen fehlt', Industriegebiete: 'Bremse: Seehafen fehlt' }[n]}</span>` : '')).join('')}</div>
      <p class="note">Die Nachfrage-Anzeige (R/C/I) zeigt, welche Zonen die Stadt gerade braucht. Hohe Nachfrage = neue Zonen dieses Typs wachsen schnell.</p></div>`;
    this.closeWin('demand');
    this.dialog('demand', 'Nachfrage', html, [['OK', null, true]], { modal: false });
  },

  updateDemand() {
    const c = this.city;
    const el = document.getElementById('st-rci');
    const parts = [['R', c.resValve, 2000, 'Wohnen', c.resCap && 'Stadion fehlt'], ['C', c.comValve, 1500, 'Gewerbe', c.comCap && 'Flughafen fehlt'],
      ['I', c.indValve, 1500, 'Industrie', c.indCap && 'Seehafen fehlt']];
    const key = parts.map(p => this.demandText(p[1], p[2])[1] + (p[4] ? '!' : '')).join('|');
    if (key === this._demandKey) return;
    this._demandKey = key;
    el.innerHTML = parts.map(([l, v, m]) => {
      const [, arrow] = this.demandText(v, m);
      return `<span class="d-${l} ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${l}${arrow}</span>`;
    }).join(' ');
    const tip = 'Nachfrage:\n' + parts.map(([, v, m, n, cap]) => `${n}: ${this.demandText(v, m)[0]}${cap ? ' (' + cap + ')' : ''}`).join('\n');
    el.title = tip + '\n(Klicken für Details)';
    const rc = document.getElementById('rci');
    if (rc) rc.title = tip;
  },

  updateStatus() {
    const c = this.city;
    document.getElementById('st-name').textContent = c.name;
    document.getElementById('st-date').textContent = (typeof Seasons !== 'undefined' && Seasons.enabled ? Seasons.icon(c.month) + ' ' : '') + c.dateString();
    document.getElementById('st-date').title = typeof Seasons !== 'undefined' ? Seasons.name(c.month) : '';
    const f = document.getElementById('st-funds');
    f.textContent = fmtMoney(c.funds);
    f.classList.toggle('neg', c.funds < 0);
    document.getElementById('st-pop').textContent = 'Einw.: ' + fmtNum(c.population());
    document.getElementById('st-speed').textContent = this.modal > 0 ? 'Angehalten' : SPEED_NAMES[c.speed];
    document.getElementById('menutitle').textContent = c.name + ' – ' + CLASS_NAMES[c.cityClass];
    this.updateDemand();
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
    // Position (auf kleinen Bildschirmen begrenzen CSS max-width/max-height die Größe)
    const app = document.getElementById('app').getBoundingClientRect();
    const r = w.getBoundingClientRect();
    let x = opts.x !== undefined ? opts.x : (app.width - r.width) / 2;
    let y = opts.y !== undefined ? opts.y : (app.height - r.height) / 2;
    if (opts.right) x = app.width - r.width - 8;
    if (app.width < 640 && opts.x !== undefined && !opts.right) x = (app.width - r.width) / 2;
    w.style.left = x + 'px'; w.style.top = y + 'px';
    this.fitWindow(w);
    // Ziehen (Maus und Touch)
    let d = null;
    tb.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('wclose')) return;
      d = { x: e.clientX, y: e.clientY, l: w.offsetLeft, t: w.offsetTop };
      try { tb.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    });
    tb.addEventListener('pointermove', e => {
      if (!d) return;
      const a = document.getElementById('app').getBoundingClientRect();
      w.style.left = clamp(d.l + e.clientX - d.x, -w.offsetWidth + 60, a.width - 40) + 'px';
      w.style.top = clamp(d.t + e.clientY - d.y, 24, a.height - 30) + 'px';
    });
    const stop = () => { d = null; };
    tb.addEventListener('pointerup', stop);
    tb.addEventListener('pointercancel', stop);
    w.addEventListener('pointerdown', () => this.focusWin(w));
    w.dataset.id = id;
    w.onClose = opts.onClose;
    if (opts.modal) { this.modal++; w.modal = true; }
    this.wins[id] = w;
    this.focusWin(w);
    this.updateStatus();
    return w;
  },

  /** Fenster vollständig in den sichtbaren Bereich schieben. */
  fitWindow(w) {
    const app = document.getElementById('app').getBoundingClientRect();
    const x = clamp(w.offsetLeft, 0, Math.max(0, app.width - w.offsetWidth));
    const y = clamp(w.offsetTop, 24, Math.max(24, app.height - w.offsetHeight));
    w.style.left = x + 'px'; w.style.top = y + 'px';
  },
  fitWindows() { document.querySelectorAll('#windows .win').forEach(w => this.fitWindow(w)); },

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

  /** Ersatz für alert() (in Sandbox-iframes blockiert). */
  alert(title, html, fn) {
    this.closeWin('alert');
    return this.dialog('alert', title, `<div style="max-width:min(340px, calc(100vw - 40px))">${html}</div>`, [['OK', fn, true]]);
  },

  /** Ersatz für confirm(). */
  confirm(title, html, yesLabel, fn) {
    this.closeWin('confirm');
    return this.dialog('confirm', title, `<div style="max-width:min(340px, calc(100vw - 40px))">${html}</div>`,
      [[yesLabel || 'OK', fn, true], ['Abbrechen', null]]);
  },

  /** Ersatz für prompt(): fn(text) wird nur bei OK mit nicht-leerem Text aufgerufen. */
  ask(title, label, value, fn, maxLen) {
    const id = 'ask';
    this.closeWin(id);
    const body = document.createElement('div');
    body.innerHTML = `<div class="col" style="width:min(280px, calc(100vw - 40px))"><label for="ask-in">${label}</label>
      <input id="ask-in" class="field" maxlength="${maxLen || 40}"></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn def" data-b="ok">OK</button><button class="btn" data-b="no">Abbrechen</button></div>`;
    const inp = body.querySelector('input');
    inp.value = value || '';
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } this.closeWin(id); fn(v); };
    body.querySelector('[data-b=ok]').addEventListener('click', ok);
    body.querySelector('[data-b=no]').addEventListener('click', () => this.closeWin(id));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    this.win(id, title, body, { modal: true });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  },

  // =================== Meldungsverlauf ===================
  logMessage(d) {
    this.msgLog.unshift({ text: d.text, x: d.x, y: d.y, important: !!d.important, date: this.city.dateString() });
    if (this.msgLog.length > 100) this.msgLog.length = 100;
    if (this.wins.log) this.fillLog();
  },

  openLog() {
    const body = document.createElement('div');
    body.style.width = 'min(360px, calc(100vw - 24px))';
    body.innerHTML = '<div class="loglist sunken" id="log-list"></div><div class="row" style="justify-content:space-between"><span class="note">Klick auf eine Meldung springt zum Ort.</span><button class="btn small" id="log-clear">Leeren</button></div>';
    body.querySelector('#log-clear').addEventListener('click', () => { this.msgLog = []; this.fillLog(); });
    this.win('log', 'Meldungen', body, { right: true, y: 30 });
    this.fillLog();
  },

  fillLog() {
    const list = document.getElementById('log-list');
    if (!list) return;
    list.innerHTML = '';
    if (!this.msgLog.length) { list.innerHTML = '<i>Noch keine Meldungen.</i>'; return; }
    for (const m of this.msgLog) {
      const row = document.createElement('div');
      row.className = 'logrow' + (m.important ? ' imp' : '') + (m.x !== undefined ? ' go' : '');
      row.innerHTML = `<span class="ld">${m.date}</span><span class="lt"></span>${m.x !== undefined ? '<span class="lg" title="Gehe zu">➜</span>' : ''}`;
      row.querySelector('.lt').textContent = m.text;
      if (m.x !== undefined) {
        row.title = 'Klicken, um zum Ort zu springen';
        row.addEventListener('click', () => this.view.centerOn(m.x, m.y));
      }
      list.appendChild(row);
    }
  },

  // =================== Übersichtskarte ===================
  openMap() {
    const body = document.createElement('div');
    body.className = 'mapwin';
    const groups = [...new Set(MAP_MODES.map(m => m[2]))];
    body.innerHTML = `
      <div class="row maptop">
        <button class="btn small" id="map-prev" title="Vorherige Ansicht">‹</button>
        <select id="map-mode" title="Kartenansicht">${groups.map(g => `<optgroup label="${g}">${MAP_MODES.filter(m => m[2] === g)
          .map(m => `<option value="${m[0]}">${m[1]}</option>`).join('')}</optgroup>`).join('')}</select>
        <button class="btn small" id="map-next" title="Nächste Ansicht">›</button>
        <label class="note" style="margin-left:auto"><input type="checkbox" id="map-onmain"> im Stadtfenster</label>
      </div>`;
    const cv = mkCanvas(W * MAP_SCALE, H * MAP_SCALE);
    cv.className = 'sunken minimap mapcv';
    cv.title = 'Klicken oder ziehen, um den Ausschnitt zu verschieben';
    body.appendChild(cv);
    const legend = document.createElement('div');
    legend.className = 'maplegend'; legend.id = 'map-legend';
    body.appendChild(legend);
    const sel = body.querySelector('#map-mode');
    sel.value = this.mapMode;
    const setMode = m => {
      this.mapMode = m;
      sel.value = m;
      this.view.overlay = this.mapOnMain && this.isOverlayMode(m) ? m : null;
      this.drawMapWin(true);
    };
    sel.addEventListener('change', () => setMode(sel.value));
    const step = d => {
      const i = MAP_MODES.findIndex(m => m[0] === this.mapMode);
      setMode(MAP_MODES[(i + d + MAP_MODES.length) % MAP_MODES.length][0]);
    };
    body.querySelector('#map-prev').addEventListener('click', () => step(-1));
    body.querySelector('#map-next').addEventListener('click', () => step(1));
    const chk = body.querySelector('#map-onmain');
    chk.checked = this.mapOnMain;
    chk.addEventListener('change', () => { this.mapOnMain = chk.checked; this.view.overlay = chk.checked && this.isOverlayMode(this.mapMode) ? this.mapMode : null; });
    let dragging = false;
    const go = e => {
      const r = cv.getBoundingClientRect();
      this.view.camX = (e.clientX - r.left) / r.width * W;
      this.view.camY = (e.clientY - r.top) / r.height * H;
      this.view.clampCam();
    };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      dragging = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      go(e);
    });
    cv.addEventListener('pointermove', e => { if (dragging) go(e); });
    cv.addEventListener('pointerup', () => { dragging = false; });
    cv.addEventListener('pointercancel', () => { dragging = false; });
    this.mapCanvas = cv;
    this.mapImg = mkCanvas(W * MAP_SCALE, H * MAP_SCALE);
    this.injectMapCSS();
    this.win('map', 'Übersichtskarte', body, { x: 112, y: 30, onClose: () => { this.mapCanvas = null; this.view.overlay = null; } });
    this.drawMapWin(true);
  },

  injectMapCSS() {
    if (document.getElementById('map-css')) return;
    const st = document.createElement('style');
    st.id = 'map-css';
    st.textContent = `
      .mapwin { width: min(480px, calc(100vw - 36px)); display: flex; flex-direction: column; gap: 6px; }
      .mapwin .maptop { gap: 4px; flex-wrap: wrap; margin: 0; }
      .mapwin select { font: inherit; padding: 2px; min-width: 0; flex: 1 1 150px; max-width: 220px; }
      .mapwin .mapcv { width: 100%; height: auto; aspect-ratio: ${W} / ${H}; padding: 0; cursor: pointer; display: block; }
      .maplegend { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 12px; min-height: 18px; }
      .maplegend .sw { display: inline-block; width: 12px; height: 12px; border: 1px solid #000; vertical-align: -2px; margin-right: 4px; }
      .maplegend .stat { flex-basis: 100%; color: #000080; }
      .maplegend .grad { display: inline-block; width: 90px; height: 10px; border: 1px solid #000; vertical-align: -1px; margin: 0 4px; }`;
    document.head.appendChild(st);
  },

  isOverlayMode(m) { return ['popdens', 'growth', 'traffic', 'pollution', 'crime', 'landvalue', 'fire', 'police'].includes(m); },

  drawMapWin(force) {
    if (!this.mapCanvas) return;
    const c = this.city;
    const now = performance.now();
    const age = now - (this.mapDrawnAt || 0);
    const k = MAP_SCALE;
    if (force || (this.mapVersionDrawn !== c.mapVersion && age > 400) || (this.mapMode !== 'all' && age > 1000)) {
      MapRender.draw(this.mapImg.getContext('2d'), c, this.mapMode, k);
      this.mapVersionDrawn = c.mapVersion;
      this.mapDrawnAt = now;
      this.updateMapLegend();
    }
    const g = this.mapCanvas.getContext('2d');
    g.drawImage(this.mapImg, 0, 0);
    // Sichtbereich: gelber Rahmen mit schwarzer Kontur
    const v = this.view;
    const vw = v.canvas.width / v.ts, vh = v.canvas.height / v.ts;
    const rx = Math.round((v.camX - vw / 2) * k), ry = Math.round((v.camY - vh / 2) * k);
    const rw = Math.round(vw * k), rh = Math.round(vh * k);
    g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    g.lineWidth = 1.5; g.strokeStyle = '#ffff40'; g.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  },

  updateMapLegend() {
    const lg = document.getElementById('map-legend');
    if (!lg) return;
    const c = this.city, s = c.stats;
    const sw = (col, text) => `<span><span class="sw" style="background:${col}"></span>${text}</span>`;
    const heat = (lo, hi) => `<span>${lo}<span class="grad" style="background:linear-gradient(90deg,#ffff60,#ff8020,#ff1a0a)"></span>${hi}</span>`;
    let html = '';
    switch (this.mapMode) {
      case 'all': case 'res': case 'com': case 'ind':
        html = sw('#30c030', 'Wohnen') + sw('#3070f0', 'Gewerbe') + sw('#e8d020', 'Industrie') + sw('#383838', 'Straße') +
          sw('#6a4a2a', 'Schiene') + sw('#5ab845', 'Park') + sw('#2d5fcf', 'Wasser') + '<span class="note">helle Farbe = unbebaut</span>';
        break;
      case 'power': {
        html = sw('#ffd020', 'versorgt') + sw('#e02020', 'ohne Strom') + sw('#ffffff', 'Kraftwerk') + sw('#ffe880', 'Leitung');
        html += `<span class="stat">Kraftwerke: ${fmtNum(c.powerUsed)} von ${fmtNum(c.powerCapacity)} Feldern versorgt${c.brownout ? ' – <b style="color:#c00">überlastet!</b>' : ''}</span>`;
        break;
      }
      case 'transport':
        html = sw('#d0d0d0', 'Straße frei') + sw('#ffb040', 'dichter Verkehr') + sw('#ff4040', 'Stau') + sw('#a07040', 'Schiene');
        html += `<span class="stat">Verkehrsindex: ${c.getTrafficAverage()} (ab 60 meldet der Berater Staus)</span>`;
        break;
      case 'rail': {
        const zones = s.resZonePop + s.comZonePop + s.indZonePop;
        const ok = !(zones > 50 && zones > s.railTotal);
        html = sw('#ffb030', 'Schiene') + sw('#4a5a4a', `Zone mit Bahnanschluss (≤ ${RAIL_NEAR} Felder)`) + sw('#a03030', 'Zone ohne Bahnanschluss') + sw('#5a5a5a', 'Straße');
        html += `<span class="stat">Schienenfelder: ${fmtNum(s.railTotal)} · Zonen: ${fmtNum(zones)} – ${ok
          ? 'Schienennetz ausreichend'
          : `<b style="color:#c00">zu klein</b>: der Berater meldet „Unzureichendes Schienennetz“, solange es weniger Schienenfelder als Zonen gibt (noch ${fmtNum(zones - s.railTotal)} Felder)`}</span>`;
        break;
      }
      case 'growth': html = sw('#28c850', 'Wachstum') + sw('#e62828', 'Rückgang'); break;
      case 'landvalue': html = sw('#50ff78', 'hoch') + sw('#b47850', 'niedrig') + `<span class="stat">Durchschnitt: ${c.landValueAverage}</span>`; break;
      case 'fire': html = sw('#ff4020', 'gut abgedeckt') + '<span class="note">kräftiger = besser</span>'; break;
      case 'police': html = sw('#3060ff', 'gut abgedeckt') + '<span class="note">kräftiger = besser</span>'; break;
      case 'pollution': html = heat('niedrig', 'hoch') + `<span class="stat">Durchschnitt: ${c.pollutionAverage} (ab 60 gilt sie als sehr hoch)</span>`; break;
      case 'crime': html = heat('niedrig', 'hoch') + `<span class="stat">Durchschnitt: ${c.crimeAverage} (ab 100 gilt sie als sehr hoch)</span>`; break;
      default: html = heat('niedrig', 'hoch');
    }
    lg.innerHTML = html;
  },

  // =================== Grafiken ===================
  openGraphs() {
    const body = document.createElement('div');
    const cv = mkCanvas(380, 200);
    cv.className = 'sunken scalable'; cv.style.padding = '0'; cv.style.background = '#000';
    body.style.maxWidth = '388px';
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
    if (!yearEnd && this.guard('budget')) return;
    if (!yearEnd) c.computeBudgetRequests();
    const body = document.createElement('div');
    body.style.width = 'min(400px, calc(100vw - 24px))';
    body.innerHTML = `
      ${yearEnd ? '<div class="news"><b>Haushaltsabschluss ' + (c.year - 1) + '</b><br>Lege Steuersatz und Mittel für das kommende Jahr fest.</div>' : ''}
      <h3>Steuern</h3>
      <div class="row"><span style="width:110px">Steuersatz:</span><input type="range" id="b-tax" min="0" max="20" step="1"><b id="b-taxv"></b></div>
      <div class="row"><span style="width:110px">Steuerertrag:</span><select id="b-boost">
        <option value="1">wie 1989 (Original)</option><option value="3">erhöht (×3)</option><option value="5">hoch (×5)</option></select></div>
      <div class="grid2" style="margin-left:4px">
        <span id="b-taxlabel"></span><span class="r" id="b-taxfund"></span>
        <span>Monatlich in die Kasse:</span><span class="r" id="b-taxmonth"></span>
      </div>
      <h3>Ausgaben</h3>
      <div class="sunken" style="background:#d8d8d8">
      <div class="row" style="font-weight:bold"><span style="width:96px"></span><span style="width:80px;text-align:right">angefordert</span><span style="width:120px;text-align:center">Anteil</span><span style="width:70px;text-align:right">bewilligt</span></div>
      ${['road:Verkehr', 'fire:Feuerwehr', 'police:Polizei'].map(s => { const [k, n] = s.split(':'); return `
      <div class="row"><span style="width:96px">${n}</span><span style="width:80px;text-align:right" id="b-${k}req"></span>
      <input type="range" id="b-${k}" min="0" max="100" step="1" style="width:90px"><b id="b-${k}p" style="width:30px"></b><span style="width:70px;text-align:right" id="b-${k}sp"></span></div>`; }).join('')}
      </div>
      <h3>Kredite</h3>
      <div class="grid2" style="margin-left:4px">
        <span>Offene Kredite:</span><span class="r" id="b-loans"></span>
        <span>Zinsen pro Jahr:</span><span class="r" id="b-interest"></span>
      </div>
      <div class="row"><button class="btn small" id="b-loan">Kredit aufnehmen (${fmtMoney(LOAN_AMOUNT)})</button><button class="btn small" id="b-repay">Kredit tilgen</button></div>
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
      c.taxBoost = +$('#b-boost').value;
      // Am Jahresende zählen die tatsächlich eingenommenen Steuern, sonst die Prognose
      const projected = c.calcTaxFund();
      if (!yearEnd) c.taxFund = projected;
      const plan = c.budgetPlan();
      $('#b-taxv').textContent = c.cityTax + ' %';
      $('#b-taxlabel').textContent = yearEnd ? 'Steuereinnahmen (Vorjahr):' : 'Steuereinnahmen (Jahr, Prognose):';
      $('#b-taxfund').textContent = fmtMoney(c.taxFund);
      $('#b-taxmonth').textContent = fmtMoney(Math.floor(projected / 12));
      $('#b-loans').textContent = c.loans.length + ' × ' + fmtMoney(LOAN_AMOUNT) + ' = ' + fmtMoney(c.loanTotal());
      $('#b-interest').textContent = fmtMoney(c.loanInterest()) + (c.loans.length ? '' : ` (Zins ${Math.round(c.loanRate() * 100)} %)`);
      $('#b-repay').disabled = !c.loans.length;
      $('#b-loan').disabled = c.loans.length >= LOAN_MAX;
      for (const k of ['road', 'fire', 'police']) {
        $('#b-' + k + 'req').textContent = fmtMoney(c[k + 'Fund']);
        $('#b-' + k + 'p').textContent = Math.round(c[k + 'Pct'] * 100) + '%';
        $('#b-' + k + 'sp').textContent = fmtMoney(plan.spend[k]);
      }
      const flow = (yearEnd ? c.taxFund : projected) - plan.total;
      $('#b-prev').textContent = fmtMoney(yearEnd ? c.prevFunds : c.funds);
      $('#b-flow').textContent = (flow >= 0 ? '+' : '') + fmtMoney(flow) + (yearEnd ? '' : ' / Jahr');
      $('#b-flow').style.color = flow >= 0 ? '#006000' : '#a00000';
      $('#b-cur').textContent = fmtMoney(c.funds - (yearEnd ? plan.total : 0));
      if (!yearEnd) c.updateFundEffects(plan.spend);
    };
    $('#b-tax').value = c.cityTax;
    $('#b-road').value = Math.round(c.roadPct * 100);
    $('#b-fire').value = Math.round(c.firePct * 100);
    $('#b-police').value = Math.round(c.policePct * 100);
    $('#b-auto').checked = c.autoBudget;
    $('#b-boost').value = String(c.taxBoost || 1);
    $('#b-boost').addEventListener('change', upd);
    $('#b-loan').addEventListener('click', () => {
      const r = c.takeLoan();
      if (!r.ok) this.status(r.err, true); else { Sound.cash(); this.status(`Kredit über ${fmtMoney(LOAN_AMOUNT)} aufgenommen.`); }
      upd();
    });
    $('#b-repay').addEventListener('click', () => {
      const r = c.repayLoan();
      if (!r.ok) this.status(r.err, true); else this.status('Kredit getilgt.');
      upd();
    });
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
    body.style.width = 'min(420px, calc(100vw - 24px))';
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
      <div class="row wrap" style="align-items:stretch;gap:8px 14px">
        <div class="sunken" style="flex:1 1 170px">
          <h3 style="margin-top:0">Öffentliche Meinung</h3>
          Macht der Bürgermeister einen guten Job?
          <div class="row"><span style="width:50px">Ja</span><b>${c.cityYes} %</b></div>
          <div class="row"><span style="width:50px">Nein</span><b>${100 - c.cityYes} %</b></div>
          <h3>Die größten Probleme</h3>${probs}
        </div>
        <div class="sunken" style="flex:1.2 1 190px">
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
      const rl = roadLevel(c, i);
      if (rl) name = k === T.ROADBRIDGE ? ROAD_LEVEL_NAMES[rl] + 'nbrücke' : ROAD_LEVEL_NAMES[rl];
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
    // Wachstums-Check: warum wächst die Zone (nicht)?
    let growth = '';
    if (z && (z.type === Z.RES || z.type === Z.COM || z.type === Z.IND)) {
      const info = c.zoneGrowthInfo(z);
      growth = `<div style="margin-top:6px;font-weight:bold">Wachstums-Check</div><div class="sunken" style="font-size:11px">` +
        info.map(r => `<div style="display:flex;gap:4px"><b style="color:${r.ok ? '#007000' : '#c00000'}">${r.ok ? '✓' : '✗'}</b><span>${r.text}</span></div>`).join('') +
        `</div>`;
    }
    const t = c.trafficDensity[h];
    this.closeWin('query');
    this.dialog('query', 'Abfrage', `
      <div style="width:min(${growth ? 320 : 250}px, calc(100vw - 40px))">
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
        ${growth}
        <div class="note center">Feld ${x}, ${y}</div>
      </div>`, [['OK', null, true]], { modal: false });
  },

  // =================== Ereignisse aus der Simulation ===================
  onCityEvent(type, d) {
    const c = this.city;
    switch (type) {
      case 'message': {
        this.lastMsg = d;
        this.logMessage(d);
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
        this.logMessage({ text: d.text, important: true });
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
    if (this.guard('newcity')) return;
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
          ${this.startButtons.map((b, i) => (!b.show || b.show()) ? `<button class="btn" data-ext="${i}">${b.label}</button>` : '').join('')}
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
    box.querySelectorAll('[data-ext]').forEach(b => b.addEventListener('click', () => {
      close();
      this.startButtons[+b.dataset.ext].fn();
    }));
  },

  newCityDialog() {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="row wrap" style="align-items:flex-start;gap:12px">
        <div class="col">
          <canvas id="nc-map" width="${W * 2}" height="${H * 2}" class="sunken" style="padding:0"></canvas>
          <button class="btn" id="nc-gen">Neue Landschaft erzeugen</button>
        </div>
        <div class="col" style="width:200px">
          <h3 style="margin-top:0">Stadtname</h3>
          <input id="nc-name" class="field" value="Neustadt" maxlength="24">
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
    if (this.guard('load')) return;
    const body = document.createElement('div');
    body.style.width = 'min(460px, calc(100vw - 24px))';
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
    this.msgLog = [];
    this.fillLog();
    this.lastMsg = null;
    this.updateStatus();
    this.fillEvaluation();
    this.drawGraphs();
    this.drawMapWin(true);
  },

  // =================== Speichern / Laden ===================
  /* Spielstände liegen im localStorage. Ist er nicht verfügbar (z. B. in einem Sandbox-iframe),
   * bleibt der Export als Datei bzw. als Text zum Kopieren. */
  savesIndex() {
    try { return JSON.parse(this.lsGet('simcity89-index') || '[]') || []; } catch (e) { return []; }
  },

  noStorageHint() {
    return '<p>Speichern im Browser ist hier leider nicht möglich (der Browser bzw. die einbettende Seite erlaubt keinen lokalen Speicher).</p><p>Du kannst die Stadt stattdessen <b>als Datei exportieren</b> und später wieder importieren.</p>';
  },

  saveCity(ask) {
    const c = this.city;
    if (!this.storageOK()) {
      this.dialog('nosave', 'Speichern nicht möglich', `<div style="max-width:min(340px, calc(100vw - 40px))">${this.noStorageHint()}</div>`,
        [['Exportieren…', () => this.exportFile(), true], ['Abbrechen', null]]);
      return;
    }
    const name = c.saveName || c.name;
    if (ask || !c.saveName) this.ask('Speichern unter', 'Name des Spielstands:', name, n => this.saveAs(n), 40);
    else this.saveAs(name);
  },

  saveAs(name) {
    const c = this.city;
    try {
      const data = JSON.stringify(c.serialize());
      this.lsSet('simcity89-save-' + name, data);
      const idxs = this.savesIndex().filter(s => s.name !== name);
      idxs.unshift({ name, city: c.name, date: c.dateString(), pop: c.population(), saved: new Date().toLocaleString('de-DE') });
      this.lsSet('simcity89-index', JSON.stringify(idxs));
      c.saveName = name;
      this.status(`Spielstand „${name}“ gespeichert.`);
    } catch (e) {
      this.dialog('nosave', 'Speichern fehlgeschlagen', `<div style="max-width:min(340px, calc(100vw - 40px))"><p>${esc(e.message || String(e))}</p><p>Tipp: Exportiere die Stadt als Datei.</p></div>`,
        [['Exportieren…', () => this.exportFile(), true], ['Abbrechen', null]]);
    }
  },

  loadDialog(fromStart) {
    if (this.guard('load')) return;
    const ok = this.storageOK();
    const saves = ok ? this.savesIndex() : [];
    const body = document.createElement('div');
    body.style.width = 'min(420px, calc(100vw - 24px))';
    body.innerHTML = `<div class="saves sunken">${!ok ? this.noStorageHint() : saves.length ? saves.map((s, i) => `
      <div class="row"><span><b>${esc(s.name)}</b><br><span class="note">${esc(s.city)} · ${esc(s.date)} · ${fmtNum(s.pop)} Einw. · gespeichert ${esc(s.saved)}</span></span>
      <span style="white-space:nowrap"><button class="btn small" data-load="${i}">Laden</button><button class="btn small" data-del="${i}">Löschen</button></span></div>`).join('') : '<i>Keine gespeicherten Städte im Browser.</i>'}</div>
      <div class="row wrap" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="ld-file">Aus Datei…</button><button class="btn" id="ld-text">Aus Text…</button><button class="btn" id="ld-back">Abbrechen</button></div>`;
    const back = () => { this.closeWin('load'); if (fromStart && !this.hasRunningCity) this.startScreen(); };
    body.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
      const s = saves[+b.dataset.load];
      try {
        const raw = this.lsGet('simcity89-save-' + s.name);
        if (!raw) throw new Error('Spielstand nicht gefunden.');
        this.loadObject(JSON.parse(raw));
        this.city.saveName = s.name;
        this.closeWin('load');
      } catch (e) { this.alert('Laden fehlgeschlagen', esc(e.message || String(e))); }
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const s = saves[+b.dataset.del];
      this.confirm('Löschen', `Spielstand „${esc(s.name)}“ wirklich löschen?`, 'Löschen', () => {
        this.lsDel('simcity89-save-' + s.name);
        try { this.lsSet('simcity89-index', JSON.stringify(saves.filter(x => x !== s))); } catch (e) { /* egal */ }
        this.closeWin('load'); this.loadDialog(fromStart);
      });
    }));
    body.querySelector('#ld-file').addEventListener('click', () => document.getElementById('fileinput').click());
    body.querySelector('#ld-text').addEventListener('click', () => { this.closeWin('load'); this.importTextDialog(fromStart); });
    body.querySelector('#ld-back').addEventListener('click', back);
    this.win('load', 'Stadt laden', body, { modal: true, onClose: null });
  },

  loadObject(o) {
    if (this.guard('load')) return;
    const c = this.city;
    const listeners = c.listeners;
    c.deserialize(o);
    if (!c.listeners || !c.listeners.length) c.listeners = listeners;
    c.fullAnalysis();
    this.afterLoad();
    this.status(`${c.name} geladen.`);
  },

  /** Nach dem Laden aus Datei/Text: Startbildschirm und Dialoge schließen. */
  closeAllForGame() {
    const bg = document.getElementById('start-bg');
    if (bg) bg.remove();
    for (const id in this.wins) this.closeWin(id);
    this.modal = 0;
    this.updateStatus();
  },

  exportFile() {
    const c = this.city;
    const json = JSON.stringify(c.serialize());
    const fname = (c.name || 'stadt').replace(/[^\wäöüÄÖÜß-]+/g, '_') + '.city.json';
    const download = () => {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        this.status(`Download „${fname}“ angefordert – falls nichts passiert, bitte den Text kopieren.`);
      } catch (e) { this.status('Download nicht möglich – bitte den Text kopieren.', true); }
    };
    // In iframes ist der Download oft gesperrt: dann den Text zum Kopieren anbieten.
    const body = document.createElement('div');
    body.style.width = 'min(400px, calc(100vw - 24px))';
    body.innerHTML = `<p>Speichere die Stadt als Datei <b>${esc(fname)}</b>. Falls der Download hier nicht funktioniert,
      kopiere den Text unten und füge ihn später unter <i>Stadt laden → Aus Text…</i> wieder ein.</p>
      <textarea class="field codebox" readonly></textarea>
      <div class="row wrap" style="justify-content:flex-end;margin-top:6px">
        <button class="btn def" data-b="dl">Datei herunterladen</button><button class="btn" data-b="copy">Text kopieren</button><button class="btn" data-b="close">Schließen</button></div>`;
    const ta = body.querySelector('textarea');
    ta.value = json;
    body.querySelector('[data-b=dl]').addEventListener('click', download);
    body.querySelector('[data-b=copy]').addEventListener('click', () => {
      ta.focus(); ta.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      if (!done && navigator.clipboard) {
        navigator.clipboard.writeText(json).then(() => this.status('Spielstand in die Zwischenablage kopiert.'),
          () => this.status('Kopieren nicht erlaubt – bitte Text markieren und manuell kopieren.', true));
      } else this.status(done ? 'Spielstand in die Zwischenablage kopiert.' : 'Bitte Text markieren und manuell kopieren.', !done);
    });
    body.querySelector('[data-b=close]').addEventListener('click', () => this.closeWin('export'));
    this.closeWin('export');
    this.win('export', 'Als Datei exportieren', body, { modal: true });
  },

  importTextDialog(fromStart) {
    const body = document.createElement('div');
    body.style.width = 'min(400px, calc(100vw - 24px))';
    body.innerHTML = `<p>Füge hier den exportierten Spielstand (Text) ein:</p><textarea class="field codebox"></textarea>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn def" data-b="ok">Laden</button><button class="btn" data-b="no">Abbrechen</button></div>`;
    const ta = body.querySelector('textarea');
    body.querySelector('[data-b=ok]').addEventListener('click', () => {
      try {
        const o = JSON.parse(ta.value.trim());
        this.loadObject(o);
        this.closeAllForGame();
      } catch (e) { this.status('Text ist kein gültiger Spielstand: ' + (e.message || e), true); Sound.error(); }
    });
    body.querySelector('[data-b=no]').addEventListener('click', () => { this.closeWin('importtext'); if (fromStart && !this.hasRunningCity) this.startScreen(); });
    this.win('importtext', 'Stadt aus Text laden', body, { modal: true });
    setTimeout(() => ta.focus(), 0);
  },

  importFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (this.guard('load')) { e.target.value = ''; return; }
    const r = new FileReader();
    r.onload = () => {
      try {
        this.loadObject(JSON.parse(r.result));
        this.closeAllForGame();
      } catch (err) { this.alert('Import fehlgeschlagen', 'Datei konnte nicht geladen werden: ' + esc(err.message || String(err))); }
    };
    r.onerror = () => this.alert('Import fehlgeschlagen', 'Datei konnte nicht gelesen werden.');
    r.readAsText(f);
    e.target.value = '';
  },

  renameCity() {
    if (this.guard('rename')) return;
    this.ask('Stadt umbenennen', 'Neuer Name der Stadt:', this.city.name, n => { this.city.name = n; this.updateStatus(); }, 24);
  },

  about() {
    this.dialog('about', 'Über SimCity', `<div style="max-width:min(400px, calc(100vw - 40px))">
      <div class="logo" style="font-size:32px">SimCity</div>
      <p>Ein originalgetreuer Nachbau des Stadtsimulators von 1989 – mit den Simulationsregeln des Originals
      (Zonenwachstum, Verkehr, Strom, Umwelt, Kriminalität, Bodenwert, Haushalt, Bewertung), allen Werkzeugen,
      Katastrophen und den acht klassischen Szenarien.</p>
      <h3>Maus</h3>
      <p class="note">Linksklick baut, Ziehen baut Linien (Straße, Schiene, Leitung, Park, Bulldozer).
      Rechts-/Mittelklick + Ziehen verschiebt die Karte, Mausrad zoomt, Klick in die Übersichtskarte springt dorthin.</p>
      <h3>Touch</h3>
      <p class="note">Tippen baut bzw. fragt ab, mit einem Finger ziehen baut Linien.
      Zwei Finger verschieben die Karte, Auseinander-/Zusammenziehen zoomt.</p>
      <h3>Tastatur</h3>
      <div class="grid2 note keys">
        <span>Pfeiltasten</span><span>Karte verschieben</span>
        <span>+ / −</span><span>Vergrößern / Verkleinern</span>
        <span>Leertaste</span><span>Pause an/aus</span>
        <span>Esc</span><span>Oberstes Fenster schließen</span>
        <span>M / G / E / N</span><span>Karte / Grafiken / Bewertung / Meldungen</span>
        <span>Umschalt+B</span><span>Haushalt</span>
        <span>Strg+S</span><span>Speichern</span>
        <span>F1</span><span>Diese Hilfe</span>
        <span>B Q R T L P H</span><span>Bulldozer, Abfrage, Straße, Schiene, Leitung, Park, Verschieben</span>
        <span>1 – 0</span><span>Wohnen, Gewerbe, Industrie, Polizei, Feuerwehr, Stadion, Hafen, Kohle-, Atomkraftwerk, Flughafen</span>
      </div>
      <p class="note">Alle Grafiken und Klänge werden im Programm erzeugt – es werden keine Original-Dateien verwendet.</p></div>`,
    [['OK', null, true]], { modal: false });
  },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function c2date(c) { return c.dateString(); }
