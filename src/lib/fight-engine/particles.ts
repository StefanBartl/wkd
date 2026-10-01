/// <reference types="@webgpu/types" />
// Hit sparks and landing dust as GPU particles. The particles live in one
// storage buffer; a WGSL compute shader integrates them every frame and a
// second pipeline draws them as instanced pixel squares, additively, into
// an offscreen WebGPU canvas. The 2D game canvas then composites that layer
// on top with 'lighter' -- so the page keeps its single visible canvas and
// its layout, and the match itself stays Canvas 2D.
//
// Loaded with a dynamic import() on the first match only. No WebGPU, no
// adapter, a lost device: createParticles() resolves to null or draw()
// turns into a no-op, and the match simply has no particles.

const MAX_PARTICLES = 2048;
const FLOATS_PER_PARTICLE = 8; // pos.xy, vel.xy, life, maxLife, size, kind
const BYTES_PER_PARTICLE = FLOATS_PER_PARTICLE * 4;
const WORKGROUP_SIZE = 64;

const KIND_SPARK = 0;
const KIND_DUST = 1;

const SHADER = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
  life: f32,
  maxLife: f32,
  size: f32,
  kind: f32,
};

struct Params {
  dt: f32,
  gravity: f32,
  groundY: f32,
  drag: f32,
  resolution: vec2f,
  pad: vec2f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&particles)) {
    return;
  }
  var p = particles[i];
  if (p.life <= 0.0) {
    return;
  }
  if (p.kind < 0.5) {
    // Spark: ballistic, loses most of its energy bouncing off the ground.
    p.vel.y += params.gravity * params.dt;
    p.pos += p.vel * params.dt;
    if (p.pos.y > params.groundY) {
      p.pos.y = params.groundY;
      p.vel = vec2f(p.vel.x * 0.6, -p.vel.y * 0.4);
    }
  } else {
    // Dust: kicked sideways, slows quickly, drifts up.
    p.vel = p.vel * exp(-params.drag * params.dt);
    p.vel.y -= 30.0 * params.dt;
    p.pos += p.vel * params.dt;
  }
  p.life -= params.dt;
  particles[i] = p;
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
};

@group(0) @binding(1) var<storage, read> drawn: array<Particle>;

@vertex
fn vertex(@builtin(vertex_index) corner: u32, @builtin(instance_index) index: u32) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let p = drawn[index];
  // Never-spawned slots are all zeros: dividing by their maxLife would be 0/0.
  let t = clamp(p.life / max(p.maxLife, 0.0001), 0.0, 1.0);
  let isDust = step(0.5, p.kind);
  // Dead particles collapse to a zero-area quad instead of needing a
  // compacted buffer. Sparks shrink as they cool, dust puffs up.
  let alive = step(0.0001, p.life);
  let size = p.size * alive * mix(mix(0.5, 1.0, t), 2.0 - t, isDust);
  // Snapped to whole pixels: hard squares, to sit with the pixel art.
  let px = floor(p.pos) + corners[corner] * size;
  var out: VertexOut;
  out.position = vec4f(
    px.x / params.resolution.x * 2.0 - 1.0,
    1.0 - px.y / params.resolution.y * 2.0,
    0.0,
    1.0,
  );
  let spark = mix(vec3f(1.0, 0.3, 0.05), vec3f(1.0, 0.95, 0.7), t) * sqrt(t);
  let dust = vec3f(0.42, 0.38, 0.33) * t;
  out.color = mix(spark, dust, isDust);
  return out;
}

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;

export interface Particles {
  /** A burst of sparks at a hit; `dir` is the way the blow travels (1 = right). */
  sparks(x: number, y: number, dir: number): void;
  /** A puff of dust where a fighter lands. */
  dust(x: number, y: number): void;
  /** Advance the particles by `dt` seconds and composite them onto `ctx`. */
  draw(ctx: CanvasRenderingContext2D, dt: number): void;
  /** Remove every particle: a new match must not inherit the last one's final sparks. */
  clear(): void;
}

export async function createParticles(
  width: number,
  height: number,
  groundY: number,
): Promise<Particles | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  if (typeof OffscreenCanvas === 'undefined') return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const layer = new OffscreenCanvas(width, height);
  const context = layer.getContext('webgpu');
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  let lost = false;
  void device.lost.then(() => {
    lost = true;
  });

  const module = device.createShaderModule({ code: SHADER });
  const info = await module.getCompilationInfo();
  if (info.messages.some((m) => m.type === 'error')) {
    for (const m of info.messages) console.error(`fight particles: ${m.lineNum}: ${m.message}`);
    return null;
  }

  const particleBuffer = device.createBuffer({
    size: MAX_PARTICLES * BYTES_PER_PARTICLE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const params = new Float32Array(8);
  params[1] = 1400; // gravity, px/s^2
  params[2] = groundY;
  params[3] = 5; // dust drag, 1/s
  params[4] = width;
  params[5] = height;

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'simulate' },
  });
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vertex' },
    fragment: {
      module,
      entryPoint: 'fragment',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one' },
            alpha: { srcFactor: 'one', dstFactor: 'one' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  });
  const entries = [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: particleBuffer } },
  ];
  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries,
  });
  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries,
  });

  // New particles overwrite the oldest slots of a ring; the CPU only ever
  // writes spawn data, everything after that happens on the GPU.
  let cursor = 0;
  // Seconds until the longest-lived particle has died: lets draw() skip the
  // GPU passes and the canvas copy while nothing is on screen.
  let alive = 0;
  const empty = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);

  const spawn = (data: Float32Array<ArrayBuffer>, longestLife: number): void => {
    if (lost) return;
    const count = data.length / FLOATS_PER_PARTICLE;
    const first = Math.min(count, MAX_PARTICLES - cursor);
    device.queue.writeBuffer(
      particleBuffer,
      cursor * BYTES_PER_PARTICLE,
      data,
      0,
      first * FLOATS_PER_PARTICLE,
    );
    if (first < count) {
      device.queue.writeBuffer(particleBuffer, 0, data, first * FLOATS_PER_PARTICLE);
    }
    cursor = (cursor + count) % MAX_PARTICLES;
    alive = Math.max(alive, longestLife);
  };

  const fill = (
    data: Float32Array,
    i: number,
    values: readonly [number, number, number, number, number, number, number],
  ): void => {
    const [x, y, vx, vy, life, size, kind] = values;
    const o = i * FLOATS_PER_PARTICLE;
    data[o] = x;
    data[o + 1] = y;
    data[o + 2] = vx;
    data[o + 3] = vy;
    data[o + 4] = life;
    data[o + 5] = life;
    data[o + 6] = size;
    data[o + 7] = kind;
  };

  return {
    sparks(x, y, dir) {
      const count = 48;
      const data = new Float32Array(count * FLOATS_PER_PARTICLE);
      for (let i = 0; i < count; i++) {
        // A cone along the blow, opened upwards.
        const angle = (Math.random() - 0.5) * 1.9 - 0.5;
        const speed = 120 + Math.random() * 420;
        fill(data, i, [
          x + (Math.random() - 0.5) * 16,
          y + (Math.random() - 0.5) * 30,
          Math.cos(angle) * speed * dir,
          Math.sin(angle) * speed,
          0.25 + Math.random() * 0.45,
          1 + Math.random() * 2,
          KIND_SPARK,
        ]);
      }
      spawn(data, 0.7);
    },
    dust(x, y) {
      const count = 20;
      const data = new Float32Array(count * FLOATS_PER_PARTICLE);
      for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        fill(data, i, [
          x + side * Math.random() * 30,
          y - Math.random() * 4,
          side * (60 + Math.random() * 160),
          -Math.random() * 40,
          0.3 + Math.random() * 0.35,
          2 + Math.random() * 2,
          KIND_DUST,
        ]);
      }
      spawn(data, 0.65);
    },
    clear() {
      alive = 0;
      cursor = 0;
      if (!lost) device.queue.writeBuffer(particleBuffer, 0, empty);
    },
    draw(ctx, dt) {
      if (lost || alive <= 0) return;
      // The countdown and the simulation must age particles by the same
      // (capped) amount, or a slow frame ends the layer with particles
      // still alive in the buffer, frozen until the next burst revives them.
      const step = Math.min(dt, 0.05);
      alive -= step;
      params[0] = step;
      device.queue.writeBuffer(paramsBuffer, 0, params);

      const encoder = device.createCommandEncoder();
      const compute = encoder.beginComputePass();
      compute.setPipeline(computePipeline);
      compute.setBindGroup(0, computeBindGroup);
      compute.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / WORKGROUP_SIZE));
      compute.end();
      const render = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      render.setPipeline(renderPipeline);
      render.setBindGroup(0, renderBindGroup);
      render.draw(6, MAX_PARTICLES);
      render.end();
      device.queue.submit([encoder.finish()]);

      // Black adds no colour under 'lighter', so the scene stays untouched
      // where there are no sparks. Its alpha is added too, though: while
      // particles live the canvas turns opaque, which the arena background
      // (it covers the whole canvas) makes invisible.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    },
  };
}
