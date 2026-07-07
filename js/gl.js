/* WebGL2 renderer for the VSS simulator.

   Pass 1 (scene pass): source texture → double vision, nyctalopia,
     photophobia glare, halos/starbursts, then palinopsia trailing via a
     ping-pong feedback buffer. Writes into the trail buffer.
   Pass 2 (overlay pass): trail buffer → pulsating vision, visual snow,
     floaters, blue-field dots, photopsia flashes. Draws to the screen —
     once normally, twice (half-width viewports) in VR mode. */

"use strict";

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

const SCENE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uScene, uPrev;
uniform vec2 uRes, uSceneSize;
uniform float uGhost, uNyct, uTrail;
uniform float uZoom, uPan;   // slow Ken Burns pan for still images

float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }

vec2 coverUv(vec2 uv){
  float ca = uRes.x/uRes.y, sa = uSceneSize.x/uSceneSize.y;
  vec2 s = (ca > sa) ? vec2(1.0, sa/ca) : vec2(ca/sa, 1.0);
  s /= uZoom;
  vec2 p = (uv - 0.5)*s + 0.5;
  p.x += (1.0 - s.x) * 0.5 * uPan;   // slide within the horizontal slack
  return p;
}

void main(){
  vec2 uv = coverUv(vUv);
  vec3 col = texture(uScene, uv).rgb;

  // — double vision / ghosting: a displaced second copy of the scene —
  if(uGhost > 0.001){
    vec2 off = vec2(0.016, 0.010) * uGhost;
    col = mix(col, texture(uScene, uv + off).rgb, 0.38*min(uGhost*1.6, 1.0));
  }

  // — nyctalopia: shadow detail collapses, darks desaturate —
  if(uNyct > 0.001){
    float l = luma(col);
    vec3 crushed = col * smoothstep(0.015, 0.5, l);
    crushed = mix(vec3(luma(crushed)), crushed, 1.0 - 0.6*uNyct);
    col = mix(col, crushed * 0.85, uNyct);
  }

  // — palinopsia: bright afterimages persist, motion smears —
  // (glare/halos are added in pass 2, AFTER this feedback buffer, so
  //  additive light can't compound itself frame over frame)
  vec3 prev = texture(uPrev, vUv).rgb;
  if(uTrail > 0.001){
    float decay = mix(0.86, 0.975, uTrail);
    col = max(col, prev * decay);
    col = mix(col, prev, uTrail * 0.22);
  }

  frag = vec4(col, 1.0);
}`;

const OVERLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uTex;    // trailed base scene (canvas-sized)
uniform sampler2D uScene;  // original source, mipmapped (for glare/halo blurs)
uniform vec2 uView, uCanvas, uSceneSize;
uniform float uTime;
uniform float uGlare, uHalo;
uniform float uZoom, uPan;
uniform float uClean;      // 1 = render the untouched scene (split compare)
uniform float uSnow, uSnowDensity, uSnowSize, uSnowSpeed, uSnowColor;
uniform float uPulse, uFloaterAmt, uBfepAmt;
uniform int uFloaterCount, uBfepCount;
uniform vec4 uFloaters[12];
uniform vec4 uBfep[32];
uniform vec4 uFlash;

float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
float hash21(vec2 p){
  uvec2 q = uvec2(ivec2(p) + 32768) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0/4294967295.0);
}

vec2 coverUv(vec2 uv){
  float ca = uCanvas.x/uCanvas.y, sa = uSceneSize.x/uSceneSize.y;
  vec2 s = (ca > sa) ? vec2(1.0, sa/ca) : vec2(ca/sa, 1.0);
  s /= uZoom;
  vec2 p = (uv - 0.5)*s + 0.5;
  p.x += (1.0 - s.x) * 0.5 * uPan;   // must match the scene pass exactly
  return p;
}

void main(){
  float aspect = uView.x/uView.y;
  vec2 uv = vUv;

  // split compare: this side of the divider shows typical vision
  if(uClean > 0.5){
    frag = vec4(texture(uScene, coverUv(uv)).rgb, 1.0);
    return;
  }

  // — pulsating / trembling vision —
  float pulseWave = 0.0;
  if(uPulse > 0.001){
    pulseWave = sin(uTime*2.1)*0.6 + sin(uTime*3.37)*0.4;
    uv = (uv - 0.5) * (1.0 + pulseWave*0.007*uPulse) + 0.5;
  }

  vec3 col = texture(uTex, uv).rgb;
  if(uPulse > 0.001) col *= 1.0 + pulseWave*0.03*uPulse;

  // — glare & halos, computed from the blurred original scene —
  if(uGlare > 0.001 || uHalo > 0.001){
    vec2 suv = coverUv(uv);
    vec3 blur1 = textureLod(uScene, suv, 3.5).rgb;
    vec3 blur2 = textureLod(uScene, suv, 5.5).rgb;
    float wideL = luma(blur2);

    if(uHalo > 0.001){
      // halos belong to light SOURCES: bright vs. their wide surroundings,
      // so a uniformly bright scene (white page, day sky) must not bloom
      float wideL3 = luma(textureLod(uScene, suv, 7.5).rgb);
      float srcness = smoothstep(0.04, 0.28, wideL - wideL3*0.9);
      col += blur2 * smoothstep(0.3, 0.85, wideL) * srcness * uHalo * 1.6;
      vec3 st = vec3(0.0);
      for(int i=0;i<8;i++){
        float a = float(i)*0.7854 + 0.32;
        vec2 dir = vec2(cos(a), sin(a));
        for(int j=1;j<=3;j++){
          vec2 o = dir * float(j*j) * 0.0065;
          o.x *= uCanvas.y/uCanvas.x;
          st += textureLod(uScene, suv + o, 4.0 + float(j)*0.5).rgb / float(j);
        }
      }
      st /= 12.0;
      col += st * smoothstep(0.45, 1.0, luma(st)) * srcness * uHalo * 1.5;
    }

    if(uGlare > 0.001){
      col += blur1 * smoothstep(0.4, 1.0, luma(blur1)) * uGlare * 0.7;
      col = mix(col, vec3(1.0), uGlare * 0.3 * smoothstep(0.6, 1.1, wideL));
      col *= 1.0 + uGlare * 0.15;
    }
    // keep headroom so snow/floaters stay visible over blown-out light
    col = clamp(col, 0.0, 1.0);
  }

  // — floaters: translucent drifting strands —
  for(int i=0;i<12;i++){
    if(i >= uFloaterCount) break;
    vec4 f = uFloaters[i];
    vec2 d = uv - f.xy;
    d.x *= aspect;
    float ang = f.w*6.2831 + uTime*0.07;
    vec2 dir = vec2(cos(ang), sin(ang));
    float m = 0.0;
    for(int j=0;j<3;j++){
      vec2 cc = d - dir*(float(j)-1.0)*f.z*1.15;
      float rr = f.z*(0.72 + 0.28*sin(f.w*41.0 + float(j)*2.13));
      m = max(m, smoothstep(rr, rr*0.25, length(cc)));
    }
    col = mix(col, col*0.62 + vec3(0.015), m*min(uFloaterAmt*1.5,1.0)*0.72);
  }

  // — blue-field entoptic phenomenon: quick darting bright dots —
  if(uBfepAmt > 0.001){
    for(int i=0;i<32;i++){
      if(i >= uBfepCount) break;
      vec4 b = uBfep[i];
      vec2 d = uv - b.xy;
      d.x *= aspect;
      float fade = sin(clamp(b.z, 0.0, 1.0)*3.14159);
      float m = exp(-pow(length(d)/0.0032, 2.0));
      col += vec3(0.85, 0.92, 1.0) * m * fade * min(uBfepAmt*1.4, 1.0);
    }
  }

  // — photopsia: spontaneous flash of light —
  if(uFlash.z > 0.003){
    vec2 d = uv - uFlash.xy;
    d.x *= aspect;
    float r = length(d);
    float m = exp(-pow(r/uFlash.w, 2.0))*0.85
            + exp(-pow(abs(r - uFlash.w*1.7)/(uFlash.w*0.32), 2.0))*0.5;
    col += vec3(1.0, 0.98, 0.9) * m * uFlash.z;
  }

  // — visual snow: dynamic dots across the entire field —
  if(uSnow > 0.001){
    float px = mix(1.6, 5.5, uSnowSize) * max(uView.y, 1.0)/800.0;
    px = max(px, 1.0);
    vec2 cell = floor(uv * uView / px);
    float fr = mod(floor(uTime * mix(7.0, 52.0, uSnowSpeed)), 1024.0);
    vec2 fo = vec2(fr*127.0, fr*311.0);
    float dens = mix(0.05, 0.62, uSnowDensity);
    float on = step(1.0 - dens, hash21(cell + fo));
    if(on > 0.5){
      float h2 = hash21(cell*1.61 + fo + 4.7);
      if(uSnowColor > 0.5){
        vec3 rc = vec3(hash21(cell+fo+9.1), hash21(cell+fo+13.7), hash21(cell+fo+17.3)) - 0.5;
        col += rc * 0.9 * uSnow;
      } else {
        col += (step(0.5, h2)*2.0 - 1.0) * uSnow * 0.42;
      }
    }
  }

  frag = vec4(col, 1.0);
}`;

class VSSRenderer {
  constructor(canvas){
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias:false, alpha:false, preserveDrawingBuffer:false });
    if(!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // fullscreen triangle
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.progScene = this._program(VERT, SCENE_FRAG);
    this.progOverlay = this._program(VERT, OVERLAY_FRAG);
    this.uS = this._uniforms(this.progScene,
      ["uScene","uPrev","uRes","uSceneSize","uGhost","uNyct","uTrail","uZoom","uPan"]);
    this.uO = this._uniforms(this.progOverlay,
      ["uTex","uScene","uView","uCanvas","uSceneSize","uTime","uGlare","uHalo","uZoom","uPan","uClean",
       "uSnow","uSnowDensity","uSnowSize","uSnowSpeed","uSnowColor",
       "uPulse","uFloaterAmt","uBfepAmt","uFloaterCount","uBfepCount","uFloaters","uBfep","uFlash"]);

    // source texture (image / video), mipmapped for halo & glare blurs
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.source = null;       // {el, w, h, dynamic}
    this.trail = [null, null]; // ping-pong {tex, fbo}
    this.cur = 0;
    this.width = 0; this.height = 0;

    // particle state
    this.floaters = Array.from({length:12}, (_, i) => ({
      bx: Math.random(), by: Math.random()*0.8 + 0.1,
      r: 0.018 + Math.random()*0.035,
      seed: Math.random(),
      p1: Math.random()*6.28, p2: Math.random()*6.28
    }));
    this.bfep = Array.from({length:32}, () => this._spawnBfep(true));
    this.flash = { x:0.5, y:0.5, i:0, r:0.1 };
    this.lastT = 0;

    this.floaterData = new Float32Array(48);
    this.bfepData = new Float32Array(128);
  }

  _spawnBfep(randomAge){
    const a = Math.random()*Math.PI*2;
    return {
      x: Math.random(), y: Math.random(),
      vx: Math.cos(a)*0.35, vy: Math.sin(a)*0.35,
      wig: Math.random()*40 + 20,
      life: randomAge ? Math.random() : 0,
      speed: 0.9 + Math.random()*1.4
    };
  }

  _program(vsSrc, fsSrc){
    const gl = this.gl;
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error("Shader: " + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error("Link: " + gl.getProgramInfoLog(p));
    return p;
  }

  _uniforms(prog, names){
    const out = {};
    for(const n of names) out[n] = this.gl.getUniformLocation(prog, n);
    return out;
  }

  setSource(el, w, h, dynamic){
    this.source = { el, w, h, dynamic };
    this._uploadSource();
    this._clearTrail();
  }

  _uploadSource(){
    const gl = this.gl, s = this.source;
    if(!s) return;
    if(s.dynamic && s.el.readyState !== undefined && s.el.readyState < 2) return;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.el);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  resize(w, h){
    if(w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl;
    for(let i=0;i<2;i++){
      if(this.trail[i]){ gl.deleteTexture(this.trail[i].tex); gl.deleteFramebuffer(this.trail[i].fbo); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.trail[i] = { tex, fbo };
    }
    this._clearTrail();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _clearTrail(){
    const gl = this.gl;
    for(const t of this.trail){
      if(!t) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0,0,0,1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _updateParticles(t, P){
    const dt = Math.min(t - this.lastT, 0.05);
    this.lastT = t;

    // floaters wander slowly
    for(let i=0;i<12;i++){
      const f = this.floaters[i];
      const x = f.bx + Math.sin(t*0.11 + f.p1)*0.05 + Math.sin(t*0.031 + f.p2)*0.03;
      const y = f.by + Math.cos(t*0.087 + f.p2)*0.05 + Math.sin(t*0.021 + f.p1)*0.04;
      this.floaterData.set([x, y, f.r, f.seed], i*4);
    }

    // blue-field sprites dart along wiggly paths
    for(let i=0;i<32;i++){
      const b = this.bfep[i];
      b.life += dt * b.speed;
      if(b.life > 1) Object.assign(b, this._spawnBfep(false));
      const wob = Math.sin(b.life * b.wig) * 0.012;
      const px = b.x + b.vx*b.life*0.35 + -b.vy*wob;
      const py = b.y + b.vy*b.life*0.35 +  b.vx*wob;
      this.bfepData.set([px, py, b.life, 0], i*4);
    }

    // photopsia flashes: random trigger, quick decay
    const fl = this.flash;
    fl.i *= Math.pow(0.014, dt);           // ~fully gone in half a second
    if(fl.i < 0.01) fl.i = 0;
    if(P.flashes > 0.001 && Math.random() < dt * P.flashes * 0.55){
      fl.x = 0.15 + Math.random()*0.7;
      fl.y = 0.15 + Math.random()*0.7;
      fl.r = 0.05 + Math.random()*0.09;
      fl.i = 0.5 + Math.random()*0.5;
    }
  }

  render(t, P, vr, split){
    const gl = this.gl;
    if(!this.source || !this.width) return;
    if(this.source.dynamic) this._uploadSource();
    this._updateParticles(t, P);

    const prev = this.trail[this.cur];
    const next = this.trail[1 - this.cur];
    this.cur = 1 - this.cur;

    // slow side-to-side pan on still images so motion effects (trailing,
    // ghosting) are visible even without a camera; the sinusoid eases at
    // each end. Live video pans itself — leave it alone.
    const still = !this.source.dynamic;
    const zoom = still ? 1.18 : 1.0;
    const pan = still ? Math.sin(t * (2*Math.PI/28)) : 0.0;

    // — pass 1: scene effects + trailing, into the trail buffer —
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.progScene);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(this.uS.uScene, 0);
    gl.uniform1i(this.uS.uPrev, 1);
    gl.uniform2f(this.uS.uRes, this.width, this.height);
    gl.uniform2f(this.uS.uSceneSize, this.source.w, this.source.h);
    gl.uniform1f(this.uS.uGhost, P.ghost);
    gl.uniform1f(this.uS.uNyct, P.night);
    gl.uniform1f(this.uS.uTrail, P.trail);
    gl.uniform1f(this.uS.uZoom, zoom);
    gl.uniform1f(this.uS.uPan, pan);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // — pass 2: light effects + overlay phenomena, to screen (twice for VR) —
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.progOverlay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(this.uO.uTex, 0);
    gl.uniform1i(this.uO.uScene, 1);
    gl.uniform2f(this.uO.uCanvas, this.width, this.height);
    gl.uniform2f(this.uO.uSceneSize, this.source.w, this.source.h);
    gl.uniform1f(this.uO.uGlare, P.glare);
    gl.uniform1f(this.uO.uHalo, P.halos);
    gl.uniform1f(this.uO.uZoom, zoom);
    gl.uniform1f(this.uO.uPan, pan);
    gl.uniform1f(this.uO.uTime, t);
    gl.uniform1f(this.uO.uSnow, P.snow);
    gl.uniform1f(this.uO.uSnowDensity, P.snowDensity);
    gl.uniform1f(this.uO.uSnowSize, P.snowSize);
    gl.uniform1f(this.uO.uSnowSpeed, P.snowSpeed);
    gl.uniform1f(this.uO.uSnowColor, P.snowColor);
    gl.uniform1f(this.uO.uPulse, P.pulse);
    gl.uniform1f(this.uO.uFloaterAmt, P.floaters);
    gl.uniform1f(this.uO.uBfepAmt, P.bfep);
    gl.uniform1i(this.uO.uFloaterCount, Math.ceil(P.floaters * 12));
    gl.uniform1i(this.uO.uBfepCount, Math.ceil(P.bfep * 32));
    gl.uniform4fv(this.uO.uFloaters, this.floaterData);
    gl.uniform4fv(this.uO.uBfep, this.bfepData);
    gl.uniform4f(this.uO.uFlash, this.flash.x, this.flash.y, this.flash.i, this.flash.r);

    if(vr){
      gl.uniform1f(this.uO.uClean, 0);
      const hw = Math.floor(this.width/2);
      gl.uniform2f(this.uO.uView, hw, this.height);
      gl.viewport(0, 0, hw, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.viewport(hw, 0, this.width - hw, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if(split != null){
      // split compare: clean scene left of the divider, symptoms right
      const sx = Math.round(Math.min(Math.max(split, 0), 1) * this.width);
      gl.uniform2f(this.uO.uView, this.width, this.height);
      gl.viewport(0, 0, this.width, this.height);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, sx, this.height);
      gl.uniform1f(this.uO.uClean, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.scissor(sx, 0, this.width - sx, this.height);
      gl.uniform1f(this.uO.uClean, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
    } else {
      gl.uniform1f(this.uO.uClean, 0);
      gl.uniform2f(this.uO.uView, this.width, this.height);
      gl.viewport(0, 0, this.width, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}
