import { hill } from "./sim/pudding/terrain.js";

const W = 600;
const H = 244;
const colors = { a: "#ffab43", b: "#64d28a", player: "#ba8beb" };
const tints = { a: "none", b: "hue-rotate(96deg) saturate(.66) brightness(1.13)", player: "hue-rotate(224deg) saturate(.78)" };

function loadImage(file) {
  const image = new Image();
  image.src = new URL(file, import.meta.url).href;
  return image;
}

const landscape = loadImage("./art/custard-horizon.webp");
const gummy = loadImage("./art/gummy-bear.webp");
export const artworkReady = Promise.allSettled([landscape.decode(), gummy.decode()]);

const sprites = new Map();
function spriteFor(theme) {
  if (!gummy.complete || !gummy.naturalWidth) return null;
  if (theme === "a") return gummy;
  if (sprites.has(theme)) return sprites.get(theme);

  const sprite = document.createElement("canvas");
  sprite.width = gummy.naturalWidth;
  sprite.height = gummy.naturalHeight;
  const ctx = sprite.getContext("2d");
  if (!ctx) return null;
  const supportsFilter = "filter" in ctx;
  if (supportsFilter) ctx.filter = tints[theme];
  ctx.drawImage(gummy, 0, 0);
  if (!supportsFilter) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = colors[theme];
    ctx.fillRect(0, 0, sprite.width, sprite.height);
  }
  sprites.set(theme, sprite);
  return sprite;
}

function ellipse(ctx, x, y, rx, ry, fill, rotation = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function gradient(ctx, x0, y0, x1, y1, stops) {
  const blend = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [position, color] of stops) blend.addColorStop(position, color);
  return blend;
}

function sparkle(ctx, x, y, size, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x + 0.9, y - 0.9, x + size, y);
  ctx.quadraticCurveTo(x + 0.9, y + 0.9, x, y + size);
  ctx.quadraticCurveTo(x - 0.9, y + 0.9, x - size, y);
  ctx.quadraticCurveTo(x - 0.9, y - 0.9, x, y - size);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawSky(ctx, position) {
  if (landscape.complete && landscape.naturalWidth) {
    const cropWidth = landscape.naturalWidth * 0.92;
    const cropHeight = cropWidth * H / W;
    const left = landscape.naturalWidth * (0.04 + 0.038 * Math.sin(position / 1250));
    const top = landscape.naturalHeight * 0.14;
    ctx.drawImage(landscape, left, top, cropWidth, cropHeight, 0, 0, W, H);
    return;
  }
  ctx.fillStyle = gradient(ctx, 0, 0, 0, H, [[0, "#edb4a7"], [0.65, "#ffd195"], [1, "#956281"]]);
  ctx.fillRect(0, 0, W, H);
  ellipse(ctx, 532, 117, 21, 21, "#fff2bf");
}

function drawGround(ctx, terrain, camera) {
  const points = [];
  for (let x = -6; x <= W + 6; x += 3) points.push([x, camera.y(hill(terrain, camera.world(x)))]);
  const trace = lift => {
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      if (i === 0) ctx.moveTo(x, y + lift);
      else ctx.lineTo(x, y + lift);
    }
  };

  ctx.save();
  trace(0);
  ctx.lineTo(W + 6, H + 40);
  ctx.lineTo(-6, H + 40);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = gradient(ctx, 0, 111, 0, H, [
    [0, "#cc8d5c"], [0.54, "#bc7355"], [0.75, "#94555b"], [1, "#58324c"],
  ]);
  ctx.fillRect(0, 0, W, H);
  for (const [lift, width, color] of [
    [3, 9, "#c27b55"], [1, 4, "#ffd59a"], [10, 2, "#dfa36a"],
    [19, 7, "#e5af747a"], [27, 1, "#ffde9e81"], [45, 12, "#48334b35"],
    [56, 2, "#ffc48d53"],
  ]) {
    trace(lift);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  for (let i = 0; i < 75; i++) {
    const x = ((i * 43 - camera.left * 0.62) % W + W) % W;
    const y = camera.y(hill(terrain, camera.world(x))) + 11 + (i * 23) % 78;
    ellipse(ctx, x, y, 1.4 + (i % 3) * 0.46, .85, "#ffe7bf6a", (i % 3) * 0.51);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "#ffe6ac";
  ctx.lineWidth = 1.7;
  trace(.3);
  ctx.stroke();
  ctx.restore();

  for (const feature of terrain.feats) {
    const from = camera.x(feature.x0);
    const to = camera.x(feature.x1);
    if (to < -25 || from > W + 25) continue;
    const middle = (from + to) / 2;
    const y = camera.y(hill(terrain, camera.world(middle)));
    if (feature.kind === "caramel") {
      const min = Math.max(-10, from);
      ctx.beginPath();
      for (let x = min; x <= Math.min(W + 10, to); x += 2) {
        const height = camera.y(hill(terrain, camera.world(x)));
        if (x === min) ctx.moveTo(x, height);
        else ctx.lineTo(x, height);
      }
      ctx.strokeStyle = "#884a32";
      ctx.lineWidth = 6;
      ctx.stroke();
      ellipse(ctx, middle, y, Math.min(18, (to - from) / 3), 2.5, "#f3ac6295");
    } else if (feature.kind === "cream") {
      ellipse(ctx, middle, y - 2, 24, 6.5, "#ffe9de");
      ellipse(ctx, middle + 4, y - 7, 14, 6, "#fff6e0");
      ellipse(ctx, middle + 5, y - 12, 7, 5, "#fffcec");
    } else {
      sparkle(ctx, middle, y - 15, 7, "#fff5ad");
    }
  }
}

function drawSpoon(ctx, x, y, caught) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(caught ? -0.18 : 0.51);
  const silver = gradient(ctx, -12, -11, 10, 13, [
    [0, "#fff2df"], [.29, "#c1a8be"], [.54, "#f2e0d8"], [1, "#86708e"],
  ]);
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(-52, 1.5);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#78556c";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = silver;
  ctx.lineWidth = 5.3;
  ctx.stroke();
  ellipse(ctx, 2, 1.7, 20.5, 11.8, "#6d4b61");
  ellipse(ctx, 2, 0, 20.5, 11.4, silver);
  ellipse(ctx, 5, -1.9, 13.3, 6.1, "#f5dfd988");
  ellipse(ctx, 8, -4.7, 7.2, 1.45, "#fff8ea");
  ctx.restore();
}

function drawBear(ctx, x, y, input, angle, theme) {
  const squash = input.grounded ? (input.bonk > 0 ? 0.83 : 1 - input.charge * 0.17) : 1.04;
  const stage = Math.min(1.12, 1 + input.stage * 0.02);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale((1 + (1 - squash) * 0.45) * stage, squash * stage);
  const sprite = spriteFor(theme);
  if (sprite) {
    ctx.drawImage(sprite, -31.5, -82, 63, 81);
  } else {
    ellipse(ctx, -13, -52, 7, 7, colors[theme]);
    ellipse(ctx, 13, -52, 7, 7, colors[theme]);
    ellipse(ctx, 0, -15, 15, 14, colors[theme]);
    ellipse(ctx, 0, -39, 20, 18, colors[theme]);
    ellipse(ctx, -6, -39, 2.1, 2.8, "#422732");
    ellipse(ctx, 6, -39, 2.1, 2.8, "#422732");
  }
  ctx.restore();
}

function drawSignals(ctx, x, y, at) {
  if (!["good", "perfect", "splat", "caught"].includes(at)) return;
  for (const [dx, dy, size] of [[22, -64, 4], [35, -31, 5], [-25, -46, 6]]) {
    sparkle(ctx, x + dx, y + dy, size, at === "splat" ? "#ffe2cd" : "#fff8bb");
  }
}

export function paint(canvas, input, theme, effect = "") {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(W * dpr);
  const targetHeight = Math.round(H * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(targetWidth / W, 0, 0, targetHeight / H, 0, 0);
  const unit = 0.69;
  const playerX = W * 0.41;
  const feetAtGround = hill(input.terrain, input.x);
  const feetHeight = Math.max(0, feetAtGround - input.y);
  const skyRoom = 102;
  const verticalUnit = Math.min(unit, (218 - skyRoom) / Math.max(1, feetHeight));
  const baseline = Math.max(177, skyRoom + feetHeight * verticalUnit);
  const left = input.x - playerX / unit;
  const camera = {
    left,
    x: world => (world - left) * unit,
    world: x => left + x / unit,
    y: y => baseline + (y - feetAtGround) * verticalUnit,
  };
  drawSky(ctx, input.x);
  drawGround(ctx, input.terrain, camera);

  for (const coin of input.coins) {
    const x = camera.x(coin.x);
    const y = camera.y(coin.y);
    if (coin.star) sparkle(ctx, x, y, 7, "#fff4a4");
    else {
      ellipse(ctx, x, y, 3.7, 4.4, "#ab6431");
      ellipse(ctx, x, y - .6, 3, 3.8, "#ffe28c");
      ellipse(ctx, x - .9, y - 1.2, .9, 1.7, "#fff6c7");
    }
  }

  const y = camera.y(input.y);
  const spoonX = playerX - input.gap * unit;
  const spoonY = input.caught ? y - 37 : Math.min(y - 12, camera.y(hill(input.terrain, camera.world(spoonX))) - 44);
  ellipse(ctx, playerX, baseline + 2, 15 + Math.min(10, feetHeight / 14), 4.1, "#633b494f");
  drawSpoon(ctx, spoonX, spoonY, input.caught);
  if (input.grounded && input.holding && input.charge > .17) {
    ellipse(ctx, playerX, y - 19, 25 + input.charge * 5, 24, "#fff4b96f");
  }
  const angle = input.grounded
    ? (camera.y(hill(input.terrain, input.x + 24)) - baseline) / 95
    : Math.max(-.23, Math.min(.35, input.motionY / 1900));
  drawBear(ctx, playerX, y, input, angle, theme);
  drawSignals(ctx, playerX, y, effect);
  if (input.grounded && input.holding) {
    ctx.fillStyle = "#503446";
    ctx.fillRect(playerX - 19, y + 6, 38, 4);
    ctx.fillStyle = "#fff0a3";
    ctx.fillRect(playerX - 19, y + 6, 38 * input.charge, 4);
  }
}
