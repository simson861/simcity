'use strict';
/*
 * Online-Grundlage: Firebase (Google-Anmeldung + Realtime Database).
 * Die eigentlichen Funktionen stecken in cloud.js (Spielstände, Auto-Speichern,
 * Region) und coop.js (gemeinsame Städte). Ohne Konfiguration ist Net.available false
 * und das Spiel bleibt rein offline.
 */

const Net = {
  available: false,
  emulator: false,
  user: null,          // Firebase-Benutzer oder null
  connected: false,    // Verbindung zur Datenbank steht
  auth: null, db: null,
  listeners: [],

  init() {
    const params = new URLSearchParams(location.search);
    this.emulator = params.has('emulator');
    let cfg = typeof FIREBASE_CONFIG !== 'undefined' ? FIREBASE_CONFIG : null;
    if (this.emulator) {
      cfg = { apiKey: 'demo-key', authDomain: 'demo-simcity.firebaseapp.com', projectId: 'demo-simcity',
        databaseURL: 'http://127.0.0.1:9000/?ns=demo-simcity' };
    }
    if (!cfg || typeof firebase === 'undefined') { this.updateIndicator(); return; }
    try {
      firebase.initializeApp(cfg);
      this.auth = firebase.auth();
      this.db = firebase.database();
      if (this.emulator) {
        this.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        this.db.useEmulator('127.0.0.1', 9000);
      }
      this.available = true;
    } catch (e) {
      console.error('Firebase konnte nicht gestartet werden', e);
      this.updateIndicator();
      return;
    }
    // Rückkehr von einer Weiterleitungs-Anmeldung (Handy, blockierte Popups)
    this.auth.getRedirectResult().catch(e => this.authError(e));
    this.auth.onAuthStateChanged(u => {
      this.user = u;
      if (u) {
        this.ref('users/' + u.uid).update({ name: this.name, photo: u.photoURL || '', lastSeen: this.TIMESTAMP }).catch(() => {});
      }
      this.updateIndicator();
      this.emit('auth', { user: u });
    });
    this.db.ref('.info/connected').on('value', s => {
      this.connected = !!s.val();
      this.updateIndicator();
      this.emit('connection', { connected: this.connected });
    });
    this.updateIndicator();
  },

  get TIMESTAMP() { return firebase.database.ServerValue.TIMESTAMP; },
  get uid() { return this.user ? this.user.uid : null; },
  get name() {
    if (!this.user) return '';
    return this.user.displayName || (this.user.email ? this.user.email.split('@')[0] : 'Bürgermeister');
  },

  on(fn) { this.listeners.push(fn); },
  emit(type, data) { for (const fn of this.listeners) { try { fn(type, data || {}); } catch (e) { console.error(e); } } },

  ref(path) { return this.db.ref(path); },

  /** Anmeldung mit Google: Popup, bei Blockade Weiterleitung. */
  signIn() {
    if (!this.available) { this.notConfigured(); return Promise.resolve(null); }
    if (this.emulator) return this.signInTest();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return this.auth.signInWithPopup(provider).catch(e => {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        return this.auth.signInWithRedirect(provider);
      }
      if (e && e.code === 'auth/popup-closed-by-user') return null;
      this.authError(e);
      return null;
    });
  },

  /** Emulator-Testmodus: Google-Konto mit frei wählbarem Namen vortäuschen (kein Google-Server nötig). */
  signInTest(name) {
    const go = n => {
      const id = n.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'test';
      const tok = JSON.stringify({ sub: 'test-' + id, email: id + '@example.com', email_verified: true, name: n });
      return this.auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(tok)).catch(e => this.authError(e));
    };
    if (name) return go(name);
    return new Promise(res => UI.ask('Test-Anmeldung (Emulator)', 'Name des Test-Kontos:', 'Spieler 1', n => res(go(n)), 30));
  },

  signOut() {
    if (!this.available) return Promise.resolve();
    this.emit('beforeSignOut');
    return this.auth.signOut();
  },

  authError(e) {
    if (!e) return;
    const hints = {
      'auth/unauthorized-domain': 'Diese Adresse ist in Firebase nicht als „Autorisierte Domain“ eingetragen (Authentication → Einstellungen).',
      'auth/operation-not-allowed': 'Die Google-Anmeldung ist im Firebase-Projekt noch nicht aktiviert (Authentication → Anmeldemethode).',
      'auth/network-request-failed': 'Keine Verbindung zum Anmeldedienst. Bitte Internetverbindung prüfen.',
    };
    UI.alert('Anmeldung fehlgeschlagen', `<p>${hints[e.code] || (e.message || 'Unbekannter Fehler')}</p>`);
  },

  notConfigured() {
    UI.alert('Online nicht eingerichtet', `<p style="max-width:360px">Für Anmeldung, Cloud-Spielstände und Multiplayer muss einmalig ein
      kostenloses Firebase-Projekt eingetragen werden (Datei <code>js/firebase-config.js</code>, Anleitung in
      <code>ONLINE-EINRICHTUNG.md</code>). Offline kannst du wie gewohnt spielen.</p>`);
  },

  /** Führt fn aus, sobald jemand angemeldet ist – fragt bei Bedarf nach der Anmeldung. */
  requireLogin(fn, why) {
    if (!this.available) { this.notConfigured(); return; }
    if (this.user) { fn(); return; }
    const off = (t) => { if (t === 'auth' && this.user) { this.listeners = this.listeners.filter(f => f !== off); fn(); } };
    UI.dialog('login', 'Anmeldung erforderlich', `<p style="max-width:320px">${why || 'Für diese Funktion musst du angemeldet sein.'}</p>`, [
      ['Abbrechen', null],
      ['Mit Google anmelden', () => { this.listeners.push(off); this.signIn(); }, true],
    ]);
  },

  updateIndicator() {
    const el = document.getElementById('st-online');
    if (!el) return;
    if (!this.available) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('on', !!this.user && this.connected);
    el.textContent = this.user ? (this.connected ? '● ' : '○ ') + this.name : 'Anmelden';
    el.title = this.user
      ? (this.connected ? 'Online angemeldet als ' + this.name : 'Verbindung unterbrochen – Änderungen werden nachgereicht')
      : 'Mit Google anmelden';
  },

  /** Kurze, eindeutige ID (z. B. für Räume). */
  shortId(n) {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < (n || 6); i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  },
};
