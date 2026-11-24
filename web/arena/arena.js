import { actionLabel, createDeck, framesPerSecond, horizon, models, recordUrl, restore, samples, simulate, unitsPerMetre, winner } from "./arena-core.js";
import { artworkReady, paint } from "./paint.js";

const id = name => document.getElementById(name);
const number = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 3 });
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const categories = { air: "공중 타이밍", ground: "지상 점프", chase: "근접 추격", recovery: "착지 실패 후 복구" };
const situationHints = {
  air: "공중에서 누르면 아래로 가속합니다. 어느 타이밍이 경사에 더 잘 맞을까요?",
  ground: "지상에서 누르면 힘을 모으고, 떼면 점프합니다. 두 AI의 대기 시간을 비교해 보세요.",
  chase: "숟가락이 바로 뒤에 있습니다. 하나만 3초를 버티면 그쪽이 이깁니다.",
  recovery: "착지에 실패해 속도가 줄었습니다. 더 빨리 벗어날 조작을 골라 보세요.",
};
const labels = { good: "GOOD", perfect: "PERFECT", splat: "SPLAT", caught: "숟가락에 잡힘", transform: "변신", bounce: "트램펄린" };
const sides = ["A", "B"];
const totalTicks = horizon * framesPerSecond;
const lanes = ["a", "b"].map(side => ({
  side, root: id(`lane-${side}`), name: id(`name-${side}`), status: id(`status-${side}`),
  canvas: id(`canvas-${side}`), hud: id(`hud-${side}`), event: id(`event-${side}`),
  cue: id(`cue-${side}`), action: id(`action-${side}`), detail: id(`detail-${side}`), pick: id(`pick-${side}`), distance: id(`distance-${side}`),
}));

let deck;
let index = 0;
let history = [];
let duel;
let phase;
let picked;
let archiveMode = false;
let tick = 0;
let raf = 0;
let playing = false;
let playFrom = 0;
let startedAt = 0;
let challengeRaf = 0;
let challenge = null;
const tryDialog = id("try");
const tryForm = id("try-form");
const controls = ["wait", "hold", "dive"].map(id);
const airMode = () => tryForm.elements["air-mode"].value;

id("record-link").href = recordUrl;
id("timeline").max = totalTicks;
id("help-open").addEventListener("click", () => id("help").showModal());

function metres(distance) {
  return `${number.format(distance)} m`;
}

function describeReplay(entry) {
  const grade = entry.outcome.firstGrades[0];
  return `${entry.outcome.survived ? "3초 생존" : `${exact.format(entry.outcome.elapsedS)}초에 잡힘`}${grade ? ` · 첫 착지 ${labels[grade]}` : ""}`;
}

function prepareDuel(sampleId, order) {
  const sample = samples.get(sampleId);
  const start = restore(sample);
  const entries = order.map(modelIndex => {
    const { action } = sample.models[modelIndex];
    return { modelIndex, action, ...simulate(sample, start, action) };
  });
  return { sample, start, entries, order, victor: winner(entries[0].outcome, entries[1].outcome) };
}

function makeReplayUrl(replay) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("replay", replay.sample.id);
  url.searchParams.set("order", replay.order[0] === 0 ? "ab" : "ba");
  return url;
}

function renderScore() {
  id("score").textContent = history.filter(round => round.correct).length;
  Array.from(id("score-marks").children).forEach((mark, position) => {
    const round = history[position];
    mark.className = round ? (round.correct ? "correct" : "wrong") : position === index ? "current" : "";
  });
}

function recentEvent(replay, at) {
  const relevant = replay.marks.findLast(mark => mark.tick <= at);
  if (!relevant) return "";
  if (relevant.kind === "caught") return "caught";
  if (at - relevant.tick > framesPerSecond * 0.72) return "";
  return relevant.kind === "grade" ? relevant.grade : relevant.kind;
}

function drawReplay({ canvas, hud, event }, entry, at, theme, showTiming) {
  const frameIndex = Math.min(at, entry.frames.length - 1);
  const frame = entry.frames[frameIndex];
  const eventKind = showTiming && at > 0 ? recentEvent(entry, frameIndex) : "";
  paint(canvas, frame, theme, eventKind);
  if (showTiming) {
    hud.textContent = `${metres((frame.x - entry.frames[0].x) / unitsPerMetre)} · ${at === 0 || frame.firstAction ? "첫 조작" : "풀차지 봇"}`;
  } else {
    hud.textContent = `숟가락 간격 ${metres(frame.gap / unitsPerMetre)}`;
  }
  event.hidden = !eventKind;
  event.dataset.kind = eventKind;
  event.textContent = labels[eventKind] || "";
}

function renderFrame(nextTick) {
  tick = Math.max(0, Math.min(totalTicks, Math.round(nextTick)));
  const showTiming = phase !== "predict";
  lanes.forEach((lane, i) => {
    drawReplay(lane, duel.entries[i], tick, lane.side, showTiming);
  });
  id("timeline").value = tick;
  id("timeline").setAttribute("aria-valuetext", `${number.format(tick / framesPerSecond)}초`);
  id("time-readout").textContent = `${number.format(tick / framesPerSecond)} / ${number.format(horizon)}초`;
}

function showInput(cue, action) {
  cue.getAnimations().forEach(animation => { animation.cancel(); });
  if (reducedMotion.matches || action.pressAfterMs === null) return;
  const from = action.waitMs ?? action.pressAfterMs;
  const to = from + (action.holdMs ?? 200);
  const cycle = Math.max(2300, to + 600);
  const idle = { background: "transparent", transform: "translateY(0)" };
  const pressed = { background: "currentColor", transform: "translateY(1px)" };
  cue.animate([
    { ...idle, offset: 0 },
    { ...idle, offset: from / cycle },
    { ...pressed, offset: from / cycle },
    { ...pressed, offset: to / cycle },
    { ...idle, offset: to / cycle },
    { ...idle, offset: 1 },
  ], { duration: cycle, iterations: Infinity });
}

function displayRound({ focus = false, replayOrder } = {}) {
  stopPlaying();
  phase = "predict";
  id("arena").dataset.phase = phase;
  picked = null;
  const order = replayOrder || (Math.random() < 0.5 ? [0, 1] : [1, 0]);
  duel = prepareDuel(deck[index], order);
  const { sample, start, entries } = duel;
  id("summary").hidden = true;
  id("arena").hidden = false;
  id("scoreboard").hidden = archiveMode;
  id("round-count").textContent = archiveMode ? "공개 리플레이" : `라운드 ${index + 1} / ${deck.length}`;
  id("scenario-title").textContent = categories[sample.category];
  id("observation").textContent = start.obs.grounded ? "지상에서 시작" : "공중에서 시작";
  id("hint").textContent = situationHints[sample.category];
  id("prediction-note").hidden = archiveMode;
  id("transport").hidden = true;
  id("result").hidden = true;
  id("copy-status").hidden = true;

  lanes.forEach((lane, i) => {
    const [title, detail] = actionLabel(entries[i].action);
    showInput(lane.cue, entries[i].action);
    lane.action.textContent = title;
    lane.detail.textContent = detail;
    lane.name.textContent = `AI ${sides[i]}`;
    lane.status.textContent = "모델 비공개";
    lane.distance.hidden = true;
    lane.pick.hidden = archiveMode;
    lane.pick.setAttribute("aria-label", `${sides[i]} 선택, ${title}`);
    lane.root.classList.remove("is-winner", "is-picked");
    lane.canvas.setAttribute("aria-label", `AI ${sides[i]}의 푸딩 언덕`);
  });
  renderScore();
  renderFrame(0);
  if (focus) {
    id("scenario-title").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function beginReplay(selection) {
  if (phase !== "predict") return;
  picked = selection;
  phase = "replay";
  id("arena").dataset.phase = phase;
  id("prediction-note").hidden = true;
  id("transport").hidden = false;
  id("skip").hidden = false;
  lanes.forEach((lane, i) => {
    lane.pick.hidden = true;
    lane.cue.getAnimations().forEach(animation => { animation.cancel(); });
    lane.status.textContent = picked === i ? "내 선택" : "리플레이";
    lane.root.classList.toggle("is-picked", picked === i);
  });

  renderFrame(0);
  if (reducedMotion.matches) updateToggle();
  else startPlaying();
  if (!archiveMode) {
    id("toggle").focus({ preventScroll: true });
    if (matchMedia("(max-width: 620px)").matches) id("lanes").scrollIntoView({ block: "start", behavior: "instant" });
  }
}

function updateToggle() {
  id("toggle").textContent = playing ? "일시정지" : tick === totalTicks ? "다시 재생" : "재생";
}

function animate(now) {
  startedAt ||= now;
  renderFrame(playFrom + (now - startedAt) / 1000 * framesPerSecond);
  if (tick < totalTicks) {
    raf = requestAnimationFrame(animate);
  } else {
    stopPlaying();
    reveal();
  }
}

function startPlaying() {
  stopPlaying();
  if (tick === totalTicks) renderFrame(0);
  playFrom = tick;
  startedAt = 0;
  playing = true;
  updateToggle();
  raf = requestAnimationFrame(animate);
}

function stopPlaying() {
  cancelAnimationFrame(raf);
  playing = false;
  updateToggle();
}

function resultDescription() {
  const { entries, victor } = duel;
  const [a, b] = entries;
  if (victor === null) {
    return `생존 상태가 같고 거리 차이가 ${exact.format(Math.abs(a.outcome.distanceM - b.outcome.distanceM))}m입니다.`;
  }
  const winning = entries[victor];
  const losing = entries[1 - victor];
  const difference = Math.abs(winning.outcome.distanceM - losing.outcome.distanceM);
  const reason = winning.outcome.survived !== losing.outcome.survived
    ? "3초 동안 살아남았습니다."
    : `${number.format(difference)}m 더 전진했습니다.`;
  const grade = winning.outcome.firstGrades[0];
  return `승리한 모델은 ${models[winning.modelIndex]}입니다. ${reason}${grade ? ` 첫 착지 ${labels[grade]}.` : ""}`;
}

function reveal() {
  if (phase !== "replay") return;
  phase = "result";
  id("arena").dataset.phase = phase;
  const { victor, entries } = duel;
  const tied = victor === null;
  const correct = tied || picked === victor;
  if (!archiveMode) {
    history.push({ ...duel, correct });
    renderScore();
  }
  lanes.forEach((lane, i) => {
    const replay = entries[i];
    lane.name.textContent = models[replay.modelIndex];
    const result = tied ? "무승부" : i === victor ? "승리" : "패배";
    lane.status.textContent = picked === i ? `내 선택 · ${result}` : result;
    lane.root.classList.toggle("is-winner", !tied && i === victor);
    lane.canvas.setAttribute("aria-label", `${models[replay.modelIndex]} 리플레이. ${describeReplay(replay)}`);
    lane.distance.textContent = metres(replay.outcome.distanceM);
    lane.distance.hidden = false;
    lane.event.dataset.kind = replay.outcome.survived ? "survived" : "caught";
    lane.event.textContent = describeReplay(replay);
    lane.event.hidden = false;
  });

  const outcome = tied ? "무승부" : `${sides[victor]} 승리`;
  id("result-title").textContent = archiveMode ? outcome : `${correct ? "정답" : "아쉽네요"} · ${outcome}`;
  id("result-detail").textContent = resultDescription();
  id("skip").hidden = true;
  id("result").dataset.outcome = archiveMode ? "archive" : correct ? "correct" : "wrong";
  id("result").hidden = false;
  id("next").textContent = archiveMode ? "게임 시작" : index === deck.length - 1 ? "최종 점수 보기" : "다음 라운드";
  if (!archiveMode) {
    id("result-title").focus({ preventScroll: true });
    if (matchMedia("(max-width: 620px)").matches) id("result").scrollIntoView({ block: "nearest", behavior: "instant" });
  }
}

function renderSummary() {
  stopPlaying();
  phase = "summary";
  id("arena").hidden = true;
  id("summary").hidden = false;
  const score = history.filter(round => round.correct).length;
  id("final-score").textContent = `세 번의 예측 중 ${score}번 맞혔습니다.`;
  id("recap").replaceChildren(...history.map(({ sample, order, correct }, i) => {
    const row = document.createElement("li");
    row.dataset.correct = String(correct);
    const title = document.createElement("strong");
    const status = document.createElement("span");
    const link = document.createElement("a");
    title.textContent = `${i + 1}라운드 · ${categories[sample.category]}`;
    status.textContent = correct ? "정답" : "오답";
    link.textContent = "리플레이";
    link.href = makeReplayUrl({ sample, order });
    row.append(title, status, link);
    return row;
  }));
  id("summary-title").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function startGame(firstGame) {
  if (archiveMode) historyReplaceGameUrl();
  archiveMode = false;
  index = 0;
  history = [];
  deck = createDeck(firstGame);
  displayRound({ focus: true });
}

function historyReplaceGameUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("replay");
  url.searchParams.delete("order");
  window.history.replaceState(null, "", url);
}

lanes.forEach((lane, i) => {
  lane.pick.addEventListener("click", () => beginReplay(i));
});
id("toggle").addEventListener("click", () => playing ? stopPlaying() : startPlaying());
id("timeline").addEventListener("input", event => {
  stopPlaying();
  renderFrame(Number(event.target.value));
  updateToggle();
  if (tick === totalTicks) reveal();
});
id("skip").addEventListener("click", () => {
  stopPlaying();
  renderFrame(totalTicks);
  updateToggle();
  reveal();
});
id("next").addEventListener("click", () => {
  if (archiveMode) startGame(true);
  else if (index + 1 === deck.length) renderSummary();
  else {
    index += 1;
    displayRound({ focus: true });
  }
});
id("restart").addEventListener("click", () => startGame(false));
id("copy-link").addEventListener("click", async () => {
  const link = makeReplayUrl(duel);
  const status = id("copy-status");
  status.hidden = false;
  try {
    await navigator.clipboard.writeText(link.href);
    status.textContent = "이 라운드의 리플레이 링크를 복사했습니다.";
  } catch {
    const anchor = document.createElement("a");
    anchor.textContent = "리플레이 링크";
    anchor.href = link.href;
    status.replaceChildren("링크를 열거나 주소를 복사하세요. ", anchor);
  }
});

function updateInputs() {
  for (const slider of controls) id(`${slider.id}-value`).value = `${slider.value} ms`;
  id("dive").disabled = airMode() === "glide";
}

function openChallenge() {
  stopPlaying();
  challenge = duel;
  const { obs } = challenge.start;
  tryForm.reset();
  id("try-case").textContent = categories[challenge.sample.category];
  id("ground-controls").hidden = !obs.grounded;
  id("air-controls").hidden = obs.grounded;
  id("wait").disabled = obs.holding;
  id("try-result").hidden = true;
  id("try-run").disabled = false;
  updateInputs();
  drawReplay({ canvas: id("try-canvas"), hud: id("try-hud"), event: id("try-event") }, challenge.entries[0], 0, "player", false);
  tryDialog.showModal();
}

function finishChallenge(replay) {
  id("try-run").disabled = false;
  const comparisons = challenge.entries.map(entry => {
    const comparison = winner(replay.outcome, entry.outcome);
    return `${models[entry.modelIndex]} 대비 ${comparison === null ? "무승부" : comparison === 0 ? "내 승리" : "내 패배"}`;
  });
  const result = id("try-result");
  result.textContent = `내 기록 ${metres(replay.outcome.distanceM)} · ${describeReplay(replay)}. ${comparisons.join(" / ")}.`;
  result.hidden = false;
  result.scrollIntoView({ block: "nearest", behavior: "instant" });
}

id("try-open").addEventListener("click", openChallenge);
id("summary-try").addEventListener("click", openChallenge);
tryForm.addEventListener("input", updateInputs);
tryDialog.addEventListener("close", () => cancelAnimationFrame(challengeRaf));
tryForm.addEventListener("submit", event => {
  event.preventDefault();
  const { sample, start } = challenge;
  const action = start.obs.grounded
    ? { waitMs: start.obs.holding ? 0 : Number(id("wait").value), holdMs: Number(id("hold").value) }
    : { pressAfterMs: airMode() === "glide" ? null : Number(id("dive").value) };
  const replay = simulate(sample, start, action);
  const target = { canvas: id("try-canvas"), hud: id("try-hud"), event: id("try-event") };
  id("try-result").hidden = true;
  id("try-run").disabled = true;
  const last = replay.frames.length - 1;

  if (reducedMotion.matches) {
    drawReplay(target, replay, last, "player", true);
    finishChallenge(replay);
    return;
  }

  let startTime;
  const draw = now => {
    startTime ??= now;
    const at = Math.min(last, Math.round((now - startTime) / 1000 * framesPerSecond));
    drawReplay(target, replay, at, "player", true);
    if (at < last) challengeRaf = requestAnimationFrame(draw);
    else finishChallenge(replay);
  };
  challengeRaf = requestAnimationFrame(draw);
});

artworkReady.then(() => {
  if (phase === "predict" || phase === "replay") renderFrame(tick);
});

const params = new URLSearchParams(location.search);
const replayId = params.get("replay");
if (samples.has(replayId)) {
  archiveMode = true;
  deck = [replayId];
  displayRound({ replayOrder: params.get("order") === "ba" ? [1, 0] : [0, 1] });
  beginReplay(null);
} else {
  deck = createDeck(true);
  displayRound();
}
