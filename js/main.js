'use strict';
/* Start und Hauptschleife. */

(function () {
  const city = new City();
  generateTerrain(city, { seed: (Math.random() * 1e9) >>> 0 });
  city.fullAnalysis();
  const view = new View(document.getElementById('map'), city);
  UI.init(city, view);
  Advisor.init(city, view);
  Net.init();
  if (typeof Cloud !== 'undefined') Cloud.init(city, view);
  if (typeof Coop !== 'undefined') Coop.init(city, view);
  UI.startButtons.unshift({ label: 'Mit Google anmelden', fn: () => { UI.startScreen(); Net.signIn(); }, show: () => Net.available && !Net.user });
  UI.buildMenus();
  Net.on(t => { if (t === 'auth') UI.buildMenus(); });
  document.getElementById('st-online').addEventListener('click', () => {
    if (Net.initError) UI.alert('Online-Fehler', `<p style="max-width:340px">Firebase konnte nicht gestartet werden (<code>${Net.initError}</code>). Bitte die Werte in <code>js/firebase-config.js</code> prüfen.</p>`);
    else if (!Net.user) Net.signIn();
    else UI.confirm('Abmelden', `<p>Angemeldet als <b>${Net.name}</b>. Abmelden?</p>`, 'Abmelden', () => Net.signOut());
  });
  view.centerOn(W / 2, H / 2);
  UI.updateStatus();
  UI.startScreen();
  window.SC = { city, view, UI };   // für die Konsole

  // Neue Version auf dem Server? (version.txt wird bei jeder Veröffentlichung zusammen mit ?v= in index.html erhöht)
  const GAME_VERSION = '2026-10-19.7';
  let versionHinted = false;
  const checkVersion = () => {
    if (versionHinted || location.protocol === 'file:' || !window.fetch) return;
    fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).then(t => {
      t = t.trim();
      if (t && t !== GAME_VERSION) {
        versionHinted = true;
        UI.alert('Neue Version verfügbar', '<p style="max-width:340px">Es gibt eine neue Version des Spiels. Bitte die Seite neu laden ' +
          '(Strg+Umschalt+R). Im Multiplayer sollten alle Spieler neu laden – der Gastgeber setzt den Raum danach unter ' +
          '<i>Online → Gemeinsame Stadt → Meine Räume → Fortsetzen</i> fort. Die Stadt wird vorher automatisch gespeichert.</p>');
        if (typeof Cloud !== 'undefined' && Cloud.autoSave) { try { Cloud.autoSave('version', true); } catch (e) { /* egal */ } }
      }
    }).catch(() => {});
  };
  setTimeout(checkVersion, 15000);
  setInterval(checkVersion, 5 * 60 * 1000);

  // Millisekunden pro Simulationszyklus (16 Phasen = 1 Woche)
  const CYCLE_MS = [0, 1200, 400, 100];
  let last = performance.now(), acc = 0, spriteAcc = 0, uiAcc = 0;

  let errCount = 0;
  function loop(now) {
    requestAnimationFrame(loop);   // zuerst: ein Fehler in einem Bild darf die Schleife nicht beenden
    try { step(now); } catch (e) {
      if (errCount++ < 5) console.error(e);
      if (errCount === 1) UI.status('Interner Fehler: ' + (e && e.message), true);
    }
  }
  function step(now) {
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    // city.remote: Stadt wird von außen gesteuert (Mitspieler im Multiplayer, Stadtbesuch) – keine eigene Simulation
    if (!UI.paused && !city.remote) {
      const phaseMs = CYCLE_MS[city.speed] / 16;
      acc += dt;
      let n = 0;
      while (acc >= phaseMs && n < 64 && !UI.paused) { city.simPhase(); acc -= phaseMs; n++; }
      if (n >= 64) acc = 0;
      spriteAcc += dt * (city.speed === 3 ? 1.5 : 1);
      while (spriteAcc >= 33) { city.moveSprites(); spriteAcc -= 33; }
    } else acc = 0;
    if (city.powerDirty) city.powerScan();
    view.render(now, UI.paused);
    uiAcc += dt;
    if (uiAcc > 200) { uiAcc = 0; UI.updateStatus(); UI.drawRCI(); }
    if (UI.mapCanvas) UI.drawMapWin(false);
    for (const h of UI.tickHooks) h(now);
  }
  requestAnimationFrame(loop);
})();
