import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { R, SP } from '../../utils/clayTokens';
import { KITCHEN_PAPER as PAPER } from '../../utils/kitchenPaperTokens';
import type { KitchenEvent, KitchenFood, KitchenLot } from '../../utils/kitchenDb';
import { FRIDGE } from '../../utils/kitchenFridgeSpec';
import { fridgeLayout } from '../../utils/kitchenFridgeLayout';
import { latestReceipt, stickyReminders } from '../../utils/kitchenAppearance';
import { bendPaper, buildKitchenScene, HAND_FONT, type KitchenRig } from './kitchenFridgeBuild';

interface Props {
  lots: KitchenLot[];
  foods: KitchenFood[];
  events?: KitchenEvent[];
  onOpenLot: (id: string) => void;
  /** 点门上的小票：去看操作记录 */
  onOpenHistory?: () => void;
}

type Zone = 'fridge' | 'freezer';
const OPEN = THREE.MathUtils.degToRad(104);
const CRISPER_OUT = 2.3;

/**
 * 冰箱门（APP_CONVENTIONS P14）：门是首页的主体，门上贴着便利贴和小票；点门打开看里面。
 * 动效只跟着操作发生：门有一点回弹、开门时纸被风压平再掀起、磁贴拔了会吸回去、内灯闪两下再亮稳。
 * 静止时不渲染；减少动态效果时一律直接到终点。
 */
const KitchenFridgeScene: React.FC<Props> = ({ lots, foods, events = [], onOpenLot, onOpenHistory }) => {
  const [open, setOpen] = useState<Record<Zone, boolean>>({ fridge: false, freezer: false });
  const [crisperOpen, setCrisperOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onOpenLot, onOpenHistory });
  callbacks.current = { onOpenLot, onOpenHistory };
  const controller = useRef<{ sync: (open: Record<Zone, boolean>, crisper: boolean) => void; fill: () => void } | null>(null);
  const stateRef = useRef({ open, crisperOpen });
  stateRef.current = { open, crisperOpen };

  const layout = useMemo(() => fridgeLayout(lots, foods), [lots, foods]);
  // 便利贴的「今天 / 明天」按打开厨房的那一刻算
  const reminders = useMemo(() => stickyReminders(lots, foods, events), [lots, foods, events]);
  const receipt = useMemo(() => latestReceipt(events, foods), [events, foods]);
  const contentsRef = useRef({ layout, reminders, receipt });
  contentsRef.current = { layout, reminders, receipt };

  useEffect(() => { controller.current?.sync(open, crisperOpen); }, [open, crisperOpen]);
  useEffect(() => { controller.current?.fill(); }, [layout, reminders, receipt]);

  useEffect(() => {
    const maybeElement = host.current;
    if (!maybeElement) return;
    const element: HTMLDivElement = maybeElement;
    let disposed = false, failed = false, frame = 0, inView = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { setStatus('error'); return; }
    // 最多按两倍渲染：iPhone 是三倍屏，1.5 倍放大后发糊；静止时不渲染，两倍的开销只花在动的那一下
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    RectAreaLightUniformsLib.init();
    const canvas = renderer.domElement;
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    canvas.setAttribute('aria-hidden', 'true');
    element.appendChild(canvas);

    const rig: KitchenRig = buildKitchenScene(renderer);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);

    /* 后期：环境光遮蔽 + 很淡的颗粒和暗角。加载失败就直接画，不影响使用 */
    let composer: { render: () => void; setSize: (w: number, h: number) => void; dispose?: () => void } | null = null;
    let grainSeed: { value: number } | null = null;
    void (async () => {
      try {
        const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
          import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
          import('three/addons/postprocessing/GTAOPass.js'), import('three/addons/postprocessing/OutputPass.js'),
          import('three/addons/postprocessing/ShaderPass.js'),
        ]);
        if (disposed) return;
        const c = new EffectComposer(renderer);
        c.addPass(new RenderPass(rig.scene, camera));
        const ao = new GTAOPass(rig.scene, camera, 1, 1);
        ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.6, thickness: 0.6, scale: 1, samples: 12 });
        ao.blendIntensity = 0.85;
        c.addPass(ao);
        c.addPass(new OutputPass());
        const grain = new ShaderPass({
          uniforms: { tDiffuse: { value: null }, uSeed: { value: 0 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: `uniform sampler2D tDiffuse; uniform float uSeed; varying vec2 vUv;
            float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
            void main(){ vec4 c = texture2D(tDiffuse, vUv);
              c.rgb += (h(gl_FragCoord.xy) - 0.5) * 0.026;
              float d = distance(vUv, vec2(0.5, 0.48)); c.rgb *= mix(1.0, 0.84, smoothstep(0.34, 0.92, d));
              gl_FragColor = c; }`,
        });
        c.addPass(grain);
        grainSeed = grain.uniforms.uSeed as { value: number };
        composer = c;
        resize();
      } catch { /* 没有环境光遮蔽也照常画 */ }
    })();

    /* 弹簧状态 */
    const doors = {
      fridge: { a: stateRef.current.open.fridge ? OPEN : 0, v: 0, to: stateRef.current.open.fridge ? OPEN : 0, openedAt: -1e9 },
      freezer: { a: stateRef.current.open.freezer ? OPEN : 0, v: 0, to: stateRef.current.open.freezer ? OPEN : 0, openedAt: -1e9 },
    };
    const crisper = { z: 0, v: 0, to: 0 };
    const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), from: { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }, to: { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }, k: 1, kv: 0 };
    /**
     * 每个镜头说清楚要框住什么（中心、至少多宽多高、从哪个方向看），距离按画面比例现算。
     * 关门时只框冷冻门和冷藏门上半截（门上的纸和窗格影子是主角），冰箱底和地板出画；
     * 开哪扇门就平视那一格，把往左开的门内置物架也框进来，地板最多露一条边。
     */
    const SHOTS = {
      home: { center: new THREE.Vector3(1.0, 8.7, 0), w: 9.0, h: 11.8, dir: new THREE.Vector3(0.2, 0.06, 1) },
      fridge: { center: new THREE.Vector3(-1.7, 6.5, -0.4), w: 9.6, h: 11.4, dir: new THREE.Vector3(0.24, 0.03, 1) },
      freezer: { center: new THREE.Vector3(-1.7, 14.1, -0.4), w: 9.6, h: 7.4, dir: new THREE.Vector3(0.24, 0.05, 1) },
      both: { center: new THREE.Vector3(-1.5, 9.4, -0.4), w: 9.8, h: 17.4, dir: new THREE.Vector3(0.24, 0.04, 1) },
    };
    const shotFor = (state: Record<Zone, boolean>) => {
      const shot = state.fridge && state.freezer ? SHOTS.both : state.fridge ? SHOTS.fridge : state.freezer ? SHOTS.freezer : SHOTS.home;
      const half = THREE.MathUtils.degToRad(camera.fov / 2);
      const d = Math.max(shot.h / (2 * Math.tan(half)), shot.w / (2 * Math.tan(half) * camera.aspect));
      return { pos: shot.center.clone().add(shot.dir.clone().normalize().multiplyScalar(d)), tgt: shot.center.clone() };
    };
    const aim = (state: Record<Zone, boolean>, instant = false) => {
      const shot = shotFor(state);
      cam.from.pos.copy(cam.pos); cam.from.tgt.copy(cam.tgt); cam.to.pos.copy(shot.pos); cam.to.tgt.copy(shot.tgt);
      if (instant || reduce.matches) { cam.pos.copy(shot.pos); cam.tgt.copy(shot.tgt); cam.k = 1; } else { cam.k = 0; cam.kv = 0; }
    };

    function resize() {
      if (disposed) return;
      const w = element.clientWidth, h = element.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (cam.k >= 1) aim(stateRef.current.open, true);
      invalidate();
    }

    const fill = () => {
      const { layout: l, reminders: r, receipt: rc } = contentsRef.current;
      rig.setContents(l.entries, r, rc);
      if (!reduce.matches) for (const p of rig.papers) p.v += p.key === 'receipt' ? 1.2 : 0.7;   // 换上新纸时轻轻晃一下
      invalidate();
    };
    // 手写字体到了再写字（最多等 2.5 秒），不然胶带和便利贴上是系统字
    const fontsReady = Promise.race([
      Promise.all([document.fonts.load(`60px ${HAND_FONT}`, '牛奶快用完了'), document.fonts.load('600 46px "Noto Serif SC"', '牛奶')]).catch(() => null),
      new Promise(resolve => setTimeout(resolve, 2500)),
    ]);
    void fontsReady.then(() => { if (disposed) return; fill(); setStatus('ready'); });

    let flickerUntil = 0;
    controller.current = {
      sync: (state, crisperState) => {
        for (const zone of ['fridge', 'freezer'] as const) {
          const target = state[zone] ? OPEN : 0;
          if (target !== doors[zone].to) {
            doors[zone].to = target;
            if (target) { doors[zone].openedAt = performance.now(); flickerUntil = performance.now() + 520; }
            if (reduce.matches) { doors[zone].a = target; doors[zone].v = 0; }
          }
        }
        crisper.to = state.fridge && crisperState ? CRISPER_OUT : 0;
        if (reduce.matches) crisper.z = crisper.to;
        aim(state);
        invalidate();
      },
      fill: () => { void fontsReady.then(() => { if (!disposed) fill(); }); },
    };

    const settled = () => (['fridge', 'freezer'] as const).every(z => Math.abs(doors[z].v) < 2e-3 && Math.abs(doors[z].a - doors[z].to) < 2e-3)
      && Math.abs(crisper.v) < 2e-3 && Math.abs(crisper.z - crisper.to) < 2e-3
      && rig.papers.every(p => Math.abs(p.v) < 2e-3 && Math.abs(p.s) < 2e-3 && Math.abs(p.liftV) < 2e-3 && Math.abs(p.lift - p.liftTo) < 2e-3)
      && rig.magnets.every(m => Math.abs(m.v) < 2e-3 && Math.abs(m.z - m.to) < 2e-3 && !m.released)
      && cam.k >= 1 && performance.now() > flickerUntil;

    let last = performance.now();
    const draw = (now: number) => {
      frame = 0;
      if (disposed || failed || !inView || document.hidden) return;
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const time = now / 1000, still = reduce.matches;
      const omega: Record<Zone, number> = { fridge: 0, freezer: 0 };
      for (const zone of ['fridge', 'freezer'] as const) {
        const d = doors[zone], prev = d.a;
        // 稍微欠阻尼：开到头有一点点回弹；关门时先把抽屉收回去
        const target = zone === 'fridge' && d.to === 0 && crisper.z > 0.05 ? Math.max(d.a, 0.6) : d.to;
        if (!still) { d.v += (-26 * (d.a - target) - 7.2 * d.v) * dt; d.a = Math.max(-0.02, d.a + d.v * dt); } else d.a = target;
        (zone === 'fridge' ? rig.fridgeHinge : rig.freezerHinge).rotation.y = -d.a;
        omega[zone] = (d.a - prev) / Math.max(dt, 1e-4);
        const since = now - d.openedAt;
        const flick = still || since > 520 ? 1 : since < 90 ? 0.2 : since < 160 ? 0.9 : since < 230 ? 0.35 : 1;
        const k = Math.min(1, d.a / 0.5) * flick, l = rig.lights[zone];
        l.area.intensity = (zone === 'fridge' ? 5 : 3.5) * k; l.point.intensity = (zone === 'fridge' ? 9 : 6) * k;
        (l.strip.material as THREE.MeshBasicMaterial).color.setScalar(0.55 + 0.45 * k);
      }
      if (!still) { crisper.v += (-60 * (crisper.z - crisper.to) - 13 * crisper.v) * dt; crisper.z += crisper.v * dt; } else crisper.z = crisper.to;
      rig.crisper.position.z = -FRIDGE.depth / 2 + 0.1 + crisper.z;
      // 纸：门转起来时空气往回压，纸被带着掀；之后自己晃几下停住
      for (const p of rig.papers) {
        if (!still) {
          const acc = -70 * p.s - 3.4 * p.v - omega.fridge * (p.key === 'receipt' ? 0.55 : 0.32) * 9;
          p.v += acc * dt; p.s += p.v * dt;
          p.liftV += (-60 * (p.lift - p.liftTo) - 11 * p.liftV) * dt; p.lift += p.liftV * dt;
        } else { p.s = 0; p.v = 0; p.lift = p.liftTo; p.liftV = 0; }
        bendPaper(p, time);
      }
      for (const m of rig.magnets) {
        if (!still) {
          m.v += (-150 * (m.z - m.to) - 9 * m.v) * dt; m.z += m.v * dt;
          if (m.snapArmed && m.z < 0.02 && m.v < 0) { m.snapArmed = false; m.paper.v += -2.2; m.z = Math.max(0, m.z); m.v = -m.v * 0.25; }
        } else { m.z = m.to; m.v = 0; m.snapArmed = false; }
        m.group.position.z = FRIDGE.doorThickness / 2 + 0.032 + Math.max(0, m.z);
        m.group.rotation.z = Math.max(0, m.z) * 0.35;
      }
      if (cam.k < 1) {
        cam.kv += (-(cam.k - 1) * 40 - cam.kv * 11) * dt; cam.k = Math.min(1, cam.k + cam.kv * dt);
        if (1 - cam.k < 2e-3) cam.k = 1;
        cam.pos.lerpVectors(cam.from.pos, cam.to.pos, cam.k); cam.tgt.lerpVectors(cam.from.tgt, cam.to.tgt, cam.k);
      }
      camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
      if (grainSeed) grainSeed.value = (time * 7.3) % 100;
      if (composer) composer.render(); else renderer.render(rig.scene, camera);
      if (!settled()) frame = requestAnimationFrame(draw);
    };
    function invalidate() {
      if (!disposed && !frame && !failed) { last = performance.now(); frame = requestAnimationFrame(draw); }
    }

    /* 点哪儿：食物 → 打开那一样；便利贴的某一行 → 那一样；小票 → 操作记录；磁贴 → 拔一下；门 / 抽屉 → 开关 */
    const ray = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const toggleDoor = (zone: Zone) => setOpen(value => ({ ...value, [zone]: !value[zone] }));
    const popMagnet = (m: KitchenRig['magnets'][number]) => {
      if (m.released) return;
      m.released = true; m.to = 0.7; m.paper.liftTo = 0.55; if (!reduce.matches) m.paper.v += -3.2;
      window.setTimeout(() => { m.to = 0; m.paper.liftTo = 0; m.released = false; m.snapArmed = true; invalidate(); }, reduce.matches ? 300 : 420);
      invalidate();
    };
    const nearestItem = (x: number, y: number) => {
      // 东西小、手指粗：没点正时，取 36px 以内最近的那一样（只算开着的那格里的）
      const bounds = canvas.getBoundingClientRect();
      let best: { id: string; d: number } | null = null;
      for (const item of rig.items) {
        const zone = item.userData.zone as Zone;
        if (!stateRef.current.open[zone]) continue;
        if (item.userData.spot === 'crisper' && !stateRef.current.crisperOpen) continue;
        const p = item.getWorldPosition(new THREE.Vector3()).project(camera);
        const d = Math.hypot((p.x + 1) / 2 * bounds.width - x, (1 - p.y) / 2 * bounds.height - y);
        if (d < 36 && (!best || d < best.d)) best = { id: item.userData.lotId, d };
      }
      return best?.id ?? null;
    };
    const onDown = (event: PointerEvent) => { downAt = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 10) { downAt = null; return; }
      downAt = null;
      const bounds = canvas.getBoundingClientRect();
      const lx = event.clientX - bounds.left, ly = event.clientY - bounds.top;
      ray.setFromCamera(new THREE.Vector2(lx / bounds.width * 2 - 1, -ly / bounds.height * 2 + 1), camera);
      const hit = ray.intersectObjects(rig.pickables, true).find(h => !h.object.userData.skip);
      const o = hit?.object;
      if (o?.userData.lotId) { callbacks.current.onOpenLot(o.userData.lotId); return; }
      if (o?.userData.magnet) { const m = rig.magnets.find(item => item.key === o.userData.magnet); if (m) popMagnet(m); return; }
      if (o?.userData.paper) {
        const paper = rig.papers.find(p => p.key === o.userData.paper)!;
        if (paper.key === 'receipt') { paper.v += reduce.matches ? 0 : 1.4; invalidate(); callbacks.current.onOpenHistory?.(); return; }
        const row = hit!.uv ? Math.floor(((1 - hit!.uv.y) * 512 - 90) / 116) : 0;
        const line = paper.lines[Math.max(0, Math.min(paper.lines.length - 1, row))];
        paper.v += reduce.matches ? 0 : 1.2; invalidate();
        if (line) callbacks.current.onOpenLot(line.lotId);
        return;
      }
      const near = nearestItem(lx, ly);
      if (near) { callbacks.current.onOpenLot(near); return; }
      let node: THREE.Object3D | null = o ?? null;
      while (node) {
        if (node === rig.crisper) { if (stateRef.current.open.fridge) setCrisperOpen(value => !value); return; }
        if (node === rig.fridgeHinge) { toggleDoor('fridge'); return; }
        if (node === rig.freezerHinge) { toggleDoor('freezer'); return; }
        node = node.parent;
      }
      // 点到冰箱里面（开着门时的内胆、层板）：按高度判断是哪一格，关上它
      if (hit) {
        const y = hit.point.y;
        const zone: Zone = y >= FRIDGE.freezerDoor.y0 ? 'freezer' : 'fridge';
        if (stateRef.current.open[zone] && Math.abs(hit.point.x) < FRIDGE.width / 2 + 0.2) toggleDoor(zone);
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element);
    const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; invalidate(); }); visibility.observe(element);
    document.addEventListener('visibilitychange', invalidate);
    const lost = (event: Event) => { event.preventDefault(); failed = true; cancelAnimationFrame(frame); setStatus('error'); };
    canvas.addEventListener('webglcontextlost', lost);
    aim(stateRef.current.open, true); resize();

    return () => {
      disposed = true;
      controller.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect(); visibility.disconnect();
      document.removeEventListener('visibilitychange', invalidate);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp);
      (composer as { dispose?: () => void } | null)?.dispose?.();
      rig.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, []);

  const visibleItems = layout.entries.filter(entry => open[entry.zone] && (entry.spot !== 'crisper' || crisperOpen));
  const control: React.CSSProperties = { minHeight: 44, padding: `${SP[1]}px ${SP[2]}px`, borderRadius: R.button, color: PAPER.blueInk, fontSize: 12, fontWeight: 500 };
  return (
    <section className="kitchen-scene" aria-label="冰箱">
      <div className="relative" style={{ height: 'min(64vh, 600px)', overflow: 'hidden', background: PAPER.well }}>
        <div ref={host} className="absolute inset-0" />
        {status !== 'ready' && <div role="status" className="absolute inset-0 flex items-center justify-center text-center"
          style={{ padding: SP[3], color: PAPER.muted, fontSize: 13 }}>
          {status === 'loading' ? '正在打开冰箱…' : '冰箱画面暂时打不开，请从「食材清单」继续记录。'}
        </div>}
        {/* 读屏 / 键盘：开着的那格里有什么，一样一个按钮 */}
        {status === 'ready' && <ul className="sr-only" aria-label="冰箱里看得见的食材">
          {visibleItems.map(entry => <li key={entry.lot.id}><button type="button" onClick={() => onOpenLot(entry.lot.id)}>查看{entry.name}</button></li>)}
          {reminders.map(line => <li key={`r-${line.lotId}`}><button type="button" onClick={() => onOpenLot(line.lotId)}>便利贴：{line.text}</button></li>)}
        </ul>}
      </div>
      <div className="kitchen-scene-footer">
        <div className="kitchen-scene-controls flex items-center justify-center flex-wrap" style={{ gap: SP[1], padding: `${SP[1]}px ${SP[2]}px` }}>
          {(['freezer', 'fridge'] as const).map(zone => <button key={zone} type="button" disabled={status !== 'ready'} aria-pressed={open[zone]}
            className="disabled:opacity-40" style={control} onClick={() => setOpen(value => ({ ...value, [zone]: !value[zone] }))}>
            {open[zone] ? '关上' : '打开'}{zone === 'fridge' ? '冷藏门' : '冷冻门'}
          </button>)}
          <button type="button" disabled={status !== 'ready' || !open.fridge} aria-pressed={open.fridge && crisperOpen}
            className="disabled:opacity-40" style={control} onClick={() => setCrisperOpen(value => !value)}>
            {crisperOpen ? '推回抽屉' : '拉开抽屉'}
          </button>
        </div>
        <p className="kitchen-scene-note" style={{ color: PAPER.muted, fontSize: 12, textAlign: 'center', padding: `0 ${SP[3]}px ${SP[3]}px` }}>
          {layout.total === 0 ? '冰箱还空着，把新买的食物放进来吧。' : '点门打开 · 点食材记下还剩多少 · 点便利贴直接找到那一样'}
        </p>
      </div>
    </section>
  );
};

export default KitchenFridgeScene;
