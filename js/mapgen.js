'use strict';
/* Geländeerzeugung – angelehnt an den Kartengenerator des Originals:
 * große und kleine Flüsse als Zufallswanderung, Seen, Waldflecken, optional Insel. */

const DIR8X = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR8Y = [-1, -1, 0, 1, 1, 1, 0, -1];

function genPaint(city, x, y, r, kind) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r + r * 0.6) continue;
    const xx = x + dx, yy = y + dy;
    if (inBounds(xx, yy)) city.tile[idx(xx, yy)] = kind;
  }
}

function genRiver(city, x, y, dir, r, curve) {
  let steps = 0, last = dir;
  while (x > -r - 2 && y > -r - 2 && x < W + r + 2 && y < H + r + 2 && steps < 600) {
    genPaint(city, x, y, r, T.WATER);
    if (rand(100) < 10) dir = last;
    else {
      if (rand(200) > 200 - curve) dir = (dir + 1) & 7;
      if (rand(200) > 200 - curve) dir = (dir + 7) & 7;
    }
    x += DIR8X[dir]; y += DIR8Y[dir];
    steps++;
  }
}

function genLake(city, x, y) {
  const n = 2 + rand(12);
  for (let i = 0; i < n; i++) {
    genPaint(city, x + rand(12) - 6, y + rand(12) - 6, 1 + rand(3), T.WATER);
  }
}

function genTreeSplash(city, x, y, amount) {
  let dir = rand(7);
  for (let i = 0; i < amount; i++) {
    if (rand(100) < 30) dir = rand(7);
    x += DIR8X[dir]; y += DIR8Y[dir];
    if (!inBounds(x, y)) return;
    const i2 = idx(x, y);
    if (city.tile[i2] === T.DIRT) city.tile[i2] = T.TREES;
  }
}

function genSmooth(city) {
  // einzelne Wasser- und Landfelder glätten
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y), k = city.tile[i];
      let water = 0, n = 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (!inBounds(xx, yy)) continue;
        n++;
        if (city.tile[idx(xx, yy)] === T.WATER) water++;
      }
      if (k === T.WATER && water <= 1 && n === 4) city.tile[i] = T.DIRT;
      else if (k !== T.WATER && water >= 3) city.tile[i] = T.WATER;
    }
  }
  // einzelne Bäume entfernen (wie smoothTrees)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (city.tile[i] !== T.TREES) continue;
    let t = 0;
    for (let d = 0; d < 4; d++) if (city.kind(x + DX[d], y + DY[d]) === T.TREES) t++;
    if (t === 0 && rand(1) === 0) city.tile[i] = T.DIRT;
  }
}

/**
 * opts: { seed, island (bool), water (0..2), trees (0..2) }
 */
function generateTerrain(city, opts) {
  opts = opts || {};
  if (opts.seed) RNG.s = opts.seed >>> 0 || 1;
  city.tile.fill(T.DIRT);
  city.vari.fill(0);
  city.zid.fill(-1);
  city.zones.clear();
  const waterLvl = opts.water === undefined ? 1 : opts.water;
  const treeLvl = opts.trees === undefined ? 1 : opts.trees;

  if (opts.island) {
    city.tile.fill(T.WATER);
    // Insel mit zerklüfteter Küste
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x > 8 && x < W - 9 && y > 8 && y < H - 9) city.tile[idx(x, y)] = T.DIRT;
    }
    for (let i = 0; i < 300; i++) {
      const side = rand(3);
      let x, y;
      if (side === 0) { x = 6 + rand(W - 12); y = 6 + rand(6); }
      else if (side === 1) { x = 6 + rand(W - 12); y = H - 13 + rand(6); }
      else if (side === 2) { x = 6 + rand(6); y = 6 + rand(H - 12); }
      else { x = W - 13 + rand(6); y = 6 + rand(H - 12); }
      genPaint(city, x, y, 1 + rand(2), rand(1) ? T.DIRT : T.WATER);
    }
  }

  if (waterLvl > 0) {
    // großer Fluss
    const sx = 40 + rand(W - 80), sy = 33 + rand(H - 67);
    const dir = rand(7);
    const curve = 10 + rand(25);
    genRiver(city, sx, sy, dir, 3 + (waterLvl > 1 ? 1 : 0), curve);
    genRiver(city, sx, sy, (dir + 4) & 7, 3 + (waterLvl > 1 ? 1 : 0), curve);
    // kleine Flüsse
    const small = waterLvl > 1 ? 3 : 1 + rand(1);
    for (let i = 0; i < small; i++) genRiver(city, sx + rand(20) - 10, sy + rand(20) - 10, rand(7), 1, curve + 10);
    // Seen
    const lakes = waterLvl > 1 ? 3 + rand(4) : rand(3);
    for (let i = 0; i < lakes; i++) genLake(city, 10 + rand(W - 20), 10 + rand(H - 20));
  }

  if (treeLvl > 0) {
    const amount = treeLvl > 1 ? 80 + rand(60) : 40 + rand(40);
    for (let i = 0; i < amount; i++) genTreeSplash(city, rand(W - 1), rand(H - 1), 50 + rand(150));
  }
  genSmooth(city);
  for (let i = 0; i < W * H; i++) city.vari[i] = rand(3);
  city.mapVersion++;
  city.powerDirty = true;
}
