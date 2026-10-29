/* Живая планета (WebGL-шейдер) + 3D-монеты на орбитах, без библиотек */
(() => {
"use strict";
const auth = document.getElementById("auth");
const wrap = document.getElementById("gwrap");
const cvB = document.getElementById("scene");
const cvP = document.getElementById("planet");
const cvF = document.getElementById("scene2");
if (!auth || !wrap || !cvB || !cvP || !cvF) return;
const ctxB = cvB.getContext("2d"), ctxF = cvF.getContext("2d");
let ctx = ctxB;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;

/* ---------- WebGL: планета целиком считается в шейдере ---------- */
const VS = "attribute vec2 p;varying vec2 vUv;void main(){vUv=p;gl_Position=vec4(p,0.,1.);}";
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform float uSpin, uCloud, uPx;
const float TILT = .41;
float hash(vec3 p){ p = fract(p*.3183099 + vec3(.1,.2,.3)); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x), f.y), f.z);
}
const mat3 M = mat3(.00,.80,.60, -.80,.36,-.48, -.60,-.48,.64);
float fbm(vec3 p){ float a=.5,s=0.,n=0.; for(int i=0;i<6;i++){ s+=a*noise(p); n+=a; p=M*p*2.02; a*=.5; } return s/n; }
float fbmL(vec3 p){ float a=.5,s=0.,n=0.; for(int i=0;i<3;i++){ s+=a*noise(p); n+=a; p=M*p*2.02; a*=.5; } return s/n; }
void main(){
  vec2 q = vUv/.985; float rr = length(q);
  float al = 1. - smoothstep(1.-uPx*2., 1., rr);
  if (al <= 0.) { gl_FragColor = vec4(0.); return; }
  vec3 n = vec3(q, sqrt(max(1.-rr*rr, 0.)));
  float ct = cos(TILT), st = sin(TILT);
  vec3 v = vec3(n.x*ct+n.y*st, -n.x*st+n.y*ct, n.z);
  float cs = cos(uSpin), ss = sin(uSpin);
  vec3 p = vec3(v.x*cs+v.z*ss, v.y, -v.x*ss+v.z*cs);

  float h = fbm(p*1.7 + vec3(3.1,1.7,5.3)); h = (h-.5)*1.9 + .5;
  float sea = .55, aa = .012;
  float land = smoothstep(sea-aa, sea+aa, h);
  float e = max(h-sea, 0.)/(1.-sea);
  float lat = abs(p.y);
  float m = fbmL(p*3. + vec3(9.,0.,2.));

  // океан: бирюзовая отмель -> синий -> глубокий
  float d = clamp((sea-h)*3.2, 0., 1.);
  vec3 ocean = mix(vec3(.30,.82,.84), vec3(.06,.40,.74), smoothstep(0.,.3,d));
  ocean = mix(ocean, vec3(.03,.18,.50), smoothstep(.3,1.,d));
  // суша: песок -> зелень -> лес -> горы
  vec3 lc = mix(vec3(.93,.86,.58), vec3(.45,.74,.30), smoothstep(0.,.05,e));
  lc = mix(lc, vec3(.20,.52,.25), smoothstep(.05,.30,e));
  lc = mix(lc, vec3(.34,.50,.26), smoothstep(.40,.70,e));
  float dry = smoothstep(.55,.40,m) * smoothstep(.65,.25,lat) * (1.-smoothstep(.15,.35,e));
  lc = mix(lc, vec3(.88,.76,.46), dry);
    vec3 col = mix(ocean, lc, land);
  float ice = smoothstep(.80,.90, lat + (m-.5)*.12);
  col = mix(col, vec3(.96,.98,1.), ice);

  // облака
  vec3 pc = vec3(v.x*cos(uCloud)+v.z*sin(uCloud), v.y, -v.x*sin(uCloud)+v.z*cos(uCloud));
  float cl = smoothstep(.54,.76, fbm(pc*2.3 + vec3(6.,2.,8.))) * .88;
  col = mix(col, vec3(1.), cl);

  // свет
  vec3 L = normalize(vec3(-.55,.45,.7));
  float diff = dot(n, L);
  float dd = clamp(diff*1.1+.08, 0., 1.);
  float sh = .22 + .88*pow(dd, .9);
  col = col*sh + vec3(.02,.04,.12)*(1.-sh)*.6;
  // блик на воде
  vec3 H = normalize(L + vec3(0.,0.,1.));
  float sp = pow(max(dot(n,H),0.), 110.) * .65 * (1.-land) * (1.-ice) * (1.-cl);
  col += vec3(sp);
  // огни городов на ночной стороне
  float night = clamp((.05-diff)/.3, 0., 1.);
  float city = land * smoothstep(.5,.62, fbmL(p*5.+vec3(4.,0.,1.))) * smoothstep(.74,.88, noise(p*70.))
             * (1.-smoothstep(.3,.45,e)) * (1.-ice) * night * (1.-cl*.7);
  col += vec3(1.,.74,.30) * city * 1.3;
  // атмосфера по краю
  float fres = pow(1.-n.z, 2.6) * (.25 + .75*clamp(diff+.35, 0., 1.));
  col += vec3(.43,.72,1.) * fres * .9;
  gl_FragColor = vec4(col*al, al);
}`;
let gl = null, uSpin, uCloud, uPx;
try {
  gl = cvP.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (gl) {
    const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const pr = gl.createProgram();
    gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uSpin = gl.getUniformLocation(pr, "uSpin"); uCloud = gl.getUniformLocation(pr, "uCloud"); uPx = gl.getUniformLocation(pr, "uPx");
  }
} catch (e) { console.warn("WebGL planet off:", e); gl = null; }

/* ---------- 3D-монета ---------- */
function ell(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, .01), Math.max(ry, .01), 0, 0, TAU); }
function drawCoin(x, y, r, th, sym, phi, alpha) {
  const c = Math.cos(th), s = Math.sin(th), cp = Math.cos(phi), sp = Math.sin(phi);
  const nz = c * cp, sgn = nz >= 0 ? 1 : -1;
  const thick = r * .2, vx = s * thick, vy = c * sp * thick;
  const rx = r * Math.abs(c), ry = r * cp;
  ctx.save(); ctx.globalAlpha = alpha;
  // мягкое свечение
  const gl = ctx.createRadialGradient(x, y, r * .3, x, y, r * 1.9);
  gl.addColorStop(0, "rgba(244,191,63,.22)"); gl.addColorStop(1, "rgba(244,191,63,0)");
  ctx.fillStyle = gl; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  // ребро (рифлёный бок)
  const lit = .5 + .5 * Math.sin(th + 1.2), SL = 8;
  for (let k = 0; k <= SL; k++) {
    const f = sgn * (-.5 + k / SL), tone = k % 2 ? .82 : 1;
    ctx.fillStyle = `rgb(${(120 + 110 * lit) * tone | 0},${(72 + 88 * lit) * tone | 0},${(8 + 36 * lit) * tone | 0})`;
    ell(x + vx * f, y + vy * f, rx, ry); ctx.fill();
  }
  // лицевая сторона
  const fx = x + vx * .5 * sgn, fy = y + vy * .5 * sgn;
  const g = ctx.createRadialGradient(fx - rx * .3, fy - ry * .35, 0, fx, fy, Math.max(rx, ry) * 1.1);
  g.addColorStop(0, "#fff0b0"); g.addColorStop(.42, "#f4bf3f"); g.addColorStop(.74, "#cf8f1e"); g.addColorStop(1, "#a96a10");
  ell(fx, fy, rx, ry); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = r * .06;
  ell(fx, fy, rx * .97, ry * .97); ctx.strokeStyle = "rgba(140,88,8,.55)"; ctx.stroke();
  ell(fx, fy, rx * .82, ry * .82); ctx.strokeStyle = "rgba(255,238,175,.6)"; ctx.stroke();
  // блик
  ctx.save(); ell(fx, fy, rx, ry); ctx.clip();
  const p = .5 + .5 * Math.sin(th + .8);
  const sh = ctx.createLinearGradient(fx - rx, fy - ry, fx + rx, fy + ry);
  sh.addColorStop(clamp(p - .14), "rgba(255,255,255,0)"); sh.addColorStop(clamp(p), "rgba(255,255,255,.55)"); sh.addColorStop(clamp(p + .14), "rgba(255,255,255,0)");
  ctx.fillStyle = sh; ctx.fillRect(fx - rx, fy - ry, rx * 2, ry * 2);
  ctx.restore();
  // символ
  if (Math.abs(c) > .06) {
    ctx.save(); ctx.translate(fx, fy); ctx.scale(Math.abs(c), cp);
    ctx.font = `900 ${r * 1.05}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,240,170,.8)"; ctx.fillText(sym, r * .03, r * .06);
    ctx.fillStyle = "rgba(120,70,0,.65)"; ctx.fillText(sym, -r * .025, -r * .02);
    ctx.fillStyle = "#d9961f"; ctx.fillText(sym, 0, r * .02);
    ctx.restore();
  }
  // искра
  if (Math.abs(c) > .95) {
    const sx = fx - rx * .45, sy = fy - ry * .5, q = r * .38 * (Math.abs(c) - .95) * 20 / 1;
    ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath();
    ctx.moveTo(sx, sy - q); ctx.lineTo(sx + q * .16, sy - q * .16); ctx.lineTo(sx + q, sy); ctx.lineTo(sx + q * .16, sy + q * .16);
    ctx.lineTo(sx, sy + q); ctx.lineTo(sx - q * .16, sy + q * .16); ctx.lineTo(sx - q, sy); ctx.lineTo(sx - q * .16, sy - q * .16);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ---------- орбиты и монеты ---------- */
const orbits = [
  { ro: 1.34, tilt: .3, roll: -.12, w: .35, coins: [{ s: "₸", a: 0, r: .27, sp: 1.1 }, { s: "$", a: 2.1, r: .2, sp: 1.5 }, { s: "€", a: 4.2, r: .23, sp: .9 }] },
  { ro: 1.56, tilt: -.22, roll: .16, w: -.26, coins: [{ s: "¥", a: 1, r: .15, sp: 1.8 }, { s: "£", a: 4.1, r: .17, sp: 1.3 }] }
];
function orbitPos(o, a, ro, mx, my) {
  const T = o.tilt + my * .05;
  const x0 = ro * Math.cos(a), y0 = -ro * Math.sin(a) * Math.sin(T), z = ro * Math.sin(a) * Math.cos(T);
  const cr = Math.cos(o.roll + mx * .03), sr = Math.sin(o.roll + mx * .03);
  return { x: cx + x0 * cr - y0 * sr, y: cy - (x0 * sr + y0 * cr), z };
}
function drawRing(o, ro, mx, my, front) {
  ctx.beginPath();
  const S = 90;
  for (let i = 0; i < S; i++) {
    const a1 = i / S * TAU, a2 = (i + 1) / S * TAU;
    const p1 = orbitPos(o, a1, ro, mx, my), p2 = orbitPos(o, a2, ro, mx, my);
    if ((p1.z + p2.z >= 0) === front) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
  }
  ctx.lineWidth = 1.2; ctx.setLineDash([2, 7]); ctx.lineCap = "round";
  ctx.strokeStyle = front ? "rgba(214,150,31,.55)" : "rgba(214,150,31,.22)"; ctx.stroke(); ctx.setLineDash([]);
}

/* ---------- частицы ---------- */
let parts = [];
const PCOL = ["244,191,63", "127,203,79", "90,169,214"];
function initParts() {
  parts = Array.from({ length: Math.round(W / 38) }, () => ({
    x: Math.random() * W, y: Math.random() * H, s: 2 + Math.random() * 4, v: 6 + Math.random() * 16,
    ph: Math.random() * TAU, k: (Math.random() * 3) | 0, c: PCOL[(Math.random() * 3) | 0]
  }));
}
function drawParts(t, dt) {
  for (const p of parts) {
    p.y -= p.v * dt; if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
    const a = .25 + .5 * (.5 + .5 * Math.sin(t * 1.6 + p.ph)), x = p.x + Math.sin(t * .6 + p.ph) * 8;
    ctx.fillStyle = ctx.strokeStyle = `rgba(${p.c},${a})`;
    if (p.k === 0) { ctx.beginPath(); ctx.arc(x, p.y, p.s * .5, 0, TAU); ctx.fill(); }
    else if (p.k === 1) { ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - p.s, p.y); ctx.lineTo(x + p.s, p.y); ctx.moveTo(x, p.y - p.s); ctx.lineTo(x, p.y + p.s); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(x, p.y - p.s); ctx.lineTo(x + p.s * .6, p.y); ctx.lineTo(x, p.y + p.s); ctx.lineTo(x - p.s * .6, p.y); ctx.closePath(); ctx.fill(); }
  }
}

/* ---------- размеры ---------- */
let W = 0, H = 0, dpr = 1, D = 0, R = 0, cx = 0, cy = 0;
function layout() {
  const w = wrap.clientWidth; if (!w) return false;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = w; D = W < 760 ? W * .72 : Math.min(W * .58, 660); R = D / 2;
  // Планета целиком: центр посередине, сверху и снизу запас под атмосферу, орбиты и монеты
  // (раньше высота была cy + 0.8R, и нижняя часть шара обрезалась).
  cy = R * 1.3; cx = W / 2; H = Math.round(cy + R * 1.3);
  wrap.style.height = H + "px";
  for (const c of [cvB, cvF]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  ctxB.setTransform(dpr, 0, 0, dpr, 0, 0); ctxF.setTransform(dpr, 0, 0, dpr, 0, 0);
  // холст планеты: квадрат чуть больше шара
  const side = D / .985, px = Math.min(Math.round(side * dpr), 900);
  cvP.width = cvP.height = px;
  Object.assign(cvP.style, { left: (cx - side / 2) + "px", top: (cy - side / 2) + "px", width: side + "px", height: side + "px", right: "auto", bottom: "auto" });
  cvP.style.position = "absolute";
  initParts();
  return true;
}

/* ---------- отрисовка ---------- */
let t = reduce ? 6 : 0, mx = 0, my = 0, tmx = 0, tmy = 0, dirty = true;
function drawPlanet() {
  if (gl) {
    gl.viewport(0, 0, cvP.width, cvP.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uSpin, t * .104); gl.uniform1f(uCloud, t * .13 + .3); gl.uniform1f(uPx, 1.5 / (cvP.width / 2));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    // запасной вариант без WebGL: простой шар
    const g = ctxB.createRadialGradient(cx - R * .35, cy - R * .4, R * .1, cx, cy, R);
    g.addColorStop(0, "#9fe0e6"); g.addColorStop(.5, "#2f93c8"); g.addColorStop(1, "#143f78");
    ctxB.fillStyle = g; ctxB.beginPath(); ctxB.arc(cx, cy, R, 0, TAU); ctxB.fill();
  }
}
function draw(dt) {
  ctxB.clearRect(0, 0, W, H); ctxF.clearRect(0, 0, W, H);
  ctx = ctxB;
  drawParts(t, dt);
  const items = [];
  for (const o of orbits) {
    const ro = Math.min(R * o.ro, W / 2 - R * .36);
    drawRing(o, ro, mx, my, false);
    for (const c of o.coins) {
      const p = orbitPos(o, c.a + t * o.w, ro, mx, my);
      const sc = 1 + (p.z / ro) * .28;
      items.push({ x: p.x, y: p.y + Math.sin(t * 1.3 + c.a) * 4, z: p.z, r: R * c.r * sc, th: t * c.sp + c.a * 2, s: c.s, phi: .3 + my * .1 + Math.sin(t * .7 + c.a) * .08 });
    }
  }
  for (const it of items) if (it.z < 0) drawCoin(it.x, it.y, it.r, it.th, it.s, it.phi, .88);
  const glw = ctxB.createRadialGradient(cx, cy, R * .96, cx, cy, R * 1.2);
  glw.addColorStop(0, "rgba(110,190,255,.34)"); glw.addColorStop(.35, "rgba(110,190,255,.12)"); glw.addColorStop(1, "rgba(110,190,255,0)");
  ctxB.fillStyle = glw; ctxB.beginPath(); ctxB.arc(cx, cy, R * 1.2, 0, TAU); ctxB.fill();
  drawPlanet();
  ctx = ctxF;
  for (const o of orbits) drawRing(o, Math.min(R * o.ro, W / 2 - R * .36), mx, my, true);
  for (const it of items) if (it.z >= 0) drawCoin(it.x, it.y, it.r, it.th, it.s, it.phi, 1);
}

let last = 0, vis = true;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05); last = now;
  if (!vis || document.hidden || !auth.getClientRects().length) return;
  const paused = auth.classList.contains("paused") || reduce;
  if (paused && !dirty) return;
  if (!paused) {
    t += dt;
    mx += (tmx - mx) * .06; my += (tmy - my) * .06;
    wrap.style.setProperty("--mx", mx.toFixed(3)); wrap.style.setProperty("--my", my.toFixed(3));
  }
  draw(paused ? 0 : dt); dirty = false;
}

/* ---------- события ---------- */
window.addEventListener("pointermove", e => { tmx = (e.clientX / innerWidth - .5) * 2; tmy = (e.clientY / innerHeight - .5) * 2; }, { passive: true });
if ("ResizeObserver" in window) {
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (layout()) dirty = true; }); }).observe(wrap);
}
if ("IntersectionObserver" in window) new IntersectionObserver(es => { vis = es[0].isIntersecting; }).observe(wrap);

// чип с поступлениями
const ntv = document.getElementById("ntv");
if (ntv && !reduce) {
  const vals = ["+45 000 ₸", "+12 500 ₸", "+3 200 ₸", "+120 000 ₸", "+8 900 ₸"]; let k = 0;
  setInterval(() => {
    if (auth.classList.contains("paused") || !auth.getClientRects().length) return;
    k = (k + 1) % vals.length; ntv.textContent = vals[k];
    ntv.classList.remove("pop"); void ntv.offsetWidth; ntv.classList.add("pop");
  }, 2800);
}

layout();
requestAnimationFrame(frame);
})();
