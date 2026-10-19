'use strict';
/*
 * Cloud-Spielstände, Auto-Speichern und Region (Bestenliste + Stadtbesuche).
 *
 * Datenbank (Firebase Realtime Database):
 *   saveMeta/{uid}/{id}  kleine Übersicht (Name, Stadt, Datum, Einwohner, savedAt) – billig aufzulisten
 *   saveData/{uid}/{id}  vollständiger Spielstand als JSON-Text; id "autosave" = Auto-Speicherstand
 *   region/meta/{uid}    öffentlicher Eintrag der Bestenliste (nur wenn der Spieler das will)
 *   region/data/{uid}    vollständige Stadt (JSON-Text) zum Besuchen
 *
 * Schnittstelle für andere Module (z. B. coop.js):
 *   Cloud.suspended = true   – Auto-Speichern und Veröffentlichen ruhen (Multiplayer-Sitzung)
 *   Cloud.isVisiting()       – gerade zu Besuch in einer fremden Stadt?
 *   Cloud.endVisit(restore)  – Besuch beenden (restore=true: eigene Stadt wiederherstellen)
 *   Cloud.autoSave(reason, force) – sofort automatisch speichern (falls erlaubt)
 */

const Cloud = {
  AUTO_NAME: 'Auto-Speicherstand',
  MAX_SIZE: 2000000,      // Zeichen; muss zu database.rules.json passen
  MAX_SAVES: 20,          // eigene Cloud-Spielstände (ohne Auto-Speicherstand)
  interval: 60000,        // ms zwischen Auto-Speicherungen (Testhaken: verkleinern)

  city: null, view: null,
  enabled: true,          // Option "Auto-Speichern"
  suspended: false,       // von coop.js gesetzt, solange eine Multiplayer-Sitzung läuft
  publishing: false,      // eigene Stadt ist in der Region sichtbar
  cloudAuto: null,        // saveMeta/{uid}/autosave oder null
  lastKey: null,          // Zustand beim letzten Auto-Speichern
  lastSave: 0,            // performance.now() des letzten Auto-Speicherns
  visit: null,            // { uid, owner, name, snapshot, saveName, msgLog, cam } während eines Besuchs
  _restoring: false,
  _entering: false,
  _regionRef: null,
  _ownRef: null,
  _regionCb: null,
  _regionRows: {},
  _sort: 'pop',

  init(city, view) {
    this.city = city; this.view = view;
    this.injectCSS();
    const opt = UI.lsGet('simcity89-autosave');
    this.enabled = opt !== '0';

    UI.menuExt['Optionen'] = (UI.menuExt['Optionen'] || []).concat([
      ['Auto-Speichern', () => this.setEnabled(!this.enabled), null, () => this.enabled],
    ]);
    UI.menuExt['Online'] = (UI.menuExt['Online'] || []).concat([
      ['Cloud-Spielstände…', () => this.openSaves()],
      ['Region & Bestenliste…', () => this.openRegion()],
    ]);
    UI.startButtons.push({ label: 'Weiterspielen', fn: () => this.continueGame(), show: () => this.hasAutosave() });

    // Während eines Besuchs nicht bauen (Abfrage bleibt erlaubt)
    UI.toolHooks.push(tool => {
      if (!this.visit || (tool && tool.id === 'query')) return false;
      UI.status(`Nur ansehen – das ist die Stadt von ${this.visit.owner}.`, true);
      Sound.error();
      return true;
    });
    // Speichern während eines Besuchs würde die fremde Stadt unter eigenem Namen ablegen
    const origSave = UI.saveCity;
    UI.saveCity = function (ask) {
      if (Cloud.visit) { this.status(`Nur ansehen – das ist die Stadt von ${Cloud.visit.owner}.`, true); return; }
      return origSave.call(this, ask);
    };
    // Wird während eines Besuchs eine andere Stadt geladen/gegründet, endet der Besuch ohne Rückkehr
    const origAfter = UI.afterLoad;
    UI.afterLoad = function () {
      if (Cloud.visit && !Cloud._restoring && !Cloud._entering) Cloud.endVisit(false);
      return origAfter.apply(this, arguments);
    };

    setInterval(() => {
      if (performance.now() - this.lastSave >= this.interval) this.autoSave('timer');
    }, 5000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.autoSave('hidden'); });
    window.addEventListener('pagehide', () => this.autoSave('pagehide'));

    Net.on((t, d) => {
      if (t === 'auth') this.onAuth(d.user);
      else if (t === 'beforeSignOut') { this.autoSave('signout', true, true); }
    });
  },

  injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
      .cl-table { border-collapse: collapse; width: 100%; font-size: 12px; }
      .cl-table th { background: #c0c0c0; border: 1px outset #fff; padding: 1px 4px; text-align: left; white-space: nowrap; }
      .cl-table th.sort { cursor: pointer; text-decoration: underline; }
      .cl-table th.sorted { background: #a8a8a8; border-style: inset; }
      .cl-table td { border-bottom: 1px solid #c0c0c0; padding: 1px 4px; white-space: nowrap; }
      .cl-table td.r, .cl-table th.r { text-align: right; }
      .cl-table tr.own td { background: #ffffc0; font-weight: bold; }
      #cl-visit { left: 50%; top: 30px; transform: translateX(-50%); z-index: 1500; min-width: 0; }
      #cl-visit .wbody { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    `;
    document.head.appendChild(s);
  },

  setEnabled(on) {
    this.enabled = on;
    try { UI.lsSet('simcity89-autosave', on ? '1' : '0'); } catch (e) { /* egal */ }
    UI.status(on ? 'Auto-Speichern eingeschaltet.' : 'Auto-Speichern ausgeschaltet.');
    if (on) this.autoSave('option');
  },

  // =================== Anmeldung ===================
  onAuth(user) {
    this.publishing = false;
    this.cloudAuto = null;
    if (this._ownRef) { this._ownRef.off(); this._ownRef = null; }
    if (!user) { UI.closeWin('cloudsaves'); this.closeRegion(); return; }
    const uid = user.uid;
    // Eintrag live verfolgen (auch Änderungen von einem anderen Gerät)
    this._ownRef = Net.ref('region/meta/' + uid);
    this._ownRef.on('value', s => {
      if (Net.uid !== uid) return;
      this.publishing = s.exists();
      this.refreshRegionCheckbox();
    }, () => {});
    Net.ref('saveMeta/' + uid + '/autosave').once('value').then(s => {
      if (Net.uid !== uid) return;
      this.cloudAuto = s.val();
      if (this.cloudAuto) this.addContinueButton();
    }).catch(() => {});
  },

  // =================== Auto-Speichern ===================
  localAuto() {
    if (!UI.storageOK()) return null;
    const e = UI.savesIndex().find(s => s.name === this.AUTO_NAME);
    return e && UI.lsGet('simcity89-save-' + this.AUTO_NAME) ? e : null;
  },

  hasAutosave() { return !!(this.localAuto() || this.cloudAuto); },

  /** Darf jetzt automatisch gespeichert werden? */
  canAutoSave() {
    const c = this.city;
    return UI.hasRunningCity && !c.remote && !this.suspended && !this.visit;
  },

  stateKey() {
    const c = this.city;
    return [c.mapVersion, c.cityTime, c.funds, c.name, c.zones.size].join('|');
  },

  /** Auto-Speichern: lokal + (angemeldet) Cloud; außerdem Region aktualisieren. force: auch ohne Änderung. */
  autoSave(reason, force, localOnly) {
    if (!this.canAutoSave()) return false;
    const key = this.stateKey();
    if (key === this.lastKey && !force) return false;
    this.lastSave = performance.now();
    this.lastKey = key;
    const c = this.city;
    let json;
    try { json = JSON.stringify(c.serialize()); } catch (e) { console.error(e); return false; }
    const done = [];
    if (this.enabled) {
      if (this.saveLocal(json)) done.push('lokal');
      if (!localOnly && Net.available && Net.user && json.length < this.MAX_SIZE) {
        const uid = Net.uid;
        const meta = this.metaFor(this.AUTO_NAME, json);
        Net.ref('/').update({ ['saveData/' + uid + '/autosave']: json, ['saveMeta/' + uid + '/autosave']: meta })
          .then(() => { if (Net.uid === uid) this.cloudAuto = Object.assign({}, meta, { savedAt: Date.now() }); })
          .catch(e => console.warn('Auto-Speichern (Cloud) fehlgeschlagen', e));
        done.push('Cloud');
      }
    }
    if (!localOnly && this.publishing) this.publish(json);
    if (done.length && (reason === 'timer' || reason === 'option' || reason === 'test')) {
      const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      UI.status(`Automatisch gespeichert (${done.join(' + ')}, ${t})`);
    }
    return done.length > 0;
  },

  saveLocal(json) {
    if (!UI.storageOK()) return false;
    const c = this.city;
    try {
      UI.lsSet('simcity89-save-' + this.AUTO_NAME, json);
      const idxs = UI.savesIndex().filter(s => s.name !== this.AUTO_NAME);
      idxs.unshift({ name: this.AUTO_NAME, city: c.name, date: c.dateString(), pop: c.population(),
        saved: new Date().toLocaleString('de-DE'), ts: Date.now() });
      UI.lsSet('simcity89-index', JSON.stringify(idxs));
      return true;
    } catch (e) {
      console.warn('Auto-Speichern (lokal) fehlgeschlagen', e);
      return false;
    }
  },

  metaFor(name, json) {
    const c = this.city;
    return { name: String(name).slice(0, 60), city: String(c.name || '').slice(0, 60), date: c.dateString(),
      pop: c.population(), size: json.length, savedAt: Net.TIMESTAMP };
  },

  /** Startbildschirm: neuesten Auto-Speicherstand laden (Cloud, wenn neuer). */
  continueGame() {
    const local = this.localAuto();
    const cloud = this.cloudAuto;
    const useCloud = cloud && Net.user && (!local || !local.ts || (cloud.savedAt || 0) > local.ts);
    const loadLocal = () => {
      try {
        const raw = UI.lsGet('simcity89-save-' + this.AUTO_NAME);
        if (!raw) throw new Error('Kein Auto-Speicherstand gefunden.');
        this.loadJSON(raw, null);
        return true;
      } catch (e) {
        UI.alert('Laden fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`, () => { if (!UI.hasRunningCity) UI.startScreen(); });
        return false;
      }
    };
    if (!useCloud) { loadLocal(); return; }
    UI.status('Lade Auto-Speicherstand aus der Cloud…');
    Net.ref('saveData/' + Net.uid + '/autosave').once('value').then(s => {
      if (!s.exists()) throw new Error('Auto-Speicherstand in der Cloud nicht gefunden.');
      this.loadJSON(s.val(), null);
    }).catch(e => {
      if (local) { UI.status('Cloud nicht erreichbar – lade lokalen Auto-Speicherstand.', true); loadLocal(); }
      else UI.alert('Laden fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`, () => { if (!UI.hasRunningCity) UI.startScreen(); });
    });
  },

  /** Knopf "Weiterspielen" nachträglich in den offenen Startbildschirm setzen (Cloud-Info kommt asynchron). */
  addContinueButton() {
    const col = document.querySelector('#start-bg .col');
    if (!col || [...col.querySelectorAll('button')].some(b => b.textContent === 'Weiterspielen')) return;
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = 'Weiterspielen';
    b.addEventListener('click', () => {
      const bg = document.getElementById('start-bg');
      if (bg) { bg.remove(); UI.modal = Math.max(0, UI.modal - 1); }
      this.continueGame();
    });
    col.appendChild(b);
  },

  /** Spielstand (JSON-Text) als eigene Stadt laden. */
  loadJSON(json, saveName) {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    UI.loadObject(o);
    this.city.saveName = saveName || undefined;
    this.lastKey = this.stateKey();
    this.lastSave = performance.now();
  },

  // =================== Cloud-Spielstände ===================
  openSaves() {
    if (this.suspended) { UI.alert('Cloud-Spielstände', '<p>Während einer Multiplayer-Sitzung nicht verfügbar.</p>'); return; }
    Net.requireLogin(() => this.showSaves(), 'Cloud-Spielstände werden in deinem Google-Konto gespeichert. Bitte melde dich an.');
  },

  showSaves() {
    UI.closeWin('cloudsaves');
    const uid = Net.uid;
    const body = document.createElement('div');
    body.style.width = 'min(440px, calc(100vw - 24px))';
    body.innerHTML = `<div class="saves sunken" id="cs-list"><i>Lade…</i></div>
      <div class="row wrap" style="justify-content:flex-end;margin-top:6px">
        <button class="btn" id="cs-save">Aktuelle Stadt in der Cloud speichern…</button><button class="btn" id="cs-close">Schließen</button></div>`;
    body.querySelector('#cs-close').addEventListener('click', () => UI.closeWin('cloudsaves'));
    body.querySelector('#cs-save').addEventListener('click', () => this.saveToCloudDialog());
    UI.win('cloudsaves', 'Cloud-Spielstände', body, { modal: true });
    Net.ref('saveMeta/' + uid).once('value').then(s => {
      const list = body.querySelector('#cs-list');
      const all = s.val() || {};
      const saves = Object.keys(all).map(id => Object.assign({ id }, all[id])).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      this._saves = saves;
      if (!saves.length) { list.innerHTML = '<i>Noch keine Spielstände in der Cloud.</i>'; return; }
      list.innerHTML = saves.map((m, i) => `<div class="row"><span><b>${esc(m.id === 'autosave' ? this.AUTO_NAME : m.name)}</b><br>
        <span class="note">${esc(m.city || '')} · ${esc(m.date || '')} · ${fmtNum(m.pop || 0)} Einw. · gespeichert ${esc(this.fmtTime(m.savedAt))}</span></span>
        <span style="white-space:nowrap"><button class="btn small" data-load="${i}">Laden</button><button class="btn small" data-del="${i}">Löschen</button></span></div>`).join('');
      list.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => this.loadFromCloud(saves[+b.dataset.load])));
      list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const m = saves[+b.dataset.del];
        UI.confirm('Löschen', `<p>Cloud-Spielstand „${esc(m.id === 'autosave' ? this.AUTO_NAME : m.name)}“ wirklich löschen?</p>`, 'Löschen', () => this.deleteFromCloud(m));
      }));
    }).catch(e => {
      body.querySelector('#cs-list').innerHTML = `<p>Liste konnte nicht geladen werden: ${esc(e.message || String(e))}</p>`;
    });
  },

  fmtTime(ts) {
    if (!ts) return '–';
    try { return new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return String(ts); }
  },

  loadFromCloud(m) {
    const uid = Net.uid;
    UI.status('Lade Spielstand aus der Cloud…');
    Net.ref('saveData/' + uid + '/' + m.id).once('value').then(s => {
      if (!s.exists()) throw new Error('Spielstand nicht gefunden.');
      UI.closeWin('cloudsaves');
      this.loadJSON(s.val(), m.id === 'autosave' ? null : m.name);
      UI.status(`${this.city.name} aus der Cloud geladen.`);
    }).catch(e => UI.alert('Laden fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`));
  },

  deleteFromCloud(m) {
    const uid = Net.uid;
    Net.ref('/').update({ ['saveData/' + uid + '/' + m.id]: null, ['saveMeta/' + uid + '/' + m.id]: null }).then(() => {
      if (m.id === 'autosave') this.cloudAuto = null;
      UI.status(`Cloud-Spielstand „${m.name}“ gelöscht.`);
      if (UI.wins.cloudsaves) this.showSaves();
    }).catch(e => UI.alert('Löschen fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`));
  },

  saveToCloudDialog() {
    const c = this.city;
    if (!UI.hasRunningCity || c.remote || this.visit) {
      UI.alert('Speichern nicht möglich', '<p>Es läuft gerade keine eigene Stadt, die gespeichert werden könnte.</p>');
      return;
    }
    UI.ask('In der Cloud speichern', 'Name des Spielstands:', c.saveName || c.name, n => this.saveToCloud(n), 40);
  },

  saveToCloud(name) {
    const c = this.city;
    const uid = Net.uid;
    if (!uid) { UI.alert('Nicht angemeldet', '<p>Bitte zuerst anmelden.</p>'); return; }
    let json;
    try { json = JSON.stringify(c.serialize()); } catch (e) { UI.alert('Speichern fehlgeschlagen', `<p>${esc(e.message)}</p>`); return; }
    if (json.length >= this.MAX_SIZE) {
      UI.alert('Speichern fehlgeschlagen', `<p>Der Spielstand ist zu groß für die Cloud (${fmtNum(Math.round(json.length / 1024))} KB).</p>`);
      return;
    }
    Net.ref('saveMeta/' + uid).once('value').then(s => {
      const all = s.val() || {};
      const ids = Object.keys(all).filter(id => id !== 'autosave');
      let id = ids.find(k => all[k].name === name);
      if (!id) {
        if (ids.length >= this.MAX_SAVES) throw new Error(`Es sind höchstens ${this.MAX_SAVES} Cloud-Spielstände möglich. Bitte lösche zuerst einen alten.`);
        id = Net.ref('saveMeta/' + uid).push().key;
      }
      return Net.ref('/').update({ ['saveData/' + uid + '/' + id]: json, ['saveMeta/' + uid + '/' + id]: this.metaFor(name, json) });
    }).then(() => {
      c.saveName = name;
      UI.status(`Spielstand „${name}“ in der Cloud gespeichert.`);
      if (UI.wins.cloudsaves) this.showSaves();
    }).catch(e => UI.alert('Speichern fehlgeschlagen', `<p>${esc(e.message || String(e))}</p>`));
  },

  // =================== Region & Bestenliste ===================
  openRegion() {
    Net.requireLogin(() => this.showRegion(), 'Die Region zeigt die Städte aller angemeldeten Spieler. Bitte melde dich an.');
  },

  showRegion() {
    if (UI.wins.region) { UI.focusWin(UI.wins.region); return; }
    const body = document.createElement('div');
    body.style.width = 'min(620px, calc(100vw - 24px))';
    body.innerHTML = `<div class="row wrap"><label><input type="checkbox" id="rg-pub"> Meine Stadt in der Region zeigen</label>
        <span class="note" style="flex:1;text-align:right">Wird bei jedem Auto-Speichern aktualisiert.</span></div>
      <div class="sunken" style="max-height:300px;overflow:auto;padding:0" id="rg-list"><div style="padding:4px"><i>Lade…</i></div></div>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="rg-close">Schließen</button></div>`;
    body.querySelector('#rg-close').addEventListener('click', () => UI.closeWin('region'));
    const cb = body.querySelector('#rg-pub');
    cb.checked = this.publishing;
    cb.addEventListener('change', () => this.setPublishing(cb.checked));
    UI.win('region', 'Region & Bestenliste', body, { onClose: () => this.closeRegion(true) });
    this._regionRef = Net.ref('region/meta');
    this._regionCb = this._regionRef.on('value', s => { this._regionRows = s.val() || {}; this.renderRegion(); },
      e => { const l = body.querySelector('#rg-list'); if (l) l.innerHTML = `<p style="padding:4px">Fehler: ${esc(e.message || String(e))}</p>`; });
  },

  closeRegion(fromWin) {
    if (this._regionRef) { this._regionRef.off('value', this._regionCb); this._regionRef = null; }
    if (!fromWin) UI.closeWin('region');
  },

  refreshRegionCheckbox() {
    const cb = document.getElementById('rg-pub');
    if (cb) cb.checked = this.publishing;
  },

  renderRegion() {
    const list = document.getElementById('rg-list');
    if (!list) return;
    const key = this._sort;
    const rows = Object.keys(this._regionRows).map(uid => Object.assign({ uid }, this._regionRows[uid]))
      .sort((a, b) => (b[key] || 0) - (a[key] || 0) || (b.pop || 0) - (a.pop || 0));
    if (!rows.length) { list.innerHTML = '<div style="padding:4px"><i>Noch keine Städte in der Region.</i></div>'; return; }
    const th = (k, label) => `<th class="r sort${key === k ? ' sorted' : ''}" data-sort="${k}" title="Nach ${label} sortieren">${label}${key === k ? ' ▼' : ''}</th>`;
    list.innerHTML = `<table class="cl-table"><thead><tr><th class="r">#</th><th>Bürgermeister</th><th>Stadt</th>${th('pop', 'Einwohner')}
      <th>Klasse</th>${th('score', 'Wertung')}<th class="r">Jahr</th><th>Aktualisiert</th><th></th></tr></thead><tbody>${rows.map((r, i) => {
      const own = r.uid === Net.uid;
      return `<tr class="${own ? 'own' : ''}"><td class="r">${i + 1}</td><td>${esc(r.owner || '?')}</td><td>${esc(r.name || '?')}</td>
        <td class="r">${fmtNum(r.pop || 0)}</td><td>${esc(CLASS_NAMES[r.cls] || '–')}</td><td class="r">${r.score !== undefined ? Math.round(r.score) : '–'}</td>
        <td class="r">${r.year || '–'}</td><td>${esc(this.fmtTime(r.updatedAt))}</td>
        <td>${own ? '<span class="note">(du)</span>' : `<button class="btn small" data-visit="${esc(r.uid)}">Besuchen</button>`}</td></tr>`;
    }).join('')}</tbody></table>`;
    list.querySelectorAll('[data-sort]').forEach(h => h.addEventListener('click', () => { this._sort = h.dataset.sort; this.renderRegion(); }));
    list.querySelectorAll('[data-visit]').forEach(b => b.addEventListener('click', () => {
      const r = this._regionRows[b.dataset.visit];
      this.startVisit(b.dataset.visit, r ? r.owner : '?');
    }));
  },

  setPublishing(on) {
    const uid = Net.uid;
    if (!uid) return;
    if (on) {
      if (!UI.hasRunningCity || this.city.remote || this.suspended || this.visit) {
        this.refreshRegionCheckbox();
        UI.alert('Region', '<p>Es läuft gerade keine eigene Stadt, die gezeigt werden könnte.</p>');
        return;
      }
      this.publishing = true;
      this.publish(JSON.stringify(this.city.serialize())).then(ok => {
        if (ok) UI.status('Deine Stadt ist jetzt in der Region zu sehen.');
      });
    } else {
      this.publishing = false;
      Net.ref('/').update({ ['region/meta/' + uid]: null, ['region/data/' + uid]: null })
        .then(() => UI.status('Deine Stadt wurde aus der Region entfernt.'))
        .catch(e => UI.alert('Region', `<p>Entfernen fehlgeschlagen: ${esc(e.message || String(e))}</p>`));
    }
  },

  /** Eigene Stadt in die Region schreiben (Daten + Bestenlisten-Eintrag). */
  publish(json) {
    const uid = Net.uid;
    const c = this.city;
    if (!uid || !Net.available) return Promise.resolve(false);
    if (json.length >= this.MAX_SIZE) { UI.status('Stadt zu groß für die Region.', true); return Promise.resolve(false); }
    const meta = { owner: String(Net.name).slice(0, 100), name: String(c.name || 'Stadt').slice(0, 60) || 'Stadt', pop: c.population(),
      cls: c.cityClass | 0, score: Math.max(0, Math.min(1000, Math.round(c.cityScore || 0))), year: c.year, updatedAt: Net.TIMESTAMP };
    return Net.ref('/').update({ ['region/data/' + uid]: json, ['region/meta/' + uid]: meta }).then(() => true).catch(e => {
      console.warn('Region-Veröffentlichung fehlgeschlagen', e);
      UI.status('Veröffentlichen in der Region fehlgeschlagen: ' + (e.message || e), true);
      return false;
    });
  },

  // =================== Stadtbesuch ===================
  isVisiting() { return !!this.visit; },

  startVisit(uid, owner) {
    if (this.suspended) { UI.alert('Besuch', '<p>Während einer Multiplayer-Sitzung nicht möglich.</p>'); return; }
    UI.status(`Lade die Stadt von ${owner}…`);
    Net.ref('region/data/' + uid).once('value').then(s => {
      if (!s.exists()) throw new Error('Diese Stadt ist nicht mehr in der Region.');
      const o = JSON.parse(s.val());
      const c = this.city;
      if (!this.visit) {
        // eigene Stadt vorher sichern (lokal/Cloud) und exakt im Speicher behalten
        this.autoSave('visit', true);
        const own = UI.hasRunningCity && !c.remote;
        this.visit = {
          snapshot: own ? JSON.stringify(c.serialize()) : null,
          // von fullAnalysis neu berechnet – für exakte Rückkehr mitsichern
          census: own ? JSON.stringify({ stats: c.stats, cen: c.cen, rng: RNG.s }) : null,
          arrays: own ? this.copyArrays() : null,
          saveName: c.saveName, msgLog: UI.msgLog.slice(),
          cam: { x: this.view.camX, y: this.view.camY, zoom: this.view.zoom },
        };
      }
      this.visit.uid = uid; this.visit.owner = owner; this.visit.name = o.name;
      this._entering = true;
      try {
        UI.closeWin('region');
        UI.loadObject(o);
      } finally { this._entering = false; }
      c.remote = true;
      this.showBanner();
      UI.status(`Zu Besuch in ${o.name} – nur ansehen, nicht bauen.`);
    }).catch(e => UI.alert('Besuch nicht möglich', `<p>${esc(e.message || String(e))}</p>`));
  },

  /** Kopien aller Karten (Kacheln, Strom, Analysekarten) – auch die nicht gespeicherten. */
  copyArrays() {
    const out = {};
    for (const key of Object.keys(this.city)) {
      const t = this.city[key];
      if (ArrayBuffer.isView(t) && !(t instanceof DataView)) out[key] = t.slice();
    }
    return out;
  },

  showBanner() {
    let b = document.getElementById('cl-visit');
    if (b) b.remove();
    b = document.createElement('div');
    b.id = 'cl-visit'; b.className = 'win';
    b.innerHTML = `<div class="wtitle" style="cursor:default"><span>Stadtbesuch</span></div>
      <div class="wbody"><span>Zu Besuch in <b>${esc(this.visit.name)}</b> von ${esc(this.visit.owner)}</span>
      <button class="btn def" id="cl-back">Zurück zur eigenen Stadt</button></div>`;
    b.querySelector('#cl-back').addEventListener('click', () => this.endVisit(true));
    document.getElementById('app').appendChild(b);
  },

  /** Besuch beenden; restore=true stellt die eigene Stadt exakt wieder her. */
  endVisit(restore) {
    const v = this.visit;
    if (!v) return;
    this.visit = null;
    const b = document.getElementById('cl-visit');
    if (b) b.remove();
    const c = this.city;
    if (!this.suspended) c.remote = false;
    if (!restore) return;
    if (!v.snapshot) { UI.startScreen(); return; }
    this._restoring = true;
    try {
      UI.loadObject(JSON.parse(v.snapshot));
    } finally { this._restoring = false; }
    if (v.census) {
      const k = JSON.parse(v.census);
      c.stats = Object.assign(City.emptyCensus(), k.stats);
      if (k.cen) c.cen = Object.assign(City.emptyCensus(), k.cen);
      RNG.s = k.rng;
    }
    if (v.arrays) {
      for (const key in v.arrays) {
        const t = c[key];
        if (ArrayBuffer.isView(t) && t.length === v.arrays[key].length) t.set(v.arrays[key]);
      }
      c.mapVersion++;
    }
    UI.updateStatus();
    c.remote = false;
    c.saveName = v.saveName;
    UI.msgLog = v.msgLog; UI.fillLog();
    if (v.cam) { this.view.setZoom(v.cam.zoom); this.view.camX = v.cam.x; this.view.camY = v.cam.y; this.view.clampCam(); }
    this.lastKey = this.stateKey();
    UI.status(`Zurück in ${c.name}.`);
  },
};
