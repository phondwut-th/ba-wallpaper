// BA Wallpaper — เล่นตัวละคร Spine (Memorial Lobby) เต็มจอ + โต้ตอบได้
// Swift ส่งตำแหน่งเมาส์มาที่ window.onCursor(x, y) ตลอดเวลา (แม้แอปอื่นจะ active อยู่)

const msgEl = document.getElementById('msg');
function showMsg(text, ms) {
  msgEl.textContent = text;
  msgEl.style.display = 'block';
  clearTimeout(showMsg.t);
  if (ms) showMsg.t = setTimeout(() => (msgEl.style.display = 'none'), ms);
}
function log(...a) { console.log(...a); try { webkit.messageHandlers.log.postMessage(a.join(' ')); } catch (e) {} }
window.addEventListener('error', e => log('JS error:', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => log('JS rejection:', e.reason && (e.reason.stack || e.reason)));

// คุณภาพการวาด ปรับได้ผ่าน query: ?res=1.5&aa=0&fps=30&debug=1
const Q = new URLSearchParams(location.search);
const app = new PIXI.Application({
  resizeTo: window, backgroundAlpha: 0,
  antialias: Q.get('aa') === '1',                      // MSAA ทั้งจอแพงมาก และภาพ Spine แทบไม่ต่าง
  resolution: Math.min(+(Q.get('res') || 2), window.devicePixelRatio || 1), autoDensity: true,
  preserveDrawingBuffer: Q.get('debug') === '1',       // จำเป็นแค่ตอน BA_SNAPSHOT
  powerPreference: 'low-power',
});
if (Q.get('fps')) app.ticker.maxFPS = +Q.get('fps');
document.body.appendChild(app.view);

let actor = null, char = null, cfg = {};
let cursor = { x: innerWidth / 2, y: innerHeight / 2 }, lookOn = new URLSearchParams(location.search).get('look') !== '0';
let talkIndex = 0;

const anims = () => actor ? actor.skeleton.data.animations.map(a => a.name) : [];
const has = n => anims().includes(n);
const findAnim = re => anims().find(n => re.test(n));
const findAll = re => anims().filter(n => re.test(n));

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('โหลด ' + src + ' ไม่ได้'));
    document.head.appendChild(s);
  });
}

// อ่านเวอร์ชันจากหัวไฟล์ — ทั้ง .skel และ .json มีสตริงเวอร์ชันอยู่ต้นไฟล์
async function detectVersion(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer()).slice(0, 256);
  const m = String.fromCharCode(...buf).match(/([34])\.(\d+)\.\d+/);
  return m ? [+m[1], +m[2]] : null;
}

// Spine 3.7–4.1 → pixi-spine, 4.2 ขึ้นไป → spine-pixi-v7 ทางการ
// สองตัวนี้ลงทะเบียน loader ชนกัน จึงโหลดแค่ตัวเดียวต่อหน้า (เปลี่ยนตัวละคร = รีโหลดหน้า)
async function createSpine(c) {
  const v = await detectVersion(c.skel);
  log('[' + c.name + '] skeleton version', v ? v.join('.') : '?');
  if (v && (v[0] > 4 || (v[0] === 4 && v[1] >= 2))) {
    if (!window.spine) await loadScript('lib/spine-pixi-v7.min.js');
    const sk = 'skel:' + c.name, at = 'atlas:' + c.name;
    PIXI.Assets.add({ alias: sk, src: c.skel });
    PIXI.Assets.add({ alias: at, src: c.atlas });
    const [, atlas] = await PIXI.Assets.load([sk, at]).then(r => [r[sk], r[at]]);
    smoothTextures(atlas.pages.map(p => p.texture && p.texture.texture));
    return window.spine.Spine.from({ skeleton: sk, atlas: at });
  }
  if (!PIXI.spine) await loadScript('lib/pixi-spine.js');
  const res = await PIXI.Assets.load({ src: c.skel, data: { spineAtlasFile: c.atlas } });
  smoothTextures(res.spineAtlas ? res.spineAtlas.pages.map(p => p.baseTexture) : []);
  const s = new PIXI.spine.Spine(res.spineData);
  s.autoUpdate = true;
  return s;
}

// ภาพถูกย่อลงเหลือราวครึ่งหนึ่ง — ถ้าไม่มี mipmap เส้นผม/ขอบจะหยักและกะพริบเวลาขยับ
function smoothTextures(texs) {
  const bases = texs.map(t => (t && t.baseTexture) || t);
  for (const b of bases) {
    if (!(b instanceof PIXI.BaseTexture)) continue;
    b.mipmap = PIXI.MIPMAP_MODES.ON;
    b.anisotropicLevel = 4;
    b.update();
  }
  log('mipmap pages:', bases.filter(b => b instanceof PIXI.BaseTexture).length);
}

// ---------- โหลดตัวละคร ----------
async function loadCharacter(name) {
  const list = await (await fetch('ba://local/api/chars')).json();
  char = list.find(c => c.name === name) || list[0];
  if (!char) { showMsg('ยังไม่มีตัวละคร\nเอาไฟล์ .skel + .atlas + .png ไปใส่ใน ~/ba-wallpaper/characters/<ชื่อ>/'); return; }
  cfg = Object.assign({ scale: 1, offsetX: 0, offsetY: 0, fit: 'cover', idle: null, lookStrength: 1 }, char.config || {});
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('view:' + char.name) || '{}')); } catch (e) {}

  showMsg('กำลังโหลด ' + char.name + ' …');
  try {
    actor = await createSpine(char);
  } catch (e) { showMsg('โหลดไม่สำเร็จ: ' + e); log('load error', e); return; }
  app.stage.addChild(actor);
  log('[' + char.name + '] animations:', anims().join(', '));
  log('[' + char.name + '] bones:', actor.skeleton.data.bones.map(b => b.name).join(', '));

  actor.state.addListener({ event: (entry, ev) => { if (ev.data.name === 'Talk' && ev.stringValue) onTalkEvent(ev.stringValue); } });
  await loadSfx();
  setupLook();
  layout();
  playIntro();
  if (introPlaying) playSfxTimeline();
  startMusic();
  showMsg(char.name + ' พร้อมแล้ว · คลิก = คุย · ลากบนหัว = ลูบหัว · สกรอล = ซูม · ⌥ลาก = เลื่อน', 4000);
}

// ---------- จัดวางบนจอ ----------
function layout() {
  if (!actor) return;
  // วัดขนาดจาก setup pose ของ skeleton (ไม่ให้ท่าทางทำให้กรอบเปลี่ยน)
  const sk = actor.skeleton;
  sk.setToSetupPose(); sk.updateWorldTransform(window.spine?.Physics?.update);
  const vec = () => ({ x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } });
  const off = vec(), size = vec();
  sk.getBounds(off, size, []);
  let b = { x: off.x, y: off.y, width: size.x, height: size.y };
  // Memorial lobby ของ BA ออกแบบให้กล้องเห็นช่วง y = 0…1920 (จากพื้นขึ้นไป) โดยมี x = 0 เป็นจุดกึ่งกลาง
  // ส่วนที่เกินจากนี้คือส่วนเผื่อไว้ตอนกล้องแพน/ฉากยาว ๆ (เช่น Hina Dress กว้าง 16,000 หน่วย) จึงไม่ใช้กรอบทั้งหมด
  // (ใน pixi แกน y ชี้ลง ช่วงนี้จึงเป็น -1920…0)
  const H = cfg.viewHeight ?? 1920;
  const baFrame = cfg.fit !== 'contain' && b.y <= -H * 0.9 && b.y + b.height >= -50 && b.x < -H * 0.6 && b.x + b.width > H * 0.6;
  if (baFrame) b = { x: -H * innerWidth / innerHeight / 2, y: -H, width: H * innerWidth / innerHeight, height: H };
  const sx = innerWidth / b.width, sy = innerHeight / b.height;
  const base = cfg.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  const s = base * cfg.scale;
  actor.scale.set(s);
  actor.position.set(
    innerWidth / 2 - (b.x + b.width / 2) * s + cfg.offsetX,
    innerHeight / 2 - (b.y + b.height / 2) * s + cfg.offsetY,
  );
}
window.addEventListener('resize', layout);
function saveView() {
  if (char) try { localStorage.setItem('view:' + char.name, JSON.stringify({ scale: cfg.scale, offsetX: cfg.offsetX, offsetY: cfg.offsetY })); } catch (e) {}
}

// ---------- ท่าทาง ----------
function idleName() {
  return cfg.idle || (has('Idle_01') ? 'Idle_01' : null) || findAnim(/^idle/i) || findAnim(/idle/i) || anims()[0];
}
function playIdle() {
  actor.state.setAnimation(0, idleName(), true);
}
// ระหว่างฉากเปิด (Start_Idle) ห้ามโต้ตอบ แบบในเกม — ไม่งั้นท่ามอง/ลูบหัวจะไปทับฉากเปิด
let introPlaying = false;
let interactOn = new URLSearchParams(location.search).get('interact') !== '0';
function playIntro() {
  const start = has('Start_Idle_01') ? 'Start_Idle_01' : findAnim(/^start/i);
  if (start) {
    introPlaying = true;
    const e = actor.state.setAnimation(0, start, false);
    e.listener = { complete: () => { introPlaying = false; }, interrupt: () => { introPlaying = false; } };
    actor.state.addAnimation(0, idleName(), true, 0);
  } else playIdle();
}

// เล่นท่าบน track แยก แล้วจางกลับ
function playOver(track, name, done) {
  const e = actor.state.setAnimation(track, name, false);
  e.mixDuration = 0.25;
  actor.state.addEmptyAnimation(track, 0.3, 0);
  if (done) e.listener = { complete: done };
  return e;
}

// ---------- โหมดโต้ตอบแบบในเกม ----------
// BA ทำงานเป็นคู่ X_01_A (ตัว) + X_01_M (หน้า/ปาก) และใช้ bone Touch_Eye / Touch_Point เป็นเป้า
// mode: null | 'look' | 'pat' | 'talk'
let mode = null, lastMove = 0;
const MIX = 0.35;               // วินาทีที่ใช้ผสมท่าเวลาเปลี่ยน — ยิ่งมากยิ่งนุ่ม
// เป้าแยกต่อ bone: {bone, origin(จอ), range, active, x,y(เป้า), cx,cy(ปัจจุบัน), vx,vy(ความเร็ว)}
// ตอนเลิกใช้ไม่ลบทิ้งทันที แต่ปล่อยให้ค่อย ๆ กลับที่เดิมก่อน ไม่งั้นตา/หัวจะดีดกลับ
const targets = {};
const pair = base => [findAnim(new RegExp('^' + base + '_A$', 'i')), findAnim(new RegExp('^' + base + '_M$', 'i'))];

function grab(boneName, range) {
  const bone = actor.skeleton.findBone(boneName);
  if (!bone) return null;
  let t = targets[boneName];
  if (!t) {
    // จุดตั้งต้นบนจอ — ใช้หาทิศทางจากตา/หัวไปหาเมาส์
    const w = { x: bone.data.x, y: bone.data.y };
    if (bone.parent) bone.parent.localToWorld(w);
    const origin = actor.toGlobal(new PIXI.Point(w.x, w.y));
    t = targets[boneName] = { bone, origin, cx: bone.data.x, cy: bone.data.y, vx: 0, vy: 0 };
  }
  Object.assign(t, { range, active: true, x: bone.data.x, y: bone.data.y });
  return t;
}
function release(boneName) {
  const t = targets[boneName];
  if (t) { t.active = false; t.x = t.bone.data.x; t.y = t.bone.data.y; }
}

function startLoop(base, boneName, range) {
  const [a, m] = pair(base);
  if (!a) return false;
  actor.state.setAnimation(1, a, true).mixDuration = MIX;
  if (m) actor.state.setAnimation(2, m, true).mixDuration = MIX;
  grab(boneName, range);
  return true;
}
function endLoop(base, boneName) {
  const [a, m] = pair(base + 'End');
  // ท่า End ของเกมยาวแค่ 0.1 วิ — ให้ผสมช้ากว่านั้นจะได้ไม่วูบ
  if (a) { playOver(1, a).mixDuration = MIX; } else actor.state.setEmptyAnimation(1, MIX);
  if (m) { playOver(2, m).mixDuration = MIX; } else actor.state.setEmptyAnimation(2, MIX);
  release(boneName);
}

// แปลงเมาส์ → ตำแหน่งเป้าในพิกัดของ bone แม่ โดยเลื่อนได้ไม่เกิน range หน่วย
// (ในเกมนิ้วอยู่บนหน้าตัวละครเสมอ แต่เมาส์ไปได้ทั่วจอ จึงต้องจำกัด ไม่งั้นตาดำหลุด)
function aimAt(x, y) {
  for (const t of Object.values(targets)) {
    if (!t.active) continue;
    const dx = x - t.origin.x, dy = y - t.origin.y, d = Math.hypot(dx, dy) || 1;
    // ease-out: ใกล้ ๆ ขยับไว ไกลแล้วค่อย ๆ อิ่มตัว
    const reach = 1 - Math.exp(-d / (innerWidth * 0.18));
    const px = t.range * actor.scale.x * reach;
    const p = actor.toLocal(new PIXI.Point(t.origin.x + dx / d * px, t.origin.y + dy / d * px));
    const v = { x: p.x, y: p.y };
    if (t.bone.parent) t.bone.parent.worldToLocal(v);
    t.x = v.x; t.y = v.y;
  }
}

function look(on) {
  if (!actor || (!lookOn || introPlaying || !interactOn) && on) return;
  if (on && !mode) { if (startLoop('Look_01', 'Touch_Eye', cfg.eyeRange ?? 60)) mode = 'look'; }
  else if (!on && mode === 'look') { endLoop('Look_01', 'Touch_Eye'); mode = null; }
}
function pat(on) {
  if (!actor || (introPlaying || !interactOn) && on) return;
  if (on) {
    if (mode === 'look') { release('Touch_Eye'); mode = null; }  // ท่า Pat จะผสมทับ Look เอง
    if (!mode && startLoop('Pat_01', 'Touch_Point', cfg.patRange ?? 80)) mode = 'pat';
  } else if (mode === 'pat') { endLoop('Pat_01', 'Touch_Point'); mode = null; }
}

// คลิก = Talk_0N_A + Talk_0N_M + เสียง memoriallobby_N
function talk() {
  if (!actor || introPlaying || !interactOn || mode === 'talk' || mode === 'pat') return;
  if (mode === 'look') { release('Touch_Eye'); mode = null; }
  const sets = [...new Set(findAll(/^Talk_\d+/i).map(n => n.match(/^Talk_(\d+)/i)[1]))].sort();
  if (sets.length) {
    const id = sets[talkIndex++ % sets.length];
    const [body, mouth] = pair('Talk_' + id);
    mode = 'talk';
    const done = () => { if (mode === 'talk') mode = null; };
    const end = () => { done(); hideLine(800); };
    if (body) playOver(1, body, end).mixDuration = MIX; else setTimeout(end, 2000);
    if (mouth) playOver(2, mouth).mixDuration = MIX;
    // ไฟล์ของเกมมี event "Talk" บอกจังหวะเสียงแต่ละท่อนอยู่แล้ว — ถ้าไม่มีค่อยเล่นต่อกันเอง
    const hasEvents = [body, mouth].some(n => n && actor.skeleton.data.findAnimation(n).timelines.some(t => t.events));
    if (!hasEvents) playVoice(parseInt(id, 10));
    return;
  }
  // โมเดลอื่น ๆ: สุ่มท่าที่ไม่ใช่ idle
  const others = anims().filter(n => n !== idleName() && !/idle|start/i.test(n));
  if (!others.length) return;
  mode = 'talk';
  playOver(1, others[Math.floor(Math.random() * others.length)], () => (mode = null));
}

// ---------- เสียง + กล่องบทพูดตาม event ----------
// event "Talk" มี stringValue เช่น "Zunko_MemorialLobby_4_2" ณ เวลาที่ท่อนนั้นต้องดัง
function onTalkEvent(key) {
  const m = key.match(/memoriallobby_(\d+(?:_\d+)?)/i);
  if (!m) return;
  const part = m[1];
  const src = (char.voices || []).find(f => f.toLowerCase().includes('memoriallobby_' + part.toLowerCase() + '.'));
  if (src) playClip(src);
  const line = cfg.dialog && cfg.dialog.lines && cfg.dialog.lines[part];
  if (line) showLine(line);
}

async function playClip(src) {
  const token = ++voiceToken;
  if (voiceAudio) voiceAudio.pause();
  try {
    const b = await (await fetch(src)).blob();
    if (token !== voiceToken) return;
    voiceAudio = new Audio(URL.createObjectURL(b));
    voiceAudio.volume = masterVolume * (cfg.volume ?? 1);
    duckMusic(true);
    const a = voiceAudio;
    a.onended = a.onpause = () => { if (voiceAudio === a) duckMusic(false); };
    await a.play();
  } catch (e) { log('voice', e); }
}

const dlg = document.getElementById('dlg');
let hideTimer = null;
function showLine(line) {
  if (cfg.subtitles === false) return;
  clearTimeout(hideTimer);
  const restart = dlg.classList.contains('show');
  dlg.querySelector('.text').textContent = line.th || line.ja || '';
  dlg.querySelector('.ja').textContent = cfg.showJapanese ? (line.ja || '') : '';
  placeBubble();
  if (restart) { dlg.classList.remove('show'); void dlg.offsetWidth; }  // เด้งใหม่ทุกท่อน
  dlg.classList.add('show');
}
function hideLine(delay = 0) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => dlg.classList.remove('show'), delay);
}
// วางกล่องข้างหัว: ตัวละครอยู่ฝั่งขวาของจอ → กล่องไปทางซ้าย (และกลับกัน)
function placeBubble() {
  // Touch_Eye อยู่ระดับตาและมีในทุก memorial lobby (Head บางชุดไม่มี)
  const sk = actor && actor.skeleton;
  const head = sk && (sk.findBone(cfg.bubbleBone || 'Touch_Eye') || sk.findBone('Head'));
  if (!head) { dlg.style.left = innerWidth * 0.45 + 'px'; dlg.style.top = innerHeight * 0.35 + 'px'; return; }
  const p = actor.toGlobal(new PIXI.Point(head.worldX, head.worldY));
  const right = p.x < innerWidth / 2;
  const gap = innerWidth * (cfg.bubbleGap ?? 0.11);
  dlg.classList.toggle('right', right);
  dlg.style.left = (right ? p.x + gap : p.x - gap) + 'px';
  dlg.style.top = (p.y - innerHeight * (cfg.bubbleRaise ?? 0.08)) + 'px';
}
app.ticker.add(() => { if (dlg.classList.contains('show')) placeBubble(); });

// เสียง (กรณีไม่มี event): ไฟล์ *_memoriallobby_N.ogg หรือ *_memoriallobby_N_1, _N_2 … เล่นต่อกันตามลำดับ
let voiceAudio = null, voiceToken = 0;
// ค่าเริ่มต้นมาจาก URL ที่ Swift ส่งมา (ค่าที่ผู้ใช้ตั้งไว้ในเมนู) — จะได้ไม่ดังผิดระดับตอนเปลี่ยนตัวละคร
const qNum = (k, d) => (Q.get(k) !== null && !isNaN(+Q.get(k))) ? +Q.get(k) : d;
let masterVolume = qNum('vol', 0.8), musicVolume = qNum('music', 0.4), sfxVolume = qNum('sfx', 0.8);

// ---------- เสียงประกอบจาก Timeline ของเกม (sfx.json) ----------
// pitch ในเกมเป็นหน่วยครึ่งเสียง (-3…3) → อัตราเล่น 2^(p/12)
let sfxList = [], sfxBlobs = {}, sfxTimers = [];
async function loadSfx() {
  if (!char.sfx) return;
  try {
    sfxList = await (await fetch(char.sfx)).json();
    const dir = char.sfx.replace(/sfx\.json$/, '');
    await Promise.all([...new Set(sfxList.map(e => e.file))].map(async f => {
      sfxBlobs[f] = URL.createObjectURL(await (await fetch(dir + f)).blob());
    }));
  } catch (e) { log('sfx', e); sfxList = []; }
}
function playSfxTimeline() {
  sfxTimers.forEach(clearTimeout); sfxTimers = [];
  for (const e of sfxList) {
    sfxTimers.push(setTimeout(() => {
      if (!sfxBlobs[e.file] || sfxVolume <= 0) return;
      const a = new Audio(sfxBlobs[e.file]);
      a.preservesPitch = false; a.webkitPreservesPitch = false;
      a.playbackRate = Math.min(4, Math.max(0.25, Math.pow(2, (e.pitch || 0) / 12)));
      a.volume = Math.min(1, e.volume * sfxVolume * (cfg.sfxGain ?? 1));
      a.loop = !!e.loop;
      a.play().catch(() => {});
    }, e.t * 1000));
  }
}
// ---------- เพลงประจำ lobby ----------
let bgm = null, bgmPaused = false, duck = 1;
async function startMusic() {
  if (!char.bgm || bgm) return;
  try {
    const b = await (await fetch(char.bgm)).blob();
    bgm = new Audio(URL.createObjectURL(b));
    bgm.loop = true;
    applyMusicVolume();
    if (!bgmPaused) await bgm.play();
  } catch (e) { log('bgm', e); }
}
function applyMusicVolume() { if (bgm) bgm.volume = Math.max(0, Math.min(1, musicVolume * duck * (cfg.musicVolume ?? 1))); }
// ตอนตัวละครพูด ลดเสียงเพลงลงแบบในเกม แล้วค่อย ๆ เพิ่มกลับ
let duckTimer = null;
function duckMusic(on) {
  clearInterval(duckTimer);
  const target = on ? (cfg.duck ?? 0.45) : 1;
  duckTimer = setInterval(() => {
    duck += (target - duck) * 0.25;
    if (Math.abs(target - duck) < 0.01) { duck = target; clearInterval(duckTimer); }
    applyMusicVolume();
  }, 50);
}  // จากแถบเลื่อนในเมนู 🌸 (cfg.volume ของตัวละครคูณซ้ำอีกที)
async function playVoice(i) {
  const v = char.voices || [];
  if (!v.length) return;
  const re = new RegExp('memoriallobby_0*' + i + '(_(\\d+))?\\.\\w+$', 'i');
  let parts = v.filter(f => re.test(f)).sort((a, b) => (+(a.match(re)[2] || 0)) - (+(b.match(re)[2] || 0)));
  if (!parts.length) parts = [v[(i - 1 + v.length) % v.length]];
  const token = ++voiceToken;
  if (voiceAudio) voiceAudio.pause();
  for (const src of parts) {
    if (token !== voiceToken) return;
    try {
      // โหลดเป็น blob ก่อน — <audio> กับ custom scheme ของ WebKit เล่นไม่ค่อยติด
      const b = await (await fetch(src)).blob();
      voiceAudio = new Audio(URL.createObjectURL(b));
      voiceAudio.volume = masterVolume * (cfg.volume ?? 1);
      await voiceAudio.play();
      await new Promise(r => { voiceAudio.onended = r; voiceAudio.onpause = r; });
    } catch (e) { log('voice', e); return; }
  }
}

// ---------- เป้า bone ----------
function setupLook() {
  const names = ['Touch_Eye', 'Touch_Point'].filter(n => actor.skeleton.findBone(n));
  log('touch bones:', names.join(', ') || '(ไม่พบ — ตามองเมาส์จะไม่ทำงาน)');
  // แทรกหลัง state.apply เพื่อให้ตำแหน่งเป้าไม่โดนแอนิเมชันทับ
  // ใช้สปริงแบบ critically damped ตามเวลาจริง — นุ่มเท่ากันไม่ว่าจะ 30 หรือ 60 fps
  const st = actor.state, orig = st.apply.bind(st);
  let last = performance.now();
  st.apply = sk => {
    const r = orig(sk);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const w = 2 * Math.PI / (cfg.followTime ?? 0.45);  // ความถี่ธรรมชาติ
    for (const [name, t] of Object.entries(targets)) {
      for (const [p, v, g] of [['cx', 'vx', 'x'], ['cy', 'vy', 'y']]) {
        const acc = w * w * (t[g] - t[p]) - 2 * w * t[v];
        t[v] += acc * dt; t[p] += t[v] * dt;
      }
      t.bone.x = t.cx; t.bone.y = t.cy;
      if (!t.active && Math.hypot(t.x - t.cx, t.y - t.cy) < 0.3 && Math.hypot(t.vx, t.vy) < 1) delete targets[name];
    }
    return r;
  };
}

app.ticker.add(() => {
  if (!actor) return;
  if (mode === 'look' && performance.now() - lastMove > (cfg.lookTimeout ?? 2500)) look(false);
});

// ---------- input ----------
function onMove(x, y) {
  if (Math.hypot(x - cursor.x, y - cursor.y) < 1) return;
  cursor.x = x; cursor.y = y; lastMove = performance.now();
  if (!down) look(true);
  aimAt(x, y);
}
window.onCursor = onMove;

let down = null;
function nearHead(x, y) {
  const head = actor && actor.skeleton.findBone('Head');
  if (!head) return y < innerHeight * 0.55;
  const p = actor.toGlobal(new PIXI.Point(head.worldX, head.worldY));
  return Math.hypot(x - p.x, y - p.y) < innerHeight * (cfg.patRadius ?? 0.22);
}
app.view.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, ox: cfg.offsetX, oy: cfg.offsetY, alt: e.altKey, moved: 0, patting: false };
});
window.addEventListener('pointermove', e => {
  onMove(e.clientX, e.clientY);
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  down.moved = Math.max(down.moved, Math.hypot(dx, dy));
  if (down.alt) { cfg.offsetX = down.ox + dx; cfg.offsetY = down.oy + dy; layout(); return; }
  // เริ่มลากใกล้หัว = ลูบหัว
  if (!down.patting && down.moved > 20 && nearHead(down.x, down.y)) { down.patting = true; pat(true); }
});
window.addEventListener('pointerup', () => {
  if (!down) return;
  if (down.alt) saveView();
  else if (down.patting) pat(false);
  else if (down.moved < 8) talk();
  down = null;
});
window.addEventListener('wheel', e => {
  e.preventDefault();
  cfg.scale = Math.max(0.3, Math.min(4, cfg.scale * (e.deltaY > 0 ? 0.95 : 1.05)));
  layout(); saveView();
}, { passive: false });

// เรียกจาก Swift
window.BA = {
  load: name => { Q.set('char', name); location.search = '?' + Q; },
  resetView: () => { cfg.scale = 1; cfg.offsetX = 0; cfg.offsetY = 0; saveView(); layout(); },
  setInteract: on => { interactOn = !!on; if (!on) { look(false); pat(false); } },
  setLook: on => { lookOn = on; if (!on) look(false); },
  setVolume: v => { masterVolume = Math.max(0, Math.min(1, +v)); if (voiceAudio) voiceAudio.volume = masterVolume * (cfg.volume ?? 1); },
  // คลิกบนเดสก์ท็อปที่ส่งมาจาก Swift (โหมดแสดงไอคอน — Finder เป็นคนได้คลิกจริง)
  pointer: (type, x, y) => {
    const ev = { down: 'pointerdown', move: 'pointermove', up: 'pointerup' }[type];
    const target = type === 'down' ? app.view : window;
    target.dispatchEvent(new PointerEvent(ev, { clientX: x, clientY: y, bubbles: true }));
  },
  // pause(ภาพ, เพลง?) — ไม่ส่งค่าเพลง = ไม่ยุ่งกับเพลง (เช่น ตอนจอถูกบัง เพลงยังเล่นต่อ)
  pause: (on, music) => {
    on ? app.ticker.stop() : app.ticker.start();
    if (music !== undefined) { bgmPaused = music; if (bgm) music ? bgm.pause() : bgm.play().catch(() => {}); }
  },
  setSfxVolume: v => { sfxVolume = Math.max(0, Math.min(1, +v)); },
  setMusicVolume: v => { musicVolume = Math.max(0, Math.min(1, +v)); applyMusicVolume(); },
};

const initial = Q.get('char');
loadCharacter(initial);

