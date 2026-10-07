// PanoViewer — a small WebGL2 equirectangular renderer.
//
// The projection is a generalised perspective: a camera sitting `d` units
// behind the sphere centre. d = 0 is ordinary rectilinear, d = 1 is
// stereographic ("little planet"). Animating d, pitch and zoom together gives
// the unfold intro. Scene changes render both panoramas in one pass with
// independent zoom + orientation, so the cut is a continuous move forward.

const PI = Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const ease = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(PI * t) - 1) / 2,
  inCubic: (t) => t * t * t,
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 outColor;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform mat3 uRotA;
uniform mat3 uRotB;
uniform float uScaleA;
uniform float uScaleB;
uniform float uD;
uniform float uMix;
uniform float uBlur;
uniform float uAspect;
uniform float uVignette;
const float PI = 3.141592653589793;

vec3 rayFor(vec2 ndc, float s, mat3 rot){
  vec2 p = vec2(ndc.x * uAspect, ndc.y) * s;
  float r2 = dot(p, p);
  float d = uD;
  float disc = max(d * d - (r2 + 1.0) * (d * d - 1.0), 0.0);
  float t = (d + sqrt(disc)) / (r2 + 1.0);
  vec3 c = vec3(t * p.x, t * p.y, -(t - d));
  return rot * normalize(c);
}

vec3 sampleEq(sampler2D tex, vec3 dir){
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  // Pick the derivative that does not jump across the wrap seam,
  // otherwise mip selection draws a 1px line at lon = 180deg.
  float u2 = fract(uv.x + 0.5);
  float dux = dFdx(uv.x), duy = dFdy(uv.x);
  float dux2 = dFdx(u2), duy2 = dFdy(u2);
  if (abs(dux2) < abs(dux)) dux = dux2;
  if (abs(duy2) < abs(duy)) duy = duy2;
  return textureGrad(tex, uv, vec2(dux, dFdx(uv.y)), vec2(duy, dFdy(uv.y))).rgb;
}

vec3 shade(sampler2D tex, vec2 ndc, float s, mat3 rot){
  vec3 col = sampleEq(tex, rayFor(ndc, s, rot));
  if (uBlur > 0.001) {
    // radial zoom blur toward the screen centre, sells the forward motion
    float w = 1.0;
    for (int i = 1; i <= 8; i++) {
      float k = 1.0 - uBlur * 0.03 * float(i);
      col += sampleEq(tex, rayFor(ndc * k, s, rot));
      w += 1.0;
    }
    col /= w;
  }
  return col;
}

void main(){
  vec3 col = shade(uTexA, vNdc, uScaleA, uRotA);
  if (uMix > 0.001) col = mix(col, shade(uTexB, vNdc, uScaleB, uRotB), uMix);
  vec2 v = vNdc * vec2(uAspect, 1.0) * 0.5;
  col *= 1.0 - uVignette * smoothstep(0.35, 1.25, length(v));
  outColor = vec4(col, 1.0);
}`;

// --- 3x3 matrices (column-major, as WebGL wants) ---------------------------
function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
function mul(a, b) {
  const o = new Array(9);
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++)
      o[col * 3 + row] =
        a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
  return o;
}
function quatToMat(x, y, z, w) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
}
function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
const forwardLon = (m) => Math.atan2(-m[6], m[8]); // lon of R * (0,0,-1)
const forwardLat = (m) => Math.asin(clamp(-m[7], -1, 1));

export const deg = (d) => (d * PI) / 180;

export class PanoViewer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");

    this.minScale = 0.22;
    this.maxScale = 1.55;
    this._baseScale = opts.defaultScale ?? 0.8;
    this.defaultScale = this._baseScale;

    // camera state
    this.yaw = 0;
    this.pitch = 0;
    this.scale = this.defaultScale;
    this.d = 0;
    this.targetScale = this.scale;
    this.vel = { yaw: 0, pitch: 0 };
    this.dragging = false;
    this.lastInteraction = performance.now();
    this.autoRotateSpeed = opts.autoRotateSpeed ?? 0.045; // rad/s
    this.autoRotate = true;
    this.introActive = false;
    this.locked = false; // input disabled (intro / transitions)
    this.planetMode = false;

    // gyro
    this.gyro = false;
    this.deviceQuat = null;
    this.smoothQuat = null;

    // render state for the two-texture blend
    this.texA = null;
    this.texB = null;
    this.mix = 0;
    this.blur = 0;
    this.scaleAMul = 1;
    this.scaleBMul = 1;
    this.deltaB = 0;
    this.vignette = 0; // show the photos exactly as shot

    this.onFrame = null;
    this._anims = [];
    this._initGL();
    this._bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // ---------------------------------------------------------------- GL setup
  _initGL() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const n of ["uTexA", "uTexB", "uRotA", "uRotB", "uScaleA", "uScaleB", "uD", "uMix", "uBlur", "uAspect", "uVignette"])
      this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uTexA, 0);
    gl.uniform1i(this.u.uTexB, 1);

    // 1x1 placeholder so the sampler is always valid
    this._blank = this._createTexture(null);
  }

  _createTexture(source) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (source) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso)
        gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(16, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([10, 14, 24]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
  }

  /** Decode an image URL into a GPU texture. Resolves with the texture. */
  async loadTexture(url, onProgress) {
    let source;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      let blob;
      const total = +res.headers.get("content-length");
      if (onProgress && res.body && total) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          onProgress(got / total);
        }
        blob = new Blob(chunks, { type: "image/jpeg" });
      } else blob = await res.blob();
      source = await createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none" });
    } catch (e) {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    }
    onProgress?.(1);
    const tex = this._createTexture(source);
    source.close?.();
    return tex;
  }

  deleteTexture(tex) {
    if (tex && tex !== this._blank) this.gl.deleteTexture(tex);
  }

  setTexture(tex) {
    this.texA = tex;
  }

  // -------------------------------------------------------------- matrices
  _base() {
    if (this.gyro && this.smoothQuat) return quatToMat(...this.smoothQuat);
    return rotX(this.pitch);
  }
  rotation(extraYaw = 0) {
    return mul(rotY(-(this.yaw + extraYaw)), this._base());
  }
  /** Current look direction in world lon/lat (radians). */
  look() {
    const m = this.rotation();
    return { lon: forwardLon(m), lat: forwardLat(m) };
  }

  /** Project world lon/lat to CSS pixels. Returns null if not visible. */
  project(lon, lat) {
    const cl = Math.cos(lat);
    const w = [cl * Math.sin(lon), Math.sin(lat), -cl * Math.cos(lon)];
    const m = this.rotation();
    // camera = R^T * world
    const cx = m[0] * w[0] + m[1] * w[1] + m[2] * w[2];
    const cy = m[3] * w[0] + m[4] * w[1] + m[5] * w[2];
    const cz = m[6] * w[0] + m[7] * w[1] + m[8] * w[2];
    const depth = -cz + this.d;
    if (depth < 0.08) return null;
    const s = this.scale * this.scaleAMul;
    const nx = cx / depth / (s * this.aspect);
    const ny = cy / depth / s;
    if (Math.abs(nx) > 1.3 || Math.abs(ny) > 1.3) return null;
    return { x: (nx * 0.5 + 0.5) * this.cssW, y: (0.5 - ny * 0.5) * this.cssH, depth };
  }

  /** CSS pixel -> world lon/lat (for picking / debugging hotspot placement). */
  unproject(px, py) {
    const nx = (px / this.cssW) * 2 - 1, ny = 1 - (py / this.cssH) * 2;
    const s = this.scale;
    const p = [nx * this.aspect * s, ny * s];
    const r2 = p[0] * p[0] + p[1] * p[1], d = this.d;
    const t = (d + Math.sqrt(Math.max(d * d - (r2 + 1) * (d * d - 1), 0))) / (r2 + 1);
    let c = [t * p[0], t * p[1], -(t - d)];
    const l = Math.hypot(...c);
    c = c.map((v) => v / l);
    const m = this.rotation();
    const w = [
      m[0] * c[0] + m[3] * c[1] + m[6] * c[2],
      m[1] * c[0] + m[4] * c[1] + m[7] * c[2],
      m[2] * c[0] + m[5] * c[1] + m[8] * c[2],
    ];
    return { lon: Math.atan2(w[0], -w[2]), lat: Math.asin(clamp(w[1], -1, 1)) };
  }

  // ------------------------------------------------------------- animation
  animate(duration, step, easing = ease.inOutCubic) {
    return new Promise((resolve) => {
      this._anims.push({ start: performance.now(), duration, step, easing, resolve });
    });
  }

  /** Little-planet intro that unfolds into the normal view. */
  async intro({ hold = 1600, duration = 3600, toYaw = 0 } = {}) {
    this.introActive = true;
    this.locked = true;
    this.pitch = -PI / 2;
    this.d = 1;
    this.scale = this.targetScale = 2.7;
    const yaw0 = toYaw - PI * 1.15;
    this.yaw = yaw0;
    this._skipIntro = false;
    // slow spin while holding the planet
    this._holdAnim = this.animate(hold, (t) => { this.yaw = yaw0 + t * 0.35; }, (t) => t);
    await this._holdAnim;
    if (this._skipIntro) duration = Math.min(duration, 1800);
    const y1 = this.yaw;
    await this.animate(duration, (t) => {
      const e = ease.inOutCubic(t);
      this.yaw = lerp(y1, toYaw, ease.inOutSine(t));
      this.pitch = lerp(-PI / 2, 0, e);
      this.d = lerp(1, 0, ease.inOutSine(clamp(t * 1.1, 0, 1)));
      this.scale = this.targetScale = Math.exp(lerp(Math.log(2.7), Math.log(this.defaultScale), e));
    }, (t) => t);
    this.d = 0;
    this.introActive = false;
    this.locked = false;
    this.lastInteraction = performance.now();
  }

  /** Morph to / from the little-planet projection. */
  async setPlanet(on) {
    if (this.locked || on === this.planetMode) return;
    if (on && this.gyro) this.disableGyro();
    this.locked = true;
    this.vel.yaw = this.vel.pitch = 0;
    const p0 = this.pitch, d0 = this.d, s0 = this.scale;
    const p1 = on ? -PI / 2 + 0.02 : 0, d1 = on ? 1 : 0, s1 = on ? 2.7 : this.defaultScale;
    const y0 = this.yaw;
    await this.animate(1800, (t) => {
      this.pitch = lerp(p0, p1, t);
      this.d = lerp(d0, d1, ease.inOutSine(t));
      this.scale = this.targetScale = Math.exp(lerp(Math.log(s0), Math.log(s1), t));
      this.yaw = y0 + (on ? 1 : -1) * 0.6 * t;
    });
    this.planetMode = on;
    this.locked = false;
    this.lastInteraction = performance.now();
  }

  /** Cut the planet hold short; the unfold then plays quickly. */
  skipIntro() {
    if (!this.introActive || this._skipIntro) return;
    this._skipIntro = true;
    const hold = this._anims[0];
    if (hold && this._holdAnim) {
      hold.step = () => {}; // freeze the spin where it is, no jump
      hold.duration = 1e-6;
    }
  }

  /**
   * Fly through to another panorama.
   * fromLon/fromLat: where to look before moving (the hotspot), or null.
   * arriveLon: the direction the camera faces in the new scene.
   */
  async transition(texB, { fromLon = null, fromLat = 0, arriveLon = 0, duration = 1500 } = {}) {
    this.locked = true;
    this.vel.yaw = this.vel.pitch = 0;
    if (fromLon !== null && !this.gyro) {
      const y0 = this.yaw, p0 = this.pitch, s0 = this.scale;
      const dy = wrapAngle(fromLon - y0);
      const turn = Math.abs(dy) + Math.abs(fromLat * 0.6 - p0);
      await this.animate(clamp(380 + turn * 380, 380, 900), (t) => {
        this.yaw = y0 + dy * t;
        this.pitch = lerp(p0, clamp(fromLat * 0.6, -0.35, 0.35), t);
        this.scale = this.targetScale = lerp(s0, this.defaultScale, t);
      }, ease.inOutCubic);
    }
    const lookNow = this.look().lon;
    this.deltaB = wrapAngle(arriveLon - lookNow);
    this.texB = texB;
    const p0 = this.pitch;
    await this.animate(duration, (t) => {
      this.mix = ease.inOutSine(clamp((t - 0.12) / 0.7, 0, 1));
      this.scaleAMul = Math.exp(lerp(0, Math.log(0.42), ease.inCubic(t)));
      this.scaleBMul = Math.exp(lerp(Math.log(1.45), 0, ease.outCubic(t)));
      this.blur = Math.sin(PI * clamp(t * 1.05, 0, 1)) * 1.0;
      if (!this.gyro) this.pitch = lerp(p0, 0, ease.inOutSine(t));
    }, (t) => t);
    // commit: B becomes the current scene
    this.yaw += this.deltaB;
    this.deltaB = 0;
    this.texA = texB;
    this.texB = null;
    this.mix = 0;
    this.blur = 0;
    this.scaleAMul = this.scaleBMul = 1;
    this.locked = false;
    this.lastInteraction = performance.now();
  }

  // ------------------------------------------------------------------ gyro
  static gyroSupported() {
    return typeof window !== "undefined" && "DeviceOrientationEvent" in window &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }

  async enableGyro() {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== "granted") throw new Error("Motion permission denied");
    }
    const desiredLon = this.look().lon;
    this._gyroHandler = (e) => this._onOrientation(e);
    window.addEventListener("deviceorientation", this._gyroHandler);
    // wait for the first reading so we can align headings without a jump
    await new Promise((resolve, reject) => {
      const t0 = performance.now();
      const check = () => {
        if (this.deviceQuat) return resolve();
        if (performance.now() - t0 > 1500) return reject(new Error("No motion sensor data"));
        requestAnimationFrame(check);
      };
      check();
    }).catch((e) => {
      window.removeEventListener("deviceorientation", this._gyroHandler);
      throw e;
    });
    this.smoothQuat = this.deviceQuat.slice();
    const devLon = forwardLon(quatToMat(...this.smoothQuat));
    this.yaw = desiredLon - devLon;
    this.gyro = true;
  }

  disableGyro() {
    if (!this.gyro) return;
    const { lon, lat } = this.look();
    window.removeEventListener("deviceorientation", this._gyroHandler);
    this.gyro = false;
    this.deviceQuat = this.smoothQuat = null;
    this.yaw = lon;
    this.pitch = clamp(lat, -PI / 2 + 0.05, PI / 2 - 0.05);
  }

  _onOrientation(e) {
    if (e.alpha == null) return;
    const a = deg(e.alpha), b = deg(e.beta), g = deg(-e.gamma);
    // Euler 'YXZ' (beta about X, alpha about Y, -gamma about Z) -> quaternion
    const c1 = Math.cos(b / 2), c2 = Math.cos(a / 2), c3 = Math.cos(g / 2);
    const s1 = Math.sin(b / 2), s2 = Math.sin(a / 2), s3 = Math.sin(g / 2);
    let q = [
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 - s1 * s2 * c3,
      c1 * c2 * c3 + s1 * s2 * s3,
    ];
    q = quatMul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]); // camera looks out the back of the device
    const orient = deg((screen.orientation && screen.orientation.angle) || window.orientation || 0);
    q = quatMul(q, [0, 0, -Math.sin(orient / 2), Math.cos(orient / 2)]);
    this.deviceQuat = q;
  }

  // ----------------------------------------------------------------- input
  _bindInput() {
    const el = this.canvas;
    const pointers = new Map();
    let pinchDist = 0;
    let lastMove = 0;

    const angPerPx = () => (2 * this.scale) / this.cssH;

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.vel.yaw = this.vel.pitch = 0;
      this.lastInteraction = performance.now();
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      }
    });
    el.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.lastInteraction = performance.now();
      if (this.locked) return;
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (pinchDist) this.zoomBy(pinchDist / dist, true);
        pinchDist = dist;
        return;
      }
      const k = angPerPx();
      const now = performance.now();
      const dt = Math.max(1, now - lastMove) / 1000;
      lastMove = now;
      this.yaw -= dx * k;
      if (!this.gyro) this.pitch = clamp(this.pitch + dy * k, -PI / 2 + 0.02, PI / 2 - 0.02);
      this.vel.yaw = lerp(this.vel.yaw, (-dx * k) / dt, 0.5);
      this.vel.pitch = this.gyro ? 0 : lerp(this.vel.pitch, (dy * k) / dt, 0.5);
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        this.dragging = false;
        if (performance.now() - lastMove > 80) this.vel.yaw = this.vel.pitch = 0;
      }
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.lastInteraction = performance.now();
      if (this.locked) return;
      this.zoomBy(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0012)));
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (this.locked || e.target.closest?.("input,textarea")) return;
      const step = 0.12 * this.scale;
      const keys = {
        ArrowLeft: () => (this.vel.yaw = -step * 8),
        ArrowRight: () => (this.vel.yaw = step * 8),
        ArrowUp: () => (this.vel.pitch = step * 8),
        ArrowDown: () => (this.vel.pitch = -step * 8),
        "+": () => this.zoomBy(0.85),
        "=": () => this.zoomBy(0.85),
        "-": () => this.zoomBy(1.18),
      };
      if (keys[e.key]) {
        keys[e.key]();
        this.lastInteraction = performance.now();
      }
    });
  }

  zoomBy(f, immediate = false) {
    const max = this.planetMode ? 4 : this.maxScale, min = this.planetMode ? 1.2 : this.minScale;
    this.targetScale = clamp(this.targetScale * f, min, max);
    if (immediate) this.scale = this.targetScale;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = this.canvas.clientWidth || window.innerWidth;
    this.cssH = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.aspect = this.cssW / this.cssH;
    // keep the horizontal field of view generous on portrait screens
    const prev = this.defaultScale;
    this.defaultScale = this.aspect < 1 ? this._baseScale * Math.min(1.45, 1 / Math.sqrt(this.aspect)) : this._baseScale;
    if (this.scale !== undefined && !this.introActive) {
      this.targetScale *= this.defaultScale / prev;
      this.scale *= this.defaultScale / prev;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  // ------------------------------------------------------------------ loop
  _loop(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;

    // animations
    for (let i = this._anims.length - 1; i >= 0; i--) {
      const a = this._anims[i];
      const t = clamp((now - a.start) / a.duration, 0, 1);
      a.step(a.easing(t), t);
      if (t >= 1) {
        this._anims.splice(i, 1);
        a.resolve();
      }
    }

    if (!this.locked) {
      // inertia
      if (!this.dragging) {
        this.yaw += this.vel.yaw * dt;
        if (!this.gyro) this.pitch = clamp(this.pitch + this.vel.pitch * dt, -PI / 2 + 0.02, PI / 2 - 0.02);
        const decay = Math.exp(-dt * 4.2);
        this.vel.yaw *= decay;
        this.vel.pitch *= decay;
      }
      // idle auto-rotate, eased in
      const idle = (now - this.lastInteraction) / 1000;
      if (this.autoRotate && !this.gyro && !this.dragging && idle > 4) {
        const ramp = clamp((idle - 4) / 2.5, 0, 1);
        this.yaw += this.autoRotateSpeed * ramp * dt;
        if (!this.planetMode) this.pitch = lerp(this.pitch, 0, 0.6 * ramp * dt);
      }
      // smooth zoom; widen the projection a touch when zoomed far out
      this.scale = lerp(this.scale, this.targetScale, 1 - Math.exp(-dt * 10));
      if (!this.planetMode) this.d = clamp((this.scale - 1.0) / 0.55, 0, 1) * 0.45;
    }

    if (this.gyro && this.deviceQuat) {
      // low-pass the sensor (nlerp along the shorter arc)
      const q = this.deviceQuat, s = this.smoothQuat;
      const sign = q[0] * s[0] + q[1] * s[1] + q[2] * s[2] + q[3] * s[3] < 0 ? -1 : 1;
      const k = 1 - Math.exp(-dt * 18);
      for (let i = 0; i < 4; i++) s[i] = lerp(s[i], q[i] * sign, k);
      const l = Math.hypot(...s);
      for (let i = 0; i < 4; i++) s[i] /= l;
    }

    this._draw();
    this.onFrame?.(now);
    requestAnimationFrame((t) => this._loop(t));
  }

  _draw() {
    const gl = this.gl, u = this.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA || this._blank);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB || this._blank);
    gl.uniformMatrix3fv(u.uRotA, false, this.rotation());
    gl.uniformMatrix3fv(u.uRotB, false, this.rotation(this.deltaB));
    gl.uniform1f(u.uScaleA, this.scale * this.scaleAMul);
    gl.uniform1f(u.uScaleB, this.scale * this.scaleBMul);
    gl.uniform1f(u.uD, this.d);
    gl.uniform1f(u.uMix, this.mix);
    gl.uniform1f(u.uBlur, this.blur);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform1f(u.uVignette, this.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
