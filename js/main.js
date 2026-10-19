'use strict';
/* Start und Hauptschleife. */

(function () {
  const city = new City();
  generateTerrain(city, { seed: (Math.random() * 1e9) >>> 0 });
  city.fullAnalysis();
  const view = new View(document.getElementById('map'), city);
  UI.init(city, view);
  view.centerOn(W / 2, H / 2);
  UI.updateStatus();
  UI.startScreen();
  window.SC = { city, view, UI };   // für die Konsole

  // Millisekunden pro Simulationszyklus (16 Phasen = 1 Woche)
  const CYCLE_MS = [0, 1200, 400, 100];
  let last = performance.now(), acc = 0, spriteAcc = 0, uiAcc = 0;

  function loop(now) {
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    if (!UI.paused) {
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
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
