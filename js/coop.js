'use strict';
/*
 * Gemeinsame Stadt: Echtzeit-Multiplayer über die Firebase Realtime Database.
 *
 * Der Gastgeber simuliert wie gewohnt und ist maßgeblich. Mitspieler simulieren nicht
 * (city.remote = true), sondern übernehmen den Zustand des Gastgebers:
 *   – vollständiger Stand (snapshot) beim Beitreten, bei Lücken und alle 30 s,
 *   – dazwischen kleine Änderungspakete (diffs) etwa zweimal pro Sekunde.
 * Bauaufträge der Mitspieler gehen als „actions“ an den Gastgeber, der sie mit der
 * gemeinsamen Stadtkasse ausführt.
 *
 * Datenbank:
 *   roomList/{id}               {name, hostUid, hostName, private, players, pop, cityName, updatedAt, open}
 *   rooms/{id}/snapshot         {seq, ep, data (JSON-Text von city.serialize()), x (Zusatzwerte), t}
 *   rooms/{id}/diffs/{push}     {seq, ep, d (JSON-Text), t}
 *   rooms/{id}/actions/{push}   {uid, name, tool, cells (JSON-Text [[x,y],…]), t}
 *   rooms/{id}/presence/{uid}   {name, color, x, y, s, tool, t, host, ep, sync}
 *   rooms/{id}/chat/{push}      {uid, name, color, text, t}
 * ep („Epoche“) wechselt mit jeder Sitzung des Gastgebers; seq zählt die Pakete darin ab 0.
 */

const COOP_COLORS = ['#ff4040', '#3090ff', '#30c030', '#e040e0', '#ff9a20', '#10c8c8', '#a070ff', '#d0c000'];

// Einfache Werte des Stadtzustands, die übertragen werden (zusätzlich zu Feldern, Zonen, Karten)
const COOP_SCALARS = ['name', 'level', 'funds', 'startYear', 'cityTime', 'simCycle', 'cityTax', 'roadPct', 'firePct', 'policePct',
  'roadEffect', 'policeEffect', 'fireEffect', 'resValve', 'comValve', 'indValve', 'resCap', 'comCap', 'indCap',
  'cityScore', 'cityScoreDelta', 'cityPop', 'cityPopDelta', 'lastCityPop', 'cityClass', 'cityYes', 'cityAssessedValue',
  'problemTable', 'problemVotes', 'problemOrder', 'autoBulldoze', 'autoBudget', 'disastersEnabled', 'scenario',
  'nextZoneId', 'cashFlow', 'taxFund', 'roadFund', 'fireFund', 'policeFund', 'roadSpend', 'fireSpend', 'policeSpend',
  'prevFunds', 'taxBoost', 'loans', 'taxPaidYear', 'interestPaid', 'crimeRamp', 'pollutionRamp', 'cityCenterX', 'cityCenterY', 'stats', 'totalPop', 'speed',
  'powerCapacity', 'powerUsed', 'brownout', 'needHospital', 'needChurch',
  'landValueAverage', 'pollutionAverage', 'crimeAverage', 'trafficAverage',
  'pollutionMaxX', 'pollutionMaxY', 'crimeMaxX', 'crimeMaxY', 'trafficMaxX', 'trafficMaxY', 'shake', 'floodCnt'];

// Analysekarten (für Verkehr, Kartenansichten, Abfrage) – seltener übertragen
const COOP_MAPS = ['trafficDensity', 'pollution', 'landValue', 'crime', 'popDensity', 'terrainDensity', 'rateOfGrowth',
  'fireStMap', 'fireEffectMap', 'policeStMap', 'policeEffectMap', 'comRate'];

// Ereignisse der Simulation, die an Mitspieler weitergereicht werden
const COOP_EVENTS = ['message', 'milestone', 'explosion', 'earthquake', 'evaluation', 'scenarioEnd'];

const COOP_TOOLS = ['bulldozer', 'road', 'upgrade', 'loan', 'repay', 'rail', 'wire', 'park', 'res', 'com', 'ind', 'police', 'fire', 'stadium', 'port', 'coal', 'nuclear', 'airport'];

function coopB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function coopUnB64(s, target) {
  const bin = atob(s);
  const u8 = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
  for (let i = 0; i < u8.length && i < bin.length; i++) u8[i] = bin.charCodeAt(i);
}

const Coop = {
  DIFF_MS: 600,          // Abstand der Änderungspakete
  SNAP_MS: 30000,        // regelmäßiger Vollstand
  MAPS_MS: 4000,         // Analysekarten höchstens so oft
  KEEP_DIFFS: 40,        // so viele Pakete bleiben in der Datenbank
  FLUSH_MS: 150,         // Bauaufträge sammeln
  CURSOR_MS: 200,        // Mauszeiger höchstens 5× pro Sekunde senden

  city: null, view: null,
  role: null,            // null | 'host' | 'client'
  roomId: null,
  info: null,            // Eintrag aus roomList
  ep: null, seq: 0,
  subs: [],              // [ref, event, cb] zum Abmelden
  players: {},           // presence
  chat: [],
  unread: 0,

  init(city, view) {
    this.city = city; this.view = view;
    if (typeof Net === 'undefined' || !Net.available) return;   // offline: nichts zu tun
    this.injectCSS();

    this.menu = {
      lobby: ['Gemeinsame Stadt…', () => this.openLobby()],
      players: ['Mitspieler', () => this.openPlayers()],
      chat: ['Chat', () => this.toggleChat(), 'C'],
      leave: ['Raum verlassen', () => this.leaveAsk()],
    };
    UI.menuExt.Online = (UI.menuExt.Online || []).concat([this.menu.lobby, this.menu.players, this.menu.chat, this.menu.leave]);
    UI.startButtons.push({ label: 'Gemeinsam spielen (online)', fn: () => this.openLobby(true), show: () => Net.available });

    if (UI.actionGuards) UI.actionGuards.push(a => this.guard(a));
    UI.toolHooks.push((tool, x, y, drag) => this.toolHook(tool, x, y, drag));
    UI.tickHooks.push(now => this.tick(now));
    view.canvas.addEventListener('pointerup', () => this.flush());
    view.canvas.addEventListener('pointercancel', () => this.flush());
    const prevDraw = view.afterDraw;
    view.afterDraw = (ctx, offX, offY, ts, time) => {
      if (prevDraw) prevDraw(ctx, offX, offY, ts, time);
      if (this.role) this.draw(ctx, offX, offY, ts, time);
    };
    // Gastgeber: Ereignisse der Simulation für die Mitspieler sammeln
    city.on((t, d) => {
      if (this.role === 'host' && COOP_EVENTS.includes(t) && this.events.length < 60) this.events.push([t, d || {}]);
    });
    // Taste C: Chat (in ui.js nicht belegt)
    window.addEventListener('keydown', e => {
      const tg = e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.getElementById('start-bg')) return;
      if ((e.key === 'c' || e.key === 'C') && this.role) { e.preventDefault(); this.toggleChat(); }
    });
    Net.on((t, d) => {
      if (t === 'beforeSignOut' && this.role) this.leave(true);
      else if (t === 'connection' && this.role) {
        if (d.connected) {
          this.setPresence();
          if (this.role === 'host') this.updateRoomList(true);
          UI.status('Verbindung wiederhergestellt.');
        } else UI.status('Verbindung zum Server unterbrochen…', true);
        this.updateBadge();
      }
    });
    window.addEventListener('pagehide', () => { if (this.role === 'host') this.writeSnapshot(); });
    this.updateMenu();
  },

  injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
      #st-coop { cursor: pointer; }
      #st-coop.unread { font-weight: bold; color: #a00000; }
      .co-list { max-height: 260px; overflow-y: auto; min-width: 300px; padding: 0; background: #fff; }
      .co-list .co-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #c0c0c0; padding: 3px 4px; }
      .co-list .co-head { background: #c0c0c0; font-weight: bold; padding: 2px 4px; border-bottom: 1px solid #808080; }
      .co-sw { display: inline-block; width: 10px; height: 10px; border: 1px solid #000; margin-right: 4px; vertical-align: -1px; }
      .co-code { font: bold 20px "Courier New", monospace; letter-spacing: 3px; background: #fff; border: 2px inset #fff; padding: 2px 8px; user-select: all; -webkit-user-select: all; }
      .co-chat { height: 190px; overflow-y: auto; background: #fff; padding: 2px 4px; font-size: 12px; word-break: break-word; }
      .co-chat div { padding: 1px 0; }
      .co-chat .co-me { background: #eef; }
      .co-chat .co-t { color: #808080; font-size: 10px; margin-right: 4px; }
    `;
    document.head.appendChild(s);
  },

  // =================== Menü, Statusleiste ===================
  updateMenu() {
    if (!this.menu) return;
    this.menu.lobby[0] = this.role ? 'Gemeinsame Stadt: Raum ' + this.roomId : 'Gemeinsame Stadt…';
    this.menu.leave[0] = this.role === 'host' ? 'Raum schließen' : 'Raum verlassen';
  },

  updateBadge() {
    let el = document.getElementById('st-coop');
    if (!this.role) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('span');
      el.id = 'st-coop'; el.className = 'st';
      el.addEventListener('click', () => this.openPlayers());
      const on = document.getElementById('st-online');
      on.parentNode.insertBefore(el, on);
    }
    const n = Object.keys(this.players).length;
    el.textContent = `Raum ${this.roomId} · ${n} Spieler${this.role === 'client' && !this.hostOnline ? ' · Gastgeber offline' : ''}${this.unread ? ' · ' + this.unread + ' neue Nachricht' + (this.unread > 1 ? 'en' : '') : ''}`;
    el.classList.toggle('unread', this.unread > 0);
    el.title = (this.role === 'host' ? 'Du bist Gastgeber. ' : 'Gastgeber: ' + (this.info ? this.info.hostName : '?') + '. ') + 'Klicken für die Spielerliste, C für den Chat.';
  },

  colorFor(uid) {
    let h = 0;
    for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COOP_COLORS[h % COOP_COLORS.length];
  },

  // =================== Aktionen nur für den Gastgeber ===================
  guard(a) {
    if (!this.role) return false;
    if (a === 'newcity' || a === 'load') {
      UI.alert('Gemeinsame Stadt', `<p>Du bist im Raum <b>${esc(this.roomId)}</b>. Um eine andere Stadt zu laden oder zu gründen,
        ${this.role === 'host' ? 'schließe zuerst den Raum' : 'verlasse zuerst den Raum'} (Online → ${this.role === 'host' ? 'Raum schließen' : 'Raum verlassen'}).</p>`);
      return true;
    }
    if (this.role === 'host') return false;
    const host = this.info ? this.info.hostName : 'der Gastgeber';
    const hint = {
      speed: 'Das Tempo bestimmt nur der Gastgeber.',
      disaster: 'Katastrophen kann nur der Gastgeber auslösen.',
      rename: 'Nur der Gastgeber kann die Stadt umbenennen.',
    }[a];
    if (a === 'budget') { this.budgetInfo(host); return true; }
    if (hint) { UI.status(hint, true); Sound.error(); return true; }
    return a === 'cheat';
  },

  budgetInfo(host) {
    const c = this.city;
    UI.closeWin('co-budget');
    UI.dialog('co-budget', 'Haushalt (nur ansehen)', `<div style="width:min(300px, calc(100vw - 40px))">
      <div class="grid2 sunken">
        <span>Steuersatz:</span><span class="r">${c.cityTax} %</span>
        <span>Verkehr:</span><span class="r">${Math.round(c.roadPct * 100)} %</span>
        <span>Feuerwehr:</span><span class="r">${Math.round(c.firePct * 100)} %</span>
        <span>Polizei:</span><span class="r">${Math.round(c.policePct * 100)} %</span>
        <span>Steuerertrag:</span><span class="r">×${c.taxBoost || 1}</span>
        <span>Monatlich in die Kasse:</span><span class="r">${fmtMoney(Math.floor(c.calcTaxFund() / 12))}</span>
        <span>Kassenstand:</span><span class="r">${fmtMoney(c.funds)}</span>
        <span>Geldfluss (Vorjahr):</span><span class="r">${fmtMoney(c.cashFlow)}</span>
        <span>Offene Kredite:</span><span class="r">${(c.loans || []).length} × ${fmtMoney(LOAN_AMOUNT)}</span>
        <span>Zinsen pro Jahr:</span><span class="r">${fmtMoney(c.loanInterest())}</span>
      </div>
      <p class="note">Steuern und Haushalt legt nur der Gastgeber fest (<b>${esc(host)}</b>). Die Stadtkasse teilen sich alle Spieler –
      Kredite kann jeder für die gemeinsame Kasse aufnehmen.</p></div>`,
    [['Kredit tilgen', () => this.sendCommand('repay')], [`Kredit aufnehmen (${fmtMoney(LOAN_AMOUNT)})`, () => this.sendCommand('loan')], ['OK', null, true]], { modal: false });
  },

  /** Befehl ohne Kartenfeld (Kredit) an den Gastgeber schicken. */
  sendCommand(tool) {
    if (this.role !== 'client') return;
    this.flush();
    this.queue = { tool, cells: [[0, 0]], marks: [] };
    this.flush();
    UI.status(tool === 'loan' ? 'Kreditantrag an den Gastgeber geschickt…' : 'Tilgung an den Gastgeber geschickt…');
  },

  // =================== Lobby ===================
  openLobby(fromStart) {
    if (!Net.available) { Net.notConfigured(); if (fromStart && !UI.hasRunningCity) UI.startScreen(); return; }
    if (this.role) { this.openPlayers(); return; }
    if (!Net.user) {
      // wie Net.requireLogin, aber bei Abbruch vom Startbildschirm aus dorthin zurück
      const back = () => { if (fromStart && !UI.hasRunningCity) UI.startScreen(); };
      const off = t => {
        if (t === 'auth' && Net.user) { Net.listeners = Net.listeners.filter(f => f !== off); this.showLobby(fromStart); }
      };
      UI.dialog('login', 'Anmeldung erforderlich', '<p style="max-width:320px">Für gemeinsame Städte musst du mit deinem Google-Konto angemeldet sein.</p>', [
        ['Abbrechen', back],
        ['Mit Google anmelden', () => {
          Net.listeners.push(off);
          Promise.resolve(Net.signIn()).then(r => {
            if (!r && !Net.user) { Net.listeners = Net.listeners.filter(f => f !== off); back(); }
          });
        }, true],
      ]);
      return;
    }
    this.showLobby(fromStart);
  },

  showLobby(fromStart) {
    if (this.role) { this.openPlayers(); return; }
    if (UI.wins['co-lobby']) { UI.focusWin(UI.wins['co-lobby']); return; }
    const body = document.createElement('div');
    body.style.width = 'min(520px, calc(100vw - 24px))';
    body.innerHTML = `<p style="margin-top:0">Baut gemeinsam an einer Stadt! Der Gastgeber führt die Simulation, alle teilen sich die Stadtkasse.</p>
      <div class="co-list sunken" id="co-rooms"><div style="padding:4px"><i>Lade Räume…</i></div></div>
      <div class="row wrap" style="justify-content:flex-end;margin-top:6px">
        <button class="btn def" id="co-new">Neuen Raum eröffnen mit aktueller Stadt…</button>
        <button class="btn" id="co-code">Per Code beitreten…</button>
        <button class="btn" id="co-close">Schließen</button></div>`;
    const ref = Net.ref('roomList').orderByChild('updatedAt').limitToLast(100);
    const cb = ref.on('value', s => this.renderLobby(body.querySelector('#co-rooms'), s.val() || {}),
      e => { body.querySelector('#co-rooms').innerHTML = `<div style="padding:4px">Fehler: ${esc(e.message || String(e))}</div>`; });
    body.querySelector('#co-close').addEventListener('click', () => UI.closeWin('co-lobby'));
    body.querySelector('#co-new').addEventListener('click', () => this.createDialog());
    body.querySelector('#co-code').addEventListener('click', () => UI.ask('Per Code beitreten', 'Raum-Code (6 Zeichen):', '', code => {
      code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) { UI.alert('Per Code beitreten', '<p>Der Code besteht aus 6 Buchstaben bzw. Ziffern.</p>'); return; }
      this.join(code);
    }, 6));
    UI.win('co-lobby', 'Gemeinsame Stadt', body, {
      onClose: () => {
        ref.off('value', cb);
        if (!this.role && !UI.hasRunningCity && !document.getElementById('start-bg')) setTimeout(() => { if (!this.role && !UI.hasRunningCity) UI.startScreen(); }, 0);
      },
    });
  },

  ago(ts) {
    if (!ts) return '–';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'gerade eben';
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60);
    if (h < 48) return `vor ${h} Std.`;
    return new Date(ts).toLocaleDateString('de-DE');
  },

  renderLobby(list, all) {
    if (!list) return;
    const me = Net.uid;
    const rows = Object.keys(all).map(id => Object.assign({ id }, all[id])).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const mine = rows.filter(r => r.hostUid === me);
    const open = rows.filter(r => r.hostUid !== me && r.open && !r.private);
    const row = (r, own) => `<div class="co-row"><span><b>${esc(r.name)}</b> <span class="note">(${esc(r.id)})</span><br>
      <span class="note">${own ? (r.open ? 'offen' : 'geschlossen') : 'Gastgeber: ' + esc(r.hostName)} · ${esc(r.cityName || '')} · ${fmtNum(r.pop || 0)} Einw.
      · ${r.open ? (r.players || 0) + ' Spieler online' : 'niemand online'} · ${esc(this.ago(r.updatedAt))}${r.private ? ' · privat' : ''}</span></span>
      <span style="white-space:nowrap">${own
        ? `<button class="btn small" data-resume="${esc(r.id)}">Fortsetzen</button><button class="btn small" data-del="${esc(r.id)}">Löschen</button>`
        : `<button class="btn small" data-join="${esc(r.id)}">Beitreten</button>`}</span></div>`;
    let html = `<div class="co-head">Offene Räume</div>${open.length ? open.map(r => row(r, false)).join('') : '<div style="padding:4px"><i>Gerade ist kein öffentlicher Raum offen. Eröffne doch selbst einen!</i></div>'}`;
    if (mine.length) html += `<div class="co-head">Meine Räume</div>${mine.map(r => row(r, true)).join('')}`;
    list.innerHTML = html;
    list.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', () => this.join(b.dataset.join)));
    list.querySelectorAll('[data-resume]').forEach(b => b.addEventListener('click', () => this.resumeAsk(all[b.dataset.resume], b.dataset.resume)));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.del;
      UI.confirm('Raum löschen', `<p>Raum <b>${esc(all[id].name)}</b> (${esc(id)}) mit seiner Stadt endgültig löschen?</p>`, 'Löschen', () => {
        Net.ref('rooms/' + id).remove().then(() => Net.ref('roomList/' + id).remove())
          .then(() => UI.status(`Raum ${id} gelöscht.`))
          .catch(e => UI.alert('Löschen fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`));
      });
    }));
  },

  createDialog() {
    const c = this.city;
    const body = document.createElement('div');
    body.innerHTML = `<div class="col" style="width:min(300px, calc(100vw - 40px))">
        <label for="co-name">Name des Raums:</label>
        <input id="co-name" class="field" maxlength="40">
        <label><input type="checkbox" id="co-priv"> privat (nicht in der Liste, Beitritt nur per Code)</label>
        <p class="note">Mitspieler bauen in deiner aktuellen Stadt <b>${esc(c.name)}</b> mit. Nur du steuerst Tempo, Katastrophen und Haushalt.</p>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn def" data-b="ok">Eröffnen</button><button class="btn" data-b="no">Abbrechen</button></div>`;
    const inp = body.querySelector('#co-name');
    inp.value = (c.name + ' gemeinsam').slice(0, 40);
    const ok = () => {
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      const priv = body.querySelector('#co-priv').checked;
      UI.closeWin('co-create');
      this.createRoom(name, priv);
    };
    body.querySelector('[data-b=ok]').addEventListener('click', ok);
    body.querySelector('[data-b=no]').addEventListener('click', () => UI.closeWin('co-create'));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    UI.win('co-create', 'Neuen Raum eröffnen', body, { modal: true });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  },

  createRoom(name, priv) {
    if (this.role) return;
    if (typeof Cloud !== 'undefined' && Cloud.isVisiting && Cloud.isVisiting()) Cloud.endVisit(true);
    const uid = Net.uid;
    const pick = n => {
      const id = Net.shortId(6);
      return Net.ref('roomList/' + id).once('value').then(s => (s.exists() && n < 8 ? pick(n + 1) : id));
    };
    UI.status('Eröffne Raum…');
    pick(0).then(id => {
      const c = this.city;
      const info = { name, hostUid: uid, hostName: String(Net.name).slice(0, 100), private: !!priv, players: 1,
        pop: c.population(), cityName: String(c.name).slice(0, 60), updatedAt: Net.TIMESTAMP, open: true };
      return Net.ref('roomList/' + id).set(info).then(() => {
        if (!UI.hasRunningCity) UI.afterLoad();
        UI.closeWin('co-lobby');
        return this.startHost(id, info);
      }).then(() => {
        UI.dialog('co-info', 'Raum eröffnet', `<div style="width:min(320px, calc(100vw - 40px))">
          <p>Dein Raum <b>${esc(name)}</b> ist offen. Mitspieler finden ihn ${priv ? 'nur' : 'in der Liste unter <i>Online → Gemeinsame Stadt</i> oder'} mit diesem Code:</p>
          <p class="center"><span class="co-code">${esc(id)}</span></p>
          <p class="note">Du bist Gastgeber: die Simulation läuft bei dir. Schließt du das Spiel, pausiert der Raum. Chat mit Taste C.</p></div>`,
        [['OK', null, true]], { modal: false });
      });
    }).catch(e => { this.cleanup(); UI.alert('Raum konnte nicht eröffnet werden', `<p>${esc(e.message || String(e))}</p>`); });
  },

  resumeAsk(r, id) {
    if (!r) return;
    UI.confirm('Raum fortsetzen', `<p>Raum <b>${esc(r.name)}</b> fortsetzen? Deine aktuelle Stadt wird durch die Stadt des Raums
      (<b>${esc(r.cityName || '')}</b>) ersetzt – speichere sie vorher, falls nötig.</p>`, 'Fortsetzen', () => this.resume(id, r));
  },

  resume(id, r) {
    if (typeof Cloud !== 'undefined' && Cloud.isVisiting && Cloud.isVisiting()) Cloud.endVisit(true);
    UI.status('Lade die Stadt des Raums…');
    Net.ref('rooms/' + id + '/snapshot').once('value').then(s => {
      const snap = s.val();
      if (!snap || !snap.data) throw new Error('Für diesen Raum ist keine Stadt gespeichert.');
      UI.loadObject(JSON.parse(snap.data));
      if (snap.x) this.applyDiff(JSON.parse(snap.x), true);
      this.city.saveName = undefined;
      UI.closeWin('co-lobby');
      const info = Object.assign({}, r, { open: true, updatedAt: Net.TIMESTAMP });
      return Net.ref('roomList/' + id).update({ open: true, updatedAt: Net.TIMESTAMP, hostName: String(Net.name).slice(0, 100) })
        .then(() => this.startHost(id, info));
    }).then(() => UI.status(`Raum ${id} fortgesetzt – Mitspieler können wieder beitreten.`))
      .catch(e => { this.cleanup(); UI.alert('Fortsetzen fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`); });
  },

  // =================== Gastgeber ===================
  startHost(id, info) {
    this.role = 'host';
    this.roomId = id;
    this.info = info;
    this.ep = Net.shortId(8);
    this.seq = 0;
    this.events = [];
    this.acks = [];
    this.diffKeys = [];
    this.chatKeys = [];
    this.sprIds = new WeakMap();
    this.sprNext = 0;
    this.snapWanted = 0;
    this.lastSnap = performance.now();
    this.lastMaps = 0;
    this.lastListUpdate = 0;
    this.players = {};
    this.chat = []; this.unread = 0;
    this.seenSync = {};
    this.city.remote = false;
    if (typeof Cloud !== 'undefined') Cloud.suspended = true;
    this.captureBaseline();
    const room = Net.ref('rooms/' + id);
    return room.update({ diffs: null, actions: null }).then(() => this.writeSnapshot()).then(() => {
      if (this.role !== 'host' || this.roomId !== id) return;
      this.setPresence();
      this.updateRoomList(true);
      this.sub(room.child('actions'), 'child_added', s => this.onAction(s));
      this.sub(room.child('presence'), 'value', s => this.onPresence(s.val() || {}));
      this.armChat();
      this.sub(room.child('chat').limitToLast(50), 'child_added', s => this.onChat(s));
      this.timer = setInterval(() => { try { this.hostTick(); } catch (e) { console.error(e); } }, this.DIFF_MS);
      this.updateMenu(); this.updateBadge(); UI.buildMenus();
      UI.status(`Raum ${id} ist offen. Code für Mitspieler: ${id}`);
    });
  },

  /** Vergleichsstand: was die Mitspieler bereits kennen. */
  captureBaseline() {
    const c = this.city;
    const b = this.base = { tile: c.tile.slice(), vari: c.vari.slice(), zones: new Map(), sc: {}, maps: {}, hist: '', spr: '', hp: -1 };
    for (const z of c.zones.values()) b.zones.set(z.id, JSON.stringify(z));
    for (const k of COOP_SCALARS) b.sc[k] = JSON.stringify(c[k]);
    for (const k of COOP_MAPS) b.maps[k] = coopB64(c[k]);
    b.hist = this.histJSON();
  },

  histJSON() {
    const h = this.city.hist, o = {};
    for (const k in h) o[k] = Array.from(h[k]);
    return JSON.stringify(o);
  },

  /** Alle Zusatzwerte (nicht in serialize enthalten) für einen Vollstand. */
  extraState() {
    const c = this.city, s = {}, m = {};
    for (const k of COOP_SCALARS) s[k] = c[k];
    for (const k of COOP_MAPS) m[k] = coopB64(c[k]);
    return { s, m, sp: this.spriteList(), hp: UI.paused ? 1 : 0 };
  },

  spriteList() {
    const out = [];
    for (const s of this.city.sprites) {
      if (s.dead) continue;
      let id = this.sprIds.get(s);
      if (!id) { id = ++this.sprNext; this.sprIds.set(s, id); }
      const a = [id, s.type, Math.round(s.x), Math.round(s.y), typeof s.dir === 'number' ? Math.round(s.dir * 100) / 100 : 0];
      if (s.type === SPR.EXPLOSION || s.type === SPR.DUST) a.push(s.frame | 0, s.size || 0);
      else if (s.type === SPR.PLANE) a.push(0, 0, Math.round((s.alt || 0) * 100) / 100, s.crashing ? 1 : 0);
      out.push(a);
    }
    return out;
  },

  computeDiff(now) {
    const c = this.city, b = this.base, d = {};
    let any = false;
    // Felder
    const t = [];
    const tile = c.tile, vari = c.vari;
    for (let i = 0; i < tile.length; i++) {
      if (tile[i] !== b.tile[i] || vari[i] !== b.vari[i]) {
        t.push(i, tile[i], vari[i]);
        b.tile[i] = tile[i]; b.vari[i] = vari[i];
      }
    }
    if (t.length > 3 * 3000) { d.T = coopB64(tile); d.V = coopB64(vari); any = true; } else if (t.length) { d.t = t; any = true; }
    // Zonen
    const zc = [], seen = new Set();
    for (const z of c.zones.values()) {
      seen.add(z.id);
      const j = JSON.stringify(z);
      if (b.zones.get(z.id) !== j) { b.zones.set(z.id, j); zc.push(z); }
    }
    const zr = [];
    for (const id of b.zones.keys()) if (!seen.has(id)) zr.push(id);
    for (const id of zr) b.zones.delete(id);
    if (zc.length) { d.z = zc; any = true; }
    if (zr.length) { d.zr = zr; any = true; }
    // Werte
    const s = {};
    let ns = 0;
    for (const k of COOP_SCALARS) {
      const j = JSON.stringify(c[k]);
      if (b.sc[k] !== j) { b.sc[k] = j; s[k] = c[k]; ns++; }
    }
    if (ns) { d.s = s; any = true; }
    const hp = UI.paused ? 1 : 0;
    if (hp !== b.hp) { b.hp = hp; d.hp = hp; any = true; }
    // Grafiken und Analysekarten (seltener)
    if (now - this.lastMaps >= this.MAPS_MS) {
      this.lastMaps = now;
      const h = this.histJSON();
      if (h !== b.hist) { b.hist = h; d.h = JSON.parse(h); any = true; }
      const m = {};
      let nm = 0;
      for (const k of COOP_MAPS) {
        const v = coopB64(c[k]);
        if (v !== b.maps[k]) { b.maps[k] = v; m[k] = v; nm++; }
      }
      if (nm) { d.m = m; any = true; }
    }
    // Fahrzeuge, Monster usw.
    const sp = this.spriteList();
    const sj = JSON.stringify(sp);
    if (sj !== b.spr) { b.spr = sj; d.sp = sp; any = true; }
    if (this.events.length) { d.ev = this.events.splice(0, this.events.length); any = true; }
    if (this.acks.length) { d.ak = this.acks.splice(0, this.acks.length); any = true; }
    return any ? d : null;
  },

  hostTick() {
    if (this.role !== 'host') return;
    const now = performance.now();
    const d = this.computeDiff(now);
    const diffs = Net.ref('rooms/' + this.roomId + '/diffs');
    if (d) {
      this.seq++;
      const ref = diffs.push();
      ref.set({ seq: this.seq, ep: this.ep, d: JSON.stringify(d), t: Net.TIMESTAMP }).catch(e => console.warn('Coop: Paket nicht gesendet', e));
      this.diffKeys.push(ref.key);
      if (this.diffKeys.length > this.KEEP_DIFFS) {
        const del = {};
        for (const k of this.diffKeys.splice(0, this.diffKeys.length - this.KEEP_DIFFS)) del[k] = null;
        diffs.update(del).catch(() => {});
      }
    }
    if ((this.snapWanted && now >= this.snapWanted) || now - this.lastSnap >= this.SNAP_MS) {
      this.writeSnapshot();
      this.updateRoomList(false);
    }
    if (now - this.lastListUpdate > 60000) this.updateRoomList(false);
  },

  writeSnapshot() {
    if (this.role !== 'host') return Promise.resolve();
    this.snapWanted = 0;
    this.lastSnap = performance.now();
    const c = this.city;
    const data = JSON.stringify(c.serialize());
    const x = JSON.stringify(this.extraState());
    return Net.ref('rooms/' + this.roomId + '/snapshot').set({ seq: this.seq, ep: this.ep, data, x, t: Net.TIMESTAMP })
      .catch(e => { console.warn('Coop: Vollstand nicht gesendet', e); UI.status('Senden des Stadtstands fehlgeschlagen: ' + (e.message || e), true); });
  },

  updateRoomList(withDisconnect) {
    if (this.role !== 'host') return;
    this.lastListUpdate = performance.now();
    const c = this.city;
    const ref = Net.ref('roomList/' + this.roomId);
    const n = Math.max(1, Object.keys(this.players).length);
    ref.update({ players: n, pop: c.population(), cityName: String(c.name).slice(0, 60), updatedAt: Net.TIMESTAMP, open: true })
      .catch(e => console.warn('Coop: Raumliste', e));
    if (withDisconnect) ref.onDisconnect().update({ open: false, players: 0 });
  },

  onAction(snap) {
    const a = snap.val();
    snap.ref.remove().catch(() => {});
    if (this.role !== 'host' || !a || !COOP_TOOLS.includes(a.tool)) return;
    let cells;
    try { cells = JSON.parse(a.cells); } catch (e) { return; }
    if (!Array.isArray(cells)) return;
    const c = this.city;
    let err = null;
    for (const cell of cells.slice(0, 600)) {
      if (!Array.isArray(cell)) continue;
      const x = cell[0] | 0, y = cell[1] | 0;
      if (!inBounds(x, y)) continue;
      const r = c.applyTool(a.tool, x, y);
      if (!r.ok && r.err && !err) err = r.err;
    }
    if (c.powerDirty) c.powerScan();
    this.acks.push([snap.key, a.uid, err || 0]);
  },

  // =================== Mitspieler ===================
  join(id) {
    if (this.role) return;
    UI.status(`Verbinde mit Raum ${id}…`);
    Net.ref('roomList/' + id).once('value').then(s => {
      const info = s.val();
      if (!info) throw new Error(`Einen Raum mit dem Code ${id} gibt es nicht.`);
      if (info.hostUid === Net.uid) { this.resumeAsk(info, id); return; }
      if (!info.open) throw new Error(`Der Raum „${info.name}“ ist gerade geschlossen – der Gastgeber ist nicht online.`);
      this.startClient(id, info);
    }).catch(e => UI.alert('Beitreten nicht möglich', `<p>${esc(e.message || String(e))}</p>`));
  },

  startClient(id, info) {
    if (typeof Cloud !== 'undefined' && Cloud.isVisiting && Cloud.isVisiting()) Cloud.endVisit(true);
    const c = this.city, v = this.view;
    // eigene Stadt im Speicher behalten
    this.own = UI.hasRunningCity && !c.remote ? {
      json: JSON.stringify(c.serialize()), saveName: c.saveName, msgLog: UI.msgLog.slice(),
      cam: { x: v.camX, y: v.camY, zoom: v.zoom },
    } : null;
    this.role = 'client';
    this.roomId = id;
    this.info = info;
    this.ep = null; this.seq = 0;
    this.synced = false; this.syncing = true; this.needSeq = 0;
    this.buffer = new Map();
    this.snap = null;
    this.gapSince = 0;
    this.hostOnline = false;
    this.hostSeen = false;
    this.pending = new Map();
    this.queue = null;
    this.players = {};
    this.chat = []; this.unread = 0;
    this.lastPlayers = null;
    c.remote = true;
    c.saveName = undefined;
    if (typeof Cloud !== 'undefined') Cloud.suspended = true;
    UI.closeWin('co-lobby');
    const room = Net.ref('rooms/' + id);
    this.setPresence();
    this.sub(room.child('presence'), 'value', s => this.onPresence(s.val() || {}));
    this.sub(room.child('diffs').limitToLast(this.KEEP_DIFFS + 20), 'child_added', s => this.onDiff(s.val()));
    this.armChat();
    this.sub(room.child('chat').limitToLast(50), 'child_added', s => this.onChat(s));
    this.listenSnapshot(true);
    this.updateMenu(); this.updateBadge(); UI.buildMenus();
    // Kurze Warteanzeige, bis der Stand da ist
    UI.dialog('co-wait', 'Verbinde…', `<p style="width:min(280px, calc(100vw - 40px))">Lade die Stadt <b>${esc(info.cityName || '')}</b> von ${esc(info.hostName)}…</p>`,
      [['Abbrechen', () => this.leave(true)]], { modal: false });
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => {
      if (this.role === 'client' && this.roomId === id && !this.synced) {
        UI.closeWin('co-wait');
        UI.dialog('co-wait', 'Keine Antwort', `<p style="width:min(300px, calc(100vw - 40px))">Der Gastgeber antwortet nicht. Vielleicht ist er gerade nicht online.</p>`,
          [['Raum verlassen', () => this.leave(true)], ['Weiter warten', null, true]], { modal: false });
      }
    }, 15000);
  },

  listenSnapshot(on) {
    const ref = Net.ref('rooms/' + this.roomId + '/snapshot');
    if (on && !this.snapCb) {
      this.snapRef = ref;
      this.snapCb = ref.on('value', s => { this.snap = s.val(); this.pump(); }, e => console.warn('Coop: Vollstand', e));
    } else if (!on && this.snapCb) {
      this.snapRef.off('value', this.snapCb);
      this.snapCb = null; this.snap = null;
    }
  },

  /** Vollstand anfordern (Gastgeber reagiert auf die geänderte Anwesenheit). */
  requestSync(needSeq) {
    this.syncing = true;
    this.needSeq = needSeq || 0;
    this.gapSince = 0;
    this.listenSnapshot(true);
    this.setPresence({ sync: Date.now() });
  },

  onDiff(v) {
    if (this.role !== 'client' || !v || typeof v.d !== 'string') return;
    if (this.buffer.size > 400) this.buffer.clear();
    this.buffer.set(v.ep + ':' + v.seq, v);
    this.pump();
  },

  pump() {
    if (this.role !== 'client' || !this.ep) return;
    if (this.syncing) {
      const s = this.snap;
      if (!s || s.ep !== this.ep || s.seq < this.needSeq) return;
      try { this.loadSnapshot(s); } catch (e) { console.error(e); UI.status('Stadtstand fehlerhaft – fordere neu an…', true); this.requestSync(0); return; }
      this.seq = s.seq;
      this.syncing = false;
      this.listenSnapshot(false);
    }
    let v;
    while ((v = this.buffer.get(this.ep + ':' + (this.seq + 1)))) {
      this.buffer.delete(this.ep + ':' + (this.seq + 1));
      this.seq++;
      try { this.applyDiff(JSON.parse(v.d)); } catch (e) { console.error('Coop: Paket fehlerhaft', e); }
    }
    // Aufräumen und Lücken erkennen
    let minAhead = Infinity;
    for (const [k, d] of this.buffer) {
      if (d.ep !== this.ep || d.seq <= this.seq) this.buffer.delete(k);
      else minAhead = Math.min(minAhead, d.seq);
    }
    if (minAhead !== Infinity) {
      if (!this.gapSince) this.gapSince = performance.now();
    } else this.gapSince = 0;
  },

  loadSnapshot(s) {
    const c = this.city, v = this.view;
    const o = JSON.parse(s.data);
    const first = !this.synced;
    const cam = { x: v.camX, y: v.camY, zoom: v.zoom };
    const log = UI.msgLog.slice();
    this._loading = true;
    try {
      c.deserialize(o);
      c.remote = true;
      c.saveName = undefined;
      c.fullAnalysis();
      // fullAnalysis berechnet Karten und Zählung neu – Werte des Gastgebers haben Vorrang
      for (const k of ['landValue', 'pollution', 'crime', 'popDensity', 'trafficDensity']) if (o[k]) coopUnB64(o[k], c[k]);
      c.stats = Object.assign(City.emptyCensus(), o.stats || {});
      if (s.x) this.applyDiff(JSON.parse(s.x), true);
      UI.afterLoad();
    } finally { this._loading = false; }
    if (!first) {
      UI.msgLog = log; UI.fillLog();
      v.setZoom(cam.zoom); v.camX = cam.x; v.camY = cam.y; v.clampCam();
    }
    this.synced = true;
    clearTimeout(this.waitTimer);
    UI.closeWin('co-wait');
    if (first) {
      UI.status(`Willkommen in ${c.name}! Ihr baut gemeinsam – Gastgeber ist ${this.info.hostName}. Chat mit Taste C.`);
      UI.closeWin('co-hostoff');
    }
  },

  applyDiff(d, full) {
    const c = this.city;
    if (d.zr) {
      for (const id of d.zr) {
        const z = c.zones.get(id);
        if (!z) continue;
        this.clearFootprint(z);
        c.zones.delete(id);
      }
    }
    if (d.T) { coopUnB64(d.T, c.tile); coopUnB64(d.V, c.vari); }
    if (d.t) {
      const t = d.t;
      for (let j = 0; j + 2 < t.length; j += 3) { c.tile[t[j]] = t[j + 1]; c.vari[t[j]] = t[j + 2]; }
    }
    if (d.z) {
      for (const z of d.z) {
        const old = c.zones.get(z.id);
        if (old && (old.x !== z.x || old.y !== z.y || old.size !== z.size)) this.clearFootprint(old);
        c.zones.set(z.id, z);
        for (let y = z.y; y < z.y + z.size; y++) for (let x = z.x; x < z.x + z.size; x++) c.zid[idx(x, y)] = z.id;
      }
    }
    if (d.T || d.t || d.z || d.zr) { c.mapVersion++; c.powerDirty = true; }
    if (d.s) {
      for (const k in d.s) {
        if (!COOP_SCALARS.includes(k)) continue;
        c[k] = k === 'stats' ? Object.assign(City.emptyCensus(), d.s[k]) : d.s[k];
      }
    }
    if (d.m) {
      for (const k in d.m) if (COOP_MAPS.includes(k)) coopUnB64(d.m[k], c[k]);
    }
    if (d.h) {
      for (const k in d.h) if (c.hist[k]) c.hist[k].set(d.h[k].slice(0, c.hist[k].length));
      if (!full) c.emit('census');
    }
    if ('hp' in d) this.hostPaused = !!d.hp;
    if (d.sp) this.applySprites(d.sp);
    if (d.ak) {
      for (const [key, uid, err] of d.ak) {
        this.pending.delete(key);
        if (uid === Net.uid && err) { UI.status(err, true); Sound.error(); }
      }
    }
    if (d.ev && !full) {
      for (const [t, data] of d.ev) {
        if (!COOP_EVENTS.includes(t)) continue;
        try { c.emit(t, data); } catch (e) { console.error(e); }
      }
    }
  },

  clearFootprint(z) {
    const c = this.city;
    for (let y = z.y; y < z.y + z.size; y++) for (let x = z.x; x < z.x + z.size; x++) {
      if (inBounds(x, y) && c.zid[idx(x, y)] === z.id) c.zid[idx(x, y)] = -1;
    }
  },

  /** Fahrzeuge übernehmen; Bewegung wird zwischen zwei Paketen weich interpoliert. */
  applySprites(list) {
    const c = this.city, now = performance.now();
    const old = new Map();
    for (const s of c.sprites) if (s._id) old.set(s._id, s);
    const out = [];
    for (const a of list) {
      const [id, type, x, y, dir, f, size, alt, crash] = a;
      let s = old.get(id);
      if (!s) {
        s = { _id: id, type, x, y, dir, frame: f || 0, _fa: f || 0, count: 0, dead: false, trail: [], _hist: [], _ax: x, _ay: y };
      } else { s._ax = s.x; s._ay = s.y; }
      s._bx = x; s._by = y; s._t = now;
      s.dir = dir;
      if (f !== undefined && f > s._fa) { s._fa = f; s.frame = f; }
      if (type === SPR.EXPLOSION || type === SPR.DUST) s.size = size;
      if (type === SPR.PLANE) { s.alt = alt; s.crashing = !!crash; }
      if (Math.abs(x - s.x) + Math.abs(y - s.y) > 200) { s._ax = s.x = x; s._ay = s.y = y; s._hist = []; }
      out.push(s);
    }
    c.sprites = out;
  },

  /** Lokale Fortschreibung beim Mitspieler: Interpolation, Explosionen, Beben. */
  clientTick(now, dt) {
    const c = this.city;
    for (const s of c.sprites) {
      if (s._t === undefined) continue;
      const k = clamp((now - s._t) / this.DIFF_MS, 0, 1);
      s.x = s._ax + (s._bx - s._ax) * k;
      s.y = s._ay + (s._by - s._ay) * k;
      if (!this.hostPaused) {
        s._fa += dt / 33;
        if (s.type === SPR.EXPLOSION || s.type === SPR.DUST) s.frame = Math.min(Math.floor(s._fa), s.type === SPR.DUST ? 16 : 24);
        else s.frame = Math.floor(s._fa);
      }
      if (s.type === SPR.TRAIN) {
        const h = s._hist, last = h[h.length - 1];
        if (!last || Math.abs(last[0] - s.x) + Math.abs(last[1] - s.y) >= 1) { h.push([s.x, s.y]); if (h.length > 80) h.shift(); }
      }
    }
    c.sprites = c.sprites.filter(s => !((s.type === SPR.EXPLOSION && s._fa > 24) || (s.type === SPR.DUST && s._fa > 16)));
    if (c.shake > 0 && !this.hostPaused) c.shake = Math.max(0, c.shake - dt / 33);
    if (this.hostPaused) { const sp = document.getElementById('st-speed'); if (sp) sp.textContent = 'Angehalten'; }
    // Lücke in den Paketen: nach kurzer Wartezeit Vollstand anfordern
    if (!this.syncing && this.gapSince && now - this.gapSince > 2500) {
      let min = Infinity;
      for (const d of this.buffer.values()) if (d.ep === this.ep && d.seq > this.seq) min = Math.min(min, d.seq);
      UI.status('Verbindung holt auf…');
      this.requestSync(min === Infinity ? 0 : min - 1);
    }
    // Bauaufträge, die nie bestätigt wurden, verwerfen
    for (const [k, p] of this.pending) if (now - p.t > 15000) this.pending.delete(k);
  },

  // =================== Bauen als Mitspieler ===================
  toolHook(tool, x, y, drag) {
    if (this.role !== 'client') return false;
    if (!tool || tool.id === 'query' || tool.id === 'pan') return false;
    if (!this.synced || this.syncing) { UI.status('Die Stadt wird noch geladen…', true); return true; }
    if (!this.hostOnline) { if (!drag.errShown) { drag.errShown = true; UI.status('Der Gastgeber ist offline – Bauen ist gerade nicht möglich.', true); Sound.error(); } return true; }
    const c = this.city;
    const k = c.tile[idx(x, y)];
    const fail = err => {
      drag.err = err;
      if (!drag.errShown) { drag.errShown = true; UI.status(err, true); Sound.error(); }
      return true;
    };
    let cost = tool.cost, size = 1, cx = x, cy = y;
    if (tool.zone) {
      const [x0, y0] = c.zoneOrigin(tool.zone, x, y);
      const chk = c.checkZoneSite(tool.zone, x0, y0);
      if (!chk.ok) return fail(chk.err);
      cost = chk.cost; size = ZSIZE[tool.zone]; cx = x0; cy = y0;
    } else {
      // offensichtlich wirkungslose Felder gar nicht erst senden
      if ((tool.id === 'road' && isRoadK(k)) || (tool.id === 'rail' && isRailK(k)) || (tool.id === 'wire' && isWireK(k)) ||
        (tool.id === 'park' && k === T.PARK)) return true;
      if (tool.id === 'upgrade') {
        if (k !== T.ROAD && k !== T.ROADBRIDGE) return fail(isRoadK(k) ? 'Kreuzungen mit Schiene oder Leitung können nicht ausgebaut werden.' : 'Hier ist keine Straße zum Ausbauen.');
        const lvl = roadLevel(c, idx(x, y));
        if (lvl >= 2) return true;
        cost = Math.round(ROAD_UPGRADE_COST[lvl] * (k === T.ROADBRIDGE ? 2.5 : 1));
      }
      if (tool.id === 'bulldozer') {
        if (k === T.DIRT || k === T.WATER) return true;
        if (k === T.ZONE) { const z = c.zoneAt(x, y); if (z) { size = z.size; cx = z.x; cy = z.y; cost = z.size * z.size; } }
      }
    }
    if (this.isPending(cx, cy)) return true;
    if (c.funds < cost) return fail('Nicht genug Geld!');
    if (this.queue && this.queue.tool !== tool.id) this.flush();
    if (!this.queue) this.queue = { tool: tool.id, cells: [], marks: [] };
    if (this.queue.cells.length >= 400) this.flush();
    if (!this.queue) this.queue = { tool: tool.id, cells: [], marks: [] };
    this.queue.cells.push([x, y]);
    this.queue.marks.push([cx, cy, size]);
    drag.spent += cost;
    drag.err = null;
    if (tool.id === 'bulldozer') { if (size > 1 || (drag.spent % 5) === 1) Sound.bulldoze(); } else if (tool.zone) Sound.zone(); else Sound.build();
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_MS);
    return true;
  },

  isPending(x, y) {
    const hit = m => m.some(([px, py]) => px === x && py === y);
    if (this.queue && hit(this.queue.marks)) return true;
    for (const p of this.pending.values()) if (hit(p.marks)) return true;
    return false;
  },

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const q = this.queue;
    this.queue = null;
    if (!q || !q.cells.length || this.role !== 'client') return;
    const ref = Net.ref('rooms/' + this.roomId + '/actions').push();
    const key = ref.key;
    this.pending.set(key, { marks: q.marks, t: performance.now() });
    ref.set({ uid: Net.uid, name: String(Net.name).slice(0, 100), tool: q.tool, cells: JSON.stringify(q.cells), t: Net.TIMESTAMP }).catch(e => {
      this.pending.delete(key);
      UI.status('Bauauftrag nicht gesendet: ' + (e.message || e), true);
      Sound.error();
    });
  },

  // =================== Anwesenheit, Mauszeiger ===================
  setPresence(extra) {
    if (!this.role || !Net.uid) return;
    const ref = Net.ref('rooms/' + this.roomId + '/presence/' + Net.uid);
    if (!extra) {
      this.presRef = ref;
      ref.onDisconnect().remove();
      this.myColor = this.colorFor(Net.uid);
      const cur = this.view.cursor;
      ref.set({ name: String(Net.name).slice(0, 100), color: this.myColor, x: cur ? cur.x : -1, y: cur ? cur.y : -1, s: cur ? cur.size || 1 : 1,
        tool: UI.tool, t: Net.TIMESTAMP, host: this.role === 'host', ep: this.role === 'host' ? this.ep : '', sync: 0 })
        .catch(e => console.warn('Coop: Anwesenheit', e));
    } else ref.update(Object.assign({ t: Net.TIMESTAMP }, extra)).catch(() => {});
  },

  onPresence(all) {
    const prev = this.lastPlayers || {};
    this.players = all;
    const me = Net.uid;
    // Beitritte/Abgänge melden
    if (this.lastPlayers) {
      for (const uid in all) if (!prev[uid] && uid !== me) UI.status(`${all[uid].name} ist dem Raum beigetreten.`);
      for (const uid in prev) if (!all[uid] && uid !== me && (this.role === 'host' || uid !== (this.info && this.info.hostUid))) UI.status(`${prev[uid].name} hat den Raum verlassen.`);
    }
    this.lastPlayers = all;
    if (this.role === 'host') {
      // neue Mitspieler und Nachforderungen: Vollstand senden
      for (const uid in all) {
        if (uid === me) continue;
        const p = all[uid];
        const key = String(p.sync || 0);
        if (this.seenSync[uid] !== key) { this.seenSync[uid] = key; if (!this.snapWanted) this.snapWanted = performance.now() + 300; }
      }
      for (const uid in this.seenSync) if (!all[uid]) delete this.seenSync[uid];
      const n = Object.keys(all).length;
      if (n !== this.lastCount) { this.lastCount = n; this.updateRoomList(false); }
      // eigener Eintrag verschwunden (z. B. nach Verbindungsabbruch): neu setzen
      if (!all[me] && Net.connected) this.setPresence();
    } else if (this.role === 'client') {
      const hp = all[this.info.hostUid];
      const online = !!(hp && hp.host);
      if (online) {
        this.hostEp = hp.ep;
        clearTimeout(this.hostOffTimer); this.hostOffTimer = null;
        if (!this.hostOnline) {
          this.hostOnline = true;
          if (this.hostSeen) UI.status(`${this.info.hostName} ist wieder online.`);
          UI.closeWin('co-hostoff');
        }
        this.hostSeen = true;
        if (hp.ep && hp.ep !== this.ep) {
          // neue Sitzung des Gastgebers: neu synchronisieren
          const firstEp = !this.ep;
          this.ep = hp.ep; this.seq = 0;
          if (!firstEp) this.requestSync(0); else { this.syncing = true; this.listenSnapshot(true); }
          this.pump();
        }
      } else if (this.hostOnline || !this.hostSeen) {
        if (!this.hostOffTimer) {
          this.hostOffTimer = setTimeout(() => {
            this.hostOffTimer = null;
            const p = this.players[this.info.hostUid];
            if (this.role !== 'client' || (p && p.host)) return;
            this.hostOnline = false;
            this.updateBadge();
            if (!this.hostSeen) return;     // Warte-Dialog kümmert sich
            UI.closeWin('co-wait');
            UI.closeWin('co-hostoff');
            UI.dialog('co-hostoff', 'Gastgeber offline', `<p style="width:min(320px, calc(100vw - 40px))">Der Gastgeber <b>${esc(this.info.hostName)}</b> ist offline.
              Du kannst weiter zusehen (es wird nichts gebaut und die Zeit steht still) oder den Raum verlassen und zu deiner eigenen Stadt zurückkehren.</p>`,
            [['Raum verlassen', () => this.leave(true)], ['Weiter zusehen', null, true]], { modal: false });
          }, this.hostSeen ? 4000 : 3000);
        }
      }
      if (!all[me] && Net.connected) this.setPresence();
    }
    this.updateBadge();
    if (UI.wins['co-players']) this.fillPlayers();
  },

  draw(ctx, offX, offY, ts) {
    const me = Net.uid;
    ctx.save();
    // eigene, noch unbestätigte Bauaufträge
    if (this.role === 'client') {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.strokeStyle = this.myColor || '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      const mark = ([x, y, s]) => {
        ctx.fillRect(offX + x * ts, offY + y * ts, s * ts, s * ts);
        ctx.strokeRect(offX + x * ts + 0.5, offY + y * ts + 0.5, s * ts - 1, s * ts - 1);
      };
      if (this.queue) this.queue.marks.forEach(mark);
      for (const p of this.pending.values()) p.marks.forEach(mark);
      ctx.setLineDash([]);
      // Wagen der Züge entlang der gefahrenen Strecke
      const zm = this.view.zoom;
      for (const s of this.city.sprites) {
        if (s.type !== SPR.TRAIN || !s._hist || s._hist.length < 2) continue;
        const cols = ['#4a6a9a', '#8a6a3a'];
        let dist = 0, want = 16, wi = 0, px = s.x, py = s.y;
        for (let i = s._hist.length - 1; i >= 0 && wi < 2; i--) {
          const [hx, hy] = s._hist[i];
          const seg = Math.hypot(px - hx, py - hy);
          while (seg > 0 && dist + seg >= want && wi < 2) {
            const f = (want - dist) / seg;
            const wx = px + (hx - px) * f, wy = py + (hy - py) * f;
            ctx.save(); ctx.translate(offX, offY); ctx.scale(zm, zm);
            SPRITE_GFX.wagon(ctx, Math.round(wx), Math.round(wy), cols[wi]);
            ctx.restore();
            wi++; want += 16;
          }
          dist += seg; px = hx; py = hy;
        }
      }
    }
    // Mauszeiger der anderen Spieler
    ctx.font = 'bold 11px Tahoma, Arial, sans-serif';
    ctx.textBaseline = 'top';
    for (const uid in this.players) {
      if (uid === me) continue;
      const p = this.players[uid];
      if (!p || p.x === undefined || p.x < 0) continue;
      const s = p.s || 1;
      const x = offX + p.x * ts, y = offY + p.y * ts;
      const col = p.color || '#fff';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeRect(x - 0.5, y - 0.5, s * ts + 1, s * ts + 1);
      ctx.strokeStyle = col;
      ctx.strokeRect(x + 1, y + 1, s * ts - 2, s * ts - 2);
      const tool = TOOLS.find(t => t.id === p.tool);
      const label = String(p.name || '?').slice(0, 24) + (tool && tool.id !== 'pan' ? ' · ' + tool.name : '');
      const w = ctx.measureText(label).width + 6;
      const ly = y - 15 < 0 ? y + s * ts + 2 : y - 15;
      ctx.fillStyle = col;
      ctx.fillRect(x, ly, w, 14);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, ly + 0.5, w - 1, 13);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 3, ly + 2);
    }
    ctx.restore();
  },

  tick(now) {
    if (!this.role) return;
    const dt = Math.min(250, now - (this.lastTick || now));
    this.lastTick = now;
    if (this.role === 'client') this.clientTick(now, dt);
    // eigenen Mauszeiger mitteilen (gedrosselt)
    if (now - (this.lastCur || 0) >= this.CURSOR_MS && this.presRef) {
      const cu = this.view.cursor;
      const key = cu ? `${cu.x},${cu.y},${cu.size || 1},${UI.tool}` : `-1,${UI.tool}`;
      if (key !== this.curKey) {
        this.curKey = key;
        this.lastCur = now;
        this.presRef.update({ x: cu ? cu.x : -1, y: cu ? cu.y : -1, s: cu ? cu.size || 1 : 1, tool: UI.tool, t: Net.TIMESTAMP }).catch(() => {});
      }
    }
  },

  // =================== Spielerliste ===================
  openPlayers() {
    if (!this.role) { this.openLobby(); return; }
    if (UI.wins['co-players']) { UI.focusWin(UI.wins['co-players']); return; }
    const body = document.createElement('div');
    body.style.width = 'min(300px, calc(100vw - 24px))';
    body.innerHTML = `<div id="co-pl-info"></div><div class="co-list sunken" id="co-pl" style="min-width:0"></div>
      <div class="row wrap" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="co-pl-chat">Chat</button>
      <button class="btn" id="co-pl-leave">${this.role === 'host' ? 'Raum schließen' : 'Raum verlassen'}</button><button class="btn def" id="co-pl-ok">OK</button></div>`;
    body.querySelector('#co-pl-chat').addEventListener('click', () => this.openChat());
    body.querySelector('#co-pl-leave').addEventListener('click', () => this.leaveAsk());
    body.querySelector('#co-pl-ok').addEventListener('click', () => UI.closeWin('co-players'));
    UI.win('co-players', 'Mitspieler', body, { right: true, y: 30 });
    this.fillPlayers();
  },

  fillPlayers() {
    const list = document.getElementById('co-pl');
    const info = document.getElementById('co-pl-info');
    if (!list || !this.role) return;
    info.innerHTML = `<p style="margin:0 0 4px">Raum <b>${esc(this.info ? this.info.name : '')}</b> · Code <span class="co-code" style="font-size:13px;padding:0 4px">${esc(this.roomId)}</span></p>`;
    const uids = Object.keys(this.players).sort((a, b) => (this.players[b].host ? 1 : 0) - (this.players[a].host ? 1 : 0));
    list.innerHTML = uids.map(uid => {
      const p = this.players[uid];
      const tool = TOOLS.find(t => t.id === p.tool);
      return `<div class="co-row"><span><span class="co-sw" style="background:${esc(p.color || '#fff')}"></span><b>${esc(p.name)}</b>${p.host ? ' (Gastgeber)' : ''}${uid === Net.uid ? ' – du' : ''}</span>
        <span class="note">${tool ? esc(tool.name) : ''}${p.x >= 0 ? '' : ' · nicht auf der Karte'}</span></div>`;
    }).join('') || '<div style="padding:4px"><i>Niemand da.</i></div>';
  },

  // =================== Chat ===================
  onChat(s) {
    const m = s.val();
    if (!m || typeof m.text !== 'string') return;
    m.key = s.key;
    this.chat.push(m);
    if (this.chat.length > 50) this.chat.shift();
    if (this.role === 'host') {
      this.chatKeys.push(s.key);
      if (this.chatKeys.length > 60) {
        const del = {};
        for (const k of this.chatKeys.splice(0, this.chatKeys.length - 50)) del[k] = null;
        Net.ref('rooms/' + this.roomId + '/chat').update(del).catch(() => {});
      }
    }
    if (UI.wins['co-chat']) this.fillChat();
    else if (m.uid !== Net.uid && this.chatReady) {
      this.unread++;
      UI.status(`${m.name}: ${m.text}`);
      Sound.build();
      this.updateBadge();
    }
  },

  toggleChat() {
    if (!this.role) { UI.status('Der Chat ist nur in einem gemeinsamen Raum verfügbar.'); return; }
    if (UI.wins['co-chat']) UI.closeWin('co-chat'); else this.openChat();
  },

  openChat() {
    if (!this.role) return;
    if (UI.wins['co-chat']) { UI.focusWin(UI.wins['co-chat']); return; }
    const body = document.createElement('div');
    body.style.width = 'min(320px, calc(100vw - 24px))';
    body.innerHTML = `<div class="co-chat sunken" id="co-chat-list"></div>
      <div class="row" style="margin-top:4px"><input id="co-chat-in" class="field" maxlength="300" style="flex:1;min-width:0" placeholder="Nachricht…">
      <button class="btn def" id="co-chat-send">Senden</button></div>`;
    const inp = body.querySelector('#co-chat-in');
    const send = () => {
      const text = inp.value.trim().slice(0, 300);
      if (!text || !this.role) return;
      inp.value = '';
      Net.ref('rooms/' + this.roomId + '/chat').push({ uid: Net.uid, name: String(Net.name).slice(0, 100), color: this.myColor || '#000', text, t: Net.TIMESTAMP })
        .catch(e => UI.status('Nachricht nicht gesendet: ' + (e.message || e), true));
    };
    body.querySelector('#co-chat-send').addEventListener('click', send);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    UI.win('co-chat', 'Chat – Raum ' + this.roomId, body, { right: true, y: 260 });
    this.unread = 0;
    this.updateBadge();
    this.fillChat();
    setTimeout(() => inp.focus(), 0);
  },

  fillChat() {
    const list = document.getElementById('co-chat-list');
    if (!list) return;
    this.unread = 0;
    this.updateBadge();
    list.innerHTML = this.chat.length ? this.chat.map(m => {
      const tm = m.t ? new Date(m.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="${m.uid === Net.uid ? 'co-me' : ''}"><span class="co-t">${esc(tm)}</span><span class="co-sw" style="background:${esc(m.color || '#fff')}"></span><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`;
    }).join('') : '<i class="note">Noch keine Nachrichten. Sag hallo!</i>';
    list.scrollTop = list.scrollHeight;
  },

  // =================== Verlassen ===================
  leaveAsk() {
    if (!this.role) { UI.status('Du bist in keinem gemeinsamen Raum.'); return; }
    if (this.role === 'host') {
      UI.confirm('Raum schließen', `<p>Raum <b>${esc(this.roomId)}</b> schließen? Deine Mitspieler werden getrennt.
        Die Stadt bleibt im Raum gespeichert – du kannst ihn später unter <i>Gemeinsame Stadt → Meine Räume</i> fortsetzen.</p>`, 'Schließen', () => this.leave(false));
    } else {
      UI.confirm('Raum verlassen', `<p>Raum <b>${esc(this.roomId)}</b> verlassen und zu deiner eigenen Stadt zurückkehren?</p>`, 'Verlassen', () => this.leave(false));
    }
  },

  leave(silent) {
    const role = this.role, id = this.roomId;
    if (!role) return;
    if (role === 'host') {
      try { this.hostTick(); } catch (e) { console.error(e); }
      this.writeSnapshot();
      const ref = Net.ref('roomList/' + id);
      ref.update({ open: false, players: 0, updatedAt: Net.TIMESTAMP }).catch(() => {});
      ref.onDisconnect().cancel();
    } else this.flush();
    this.cleanup();
    if (role === 'client') {
      const own = this.own;
      this.own = null;
      const c = this.city;
      c.remote = false;
      if (own) {
        UI.loadObject(JSON.parse(own.json));
        c.saveName = own.saveName;
        UI.msgLog = own.msgLog; UI.fillLog();
        const v = this.view;
        v.setZoom(own.cam.zoom); v.camX = own.cam.x; v.camY = own.cam.y; v.clampCam();
        UI.status(`Raum ${id} verlassen – zurück in ${c.name}.`);
      } else {
        c.sprites = [];
        UI.hasRunningCity = false;
        UI.startScreen();
      }
    } else if (!silent) UI.status(`Raum ${id} geschlossen. Du spielst allein weiter.`);
  },

  /** Alle Verbindungen lösen und den Zustand zurücksetzen. */
  cleanup() {
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.flushTimer); this.flushTimer = null;
    clearTimeout(this.waitTimer); clearTimeout(this.hostOffTimer); this.hostOffTimer = null;
    for (const [ref, ev, cb] of this.subs) ref.off(ev, cb);
    this.subs = [];
    if (this.snapCb) this.listenSnapshot(false);
    if (this.presRef) { this.presRef.onDisconnect().cancel(); this.presRef.remove().catch(() => {}); this.presRef = null; }
    this.role = null; this.roomId = null; this.info = null; this.ep = null;
    this.players = {}; this.lastPlayers = null; this.chat = []; this.unread = 0; this.chatReady = false;
    this.queue = null; this.pending = new Map(); this.hostPaused = false; this.curKey = null;
    if (typeof Cloud !== 'undefined') Cloud.suspended = false;
    for (const w of ['co-chat', 'co-players', 'co-wait', 'co-hostoff', 'co-info', 'co-budget']) UI.closeWin(w);
    this.updateMenu(); this.updateBadge();
    UI.buildMenus();
  },

  /** Alte Chat-Nachrichten beim Betreten nicht als neu melden. */
  armChat() {
    this.chatReady = false;
    clearTimeout(this.chatReadyTimer);
    this.chatReadyTimer = setTimeout(() => { this.chatReady = true; }, 1500);
  },

  sub(ref, ev, cb) {
    ref.on(ev, cb, e => console.warn('Coop:', ev, e && e.message));
    this.subs.push([ref, ev, cb]);
  },
};
