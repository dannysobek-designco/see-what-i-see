/* See What I See — app logic: UI, sources (scenes / upload / camera),
   VR mode, presets, and shareable settings links. */

"use strict";

/* ————— symptom model ————— */

const PARAM_KEYS = ["snow","snowDensity","snowSize","snowSpeed","snowColor",
  "trail","floaters","bfep","flashes","glare","halos","night","ghost","pulse","tinnitus"];

// "amount" params get zeroed by Hold-to-compare; quality params (density/size/speed) don't
const AMOUNT_KEYS = ["snow","trail","floaters","bfep","flashes","glare","halos","night","ghost","pulse","tinnitus"];

const GROUPS = [
  { title: "Visual snow", note: "the hallmark — dynamic, continuous dots across the entire field of vision",
    ctls: [
      { key:"snow", label:"Intensity" },
      { key:"snowDensity", label:"Density" },
      { key:"snowSize", label:"Dot size" },
      { key:"snowSpeed", label:"Flicker speed" },
      { key:"snowColor", label:"Colored static", toggle:true },
    ]},
  { title: "Afterimages", note: "palinopsia — images linger and trail after the eyes move on",
    ctls: [ { key:"trail", label:"Trailing & persistence" } ]},
  { title: "Entoptic phenomena", note: "floaters, darting dots and flashes, all amplified",
    ctls: [
      { key:"floaters", label:"Floaters" },
      { key:"bfep", label:"Darting dots (blue-field)" },
      { key:"flashes", label:"Light flashes (photopsia)" },
    ]},
  { title: "Light sensitivity", note: "photophobia — ordinary light becomes glare",
    ctls: [
      { key:"glare", label:"Glare & washout" },
      { key:"halos", label:"Halos & starbursts" },
    ]},
  { title: "Night vision", note: "nyctalopia — the dark holds less detail than it should",
    ctls: [ { key:"night", label:"Impaired night vision" } ]},
  { title: "Other", note: "also commonly reported with VSS",
    ctls: [
      { key:"ghost", label:"Double vision" },
      { key:"pulse", label:"Pulsating vision" },
    ]},
  { title: "Beyond vision", note: "most people with VSS also live with tinnitus — this one you hear, not see",
    ctls: [
      { key:"tinnitus", label:"Tinnitus (ringing sound)" },
    ]},
];

// tinnitus stays 0 in every preset — audio is strictly opt-in
const PRESETS = {
  none:     { snow:0, snowDensity:.45, snowSize:.25, snowSpeed:.6, snowColor:0, trail:0, floaters:0, bfep:0, flashes:0, glare:0, halos:0, night:0, ghost:0, pulse:0, tinnitus:0 },
  mild:     { snow:.16, snowDensity:.28, snowSize:.18, snowSpeed:.55, snowColor:0, trail:.06, floaters:.08, bfep:.07, flashes:.02, glare:.06, halos:.1, night:.06, ghost:0, pulse:.03, tinnitus:0 },
  moderate: { snow:.34, snowDensity:.4, snowSize:.22, snowSpeed:.6, snowColor:0, trail:.16, floaters:.18, bfep:.16, flashes:.07, glare:.16, halos:.24, night:.16, ghost:.04, pulse:.08, tinnitus:0 },
  severe:   { snow:.7, snowDensity:.55, snowSize:.28, snowSpeed:.7, snowColor:1, trail:.5, floaters:.5, bfep:.5, flashes:.3, glare:.45, halos:.6, night:.5, ghost:.2, pulse:.3, tinnitus:0 },
};

const state = { ...PRESETS.moderate };

/* ————— local persistence ————— */

const LS_MY = "sws.my", LS_INTRO = "sws.intro", LS_TOUR = "sws.tour", LS_SOURCE = "sws.source";

function saveMine(){
  try { localStorage.setItem(LS_MY, JSON.stringify(state)); } catch {}
  const chip = document.getElementById("chip-mine");
  chip.hidden = false;
}

function loadMine(){
  try {
    const raw = localStorage.getItem(LS_MY);
    if(!raw) return null;
    const saved = JSON.parse(raw);
    const out = {};
    for(const k of PARAM_KEYS) out[k] = Math.min(Math.max(Number(saved[k]) || 0, 0), 1);
    return out;
  } catch { return null; }
}

/* ————— boot ————— */

const canvas = document.getElementById("glcanvas");
const stage = document.getElementById("stage");
const video = document.getElementById("camvideo");
let renderer;
try {
  renderer = new VSSRenderer(canvas);
} catch (e) {
  toast("This device doesn't support WebGL2 — the simulator can't run here.", 6000);
  throw e;
}

let vrMode = false;
let compareMix = 0, compareHeld = false;   // 1 = symptoms hidden
let camStream = null;

async function useScene(name){
  try {
    const el = await Scenes.get(name);
    stopCamera();
    renderer.setSource(el, el.naturalWidth || el.width, el.naturalHeight || el.height, false);
    return true;
  } catch (e) {
    toast(e.message, 4000);
    return false;
  }
}

function stopCamera(){
  if(camStream){
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    video.srcObject = null;
  }
}

async function useCamera(){
  if(!window.isSecureContext){
    toast("Camera needs a secure (https) connection. Deploy the app or open it on localhost.", 5000);
    return false;
  }
  if(!navigator.mediaDevices?.getUserMedia){
    toast("This browser can't access the camera.", 4000);
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    camStream = stream;
    video.srcObject = stream;
    await video.play();
    await new Promise(res => {
      if(video.videoWidth) res();
      else video.onloadedmetadata = res;
    });
    renderer.setSource(video, video.videoWidth, video.videoHeight, true);
    return true;
  } catch (e) {
    toast("Camera unavailable: " + (e.name === "NotAllowedError" ? "permission was denied." : e.message), 5000);
    return false;
  }
}

/* ————— sliders UI ————— */

const slidersRoot = document.getElementById("sliders");
const inputs = {};

for(const g of GROUPS){
  const sec = document.createElement("div");
  sec.className = "sym-group";
  sec.innerHTML = `<h3>${g.title}</h3><p class="sym-note">${g.note}</p>`;
  for(const c of g.ctls){
    if(c.toggle){
      const row = document.createElement("div");
      row.className = "ctl-toggle";
      row.innerHTML = `<span>${c.label}</span>`;
      const t = document.createElement("input");
      t.type = "checkbox"; t.className = "switch";
      t.checked = state[c.key] > 0.5;
      t.addEventListener("change", () => { presetAnim = null; state[c.key] = t.checked ? 1 : 0; customized(); });
      row.appendChild(t);
      sec.appendChild(row);
      inputs[c.key] = t;
    } else {
      const ctl = document.createElement("div");
      ctl.className = "ctl";
      const id = "ctl-" + c.key;
      ctl.innerHTML = `<label for="${id}"><span>${c.label}</span><span class="val"></span></label>`;
      const r = document.createElement("input");
      r.type = "range"; r.min = 0; r.max = 100; r.id = id;
      r.value = Math.round(state[c.key]*100);
      r.addEventListener("input", () => {
        presetAnim = null;
        state[c.key] = r.value/100;
        if(c.key === "tinnitus"){
          if(state.tinnitus > 0.001) initTinnitus();
          updateMuteVisibility();
        }
        paintSlider(r, ctl);
        customized();
      });
      // touch-safe adjustment: on touch screens the input itself ignores
      // taps (see pointer:coarse CSS); a horizontal drag anywhere on the row
      // nudges the value RELATIVE to where it was, so brushing the track
      // with a thumb can't slam it to max. Vertical swipes scroll the panel.
      let tdrag = null;
      ctl.addEventListener("touchstart", e => {
        const t = e.touches[0];
        tdrag = { x: t.clientX, y: t.clientY, v: +r.value, engaged: false, dead: false };
      }, { passive: true });
      ctl.addEventListener("touchmove", e => {
        if(!tdrag || tdrag.dead) return;
        const t = e.touches[0];
        const dx = t.clientX - tdrag.x, dy = t.clientY - tdrag.y;
        if(!tdrag.engaged){
          if(Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)){ tdrag.dead = true; return; }
          if(Math.abs(dx) > 10) tdrag.engaged = true;
          else return;
        }
        e.preventDefault();
        const width = r.getBoundingClientRect().width || 1;
        const nv = Math.round(Math.min(100, Math.max(0, tdrag.v + dx/width*100)));
        if(nv !== +r.value){ r.value = nv; r.dispatchEvent(new Event("input")); }
      }, { passive: false });
      const endTdrag = () => { tdrag = null; };
      ctl.addEventListener("touchend", endTdrag);
      ctl.addEventListener("touchcancel", endTdrag);

      ctl.appendChild(r);
      paintSlider(r, ctl);
      sec.appendChild(ctl);
      inputs[c.key] = r;
    }
  }
  slidersRoot.appendChild(sec);
}

function paintSlider(r, ctl){
  r.style.setProperty("--fill", r.value + "%");
  ctl.querySelector(".val").textContent = r.value + "%";
}

function refreshUI(){
  for(const key of PARAM_KEYS){
    const el = inputs[key];
    if(!el) continue;
    if(el.type === "checkbox") el.checked = state[key] > 0.5;
    else { el.value = Math.round(state[key]*100); paintSlider(el, el.closest(".ctl")); }
  }
  updateMuteVisibility();   // presets / shared link / My VSS may change tinnitus
}

function clearPresetActive(){
  document.querySelectorAll(".chip.preset").forEach(c => c.classList.remove("active"));
}

// user touched a slider: these settings are now "theirs" — remember them
function customized(){
  clearPresetActive();
  saveMine();
  document.getElementById("chip-mine").classList.add("active");
}

/* ————— presets & scene chips ————— */

// presets ease in over ~450ms instead of snapping
let presetAnim = null;
function animateToPreset(target){
  presetAnim = { from: { ...state }, to: target, t0: performance.now() };
}

document.querySelectorAll(".chip.preset").forEach(chip => {
  chip.addEventListener("click", () => {
    const target = chip.dataset.preset === "mine" ? loadMine() : PRESETS[chip.dataset.preset];
    if(!target) return;
    if(target.tinnitus > 0.001) initTinnitus();
    animateToPreset(target);
    clearPresetActive();
    chip.classList.add("active");
  });
});

const fileInput = document.getElementById("file-input");
document.querySelectorAll("#scene-chips .chip").forEach(chip => {
  chip.addEventListener("click", async () => {
    const s = chip.dataset.scene;
    let ok = true;
    if(s === "upload"){
      fileInput.click();
      return; // chip activates after a file is actually chosen
    } else if(s === "camera"){
      selectCamera(false);   // handles its own active-state + errors
      return;
    } else {
      ok = await useScene(s);
    }
    if(ok){
      document.querySelectorAll("#scene-chips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    }
  });
});

/* ————— live camera (shared by panel chip + mobile stage group) ————— */

const camGroup = document.getElementById("cam-group");

async function selectCamera(vr){
  if(camGroup) camGroup.classList.remove("expanded");
  const ok = await useCamera();
  if(!ok) return;
  document.querySelectorAll("#scene-chips .chip").forEach(c => c.classList.remove("active"));
  document.querySelector('[data-scene="camera"]').classList.add("active");
  if(vr) enterVR();
  else if(vrMode) exitVR();
}

document.getElementById("btn-cam").addEventListener("click", () => camGroup.classList.toggle("expanded"));
document.getElementById("btn-cam-normal").addEventListener("click", () => selectCamera(false));
document.getElementById("btn-cam-vr").addEventListener("click", () => selectCamera(true));

fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if(!f) return;
  const img = new Image();
  img.onload = () => {
    stopCamera();
    renderer.setSource(img, img.naturalWidth, img.naturalHeight, false);
    document.querySelectorAll("#scene-chips .chip").forEach(c => c.classList.remove("active"));
    document.querySelector('[data-scene="upload"]').classList.add("active");
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
  fileInput.value = "";
});

/* ————— hold to compare ————— */

const btnCompare = document.getElementById("btn-compare");
for(const [ev, held] of [["pointerdown", true], ["pointerup", false], ["pointercancel", false], ["pointerleave", false]]){
  btnCompare.addEventListener(ev, e => {
    if(held) btnCompare.setPointerCapture(e.pointerId);
    compareHeld = held;
    btnCompare.classList.toggle("holding", held);
  });
}
btnCompare.addEventListener("contextmenu", e => e.preventDefault());

/* ————— tinnitus (opt-in audio) ————— */

const tinn = { ctx: null, gain: null, muted: false };
const btnMute = document.getElementById("btn-mute");
btnMute.addEventListener("click", () => {
  tinn.muted = !tinn.muted;
  btnMute.classList.toggle("muted", tinn.muted);
  btnMute.setAttribute("aria-label", tinn.muted ? "Unmute the tinnitus sound" : "Mute the tinnitus sound");
});

function initTinnitus(){
  if(tinn.ctx){ tinn.ctx.resume?.(); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    // the classic VSS ringing: a thin, steady high-pitched tone
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 7600;
    osc.connect(gain);
    osc.start();
    tinn.ctx = ctx; tinn.gain = gain;
  } catch {}
}

// the mute button only exists while there's a tone to mute; called on any
// change to the tinnitus setting (not per-frame, so it's independent of the
// render loop)
function updateMuteVisibility(){
  btnMute.hidden = !(state.tinnitus > 0.001);
}

function updateTinnitus(level){
  if(!tinn.ctx) return;
  // keep it gentle even at 100%; the mute toggle silences without
  // touching the slider value
  const target = (tinn.muted ? 0 : level) * 0.045;
  tinn.gain.gain.setTargetAtTime(target, tinn.ctx.currentTime, 0.12);
}

// if settings restored on load include tinnitus, start it on the first tap
document.addEventListener("pointerdown", () => {
  if(state.tinnitus > 0.001) initTinnitus();
}, { once: true });

// stop the tone when the app is backgrounded or the screen locks — otherwise
// it keeps ringing until the tab is physically closed. Resume on return only
// if tinnitus is still switched on.
document.addEventListener("visibilitychange", () => {
  if(!tinn.ctx) return;
  if(document.hidden) tinn.ctx.suspend();
  else if(state.tinnitus > 0.001) tinn.ctx.resume();
});
addEventListener("pagehide", () => { if(tinn.ctx) tinn.ctx.suspend(); });

/* ————— split compare view ————— */

const btnSplit = document.getElementById("btn-split");
const splitUi = document.getElementById("split-ui");
const splitDivider = document.getElementById("split-divider");
let splitOn = false, splitPos = 0.5;

function setSplit(on){
  splitOn = on;
  splitUi.hidden = !on;
  btnSplit.classList.toggle("holding", on);
  if(on) positionDivider();
}
function positionDivider(){
  splitDivider.style.left = (splitPos * 100) + "%";
}
btnSplit.addEventListener("click", () => setSplit(!splitOn));

splitDivider.addEventListener("pointerdown", e => {
  splitDivider.setPointerCapture(e.pointerId);
  const move = ev => {
    const r = stage.getBoundingClientRect();
    splitPos = Math.min(Math.max((ev.clientX - r.left) / r.width, 0.06), 0.94);
    positionDivider();
  };
  const up = () => {
    splitDivider.removeEventListener("pointermove", move);
    splitDivider.removeEventListener("pointerup", up);
    splitDivider.removeEventListener("pointercancel", up);
  };
  splitDivider.addEventListener("pointermove", move);
  splitDivider.addEventListener("pointerup", up);
  splitDivider.addEventListener("pointercancel", up);
  e.preventDefault();
});

/* ————— VR mode ————— */

const btnVr = document.getElementById("btn-vr");
const vrHint = document.getElementById("vr-hint");

async function enterVR(){
  vrMode = true;
  setSplit(false);
  document.body.classList.add("vr", "panel-closed");
  document.body.classList.remove("panel-open");
  try { await stage.requestFullscreen(); } catch {}
  try { await screen.orientation.lock("landscape"); } catch {}
  vrHint.hidden = false;
  setTimeout(() => vrHint.hidden = true, 3500);
}
async function exitVR(){
  if(!vrMode) return;
  vrMode = false;
  document.body.classList.remove("vr");
  vrHint.hidden = true;
  try { if(document.fullscreenElement) await document.exitFullscreen(); } catch {}
  try { screen.orientation.unlock(); } catch {}
}
btnVr.addEventListener("click", enterVR);
canvas.addEventListener("pointerdown", () => {
  if(vrMode) exitVR();
  else document.body.classList.remove("panel-open");
  camGroup?.classList.remove("expanded");   // dismiss floating cam options
});
document.addEventListener("fullscreenchange", () => {
  if(!document.fullscreenElement) exitVR();
});

/* ————— share link ————— */

document.getElementById("btn-share").addEventListener("click", async () => {
  const vals = PARAM_KEYS.map(k => Math.round(state[k]*100)).join(".");
  const url = location.origin + location.pathname + "#v1=" + vals;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied — anyone who opens it sees your exact settings.");
  } catch {
    prompt("Copy this link:", url);
  }
});

function loadFromHash(){
  const m = location.hash.match(/#v1=([\d.]+)/);
  if(!m) return false;
  const vals = m[1].split(".").map(Number);
  if(vals.length !== PARAM_KEYS.length || vals.some(isNaN)) return false;
  PARAM_KEYS.forEach((k, i) => state[k] = Math.min(Math.max(vals[i]/100, 0), 1));
  clearPresetActive();   // a shared link is someone else's vision — don't save it as "My VSS"
  return true;
}

/* ————— panel (mobile bottom sheet), about, toast ————— */

function openPanel(){
  document.body.classList.add("panel-open", "controls-used");
}
document.getElementById("btn-panel").addEventListener("click", openPanel);

// swipe the sheet down by its grip to dismiss it (a plain tap closes too)
const panelEl = document.getElementById("panel");
const grip = document.getElementById("panel-grip");
let gripDrag = null;
grip.addEventListener("pointerdown", e => {
  gripDrag = { startY: e.clientY, dy: 0 };
  grip.setPointerCapture(e.pointerId);
  panelEl.classList.add("dragging");
});
grip.addEventListener("pointermove", e => {
  if(!gripDrag) return;
  gripDrag.dy = Math.max(0, e.clientY - gripDrag.startY);
  panelEl.style.transform = `translateY(${gripDrag.dy}px)`;
});
function endGripDrag(){
  if(!gripDrag) return;
  const dy = gripDrag.dy;
  gripDrag = null;
  panelEl.classList.remove("dragging");
  panelEl.style.transform = "";          // hand back to the CSS transition
  // a tap or a real downward swipe closes; a small drag snaps back open
  if(dy < 6 || dy > 80) document.body.classList.remove("panel-open");
}
grip.addEventListener("pointerup", endGripDrag);
grip.addEventListener("pointercancel", endGripDrag);
document.getElementById("btn-about").addEventListener("click", () => {
  document.getElementById("about").showModal();
});
document.getElementById("panel-done").addEventListener("click", () => {
  document.body.classList.remove("panel-open");
});

let toastTimer;
function toast(msg, ms = 3000){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, ms);
}

/* ————— main loop ————— */

// render at native pixel ratio (phones are often 3x): capping lower makes
// the browser upscale the buffer, which visibly softens the static on mobile
const DPR_CAP = 3;
let qualityScale = 1, frameEma = 16, lastFrameTs = 0, qualityTick = 0;

function frame(now){
  const t = now / 1000;

  // adaptive quality: drop render resolution if we can't hold ~45fps,
  // recover it when there's headroom (hysteresis so it doesn't oscillate)
  if(lastFrameTs){
    frameEma += (Math.min(now - lastFrameTs, 100) - frameEma) * 0.05;
    if(++qualityTick >= 90){
      qualityTick = 0;
      // floor at 0.7 — dropping lower turns the fine static into soft mush
      if(frameEma > 22 && qualityScale > 0.75) qualityScale = Math.max(0.7, qualityScale - 0.15);
      else if(frameEma < 15 && qualityScale < 1) qualityScale = Math.min(1, qualityScale + 0.15);
    }
  }
  lastFrameTs = now;

  const dpr = Math.min(devicePixelRatio || 1, DPR_CAP) * qualityScale;
  const w = Math.max(1, Math.round(stage.clientWidth * dpr));
  const h = Math.max(1, Math.round(stage.clientHeight * dpr));
  renderer.resize(w, h, stage.clientHeight);

  // preset transitions ease instead of snapping
  if(presetAnim){
    const k = Math.min((now - presetAnim.t0) / 450, 1);
    const e = k*k*(3 - 2*k);   // smoothstep
    for(const key of PARAM_KEYS)
      state[key] = presetAnim.from[key] + (presetAnim.to[key] - presetAnim.from[key]) * e;
    refreshUI();
    if(k >= 1) presetAnim = null;
  }

  // ease the compare mix so the A/B doesn't pop harshly
  compareMix += ((compareHeld ? 1 : 0) - compareMix) * 0.22;
  const P = { ...state };
  if(compareMix > 0.002) for(const k of AMOUNT_KEYS) P[k] *= (1 - compareMix);

  updateTinnitus(P.tinnitus);
  renderer.render(t, P, vrMode, (splitOn && !vrMode) ? splitPos : null);
  requestAnimationFrame(frame);
}

/* ————— go ————— */

// settings priority: shared link > my saved settings > moderate default
if(loadFromHash()){
  refreshUI();
} else {
  const mine = loadMine();
  if(mine){
    Object.assign(state, mine);
    refreshUI();
    clearPresetActive();
    document.getElementById("chip-mine").hidden = false;
    document.getElementById("chip-mine").classList.add("active");
  }
}

/* ————— guided walkthrough (coach marks) ————— */

const TOUR_STEPS = [
  { sel: "#source-block", panel: true,  title: "Pick what you're looking at",
    body: "Start here. Choose a sample scene, upload your own photo, or use your live camera to see the effect over the real world." },
  { sel: "#preset-block", panel: true,  title: "Set the overall severity",
    body: "Jump to Mild, Moderate or Severe — or if you have VSS, build up your own from here. Your custom mix is saved as “My VSS.”" },
  { sel: "#sliders",      panel: true,  title: "Fine-tune each symptom",
    body: "Every symptom has its own control — visual snow, afterimages, glare, floaters and more. Adjust any of them to match what you experience." },
  { sel: "#btn-compare",  panel: false, title: "Compare with typical vision",
    body: "Press and hold this any time to drop the symptoms away, so others can see the difference. “Split view” shows both at once." },
  { sel: "#share-block",  panel: true,  title: "Share exactly what you see",
    body: "Tune it, then copy a link — whoever opens it sees your exact settings. If you have visual snow, this is precisely what you see; if you don’t, it’s a way to experience what it’s like." },
];

const tour = {
  el: document.getElementById("tour"),
  hole: document.getElementById("tour-hole"),
  pop: document.getElementById("tour-pop"),
  i: 0, active: false,
};
const isMobile = () => matchMedia("(max-width: 860px)").matches;

function startTour(){
  if(tour.active) return;
  tour.active = true;
  tour.i = 0;
  setSplit(false);
  tour.el.hidden = false;
  addEventListener("resize", positionTour);
  showTourStep();
}

function endTour(){
  tour.active = false;
  tour.el.hidden = true;
  removeEventListener("resize", positionTour);
  if(isMobile()) document.body.classList.remove("panel-open");
  try { localStorage.setItem(LS_TOUR, "1"); } catch {}
  maybeShowSourceChooser();
}

// on a first mobile visit, once onboarding wraps up, ask how they want to
// see it: over their live camera, or with a sample scene
const sourcePick = document.getElementById("source-pick");
function maybeShowSourceChooser(){
  if(!isMobile() || localStorage.getItem(LS_SOURCE)) return;
  try { localStorage.setItem(LS_SOURCE, "1"); } catch {}
  setTimeout(() => sourcePick.showModal(), 250);   // after any overlay closes
}
document.getElementById("pick-cam").addEventListener("click", () => {
  sourcePick.close();
  selectCamera(false);
});
document.getElementById("pick-scene").addEventListener("click", () => sourcePick.close());

function showTourStep(){
  const step = TOUR_STEPS[tour.i];
  document.getElementById("tour-step").textContent = `Step ${tour.i + 1} of ${TOUR_STEPS.length}`;
  document.getElementById("tour-title").textContent = step.title;
  document.getElementById("tour-body").textContent = step.body;
  document.getElementById("tour-back").style.visibility = tour.i === 0 ? "hidden" : "visible";
  document.getElementById("tour-next").textContent =
    tour.i === TOUR_STEPS.length - 1 ? "Done" : "Next";

  // on mobile, panel-internal steps need the sheet open (and scrolled to);
  // stage steps need it closed. Wait for the sheet transition before measuring.
  let delay = 0;
  if(isMobile()){
    const wantOpen = step.panel;
    const isOpen = document.body.classList.contains("panel-open");
    document.body.classList.add("controls-used");
    if(wantOpen !== isOpen){
      document.body.classList.toggle("panel-open", wantOpen);
      delay = 360;
    }
  }
  setTimeout(() => {
    const el = document.querySelector(step.sel);
    // bring panel-internal targets into view on every screen size — on
    // desktop the panel is a scroll container too, so the share block near
    // the bottom would otherwise sit below the fold
    if(el && step.panel){
      el.scrollIntoView({ block: "center", inline: "nearest" });
      setTimeout(positionTour, 60);
    } else {
      positionTour();
    }
  }, delay);
}

function positionTour(){
  const step = TOUR_STEPS[tour.i];
  const el = document.querySelector(step.sel);
  if(!el) return;
  const r = el.getBoundingClientRect();
  const pad = 8;
  const H = tour.hole;
  H.style.top = (r.top - pad) + "px";
  H.style.left = (r.left - pad) + "px";
  H.style.width = (r.width + pad * 2) + "px";
  H.style.height = (r.height + pad * 2) + "px";

  const pop = tour.pop;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = innerWidth, vh = innerHeight, gap = 14, m = 12;
  const below = vh - r.bottom, above = r.top;
  let top;
  if(below >= ph + gap || below >= above) top = r.bottom + gap;
  else top = r.top - ph - gap;
  // always keep the popover on-screen so its buttons stay reachable, even
  // if the target couldn't be fully scrolled into view
  top = Math.max(m, Math.min(top, vh - ph - m));
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(m, Math.min(left, vw - pw - m));
  pop.style.top = top + "px";
  pop.style.left = left + "px";
}

document.getElementById("tour-next").addEventListener("click", () => {
  if(tour.i >= TOUR_STEPS.length - 1) endTour();
  else { tour.i++; showTourStep(); }
});
document.getElementById("tour-back").addEventListener("click", () => {
  if(tour.i > 0){ tour.i--; showTourStep(); }
});
document.getElementById("tour-skip").addEventListener("click", endTour);
document.getElementById("btn-tour").addEventListener("click", () => {
  if(isMobile()) document.body.classList.remove("panel-open");
  startTour();
});

/* ————— first visit: intro, then optionally the tour ————— */

const intro = document.getElementById("intro");
const markSeen = () => {
  try { localStorage.setItem(LS_INTRO, "1"); } catch {}
};
if(!localStorage.getItem(LS_INTRO)){
  intro.showModal();
}
document.getElementById("intro-tour").addEventListener("click", () => {
  markSeen();
  intro.close();
  setTimeout(startTour, 250);   // let the dialog finish closing first
});
document.getElementById("intro-skip").addEventListener("click", () => {
  markSeen();
  try { localStorage.setItem(LS_TOUR, "1"); } catch {}
  intro.close();
  maybeShowSourceChooser();   // still offer the source choice on first visit
});
intro.addEventListener("close", markSeen);   // Escape / backdrop

// offline/PWA support on the deployed site; skipped in local dev so
// the service worker never serves stale files while iterating
if("serviceWorker" in navigator &&
   !["localhost", "127.0.0.1"].includes(location.hostname) &&
   location.protocol === "https:"){
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  // when a new worker takes over (a fresh deploy), reload once so the page
  // is running the new code rather than whatever loaded from the old cache
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloadedForUpdate) return;
    reloadedForUpdate = true;
    location.reload();
  });
}

useScene("night");
requestAnimationFrame(frame);
