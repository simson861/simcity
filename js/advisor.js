'use strict';
/*
 * Berater (Erweiterung, angelehnt an den Berater der SNES-Fassung): blendet die Hinweise der
 * Simulation („Mehr Industriegebiete benötigt.“) als Sprechblase mit Pixel-Porträt ein.
 * Häufigkeit: 'oft' (alle Hinweise etwa alle 4 Monate), 'original' (wie 1989), 'aus'.
 */

const Advisor = {
  mode: 'oft',
  hideTimer: null,
  current: null,

  init(city, view) {
    this.city = city; this.view = view;
    const saved = UI.lsGet('simcity89-berater');
    if (saved === 'oft' || saved === 'original' || saved === 'aus') this.mode = saved;
    const seasons = UI.lsGet('simcity89-jahreszeiten');
    if (seasons === 'aus') Seasons.enabled = false;

    const box = document.createElement('div');
    box.id = 'advisor';
    box.hidden = true;
    box.innerHTML = '<canvas width="32" height="32"></canvas><div class="adv-bubble"><b>Berater</b><span class="adv-text"></span></div><button class="adv-x" title="Schließen">×</button>';
    document.getElementById('mapwrap').appendChild(box);
    this.box = box;
    this.drawPortrait(box.querySelector('canvas').getContext('2d'));
    box.querySelector('.adv-x').addEventListener('click', e => { e.stopPropagation(); this.hide(); });
    box.addEventListener('click', () => {
      const m = this.current;
      if (m && m.x !== undefined) this.view.centerOn(m.x, m.y);
      else UI.openLog();
      this.hide();
    });

    const css = document.createElement('style');
    css.textContent = `
      #advisor { position: absolute; left: calc(8px + env(safe-area-inset-left, 0px)); bottom: 8px; z-index: 60;
        display: flex; align-items: flex-end; gap: 6px; max-width: min(360px, calc(100% - 220px)); cursor: pointer;
        animation: adv-in 0.25s ease-out; }
      #advisor[hidden] { display: none; }
      #advisor canvas { width: 48px; height: 48px; image-rendering: pixelated; border: 2px outset #fff; background: #6a8ad8; flex: none; }
      #advisor .adv-bubble { background: #fffff0; border: 2px solid #000; padding: 4px 8px; box-shadow: 2px 2px 0 rgba(0,0,0,0.6);
        position: relative; font-size: 12px; line-height: 1.3; }
      #advisor .adv-bubble::before { content: ''; position: absolute; left: -9px; bottom: 8px; border: 4px solid transparent;
        border-right: 6px solid #000; }
      #advisor .adv-bubble b { display: block; color: #000080; font-size: 11px; }
      #advisor .adv-x { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; padding: 0; font: bold 11px/10px Arial;
        border: 2px outset #fff; background: #c0c0c0; cursor: pointer; }
      @keyframes adv-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
      @media (max-width: 640px) { #advisor { max-width: calc(100% - 150px); } #advisor canvas { width: 36px; height: 36px; } }
      @media (prefers-reduced-motion: reduce) { #advisor { animation: none; } }`;
    document.head.appendChild(css);

    city.on((t, d) => {
      if (t === 'message' && !d.important) this.say(d);
    });

    const setMode = m => {
      this.mode = m;
      try { UI.lsSet('simcity89-berater', m); } catch (e) { /* egal */ }
      if (m === 'aus') this.hide();
    };
    UI.addMenuItems('Optionen', [
      ['Jahreszeiten & Wetter', () => {
        Seasons.enabled = !Seasons.enabled;
        try { UI.lsSet('simcity89-jahreszeiten', Seasons.enabled ? 'an' : 'aus'); } catch (e) { /* egal */ }
      }, null, () => Seasons.enabled],
      ['Berater: häufige Hinweise', () => setMode('oft'), null, () => this.mode === 'oft'],
      ['Berater: wie 1989', () => setMode('original'), null, () => this.mode === 'original'],
      ['Berater: aus', () => setMode('aus'), null, () => this.mode === 'aus'],
    ]);
  },

  say(d) {
    if (this.mode === 'aus' || !this.box || !d.text) return;
    this.current = d;
    this.box.querySelector('.adv-text').textContent = d.text;
    this.box.hidden = false;
    // Animation neu starten
    this.box.style.animation = 'none'; void this.box.offsetWidth; this.box.style.animation = '';
    Sound.tone(880, 0.05, 'square', 0.03);
    setTimeout(() => Sound.tone(1175, 0.06, 'square', 0.03), 60);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 7000);
  },

  hide() {
    clearTimeout(this.hideTimer);
    if (this.box) this.box.hidden = true;
  },

  /** Pixel-Porträt: älterer Herr mit grauem Haar, Brille und Krawatte. */
  drawPortrait(g) {
    const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    px(0, 0, 32, 32, '#6a8ad8');
    px(6, 24, 20, 8, '#2a3a6a');           // Anzug
    px(14, 24, 4, 8, '#f0f0f0'); px(15, 25, 2, 6, '#c02020');   // Hemd, Krawatte
    px(10, 8, 12, 15, '#f0c8a0');          // Gesicht
    px(9, 12, 1, 4, '#e0b088'); px(22, 12, 1, 4, '#e0b088');    // Ohren
    px(8, 4, 16, 5, '#d8d8d8'); px(8, 8, 2, 6, '#d8d8d8'); px(22, 8, 2, 6, '#d8d8d8');   // Haar
    px(10, 3, 12, 2, '#b8b8b8');
    px(11, 12, 4, 3, '#202020'); px(17, 12, 4, 3, '#202020'); px(15, 13, 2, 1, '#202020');   // Brille
    px(12, 13, 2, 1, '#a0d0ff'); px(18, 13, 2, 1, '#a0d0ff');
    px(15, 16, 2, 2, '#e0a880');           // Nase
    px(13, 19, 6, 1, '#a05040');           // Mund
    px(12, 21, 8, 1, '#e8e8e8');           // Bart
  },
};
