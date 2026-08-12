/**
 * Demo harness. Stands in for the server: every control here corresponds to
 * something the call backend would send.
 */
import { createAvatar, ACTIONS, ACTION_IDS, STATE_NAMES, AVATAR_NAMES, DEFAULT_AVATAR } from '../src/avatar.js';
import { GAZE_NAMES } from '../src/gaze.js';
import { EMOTION_NAMES } from '../src/emotions.js';
import { VISEME_LETTERS, textToCues, shapeFor } from '../src/visemes.js';
import { REST, CHANNELS } from '../src/params.js';

// Which face the rig wears. A real host would pick this once at boot from the
// host config; here it comes off the query string.
const avatarName = new URLSearchParams(location.search).get('avatar') || DEFAULT_AVATAR;

const avatar = createAvatar({ mount: '#avatar', avatar: avatarName });
window.avatar = avatar; // poke at it from the console

// Frame the stage to the avatar's own aspect ratio, from its descriptor.
{
  const vb = avatar.meta.viewBox;
  document.querySelector('.frame').style.aspectRatio = `${vb.w} / ${vb.h}`;
}

const $ = (s) => document.querySelector(s);
const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// --- avatar picker ----------------------------------------------------------
// Switches by reloading rather than by swapping the face in place. Every control
// below closes over the rig, and a live swap would have to rebuild all of them
// for no gain — the server picks an avatar once per call, not mid-sentence.
const pick = $('#avatarPick');
for (const name of AVATAR_NAMES) {
  const b = mk('button', name === avatarName ? 'chip on' : 'chip', name);
  b.onclick = () => { location.search = `?avatar=${encodeURIComponent(name)}`; };
  pick.appendChild(b);
}

// --- semantic actions -------------------------------------------------------
const ij = $('#interjections');
for (const id of ACTION_IDS) {
  const c = ACTIONS[id];
  const b = mk('button', 'big warm', c.label);
  b.title = `${id} · ${c.duration}ms`;
  b.onclick = () => avatar.action(id);
  ij.appendChild(b);
}

// --- speak ------------------------------------------------------------------
$('#wpm').oninput = (e) => { $('#wpmV').textContent = e.target.value; };
$('#speak').onclick = () => {
  const wpm = +$('#wpm').value;
  avatar.speak({ cues: textToCues($('#text').value, { wpm }) });
};
$('#stopSpeak').onclick = () => { avatar.stopSpeaking(); avatar.setState('LISTENING'); };
avatar.on('speakEnd', () => avatar.setState('LISTENING'));

// --- state / emotion / gaze -------------------------------------------------
function toggleGroup(host, names, onPick, initial) {
  const btns = {};
  for (const n of names) {
    const b = mk('button', 'chip', n.toLowerCase().replace(/_/g, ' '));
    b.onclick = () => { onPick(n); mark(n); };
    btns[n] = b;
    host.appendChild(b);
  }
  const mark = (n) => { for (const k in btns) btns[k].classList.toggle('on', k === n); };
  mark(initial);
  return mark;
}

const markState = toggleGroup($('#states'), STATE_NAMES, (n) => avatar.setState(n), 'IDLE');

let emoAmt = 1;
const markEmo = toggleGroup($('#emotions'), EMOTION_NAMES, (n) => avatar.setEmotion(n, emoAmt), 'neutral');
$('#emoAmt').oninput = (e) => {
  emoAmt = e.target.value / 100;
  $('#emoAmtV').textContent = emoAmt.toFixed(2);
  avatar.setEmotion(avatar.emotion, emoAmt);
};

const markGaze = toggleGroup($('#gazes'), GAZE_NAMES, (n) => avatar.setGaze(n), 'USER');

// A state change adopts the state's own emotion and gaze — re-sync all three
// chip rows, or the panel shows the previous selection as still active.
avatar.on('state', (n) => { markState(n); markEmo(avatar.emotion); markGaze(avatar.gaze); });

// custom gaze pad
const pad = $('#pad'), padDot = $('#padDot');
let dragging = false;
const padMove = (ev) => {
  const r = pad.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1));
  const y = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1));
  padDot.style.left = `${((x + 1) / 2) * 100}%`;
  padDot.style.top = `${((y + 1) / 2) * 100}%`;
  avatar.setGaze('CUSTOM', { x, y });
  markGaze(null);
};
pad.onpointerdown = (e) => { dragging = true; pad.setPointerCapture(e.pointerId); padMove(e); };
pad.onpointermove = (e) => dragging && padMove(e);
pad.onpointerup = () => { dragging = false; };

// --- viseme inspector -------------------------------------------------------
let visAmt = 1, heldViseme = null;
$('#visAmt').oninput = (e) => {
  visAmt = e.target.value / 100;
  $('#visAmtV').textContent = visAmt.toFixed(2);
  if (heldViseme) hold(heldViseme);
};
const visBtns = {};
function hold(letter) {
  heldViseme = heldViseme === letter && visBtns[letter].classList.contains('on') ? null : letter;
  for (const k in visBtns) visBtns[k].classList.toggle('on', k === heldViseme);
  avatar.setOverrides(heldViseme ? shapeFor(heldViseme, visAmt) : null);
}
for (const v of VISEME_LETTERS) {
  const b = mk('button', 'chip', v);
  b.onclick = () => hold(v);
  visBtns[v] = b;
  $('#visemes').appendChild(b);
}

// --- user voice (hold-to-talk) ----------------------------------------------
// Stands in for the user's mic: hold the button, release, and watch the
// listening engine acknowledge the pause you just created.
{
  const b = $('#userTalk');
  const set = (on) => {
    avatar.setUserSpeaking(on);
    b.classList.toggle('on', on);
  };
  b.onpointerdown = (e) => { b.setPointerCapture(e.pointerId); set(true); };
  b.onpointerup = () => set(false);
  b.onpointercancel = () => set(false);
}

// --- raw parameter sliders --------------------------------------------------
const sliderEls = {};
const manual = {};
let manualOn = false;
for (const c of CHANNELS) {
  const row = mk('div', 's');
  row.appendChild(mk('span', null, c));
  const inp = mk('input');
  inp.type = 'range'; inp.min = -100; inp.max = 100; inp.value = REST[c] * 100;
  const val = mk('b', null, REST[c].toFixed(2));
  inp.oninput = () => {
    manualOn = true;
    manual[c] = inp.value / 100;
    val.textContent = manual[c].toFixed(2);
    avatar.setOverrides(manual);
    heldViseme = null;
    for (const k in visBtns) visBtns[k].classList.remove('on');
  };
  row.appendChild(inp); row.appendChild(val);
  sliderEls[c] = { inp, val };
  $('#sliders').appendChild(row);
}
$('#release').onclick = () => {
  manualOn = false;
  for (const k in manual) delete manual[k];
  avatar.setOverrides(null);
};

// --- readout ----------------------------------------------------------------
const readout = $('#readout');
setInterval(() => {
  const p = avatar.params;
  readout.innerHTML =
    `state <b>${avatar.state}</b> · emotion <b>${avatar.emotion}</b> · gaze <b>${avatar.gaze}</b>` +
    ` · clip <b>${avatar.clip || '—'}</b> · speaking <b>${avatar.speaking}</b><br>` +
    `mouthOpen ${p.mouthOpen.toFixed(2)}  width ${p.mouthWidth.toFixed(2)}  round ${p.mouthRound.toFixed(2)}` +
    `  lid ${p.lidL.toFixed(2)}  yaw ${p.headYaw.toFixed(2)}  pitch ${p.headPitch.toFixed(2)}`;
  if (!manualOn) {
    for (const c of CHANNELS) {
      sliderEls[c].inp.value = p[c] * 100;
      sliderEls[c].val.textContent = p[c].toFixed(2);
    }
  }
}, 90);

// Sensible opening pose.
avatar.setState('LISTENING', { emotion: 'warm', intensity: 0.6 });
markState('LISTENING');
markEmo('warm');
emoAmt = 0.6;
$('#emoAmt').value = 60;
$('#emoAmtV').textContent = '0.60';
