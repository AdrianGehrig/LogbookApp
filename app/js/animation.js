// Abschluss-Animationen. Jede Szene bekommt die Rechtecke der aufgelösten
// Karten und liefert { duration, frame(t, dt) }; frame gibt true zurück, wenn sie fertig ist.
const Celebrate = (() => {
  'use strict';

  const kinds = [
    { key: 'rocket', label: '🚀 Rakete – zerstreut die Gedanken', emoji: '🚀' },
    { key: 'horse', label: '🥕 Islandpferd – frisst die Karotten', emoji: '🥕' },
  ];
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = v => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2);

  let overlay = null;

  function sparkle(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + i * Math.PI / 4;
      const rr = i % 2 ? r * 0.32 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------- Szene: Rakete ----------

  const ROCKET_SVG = `
    <svg viewBox="0 0 56 96" width="56" height="96" aria-hidden="true">
      <path d="M12 60 L2 80 L16 72 Z" fill="#ff7a59"/>
      <path d="M44 60 L54 80 L40 72 Z" fill="#ff7a59"/>
      <path d="M28 2 C14 18 12 42 14 72 L42 72 C44 42 42 18 28 2 Z" fill="#f2f4fa"/>
      <path d="M28 2 C21 10 17.5 19 15.6 28 L40.4 28 C38.5 19 35 10 28 2 Z" fill="#ff7a59"/>
      <circle cx="28" cy="42" r="7.5" fill="#7aa2ff" stroke="#c9d3ea" stroke-width="2.5"/>
      <rect x="20" y="72" width="16" height="6" rx="2" fill="#9aa3bd"/>
    </svg>`;
  const DUST_COLORS = ['#ffffff', '#ffe9c2', '#ffd58a', '#cfdcff', '#e3d8ff'];

  function rocketScene({ W, H, ctx, stage, sources }) {
    const rocketEl = document.createElement('div');
    rocketEl.className = 'celebrate-actor';
    rocketEl.innerHTML = ROCKET_SVG;
    stage.appendChild(rocketEl);

    // Gedanken zerfallen in Staub und kleine Sterne
    const totalArea = sources.reduce((sum, s) => sum + s.r.width * s.r.height, 0) || 1;
    const dust = [];
    sources.forEach(s => {
      const count = Math.max(14, Math.round(1000 * s.r.width * s.r.height / totalArea));
      for (let k = 0; k < count; k++) {
        const star = Math.random() < 0.28;
        dust.push({
          x: rand(s.r.left, s.r.right), y: rand(s.r.top, s.r.bottom),
          vx: rand(-12, 12), vy: rand(-16, 4),
          size: star ? rand(2.4, 5.2) : rand(0.6, 1.7),
          star,
          color: DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0],
          delay: s.delay + rand(0, 0.6),
          alpha: 0, max: star ? 1 : rand(0.35, 0.8),
          seed: rand(0, TAU), spin: rand(-1.5, 1.5),
          blasted: -1, dead: false,
        });
      }
    });

    const sky = Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(0, H), size: rand(0.5, 1.6), phase: rand(0, TAU) }));
    const flames = [];
    const LAUNCH = 1.7, FLIGHT = 1.7, END = LAUNCH + FLIGHT + 0.9;

    function frame(t, dt) {
      // Sternenhimmel
      const skyAlpha = Math.min(1, t / 1.2);
      ctx.fillStyle = '#ffffff';
      for (const s of sky) {
        ctx.globalAlpha = skyAlpha * (0.3 + 0.3 * Math.sin(t * 2 + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, TAU);
        ctx.fill();
      }

      // Rakete von unten nach oben
      const u = Math.max(0, (t - LAUNCH) / FLIGHT);
      const ry = H + 80 - (H + 380) * Math.pow(u, 1.9);
      const rx = W / 2 + (u > 0 ? Math.sin(t * 45) * 1.4 : 0);
      rocketEl.style.transform = `translate(${rx - 28}px, ${ry - 48}px)`;
      const flying = u > 0 && ry > -200;

      if (flying) {
        for (let k = 0; k < 7; k++) {
          flames.push({ x: rx + rand(-5, 5), y: ry + 34, vx: rand(-35, 35), vy: rand(140, 380), life: 0, max: rand(0.3, 0.75), size: rand(3, 8) });
        }
      }
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        f.life += dt;
        if (f.life >= f.max) { flames.splice(i, 1); continue; }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        const k = f.life / f.max;
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = k < 0.25 ? '#fff3c4' : k < 0.6 ? '#ffb454' : '#8b91a8';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * (1 + k), 0, TAU);
        ctx.fill();
      }

      // Staub: schwebt, bis die Rakete ihn in alle Richtungen zerstreut
      for (const p of dust) {
        if (p.dead || t < p.delay) continue;
        let alpha;
        if (p.blasted < 0) {
          p.alpha = Math.min(p.max, p.alpha + dt * 2.5);
          p.vy -= 5 * dt;
          p.vx += Math.sin(t * 1.6 + p.seed) * 10 * dt;
          p.vx *= 1 - 0.9 * dt;
          p.vy *= 1 - 0.9 * dt;
          if (flying) {
            const dx = p.x - rx, dy = p.y - (ry - 30);
            const d = Math.hypot(dx, dy) || 1;
            if (d < 150 || ry - 40 < p.y) {
              const angle = Math.atan2(dy, dx) + rand(-0.9, 0.9);
              const speed = Math.max(320, 1250 - d * 2.4) * rand(0.6, 1.25);
              p.vx = Math.cos(angle) * speed;
              p.vy = Math.sin(angle) * speed - 60;
              p.blasted = t;
            }
          }
          alpha = p.alpha * (p.star ? 0.6 + 0.4 * Math.sin(t * 7 + p.seed) : 1);
        } else {
          const age = t - p.blasted;
          p.vx *= 1 - 1.5 * dt;
          p.vy *= 1 - 1.5 * dt;
          alpha = p.alpha * Math.max(0, 1 - age / 1.15);
          if (alpha <= 0) { p.dead = true; continue; }
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        if (p.star) sparkle(ctx, p.x, p.y, p.size, p.seed + t * p.spin);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      return t >= END;
    }

    return { duration: END, frame };
  }

  // ---------- Szene: Islandpferd ----------
  // Fuchsschecke: rotbraune Grundfarbe mit weißen Flecken.

  const HORSE_W = 160, HORSE_H = 130;
  // Rand rundum, damit der gehobene Schweif innerhalb der Zeichenfläche liegt. Safari (iOS) schneidet
  // SVG-Inhalt außerhalb der viewBox trotz overflow: visible ab, sobald das Element animiert wird.
  const PAD = 40;
  const FOX = '#b4532a', FOX_DARK = '#8c3f1f', WHITE = '#fbf6ea', HOOF = '#3b2a1d';
  const HORSE_SVG = `
    <svg viewBox="${-PAD} ${-PAD} ${HORSE_W + 2 * PAD} ${HORSE_H + 2 * PAD}" width="${HORSE_W + 2 * PAD}" height="${HORSE_H + 2 * PAD}" aria-hidden="true">
      <defs><clipPath id="horse-body"><ellipse cx="70" cy="66" rx="43" ry="26"/></clipPath></defs>
      <g class="tail"><path d="M33 50 C13 46 3 74 11 104 C23 100 31 82 39 62 Z" fill="${WHITE}"/></g>
      <g class="leg leg-a"><rect x="38" y="76" width="12" height="36" rx="6" fill="${FOX_DARK}"/><rect x="37" y="106" width="14" height="9" rx="3" fill="${HOOF}"/></g>
      <g class="leg leg-b"><rect x="92" y="76" width="12" height="36" rx="6" fill="${FOX_DARK}"/><rect x="91" y="106" width="14" height="9" rx="3" fill="${HOOF}"/></g>
      <path d="M88 50 L110 18 L130 32 L110 78 Z" fill="${FOX}"/>
      <ellipse cx="70" cy="66" rx="43" ry="26" fill="${FOX}"/>
      <g clip-path="url(#horse-body)" fill="${WHITE}">
        <ellipse cx="53" cy="52" rx="18" ry="14"/>
        <ellipse cx="82" cy="86" rx="17" ry="11"/>
        <circle cx="30" cy="78" r="10"/>
        <circle cx="100" cy="62" r="7"/>
      </g>
      <g class="leg leg-b"><rect x="48" y="78" width="13" height="34" rx="6" fill="${FOX}"/><rect x="48" y="94" width="13" height="16" rx="5" fill="${WHITE}"/><rect x="47" y="106" width="15" height="9" rx="3" fill="${HOOF}"/></g>
      <g class="leg leg-a"><rect x="82" y="78" width="13" height="34" rx="6" fill="${WHITE}"/><rect x="81" y="106" width="15" height="9" rx="3" fill="${HOOF}"/></g>
      <path d="M113 17 L113 3 L122 14 Z" fill="${FOX}"/>
      <path d="M124 43 L150 45 L148 55 L127 51 Z" fill="#5a1a1a"/>
      <g class="jaw"><path d="M117 41 C128 46 139 48 150 46 C153 50 150 56 142 56 C131 55 122 51 115 46 Z" fill="${FOX}"/></g>
      <path d="M108 20 C120 10 136 18 147 33 C151 39 152 45 148 46 C136 47 122 44 108 38 Z" fill="${FOX}"/>
      <path d="M125 15 C135 19 143 27 148 35 C150 39 151 43 149 45 L143 44 C142 36 135 26 123 21 Z" fill="${WHITE}"/>
      <circle cx="147" cy="40" r="1.4" fill="${HOOF}"/>
      <circle cx="126" cy="29" r="2.8" fill="#1d1408"/>
      <circle cx="127" cy="28" r="0.9" fill="#ffffff"/>
      <path d="M116 9 C102 10 88 26 82 50 C80 62 90 66 95 56 C100 42 106 32 116 26 C112 34 114 40 120 30 Z" fill="${WHITE}"/>
      <path d="M113 9 C124 5 133 13 131 26 C125 20 119 18 113 18 Z" fill="${WHITE}"/>
    </svg>`;
  const MOUTH = { x: 148 - HORSE_W / 2, y: 49 - HORSE_H / 2 };
  const REAR = { x: 26 - HORSE_W / 2, y: 60 - HORSE_H / 2 };
  const FEET = 115 - HORSE_H / 2;
  const FAIRY_COLORS = ['#ffd1f0', '#ffe9a8', '#b8f1ff', '#d9c7ff', '#ffb37a', '#ffffff'];

  function carrotSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.font = '48px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🥕', 32, 36);
    return c;
  }

  function horseScene({ W, H, ctx, stage, sources }) {
    // Das Pferd liegt unter der Zeichenfläche, damit Karotten und Feenstaub davor fliegen.
    const horseEl = document.createElement('div');
    horseEl.className = 'celebrate-actor horse walking';
    horseEl.innerHTML = HORSE_SVG;
    stage.insertBefore(horseEl, stage.querySelector('canvas'));
    const sprite = carrotSprite();
    const setClass = (name, on) => { if (horseEl.classList.contains(name) !== on) horseEl.classList.toggle(name, on); };

    // Einträge werden zu Karotten
    const totalArea = sources.reduce((sum, s) => sum + s.r.width * s.r.height, 0) || 1;
    const carrots = [];
    sources.forEach(s => {
      const count = Math.max(3, Math.round(70 * s.r.width * s.r.height / totalArea));
      for (let k = 0; k < count; k++) {
        carrots.push({
          x: rand(s.r.left + 10, s.r.right - 10), y: rand(s.r.top + 6, s.r.bottom - 6),
          vx: 0, vy: 0, size: rand(20, 32), rot: rand(0, TAU), spin: rand(-1.2, 1.2),
          delay: s.delay + rand(0.1, 0.7), pop: 0, seed: rand(0, TAU), dead: false,
          call: rand(0.02, 0.7), speed: 0,   // ab welchem Anteil des Wegs sie losfliegt
        });
      }
    });
    const total = carrots.length;
    let eaten = 0;
    const crumbs = [];
    const fairy = [];

    const ground = H * 0.76;
    const ENTER = 1.3, WALK = 2.5, PUFF = 1.0, FLIP = 0.95;
    const PUFF_AT = ENTER + WALK + 0.15;
    const FLIP_AT = PUFF_AT + PUFF;
    const END = FLIP_AT + FLIP + 1.0;
    const PUFF_AIM = [0.25, 0.95, -0.2];
    const clamp01 = v => Math.min(1, Math.max(0, v));

    function frame(t, dt) {
      const w = clamp01((t - ENTER) / WALK);
      const g = clamp01((t - PUFF_AT) / PUFF);
      const f = clamp01((t - FLIP_AT) / FLIP);
      // wird vom Fressen runder und beim Pupsen wieder schlank
      const scale = 1 + 0.14 * (total ? eaten / total : 0) * (1 - g);
      const hx = -HORSE_W + (W / 2 + HORSE_W) * (1 - Math.pow(1 - w, 1.6));
      let hy = ground - FEET * scale;
      let rot = 0;
      if (w > 0 && w < 1) hy += Math.sin(t * 15) * 2.5;
      const puffing = g > 0 && g < 1;
      const pulse = puffing ? Math.max(0, Math.sin(g * Math.PI * 3)) : 0;   // drei Pupser
      hy -= pulse * 7;
      if (f > 0) {
        hy -= Math.sin(Math.PI * f) * Math.min(190, H * 0.26);
        rot = -360 * ease(f);                                               // Rückwärtssalto
      }
      setClass('walking', w > 0 && w < 1);
      setClass('eating', w > 0 && eaten < total);
      setClass('tail-up', t > PUFF_AT - 0.15 && f === 0);
      horseEl.style.transform = `translate(${hx - HORSE_W / 2 - PAD}px, ${hy - HORSE_H / 2 - PAD}px) rotate(${rot}deg) scale(${scale})`;

      const mx = hx + MOUTH.x * scale, my = hy + MOUTH.y * scale;
      const onScreen = t > ENTER;

      for (const c of carrots) {
        if (c.dead || t < c.delay) continue;
        c.pop = Math.min(1, c.pop + dt * 3.5);
        c.rot += c.spin * dt;
        let dm = Infinity;
        if (!onScreen || w < c.call) {
          // schwebt noch an Ort und Stelle
          c.vy += Math.sin(t * 2.2 + c.seed) * 14 * dt;
          c.vx += Math.cos(t * 1.7 + c.seed) * 10 * dt;
          c.vx *= 1 - 1.4 * dt;
          c.vy *= 1 - 1.4 * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          if (onScreen) dm = Math.hypot(mx - c.x, my - c.y);
        } else {
          // fliegt auf geradem Weg ins Maul und wird dabei immer schneller
          const dx = mx - c.x, dy = my - c.y;
          dm = Math.hypot(dx, dy);
          c.speed += (900 + 2600 * w) * dt;
          const step = c.speed * dt;
          if (dm <= Math.max(14, step) || w >= 1) {
            c.dead = true;
            eaten++;
            for (let k = 0; k < 4; k++) crumbs.push({ x: mx, y: my, vx: rand(-40, 110), vy: rand(-140, -20), life: 0, max: rand(0.3, 0.6) });
            continue;
          }
          c.x += dx / dm * step;
          c.y += dy / dm * step;
        }
        const size = c.size * c.pop * (0.4 + 0.6 * Math.min(1, dm / 80));
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }

      // Krümel beim Fressen
      ctx.fillStyle = '#ff9a3c';
      for (let i = crumbs.length - 1; i >= 0; i--) {
        const p = crumbs[i];
        p.life += dt;
        if (p.life >= p.max) { crumbs.splice(i, 1); continue; }
        p.vy += 520 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = 1 - p.life / p.max;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, TAU);
        ctx.fill();
      }

      // Feenstaub: Die Karotten kommen hinten wieder heraus und lösen sich in Luft auf
      if (pulse > 0.25) {
        const bx = hx + REAR.x * scale, by = hy + REAR.y * scale;
        // jeder der drei Schübe geht in eine andere Richtung (Winkel nach hinten-oben)
        const aim = PUFF_AIM[Math.min(2, (g * 3) | 0)];
        for (let k = 0; k < 14; k++) {
          const star = Math.random() < 0.5;
          const angle = aim + rand(-0.5, 0.5);
          const speed = rand(180, 1000) * pulse;
          fairy.push({
            x: bx, y: by + rand(-6, 6),
            vx: -Math.cos(angle) * speed, vy: -Math.sin(angle) * speed,
            size: star ? rand(3.5, 10) : rand(1.2, 3.2), star,
            color: FAIRY_COLORS[(Math.random() * FAIRY_COLORS.length) | 0],
            life: 0, max: rand(1.2, 2.5), seed: rand(0, TAU), spin: rand(-3, 3),
          });
        }
      }
      for (let i = fairy.length - 1; i >= 0; i--) {
        const p = fairy[i];
        p.life += dt;
        if (p.life >= p.max) { fairy.splice(i, 1); continue; }
        p.vx *= 1 - 1.7 * dt;
        p.vy = p.vy * (1 - 1.7 * dt) - 30 * dt;
        p.x += p.vx * dt + Math.sin(t * 3 + p.seed) * 12 * dt;
        p.y += p.vy * dt;
        const k = p.life / p.max;
        ctx.globalAlpha = (1 - k * k) * (0.65 + 0.35 * Math.sin(t * 12 + p.seed));
        ctx.fillStyle = p.color;
        if (p.star) sparkle(ctx, p.x, p.y, p.size * (1 - 0.4 * k), p.seed + t * p.spin);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      return t >= END;
    }

    return { duration: END, frame };
  }

  // ---------- Ablauf ----------

  const scenes = { rocket: rocketScene, horse: horseScene };

  function run(elements, kind) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    const key = scenes[kind] ? kind : 'rocket';

    return new Promise(resolve => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      overlay = document.createElement('div');
      overlay.className = 'celebrate ' + key;
      overlay.innerHTML = '<div class="celebrate-bg"></div><canvas></canvas>';
      document.body.appendChild(overlay);
      const canvas = overlay.querySelector('canvas');
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      requestAnimationFrame(() => overlay && overlay.classList.add('on'));

      // Sichtbare Karten nacheinander auflösen
      const sources = elements
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(s => s.r.width > 0 && s.r.bottom > 0 && s.r.top < H);
      sources.forEach((s, i) => {
        s.delay = i * 0.11;
        s.el.style.transitionDelay = s.delay + 's';
        s.el.classList.add('dissolving');
      });

      const scene = scenes[key]({ W, H, ctx, stage: overlay, sources });
      let start = null, last = null;
      function frame(now) {
        if (!overlay) return;
        if (start === null) { start = now; last = now; }
        const t = (now - start) / 1000;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        ctx.clearRect(0, 0, W, H);
        if (scene.frame(t, dt)) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      // Falls der Tab im Hintergrund ist und keine Frames laufen, trotzdem weitermachen.
      setTimeout(resolve, (scene.duration + 1.5) * 1000);
    });
  }

  // Blendet die Animation aus, sobald die Abschluss-Ansicht darunter steht.
  function dismiss() {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
  }

  const emoji = kind => (kinds.find(k => k.key === kind) || kinds[0]).emoji;

  return { run, dismiss, kinds, emoji };
})();
