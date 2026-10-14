import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { R, SP } from '../../utils/clayTokens';
import { KITCHEN_PAPER as PAPER } from '../../utils/kitchenPaperTokens';
import type { KitchenEvent, KitchenFood, KitchenLot, KitchenShoppingItem } from '../../utils/kitchenDb';
import { FRIDGE } from '../../utils/kitchenFridgeSpec';
import { fridgeLayout } from '../../utils/kitchenFridgeLayout';
import { heatList, latestReceipt, pantryList, shoppingPaper, stickyReminders } from '../../utils/kitchenAppearance';
import { bendPaper, buildKitchenScene, HAND_FONT, makeFlyTag, PEN_DELAY, SANS, SERIF, type KitchenRig } from './kitchenFridgeBuild';

interface Props {
  lots: KitchenLot[];
  foods: KitchenFood[];
  events?: KitchenEvent[];
  onOpenLot: (id: string) => void;
  /** 点门上的小票：去看操作记录 */
  onOpenHistory?: () => void;
  /** 点「柜子里」那张纸的空白处：去看常温柜的完整清单 */
  onOpenPantry?: () => void;
  onOpenList?: () => void;
  shopping?: KitchenShoppingItem[];
  onToggleShopping?: (id: string) => void;
  onOpenShopping?: () => void;
  /** 铺满整个页面（首页整屏厨房）：开门按钮只留给读屏，取景照演示 */
  fullBleed?: boolean;
}

type Zone = 'fridge' | 'freezer';

/**
 * 门上的纸、标签都是画在画布上的字。Google 的中文字体按字切成几十片，页面上的字用到哪片浏览器才下哪片，
 * 画布却不会替它下——没下的那片 iPhone 上就画成方块（2026-10-14 阿萌：贴纸老冒方块）。
 * 所以画之前把这次要写的字（加上纸上固定的那些）每种字体都先下好，最多等 2.5 秒。
 */
const PAPER_WORDS = '速食零食饮料柜子里热一热就能吃还有样要买的点这里写慢吃小厨房采购放好了吃完丢了当天周个月今天明天后天前到期过期冷藏冷冻开封只剩一个快用完0123456789-/:·+.';
const PAPER_FONTS = [`60px ${HAND_FONT}`, `600 46px ${SERIF}`, `400 24px ${SANS}`, `500 24px ${SANS}`, `600 30px ${SANS}`];
const loadGlyphs = (text: string) => {
  const chars = [...new Set(text + PAPER_WORDS)].join('');
  return Promise.race([
    Promise.all(PAPER_FONTS.map(font => document.fonts.load(font, chars))).catch(() => null),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
};

/**
 * 上一次贴在门上的样子（哪些划掉了、有哪些批次），离开首页再回来也记着：
 * 在操作记录页撤销「吃完」、在清单页放进东西，回到冰箱前笔和橡皮、纸签照样补上。
 * 只活在这一次打开的页面里，刷新后第一次进厨房不播（2026-10-14 重审）。
 */
const doorMemory: { marked: Map<string, string | undefined> | null; knownLots: Set<string> | null } = { marked: null, knownLots: null };
const OPEN = THREE.MathUtils.degToRad(104);
const CRISPER_OUT = 2.3;

/**
 * 冰箱门（APP_CONVENTIONS P14）：门是首页的主体，门上贴着便利贴和小票；点门打开看里面。
 * 动效只跟着操作发生：门有一点回弹、开门时纸被风压平再掀起、磁贴拔了会吸回去、内灯闪两下再亮稳。
 * 静止时不渲染；减少动态效果时一律直接到终点。
 */
const KitchenFridgeScene: React.FC<Props> = ({ lots, foods, events = [], onOpenLot, onOpenHistory, onOpenPantry, onOpenList, shopping, onToggleShopping, onOpenShopping, fullBleed = false }) => {
  const [open, setOpen] = useState<Record<Zone, boolean>>({ fridge: false, freezer: false });
  const [crisperOpen, setCrisperOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onOpenLot, onOpenHistory, onOpenPantry, onOpenList, onToggleShopping, onOpenShopping });
  callbacks.current = { onOpenLot, onOpenHistory, onOpenPantry, onOpenList, onToggleShopping, onOpenShopping };
  const controller = useRef<{ sync: (open: Record<Zone, boolean>, crisper: boolean) => void; fill: () => void } | null>(null);
  const stateRef = useRef({ open, crisperOpen });
  stateRef.current = { open, crisperOpen };

  const layout = useMemo(() => fridgeLayout(lots, foods), [lots, foods]);
  // 便利贴的「今天 / 明天」按打开厨房的那一刻算
  const reminders = useMemo(() => stickyReminders(lots, foods, events), [lots, foods, events]);
  const receipt = useMemo(() => latestReceipt(events, foods, lots), [events, foods, lots]);
  const pantry = useMemo(() => pantryList(lots, foods), [lots, foods]);
  const heat = useMemo(() => heatList(lots, foods), [lots, foods]);
  // 没接要买清单（shopping 没传）就不贴这张
  const shop = useMemo(() => shopping ? shoppingPaper(shopping) : null, [shopping]);
  // 纸签飞进冰箱要知道哪些是刚放进来的、叫什么
  const lotsRef = useRef({ lots, foods });
  lotsRef.current = { lots, foods };
  const contentsRef = useRef({ layout, reminders, receipt, pantry, heat, shop });
  contentsRef.current = { layout, reminders, receipt, pantry, heat, shop };

  useEffect(() => { controller.current?.sync(open, crisperOpen); }, [open, crisperOpen]);
  useEffect(() => { controller.current?.fill(); }, [layout, reminders, receipt, pantry, heat, shop]);

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
     * 开哪扇门就正对那一格，里面占满画面（不做门内置物架，门开到画面外去）。
     */
    // 整屏是竖长画面，宽度先撑满：关门照演示框到冷冻门和整扇冷藏门（地板只在最底下一条，压在纸签后面）
    const SHOTS = fullBleed ? {
      // 冰箱放大、右边的柜子只露一截（2026-10-14 阿萌：柜子只是填场景的）
      home: { center: new THREE.Vector3(0.6, 10.2, 0), w: 8.4, h: 12.6, dir: new THREE.Vector3(0.2, 0.08, 1) },
      fridge: { center: new THREE.Vector3(0.3, 7.6, -1.4), w: 7.8, h: 11.0, dir: new THREE.Vector3(0.14, 0.05, 1) },
      freezer: { center: new THREE.Vector3(0.3, 13.2, -1.4), w: 7.8, h: 6.6, dir: new THREE.Vector3(0.14, 0.03, 1) },
      both: { center: new THREE.Vector3(0.3, 9.4, -1.2), w: 8.0, h: 17.2, dir: new THREE.Vector3(0.14, 0.04, 1) },
    } : {
      home: { center: new THREE.Vector3(1.0, 8.7, 0), w: 9.0, h: 11.8, dir: new THREE.Vector3(0.2, 0.06, 1) },
      fridge: { center: new THREE.Vector3(0.3, 6.3, -1.4), w: 7.6, h: 11.0, dir: new THREE.Vector3(0.14, 0.04, 1) },
      freezer: { center: new THREE.Vector3(0.3, 14.1, -1.4), w: 7.6, h: 6.6, dir: new THREE.Vector3(0.14, 0.04, 1) },
      both: { center: new THREE.Vector3(0.3, 9.2, -1.2), w: 8.0, h: 17.2, dir: new THREE.Vector3(0.14, 0.04, 1) },
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

    // 上一次贴上去时哪些已经划掉了（和当时写的批注）：这次新划掉的那几行一笔一笔写，
    // 这次不再划掉的那几行（取消打勾、撤销吃完）用橡皮擦掉。第一次打开厨房都不动，直接是终态
    const fill = (quiet = false) => {
      const { layout: l, reminders: r, receipt: rc, pantry: pt, heat: ht, shop: sp } = contentsRef.current;
      const crossed = new Map<string, string | undefined>([
        ...(sp?.lines.filter(line => line.checked).map(line => [`shop:${line.id}`, undefined] as const) ?? []),
        ...(rc?.items.filter(item => item.gone).map(item => [`gone:${item.lotId}`, item.gone] as const) ?? []),
      ]);
      const marked = doorMemory.marked, animate = marked && !reduce.matches;
      const playing = new Set(animate ? [...crossed.keys()].filter(key => !marked.has(key)) : []);
      const erasing = new Map(animate ? [...marked].filter(([key]) => !crossed.has(key)) : []);
      doorMemory.marked = crossed;
      rig.setContents(l.entries, r, rc, pt, ht, sp, playing, erasing);
      launchTags();
      // 换上新纸时轻轻晃一下；正在写 / 擦的时候不晃，让人看笔和橡皮
      if (!quiet && !reduce.matches && !playing.size && !erasing.size) for (const p of rig.papers) p.v += p.key === 'receipt' ? 1.2 : 0.7;
      invalidate();
    };
    // 这次要写的字都下好了再写（最多等 2.5 秒），不然胶带和便利贴上是系统字或方块
    const textNow = () => {
      const { reminders: r, receipt: rc, pantry: pt, heat: ht, shop: sp } = contentsRef.current;
      return lotsRef.current.foods.map(food => food.name).join('') + JSON.stringify([r, rc?.items, pt, ht, sp]);
    };
    void loadGlyphs(textNow()).then(() => { if (disposed) return; fill(); setStatus('ready'); });
    // 等超时了才到的那片字：到了再重画一遍，把方块换掉
    let refillTimer = 0;
    const onFontsLoaded = () => {
      window.clearTimeout(refillTimer);
      refillTimer = window.setTimeout(() => { if (!disposed && doorMemory.marked) fill(true); }, 120);
    };
    document.fonts.addEventListener('loadingdone', onFontsLoaded);

    /*
     * 纸签飞进冰箱（P14 招牌动效）：刚放进来的那几样，各一张手写纸签从画面下方飘起来，沿弧线飞向它去的地方——
     * 门关着就飞到门缝，门顺势开一条缝（里面的灯亮一下），纸签钻进去门再「嗒」地合上；
     * 门开着就直接落到那一样在层板上的位置，落下时那一样才出现；常温柜的落到「柜子里」那张纸上，纸晃一下。
     * 一次放进好几样（拍小票）就一张接一张，最多六张；第一次打开厨房、减少动态效果时不飞。
     */
    type Flight = {
      lotId: string; zone: 'fridge' | 'freezer' | 'pantry'; mesh: THREE.Mesh; dispose: () => void;
      start: number; dur: number; ready: boolean; mode: 'gap' | 'shelf' | 'paper';
      from: THREE.Vector3; ctrl: THREE.Vector3; to: THREE.Vector3; peeked: boolean; hidden?: THREE.Object3D;
    };
    const flights: Flight[] = [];
    const peekClose: Record<Zone, number> = { fridge: 0, freezer: 0 };
    const PEEK = 0.26, TAG_DELAY = 420, TAG_MS = 760;
    const launchTags = () => {
      const { lots: allLots, foods: allFoods } = lotsRef.current;
      const ids = new Set(allLots.map(lot => lot.id));
      const knownLots = doorMemory.knownLots;
      if (knownLots && !reduce.matches) {
        const names = new Map(allFoods.map(food => [food.id, food.name]));
        const fresh = allLots.filter(lot => !knownLots.has(lot.id) && lot.quantity > 0 && lot.storageZone !== 'staging' && Date.now() - lot.createdAt < 60_000)
          .sort((a, b) => a.createdAt - b.createdAt).slice(0, 6);
        fresh.forEach((lot, i) => {
          const zone = lot.storageZone as Flight['zone'];
          const tag = makeFlyTag(names.get(lot.foodId) ?? '食物', zone);
          tag.mesh.visible = false; rig.scene.add(tag.mesh);
          flights.push({ lotId: lot.id, zone, ...tag, start: performance.now() + TAG_DELAY + i * 170, dur: TAG_MS, ready: false, mode: 'gap',
            from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(), peeked: false });
        });
      }
      doorMemory.knownLots = ids;
    };
    const dropFlight = (flight: Flight) => {
      rig.scene.remove(flight.mesh); flight.dispose();
      if (flight.hidden) flight.hidden.visible = true;
      flights.splice(flights.indexOf(flight), 1);
    };
    /** 起飞那一刻再算路线：镜头、门开没开都按那时候的来 */
    const aimFlight = (flight: Flight) => {
      const fridgeBody = rig.fridgeHinge.parent!;
      const start = new THREE.Vector3(0.1, -0.78, 0.4).unproject(camera);
      flight.from.copy(camera.position).add(start.sub(camera.position).normalize().multiplyScalar(7));
      if (flight.zone === 'pantry') {
        const paper = rig.papers.find(p => p.key === 'pantry');
        if (!paper) return false;
        flight.mode = 'paper'; paper.mesh.getWorldPosition(flight.to); flight.to.z += 0.15;
      } else if (doors[flight.zone].to > PEEK) {
        const item = rig.items.find(o => o.userData.lotId === flight.lotId);
        if (!item) return false;
        flight.mode = 'shelf'; item.getWorldPosition(flight.to); flight.to.y += 0.6;
        item.visible = false; flight.hidden = item;
      } else {
        const span = flight.zone === 'fridge' ? FRIDGE.fridgeDoor : FRIDGE.freezerDoor;
        const y = flight.zone === 'fridge' ? span.y1 - 2.4 : (span.y0 + span.y1) / 2;
        flight.mode = 'gap'; flight.to.copy(fridgeBody.localToWorld(new THREE.Vector3(FRIDGE.width / 2 - 0.35, y, -0.5)));
      }
      // 弧线的顶：起点和终点中间往上抬、往镜头这边拉一点
      flight.ctrl.lerpVectors(flight.from, flight.to, 0.55).add(new THREE.Vector3(0.6, 2.4, 1.2));
      if (flight.mode === 'gap') flight.ctrl.add(new THREE.Vector3(1.2, 0, 1.4));
      return true;
    };
    const flyTags = (now: number) => {
      for (const flight of [...flights]) {
        if (now < flight.start) continue;
        if (!flight.ready) {
          if (!aimFlight(flight)) { dropFlight(flight); continue; }
          flight.ready = true; flight.mesh.visible = true;
        }
        const t = Math.min(1, (now - flight.start) / flight.dur);
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        const u = 1 - e;
        flight.mesh.position.set(0, 0, 0)
          .addScaledVector(flight.from, u * u).addScaledVector(flight.ctrl, 2 * u * e).addScaledVector(flight.to, e * e);
        // 面朝镜头，飘的时候左右翻一翻，越到后面越稳
        flight.mesh.quaternion.copy(camera.quaternion);
        flight.mesh.rotateZ(Math.sin(t * Math.PI * 2.6) * 0.38 * (1 - t) - 0.12);
        flight.mesh.rotateY(Math.sin(t * Math.PI * 1.7 + 0.6) * 0.5 * (1 - t));
        flight.mesh.scale.setScalar(1.15 - 0.55 * e);
        (flight.mesh.material as THREE.MeshStandardMaterial).opacity = flight.mode === 'shelf' ? 1 - Math.max(0, (t - 0.9) / 0.1) : 1 - Math.max(0, (t - 0.8) / 0.2);
        // 快到门缝时门开一条缝迎它
        if (flight.mode === 'gap' && !flight.peeked && t > 0.42) {
          flight.peeked = true;
          if (!stateRef.current.open[flight.zone as Zone] && doors[flight.zone as Zone].to < PEEK) doors[flight.zone as Zone].to = PEEK;
          peekClose[flight.zone as Zone] = 0;
        }
        if (t >= 1) {
          if (flight.mode === 'paper') { const paper = rig.papers.find(p => p.key === 'pantry'); if (paper) paper.v += 1.6; }
          if (flight.mode === 'gap') {
            const zone = flight.zone as Zone;
            // 后面还有往同一扇门飞的就先别关
            const more = flights.some(f => f !== flight && f.zone === zone && f.mode === 'gap' && f.start < now + 300);
            if (!more) peekClose[zone] = now + 140;
          }
          dropFlight(flight);
        }
      }
      for (const zone of ['fridge', 'freezer'] as const) {
        if (!peekClose[zone] || now < peekClose[zone]) continue;
        peekClose[zone] = 0;
        if (!stateRef.current.open[zone] && doors[zone].to === PEEK) doors[zone].to = 0;
      }
    };
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
      fill: () => { void loadGlyphs(textNow()).then(() => { if (!disposed) fill(); }); },
    };

    const penWaiting = (pen: KitchenRig['pens'][number]) => doors[pen.door].to > 0 && doors[pen.door].a > 0.08;
    const settled = () => (['fridge', 'freezer'] as const).every(z => Math.abs(doors[z].v) < 2e-3 && Math.abs(doors[z].a - doors[z].to) < 2e-3)
      && Math.abs(crisper.v) < 2e-3 && Math.abs(crisper.z - crisper.to) < 2e-3
      && rig.papers.every(p => Math.abs(p.v) < 2e-3 && Math.abs(p.s) < 2e-3 && Math.abs(p.liftV) < 2e-3 && Math.abs(p.lift - p.liftTo) < 2e-3)
      && rig.magnets.every(m => Math.abs(m.v) < 2e-3 && Math.abs(m.z - m.to) < 2e-3 && !m.released)
      // 等门关上的笔不算在动：门开着时它不写，门一关弹簧就会把画面叫醒（不然开着门记「吃完」会一直满帧画）
      && cam.k >= 1 && performance.now() > flickerUntil && rig.pens.every(penWaiting)
      && flights.length === 0 && !peekClose.fridge && !peekClose.freezer;

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
          const acc = -70 * p.s - 3.4 * p.v - (p.key === 'heat' || p.key === 'shop' ? omega.freezer : omega.fridge) * (p.key === 'receipt' ? 0.55 : 0.32) * 9;
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
      flyTags(now);
      // 手写笔迹：那扇门开着就先等着（纸转到画面外了），关上再写；笔落下去那一下纸轻轻一沉
      // 橡皮来回擦的时候纸跟着左右蹭
      for (const pen of [...rig.pens]) {
        if (doors[pen.door].to > 0 || doors[pen.door].a > 0.08) { pen.start = now + PEN_DELAY; pen.frame(0, 0); continue; }
        const t = Math.max(0, now - pen.start), paper = rig.papers.find(item => item.key === pen.paper);
        if (t > 0 && !pen.touched) { pen.touched = true; if (paper && pen.writeMs) paper.v -= 0.35; }
        if (paper && pen.erasing && t > 0 && t < pen.eraseMs && !still) paper.v += Math.sin(t / 34) * 0.12;
        const write = pen.writeMs ? Math.min(1, t / pen.writeMs) : 1, erase = pen.eraseMs ? Math.min(1, t / pen.eraseMs) : 1;
        pen.frame(write, erase);
        if (write >= 1 && erase >= 1) rig.pens.splice(rig.pens.indexOf(pen), 1);
      }
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
        // 按点到的高度换算是第几行；柜子清单点到标题或「还有 N 样」就去看完整清单
        const rows = paper.rows;
        const row = rows && hit!.uv ? Math.floor(((1 - hit!.uv.y) * rows.texH - rows.top) / rows.height) : -1;
        paper.v += reduce.matches ? 0 : 1.2; invalidate();
        if (paper.key === 'pantry') {
          const line = paper.lines[row];
          if (line?.lotId) callbacks.current.onOpenLot(line.lotId); else callbacks.current.onOpenPantry?.();
          return;
        }
        // 要买清单：点哪行就划掉 / 取消；点标题、空白、「还有 N 样」打开整张清单
        if (paper.key === 'shop') {
          const line = paper.lines[row];
          if (line) callbacks.current.onToggleShopping?.(line.lotId); else callbacks.current.onOpenShopping?.();
          return;
        }
        // 热一热就能吃：点哪行开哪样；点标题、「还有 N 样」去食材清单
        if (paper.key === 'heat') {
          const line = paper.lines[row];
          if (line) callbacks.current.onOpenLot(line.lotId); else callbacks.current.onOpenList?.();
          return;
        }
        const line = paper.lines[Math.max(0, Math.min(paper.lines.length - 1, row))];
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
      // 开着门时点空处（内胆、层板、墙）就关门：整屏时冰箱两边几乎没有空地，不能只认门外。
      // 两扇都开着时按点的高度关那一格
      const open = stateRef.current.open;
      if (!open.fridge && !open.freezer) return;
      const front = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
      const byHeight: Zone = front && front.y >= FRIDGE.freezerDoor.y0 ? 'freezer' : 'fridge';
      toggleDoor(open.fridge && open.freezer ? byHeight : open.fridge ? 'fridge' : 'freezer');
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
      window.clearTimeout(refillTimer);
      document.fonts.removeEventListener('loadingdone', onFontsLoaded);
      for (const flight of [...flights]) dropFlight(flight);
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
    <section className="kitchen-scene" aria-label="冰箱" style={fullBleed ? { position: 'absolute', inset: 0 } : undefined}>
      <div className="relative" style={{ height: fullBleed ? '100%' : 'min(64vh, 600px)', overflow: 'hidden', background: PAPER.well }}>
        <div ref={host} className="absolute inset-0" />
        {status !== 'ready' && <div role="status" className="absolute inset-0 flex items-center justify-center text-center"
          style={{ padding: SP[3], color: PAPER.muted, fontSize: 13 }}>
          {status === 'loading' ? '正在打开冰箱…' : '冰箱画面暂时打不开，请从「食材清单」继续记录。'}
        </div>}
        {/* 读屏 / 键盘：开着的那格里有什么，一样一个按钮 */}
        {status === 'ready' && <ul className="sr-only" aria-label="冰箱里看得见的食材">
          {visibleItems.map(entry => <li key={entry.lot.id}><button type="button" onClick={() => onOpenLot(entry.lot.id)}>查看{entry.name}</button></li>)}
          {reminders.map(line => <li key={`r-${line.lotId}`}><button type="button" onClick={() => onOpenLot(line.lotId)}>便利贴：{line.text}</button></li>)}
          {pantry?.lines.map(line => <li key={`p-${line.lotId}`}><button type="button" onClick={() => onOpenLot(line.lotId)}>柜子里：{line.text} {line.amount}</button></li>)}
          {pantry && onOpenPantry && <li><button type="button" onClick={onOpenPantry}>看柜子里的全部</button></li>}
          {shop && onOpenShopping && <li><button type="button" onClick={onOpenShopping}>要买清单{shop.lines.length ? `：${shop.lines.filter(line => !line.checked).map(line => line.text).join('、') || '都买了'}` : '（空的）'}</button></li>}
          {heat?.lines.map(line => <li key={`h-${line.lotId}`}><button type="button" onClick={() => onOpenLot(line.lotId)}>热一热就能吃：{line.text} {line.amount}</button></li>)}
        </ul>}
      </div>
      {/* 整屏时点门、点抽屉就开关；这排按钮只留给读屏和键盘 */}
      <div className={fullBleed ? 'sr-only' : 'kitchen-scene-footer'}>
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
