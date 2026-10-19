(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Elements
   * ------------------------------------------------------------------ */
  const $ = (sel) => document.querySelector(sel);

  const stage = $('#stage');
  const avatarWrap = $('#avatarWrap');
  const avatar = $('#avatar');
  const face = $('#avatarFace');
  const splats = $('#splats');
  const floaters = $('#floaters');
  const dizzy = $('#dizzy');
  const toastEl = $('#toast');
  const fx = $('#fx');
  const fctx = fx.getContext('2d');
  const defaultFaceTpl = $('#defaultFace');

  const stressValue = $('#stressValue');
  const stressFill = $('#stressFill');
  const hitCount = $('#hitCount');
  const comboCount = $('#comboCount');

  const photoInput = $('#photoInput');
  const removeBtn = $('#removePhoto');
  const adjustEl = $('#adjust');
  const zoomEl = $('#zoom');
  const panXEl = $('#panX');
  const panYEl = $('#panY');

  /* ------------------------------------------------------------------
   * Config and state
   * ------------------------------------------------------------------ */
  const TOOLS = [
    { id: 'punch',   label: 'Punch',   emoji: '👊', power: 4,   windup: 100, words: ['POW!', 'BAM!', 'WHAM!', 'BIFF!'] },
    { id: 'slap',    label: 'Slap',    emoji: '🖐️', power: 3,   windup: 120, words: ['SMACK!', 'SLAP!', 'THWACK!'] },
    { id: 'squeeze', label: 'Squeeze', emoji: '🤏', power: 0,   hold: true,   words: ['squish', 'squeeeeze', 'mmph'] },
    { id: 'poke',    label: 'Poke',    emoji: '👆', power: 1.2, windup: 70,  words: ['boop', 'poke', 'tap'] },
    { id: 'hammer',  label: 'Hammer',  emoji: '🔨', power: 6,   windup: 250, words: ['BONK!', 'THUD!', 'CRUNCH!'] },
    { id: 'tomato',  label: 'Tomato',  emoji: '🍅', power: 3,   windup: 235, words: ['SPLAT!', 'SPLOOSH!', 'SQUISH!'] },
  ];

  const COMBO_WINDOW = 1100;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionScale = calm ? 0.4 : 1;

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('stressbuster.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('stressbuster.' + key, JSON.stringify(value)); return true; }
      catch (_) { return false; }
    },
    del(key) {
      try { localStorage.removeItem('stressbuster.' + key); } catch (_) { /* ignore */ }
    },
  };

  const state = {
    tool: store.get('tool', 'punch'),
    stress: 100,
    hits: 0,
    combo: 0,
    lastHit: 0,
    sound: store.get('sound', true),
    haptics: store.get('haptics', true),
    hold: null,
    mood: 'idle',
    moodTimer: 0,
  };

  const adjust = Object.assign({ z: 1, x: 0, y: 0 }, store.get('adjust', {}));

  const toolById = (id) => TOOLS.find((t) => t.id === id) || TOOLS[0];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ------------------------------------------------------------------
   * Sound (synthesised with Web Audio, no files needed)
   * ------------------------------------------------------------------ */
  const Sound = (() => {
    let ctx = null;
    let master = null;
    let noiseBuf = null;

    function ensure() {
      if (!state.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(type, f0, f1, dur, gain, at = 0) {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime + at;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.03);
    }

    function noise(dur, opts = {}, at = 0) {
      const c = ensure();
      if (!c) return;
      const { type = 'lowpass', freq = 1000, q = 1, gain = 0.5 } = opts;
      const t = c.currentTime + at;
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(master);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.03);
    }

    function play(id, k = 1) {
      const j = 0.92 + Math.random() * 0.16;
      switch (id) {
        case 'punch':
          tone('sine', 170 * j, 40, 0.2, 0.9 * k);
          noise(0.09, { freq: 900, gain: 0.5 * k });
          break;
        case 'slap':
          noise(0.1, { type: 'bandpass', freq: 2600 * j, q: 0.9, gain: 0.9 });
          tone('triangle', 520 * j, 180, 0.07, 0.25);
          break;
        case 'poke':
          tone('sine', 720 * j, 340, 0.09, 0.55);
          break;
        case 'hammer':
          tone('square', 130 * j, 45, 0.24, 0.3 * k);
          noise(0.14, { freq: 1300, gain: 0.8 });
          tone('sine', 1500 * j, 1380, 0.4, 0.1, 0.02);
          break;
        case 'tomato':
          noise(0.3, { freq: 700, q: 4, gain: 1 });
          tone('sine', 230 * j, 70, 0.22, 0.45);
          break;
        case 'boing':
          tone('sine', 200, 560, 0.15, 0.4);
          break;
        case 'miss':
          noise(0.08, { type: 'highpass', freq: 3500, gain: 0.15 });
          break;
        case 'chime':
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('sine', f, f, 0.5, 0.25, i * 0.12));
          break;
        default:
          break;
      }
    }

    function squeezeStart() {
      const c = ensure();
      if (!c) return null;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = 260;
      g.gain.value = 0.0001;
      o.connect(g).connect(master);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.05);
      return {
        update(t) { o.frequency.setTargetAtTime(260 + t * 520, c.currentTime, 0.03); },
        stop() {
          const n = c.currentTime;
          g.gain.cancelScheduledValues(n);
          g.gain.setTargetAtTime(0.0001, n, 0.03);
          o.stop(n + 0.2);
        },
      };
    }

    return { unlock: ensure, play, squeezeStart };
  })();

  function buzz(pattern) {
    if (state.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  /* ------------------------------------------------------------------
   * Particles (canvas)
   * ------------------------------------------------------------------ */
  let fxW = 0;
  let fxH = 0;
  let parts = [];
  let raf = 0;
  let lastT = 0;

  function resizeFx() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    fxW = r.width;
    fxH = r.height;
    fx.width = Math.round(fxW * dpr);
    fx.height = Math.round(fxH * dpr);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const PALETTES = {
    spark: ['#ffd35a', '#ffffff', '#ff9b3d', '#b9a8ff'],
    hammer: ['#ffd35a', '#ff6b5e', '#ffffff', '#9aa0ff'],
    tomato: ['#e63b2e', '#ff7a63', '#b8231a', '#7ccf5b'],
  };

  function burst(x, y, kind, count) {
    const n = Math.max(2, Math.round(count * (calm ? 0.5 : 1)));
    const pal = PALETTES[kind] || PALETTES.spark;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 320;
      const isTomato = kind === 'tomato';
      const life = 0.5 + Math.random() * 0.4;
      parts.push({
        kind: isTomato ? 'drop' : kind === 'hammer' && i % 2 ? 'chunk' : 'star',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        g: isTomato ? 900 : kind === 'hammer' ? 800 : 300,
        life, max: life,
        size: isTomato ? 5 + Math.random() * 8 : 4 + Math.random() * 7,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
        color: pick(pal),
      });
    }
    parts.push({
      kind: 'ring', x, y, r: 6,
      grow: kind === 'hammer' ? 520 : 300,
      life: 0.28, max: 0.28,
      color: kind === 'tomato' ? '#ff7a63' : '#ffffff',
    });
    ensureLoop();
  }

  function drawStar(x, y, r, rot) {
    fctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const ang = rot + (i * Math.PI) / 5;
      const px = x + Math.cos(ang) * rad;
      const py = y + Math.sin(ang) * rad;
      if (i === 0) fctx.moveTo(px, py); else fctx.lineTo(px, py);
    }
    fctx.closePath();
    fctx.fill();
  }

  function tick(now) {
    const dt = Math.min(0.04, (now - lastT) / 1000);
    lastT = now;
    fctx.clearRect(0, 0, fxW, fxH);

    parts = parts.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      const a = Math.max(0, p.life / p.max);

      if (p.kind === 'ring') {
        p.r += dt * p.grow;
        fctx.globalAlpha = a;
        fctx.strokeStyle = p.color;
        fctx.lineWidth = 4 * a + 1;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        fctx.stroke();
        return true;
      }

      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      fctx.globalAlpha = Math.min(1, a * 1.6);
      fctx.fillStyle = p.color;

      if (p.kind === 'star') {
        drawStar(p.x, p.y, p.size, p.rot);
      } else if (p.kind === 'chunk') {
        fctx.save();
        fctx.translate(p.x, p.y);
        fctx.rotate(p.rot);
        fctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        fctx.restore();
      } else {
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        fctx.fill();
      }
      return true;
    });

    fctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }

  function ensureLoop() {
    if (!raf) {
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  /* ------------------------------------------------------------------
   * Small UI helpers
   * ------------------------------------------------------------------ */
  let toastTimer = 0;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function floatWord(text, x, y, color) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.setProperty('--rot', (Math.random() * 24 - 12) + 'deg');
    if (color) el.style.color = color;
    floaters.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function updateHud() {
    const s = Math.round(state.stress);
    stressValue.textContent = s + '%';
    stressFill.style.width = state.stress + '%';
    stressFill.style.backgroundColor = `hsl(${Math.round(150 - state.stress * 1.46)} 85% 62%)`;
    stressFill.parentElement.setAttribute('aria-valuenow', String(s));
    hitCount.textContent = state.hits;
    comboCount.textContent = state.combo;
  }

  /* ------------------------------------------------------------------
   * Mood (default face expressions + red tint on any avatar)
   * ------------------------------------------------------------------ */
  const baseMood = () => (state.stress <= 0 ? 'happy' : 'idle');

  function applyMood(name, tint) {
    state.mood = name;
    const svg = face.querySelector('svg');
    if (svg) svg.dataset.mood = name;
    avatar.classList.toggle('is-hurt', !!tint);
  }

  function setMood(name, ms = 0, tint = false) {
    clearTimeout(state.moodTimer);
    applyMood(name, tint);
    if (ms) state.moodTimer = setTimeout(() => applyMood(baseMood(), false), ms);
  }

  /* ------------------------------------------------------------------
   * Tools UI
   * ------------------------------------------------------------------ */
  function setCursor(emoji) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><text x="24" y="38" font-size="34" text-anchor="middle">${emoji}</text></svg>`;
    stage.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 24 24, pointer`;
  }

  function renderTools() {
    const wrap = $('#tools');
    wrap.innerHTML = '';
    TOOLS.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = t.id;
      b.title = `${t.label} (key ${i + 1})`;
      b.innerHTML = `<span class="emoji" aria-hidden="true">${t.emoji}</span><span class="label">${t.label}</span>`;
      b.addEventListener('click', () => selectTool(t.id));
      wrap.appendChild(b);
    });
  }

  function selectTool(id) {
    endSqueeze();
    state.tool = toolById(id).id;
    store.set('tool', state.tool);
    document.querySelectorAll('.tool').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
    });
    setCursor(toolById(state.tool).emoji);
  }

  /* ------------------------------------------------------------------
   * Hits
   * ------------------------------------------------------------------ */
  function registerHit() {
    const now = performance.now();
    state.combo = now - state.lastHit < COMBO_WINDOW ? state.combo + 1 : 1;
    state.lastHit = now;
    state.hits++;
    return Math.min(1.6, 1 + (state.combo - 1) * 0.04);
  }

  function reduceStress(amount) {
    const before = state.stress;
    state.stress = Math.max(0, state.stress - amount);
    if (before > 50 && state.stress <= 50) showToast('Halfway there.');
    if (before > 0 && state.stress === 0) {
      showToast('Stress at zero. Take a slow breath.');
      Sound.play('chime');
      burst(fxW / 2, fxH * 0.4, 'spark', 40);
      setMood('happy');
    }
  }

  function toolFx(tool, x, y, nx) {
    const el = document.createElement('div');
    el.className = 'tool-fx';
    el.textContent = tool.emoji;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    stage.appendChild(el);

    const dir = nx >= 0 ? 1 : -1;
    let frames;
    let opts = { duration: 300, easing: 'ease-out' };

    switch (tool.id) {
      case 'punch':
        frames = [
          { transform: 'translateY(70px) scale(2.4)', opacity: 0 },
          { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.32 },
          { transform: 'translateY(0) scale(1.1)', opacity: 1, offset: 0.7 },
          { transform: 'translateY(-10px) scale(1)', opacity: 0 },
        ];
        opts.duration = 320;
        break;
      case 'slap':
        frames = [
          { transform: `translateX(${dir * 110}px) rotate(${dir * 40}deg)`, opacity: 0 },
          { transform: `translateX(0) rotate(${-dir * 15}deg)`, opacity: 1, offset: 0.4 },
          { transform: `translateX(${-dir * 40}px) rotate(${-dir * 30}deg)`, opacity: 0 },
        ];
        break;
      case 'hammer':
        frames = [
          { transform: 'translate(30px,-150px) rotate(-80deg)', opacity: 0 },
          { transform: 'translate(0,-20px) rotate(-35deg)', opacity: 1, offset: 0.35 },
          { transform: 'translate(0,10px) rotate(15deg)', opacity: 1, offset: 0.6 },
          { transform: 'translate(0,10px) rotate(15deg)', opacity: 1, offset: 0.8 },
          { transform: 'translate(0,0) rotate(0)', opacity: 0 },
        ];
        opts = { duration: 420, easing: 'ease-in' };
        break;
      case 'tomato': {
        const sx = (Math.random() < 0.5 ? -1 : 1) * fxW * 0.5;
        frames = [
          { transform: `translate(${sx}px,${fxH * 0.5}px) scale(.7) rotate(0deg)`, opacity: 1 },
          { transform: 'translate(0,0) scale(1) rotate(540deg)', opacity: 1, offset: 0.95 },
          { transform: 'translate(0,0) scale(1.6) rotate(540deg)', opacity: 0 },
        ];
        opts = { duration: 250, easing: 'ease-in' };
        break;
      }
      default: // poke
        frames = [
          { transform: 'translateY(60px) scale(1.4)', opacity: 0 },
          { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.3 },
          { transform: 'translateY(0) scale(.95)', opacity: 1, offset: 0.6 },
          { transform: 'translateY(20px)', opacity: 0 },
        ];
        opts.duration = 260;
    }

    const anim = el.animate(frames, opts);
    anim.onfinish = () => el.remove();
  }

  let knockAnim = null;
  let squashAnim = null;
  const SQUASH = {
    punch: [1.06, 0.92],
    hammer: [1.14, 0.8],
    slap: [0.96, 1.03],
    poke: [1.03, 0.97],
    tomato: [1.05, 0.95],
  };
  const KNOCK = { punch: 34, slap: 30, poke: 8, hammer: 22, tomato: 16 };

  function knock(tool, p, k) {
    const amt = (KNOCK[tool.id] || 20) * k * motionScale;
    const tx = -p.nx * amt;
    const ty = -p.ny * amt * 0.7;
    const rot = -p.nx * amt * 0.35 * (tool.id === 'slap' ? 1.6 : 1);

    if (knockAnim) knockAnim.cancel();
    knockAnim = avatarWrap.animate([
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: `translate(${tx}px,${ty}px) rotate(${rot}deg)`, offset: 0.25 },
      { transform: `translate(${-tx * 0.35}px,${-ty * 0.35}px) rotate(${-rot * 0.35}deg)`, offset: 0.6 },
      { transform: 'translate(0,0) rotate(0deg)' },
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' });

    if (!state.hold) {
      const [sx, sy] = SQUASH[tool.id] || [1, 1];
      if (squashAnim) squashAnim.cancel();
      squashAnim = avatar.animate([
        { transform: 'scale(1,1)' },
        { transform: `scale(${sx},${sy})`, offset: 0.2 },
        { transform: `scale(${1 - (sx - 1) * 0.3},${1 - (sy - 1) * 0.3})`, offset: 0.55 },
        { transform: 'scale(1,1)' },
      ], { duration: 380, easing: 'ease-out' });
    }
  }

  function addSplat(p) {
    const r = avatar.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'splat';
    el.style.left = ((p.clientX - r.left) / r.width) * 100 + '%';
    el.style.top = ((p.clientY - r.top) / r.height) * 100 + '%';
    el.style.setProperty('--w', 16 + Math.random() * 16 + '%');
    el.style.setProperty('--r', Math.random() * 360 + 'deg');
    splats.appendChild(el);
    while (splats.children.length > 40) splats.firstChild.remove();
  }

  let dizzyTimer = 0;
  function dizzyBurst() {
    dizzy.classList.add('show');
    setMood('dizzy', 1800, true);
    clearTimeout(dizzyTimer);
    dizzyTimer = setTimeout(() => dizzy.classList.remove('show'), 1800);
    floatWord(`Combo x${state.combo}!`, fxW / 2, 44, '#6fe8b8');
  }

  function impact(tool, p) {
    const k = registerHit();
    Sound.play(tool.id, k);
    buzz(tool.id === 'hammer' ? [30, 20, 40] : tool.id === 'poke' ? 8 : 20);
    knock(tool, p, k);
    floatWord(pick(tool.words), p.x, p.y - 30);

    switch (tool.id) {
      case 'tomato':
        burst(p.x, p.y, 'tomato', 22 * k);
        addSplat(p);
        break;
      case 'hammer':
        burst(p.x, p.y, 'hammer', 26 * k);
        break;
      case 'poke':
        burst(p.x, p.y, 'spark', 6);
        break;
      default:
        burst(p.x, p.y, 'spark', 14 * k);
    }

    setMood('hurt', 380, tool.id !== 'poke');
    reduceStress(tool.power * 0.8 * k);
    if (state.combo > 0 && state.combo % 10 === 0) dizzyBurst();
    updateHud();
  }

  function strike(tool, clientX, clientY) {
    const r = avatar.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = r.width / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const sr = stage.getBoundingClientRect();
    const x = clientX - sr.left;
    const y = clientY - sr.top;

    if (Math.hypot(dx, dy) > rad * 1.02) {
      Sound.play('miss');
      floatWord('whiff', x, y, '#a9acd9');
      return;
    }

    const p = {
      x, y, clientX, clientY,
      nx: clamp(dx / rad, -1, 1),
      ny: clamp(dy / rad, -1, 1),
    };
    toolFx(tool, x, y, p.nx);
    setTimeout(() => impact(tool, p), tool.windup);
  }

  /* ------------------------------------------------------------------
   * Squeeze (hold to press, release to boing back)
   * ------------------------------------------------------------------ */
  function startSqueeze(clientX, clientY, pointerId) {
    if (state.hold) return;
    const r = avatar.getBoundingClientRect();
    const rad = r.width / 2;
    const dx = clientX - (r.left + rad);
    const dy = clientY - (r.top + r.height / 2);
    const sr = stage.getBoundingClientRect();
    const x = clientX - sr.left;
    const y = clientY - sr.top;

    if (Math.hypot(dx, dy) > rad * 1.02) {
      Sound.play('miss');
      floatWord('whiff', x, y, '#a9acd9');
      return;
    }

    if (pointerId !== null && pointerId !== undefined) {
      try { stage.setPointerCapture(pointerId); } catch (_) { /* ignore */ }
    }

    const el = document.createElement('div');
    el.className = 'tool-fx';
    el.textContent = toolById('squeeze').emoji;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    stage.appendChild(el);

    const now = performance.now();
    state.hold = { start: now, last: now, x, y, el, t: 0, raf: 0, snd: Sound.squeezeStart() };
    if (knockAnim) knockAnim.cancel();
    if (squashAnim) squashAnim.cancel();
    setMood('squeeze');
    buzz(15);
    state.hold.raf = requestAnimationFrame(holdLoop);
  }

  function holdLoop(now) {
    const h = state.hold;
    if (!h) return;
    const dt = Math.min(0.05, (now - h.last) / 1000);
    h.last = now;
    h.t = Math.min(1, (now - h.start) / 900);
    const e = 1 - Math.pow(1 - h.t, 3);

    avatar.style.transform = `scale(${1 + 0.3 * e},${1 - 0.4 * e})`;
    h.el.style.transform = `scale(${1 - 0.15 * e})`;
    if (h.snd) h.snd.update(e);

    state.lastHit = now;
    reduceStress(9 * dt);
    updateHud();
    h.raf = requestAnimationFrame(holdLoop);
  }

  function endSqueeze() {
    const h = state.hold;
    if (!h) return;
    cancelAnimationFrame(h.raf);
    state.hold = null;
    if (h.snd) h.snd.stop();
    h.el.remove();

    const e = 1 - Math.pow(1 - h.t, 3);
    const sx = 1 + 0.3 * e;
    const sy = 1 - 0.4 * e;
    avatar.style.transform = '';
    squashAnim = avatar.animate([
      { transform: `scale(${sx},${sy})` },
      { transform: `scale(${1 - (sx - 1) * 0.6},${1 + (1 - sy) * 0.6})`, offset: 0.35 },
      { transform: `scale(${1 + (sx - 1) * 0.2},${1 - (1 - sy) * 0.2})`, offset: 0.65 },
      { transform: 'scale(1,1)' },
    ], { duration: 520, easing: 'ease-out' });

    Sound.play('boing');
    registerHit();
    burst(h.x, h.y, 'spark', 8 + e * 10);
    floatWord(pick(toolById('squeeze').words), h.x, h.y - 30);
    setMood('hurt', 350, false);
    updateHud();
  }

  /* ------------------------------------------------------------------
   * Input
   * ------------------------------------------------------------------ */
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    Sound.unlock();
    const tool = toolById(state.tool);
    if (tool.hold) startSqueeze(e.clientX, e.clientY, e.pointerId);
    else strike(tool, e.clientX, e.clientY);
  });

  stage.addEventListener('pointerup', endSqueeze);
  stage.addEventListener('pointercancel', endSqueeze);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  avatarWrap.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat) return;
    Sound.unlock();
    const r = avatar.getBoundingClientRect();
    const cx = r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.5;
    const cy = r.top + r.height / 2 + (Math.random() - 0.5) * r.height * 0.5;
    const tool = toolById(state.tool);
    if (tool.hold) startSqueeze(cx, cy, null);
    else strike(tool, cx, cy);
  });

  avatarWrap.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') endSqueeze();
  });
  avatarWrap.addEventListener('blur', endSqueeze);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TOOLS.length) selectTool(TOOLS[n - 1].id);
  });

  setInterval(() => {
    if (state.combo && !state.hold && performance.now() - state.lastHit > COMBO_WINDOW) {
      state.combo = 0;
      updateHud();
    }
  }, 250);

  /* ------------------------------------------------------------------
   * Photo handling
   * ------------------------------------------------------------------ */
  function applyAdjust() {
    const img = face.querySelector('img');
    if (!img) return;
    img.style.transform = `translate(${adjust.x}%, ${adjust.y}%) scale(${adjust.z})`;
  }

  function syncSliders() {
    zoomEl.value = adjust.z;
    panXEl.value = adjust.x;
    panYEl.value = adjust.y;
  }

  function showDefault() {
    face.replaceChildren(defaultFaceTpl.content.cloneNode(true));
    adjustEl.hidden = true;
    removeBtn.hidden = true;
    applyMood(baseMood(), false);
  }

  function showPhoto(dataUrl) {
    const img = new Image();
    img.alt = 'Your attached photo';
    img.draggable = false;
    img.src = dataUrl;
    face.replaceChildren(img);
    adjustEl.hidden = false;
    removeBtn.hidden = false;
    applyAdjust();
    applyMood(baseMood(), false);
  }

  function loadPhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast("That file isn't a picture.");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);

      adjust.z = 1; adjust.x = 0; adjust.y = 0;
      syncSliders();
      store.set('adjust', adjust);
      const saved = store.set('photo', dataUrl);
      showPhoto(dataUrl);
      showToast(saved ? 'Photo attached. Take it out on them.' : 'Photo attached for this session.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("Couldn't read that picture. Try a JPG or PNG.");
    };
    img.src = url;
  }

  photoInput.addEventListener('change', () => {
    loadPhotoFile(photoInput.files && photoInput.files[0]);
    photoInput.value = '';
  });

  removeBtn.addEventListener('click', () => {
    store.del('photo');
    showDefault();
    showToast('Back to the default face.');
  });

  [zoomEl, panXEl, panYEl].forEach((el) => {
    el.addEventListener('input', () => {
      adjust.z = parseFloat(zoomEl.value);
      adjust.x = parseFloat(panXEl.value);
      adjust.y = parseFloat(panYEl.value);
      applyAdjust();
      store.set('adjust', adjust);
    });
  });

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  ['dragenter', 'dragover'].forEach((type) => {
    stage.addEventListener(type, (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      stage.classList.add('drop-active');
    });
  });

  stage.addEventListener('dragleave', () => stage.classList.remove('drop-active'));

  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop-active');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const file = files.find((f) => f.type.startsWith('image/'));
    if (file) loadPhotoFile(file);
    else showToast("That file isn't a picture.");
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  window.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    const file = files.find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      loadPhotoFile(file);
    }
  });

  /* ------------------------------------------------------------------
   * Settings and reset buttons
   * ------------------------------------------------------------------ */
  const soundToggle = $('#soundToggle');
  const hapticToggle = $('#hapticToggle');

  soundToggle.checked = state.sound;
  soundToggle.addEventListener('change', () => {
    state.sound = soundToggle.checked;
    store.set('sound', state.sound);
  });

  if (!navigator.vibrate) {
    $('#hapticLabel').hidden = true;
  } else {
    hapticToggle.checked = state.haptics;
    hapticToggle.addEventListener('change', () => {
      state.haptics = hapticToggle.checked;
      store.set('haptics', state.haptics);
    });
  }

  $('#wipeBtn').addEventListener('click', () => {
    splats.replaceChildren();
    showToast('Wiped clean.');
  });

  $('#resetBtn').addEventListener('click', () => {
    endSqueeze();
    state.stress = 100;
    state.hits = 0;
    state.combo = 0;
    splats.replaceChildren();
    dizzy.classList.remove('show');
    setMood(baseMood());
    updateHud();
    showToast('Fresh start.');
  });

  /* ------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------ */
  renderTools();
  selectTool(state.tool);
  resizeFx();
  if (window.ResizeObserver) new ResizeObserver(resizeFx).observe(stage);
  else window.addEventListener('resize', resizeFx);

  syncSliders();
  const savedPhoto = store.get('photo', null);
  if (savedPhoto) showPhoto(savedPhoto);
  else showDefault();

  updateHud();
  showToast('Pick a move, then tap the face.');
})();
