/**
 * 小厨房的 3D 场景：全部用代码画，不加载模型文件（APP_CONVENTIONS P14）。
 *
 * 真实感主要来自材质、光和后期，不来自建模：
 * - 贴图现画、故意不匀（烤漆橘皮和手印、灰泥墙、橡木、瓷砖缝、纸纤维）
 * - 主光从左边窗户进来，带窗格图案；补光压低，阴影才有颜色
 * - 环境反射里放一扇四格窗，烤漆上映得出窗格
 * - 环境光遮蔽 + 很淡的颗粒和暗角（在 KitchenFridgeScene 里接）
 * 不做门内置物架（2026-10-11 Emma 定），开门正对冰箱里面。
 * 冰箱里不逐个建模：几种通用容器 + 现写的标签；剩菜和认不出的进保鲜盒贴手写胶带；蔬果进磨砂抽屉只见色块。
 *
 * 场景里的颜色是「东西本身的颜色」（墙、木头、烤漆、食物），不是界面 chrome，按 P12 不走 Clay tokens。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FRIDGE } from '../../utils/kitchenFridgeSpec';
import { eggVisibleCount, LOOK_SIZE, type FridgeEntry } from '../../utils/kitchenFridgeLayout';
import { produceTint, tapeLabel, type DoorNoteLine, type DoorReceipt, type HeatList, type PantryList, type ShoppingPaper } from '../../utils/kitchenAppearance';

const { width: W, depth: D, height: H, doorThickness: T } = FRIDGE;
export const HAND_FONT = '"Long Cang", "Kaiti SC", "STKaiti", "KaiTi", cursive';
const SANS = '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif';
const SERIF = '"Noto Serif SC", "Songti SC", "STSong", serif';

/* ── 小工具 ── */
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashOf = (text: string) => { let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** 记下所有建出来的几何、材质、贴图，离开厨房时一起释放 */
class Bin {
  private items = new Set<{ dispose: () => void }>();
  add<T extends { dispose: () => void }>(item: T): T { this.items.add(item); return item; }
  dispose() { this.items.forEach(item => item.dispose()); this.items.clear(); }
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
/** scale：画布按几倍像素画（字和纸纹凑近看不糊）；画的代码照旧用 w × h 的坐标 */
function canvasTex(bin: Bin, w: number, h: number, draw: Draw, opts: { srgb?: boolean; repeat?: [number, number]; aniso?: number; scale?: number } = {}) {
  const scale = opts.scale ?? 1;
  const canvas = document.createElement('canvas'); canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!; ctx.scale(scale, scale); draw(ctx, w, h);
  const texture = bin.add(new THREE.CanvasTexture(canvas));
  if (opts.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = opts.aniso ?? 4;
  if (opts.repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(...opts.repeat); }
  return texture;
}
const speckle = (ctx: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, alpha: number, colors: string[], size = 2) => {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(rnd() * colors.length) | 0].replace('A', (alpha * (0.3 + rnd() * 0.7)).toFixed(3));
    const s = 0.6 + rnd() * size; ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
};
const blotches = (ctx: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, r0: number, r1: number, colors: string[], aMax: number) => {
  for (let i = 0; i < n; i++) {
    const r = r0 + rnd() * (r1 - r0), x = rnd() * w, y = rnd() * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[(rnd() * colors.length) | 0];
    g.addColorStop(0, `rgba(${c},${(aMax * (0.4 + rnd() * 0.6)).toFixed(3)})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
};
const fibers = (ctx: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, base: string, tint: string) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  blotches(ctx, rnd, w, h, 90, 10, 60, [tint, '255,255,255'], 0.06);
  for (let i = 0; i < 200; i++) {
    ctx.strokeStyle = `rgba(${tint},${(0.04 + rnd() * 0.08).toFixed(3)})`; ctx.lineWidth = 0.5 + rnd();
    const px = rnd() * w, py = rnd() * h, a = rnd() * Math.PI, l = 4 + rnd() * 14;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
  }
  speckle(ctx, rnd, w, h, 1200, 0.06, [`rgba(${tint},A)`]);
};
/** 手写一行：每个字微微错落 */
const handLine = (ctx: CanvasRenderingContext2D, rnd: () => number, text: string, x: number, y: number, size: number, color: string, maxWidth = Infinity) => {
  ctx.fillStyle = color; ctx.font = `${size}px ${HAND_FONT}`; let cx = x;
  for (const ch of text) {
    const step = ctx.measureText(ch).width * (0.96 + rnd() * 0.06);
    if (cx + step - x > maxWidth) { ctx.fillText('…', cx, y); break; }
    ctx.save(); ctx.translate(cx, y + (rnd() - 0.5) * 3); ctx.rotate((rnd() - 0.5) * 0.06); ctx.fillText(ch, 0, 0); ctx.restore();
    cx += step;
  }
  return cx;
};
const tornTape = (ctx: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, fill: string) => {
  ctx.beginPath(); ctx.moveTo(6, 10); for (let px = 6; px < w - 6; px += 12) ctx.lineTo(px, 4 + rnd() * 8);
  ctx.lineTo(w - 6, h - 10); for (let px = w - 6; px > 6; px -= 12) ctx.lineTo(px, h - 4 - rnd() * 8); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
};

/* ── 笔：手写的勾、划线、批注，和让字淡下去的那层纸色 ──
 * 静止时一次画完；刚发生的那一笔（刚打的勾、刚吃完的那样）按进度一点点画出来（P14「用掉划一笔墨线」）。
 * 笔迹的抖动在生成时就定好，逐帧重画只改进度，笔画不会跟着抖。 */
type Pt = [number, number];
interface PenStroke { pts: Pt[]; width: number; color: string; from: number; to: number }
interface PenNote { text: string; x: number; y: number; size: number; color: string; from: number; to: number }
interface PenVeil { x: number; y: number; w: number; h: number; color: string; alpha: number; from: number; to: number }
export interface PenMark { key: string; strokes: PenStroke[]; notes: PenNote[]; veils: PenVeil[] }
/** 一笔里先慢后快再收：跟手写一样起笔和收笔都慢一点 */
const easePen = (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** 从起点到终点的一笔：中间拱一点，每个采样点抖一点点 */
const penPath = (rnd: () => number, x0: number, y0: number, x1: number, y1: number, bow = 0, n = 14): Pt[] => {
  const cx = (x0 + x1) / 2 + (rnd() - 0.5) * 2, cy = (y0 + y1) / 2 - bow;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    const j = i === 0 || i === n ? 0 : (rnd() - 0.5) * 0.7;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1 + j] as Pt;
  });
};
const drawStroke = (ctx: CanvasRenderingContext2D, stroke: PenStroke, p: number) => {
  if (p <= 0) return;
  const segs = stroke.pts.length - 1, upto = easePen(p) * segs;
  ctx.strokeStyle = stroke.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.9;
  for (let i = 0; i < Math.ceil(upto); i++) {
    const f = Math.min(1, upto - i), a = stroke.pts[i], b = stroke.pts[i + 1];
    // 笔压：中段粗、两头细
    ctx.lineWidth = stroke.width * (0.72 + 0.38 * Math.sin(Math.PI * (i + 0.5) / segs));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f); ctx.stroke();
  }
  ctx.globalAlpha = 1;
};
const drawMark = (ctx: CanvasRenderingContext2D, mark: PenMark, t: number) => {
  const local = (from: number, to: number) => clamp01((t - from) / (to - from));
  for (const v of mark.veils) {
    const k = local(v.from, v.to); if (k <= 0) continue;
    ctx.globalAlpha = v.alpha * k; ctx.fillStyle = v.color; ctx.fillRect(v.x, v.y, v.w, v.h); ctx.globalAlpha = 1;
  }
  for (const stroke of mark.strokes) drawStroke(ctx, stroke, local(stroke.from, stroke.to));
  for (const note of mark.notes) {   // 手写批注：从左往右一点点写出来
    const k = local(note.from, note.to); if (k <= 0) continue;
    ctx.save(); ctx.font = `${note.size}px ${HAND_FONT}`;
    const tw = ctx.measureText(note.text).width;
    ctx.beginPath(); ctx.rect(note.x - tw - 4, note.y - note.size * 1.2, (tw + 8) * easePen(k), note.size * 1.7); ctx.clip();
    ctx.fillStyle = note.color; ctx.textAlign = 'right'; ctx.fillText(note.text, note.x, note.y);
    ctx.restore();
  }
};
/** 正在写的那几笔：场景每帧推进度，写完就从列表里拿掉 */
export interface PenAnim { render: (progress: (key: string) => number) => void; keys: Set<string>; start: number; duration: number; paper: DoorPaper['key']; door: 'fridge' | 'freezer'; touched?: boolean }
export const PEN_DELAY = 160;

/* ── 门上的纸：薄面片，顶点实时弯曲 ── */
export interface DoorPaper {
  key: 'sticky' | 'receipt' | 'pantry' | 'heat' | 'shop';
  /** 要买清单这张：lines 的 lotId 放的是清单那一行的 id */
  mesh: THREE.Mesh;
  w: number; h: number; curl: number; cup: number; glue: number;
  base: Float32Array;
  /** 被风带动的摆幅、速度；lift 是被拿起 / 磁贴拔开时多翘出来的那截 */
  s: number; v: number; lift: number; liftV: number; liftTo: number; phase: number;
  lines: DoorNoteLine[];
  /** 点到第几行：贴图上第一行的上沿、行高、贴图总高（贴图像素，按 1 倍算） */
  rows?: { top: number; height: number; texH: number };
}
export function bendPaper(paper: DoorPaper, time: number) {
  const geometry = paper.mesh.geometry as THREE.BufferGeometry;
  const pos = geometry.attributes.position.array as Float32Array, base = paper.base;
  const top = paper.h / 2, span = paper.h * (1 - paper.glue);
  const ripple = Math.min(1, Math.abs(paper.v) * 0.04);
  for (let i = 0; i < pos.length; i += 3) {
    const x = base[i], y = base[i + 1];
    const t = Math.max(0, Math.min(1, (top - paper.h * paper.glue - y) / span));
    const u = x / (paper.w / 2);
    // 被风压向门时贴平，不穿进门里
    pos[i + 2] = Math.max(0, paper.curl * t * t + paper.cup * u * u * t + (paper.s + paper.lift) * Math.pow(t, 1.6)
      + ripple * 0.12 * Math.sin(time * 9 + y * 2.2 + paper.phase) * t);
  }
  geometry.attributes.position.needsUpdate = true; geometry.computeVertexNormals();
}
export interface DoorMagnet { key: string; group: THREE.Group; paper: DoorPaper; z: number; v: number; to: number; released: boolean; snapArmed: boolean }

/* ── 场景 ── */
export interface KitchenRig {
  scene: THREE.Scene;
  fridgeHinge: THREE.Group;
  freezerHinge: THREE.Group;
  crisper: THREE.Group;
  lights: { fridge: { area: THREE.RectAreaLight; point: THREE.PointLight; strip: THREE.Mesh }; freezer: { area: THREE.RectAreaLight; point: THREE.PointLight; strip: THREE.Mesh } };
  papers: DoorPaper[];
  magnets: DoorMagnet[];
  /** 每个能点的食物（lotId 挂在 userData 上） */
  items: THREE.Object3D[];
  pickables: THREE.Object3D[];
  /** 正在写的手写笔迹 */
  pens: PenAnim[];
  setContents: (entries: FridgeEntry[], reminders: DoorNoteLine[], receipt: DoorReceipt | null, pantry: PantryList | null, heat: HeatList | null, shop: ShoppingPaper | null, playing?: Set<string>) => void;
  dispose: () => void;
}

export function buildKitchenScene(renderer: THREE.WebGLRenderer): KitchenRig {
  const bin = new Bin();
  const rnd = mulberry(1007);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe8eb');
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (w: number, h: number, draw: Draw, opts: { srgb?: boolean; repeat?: [number, number] } = {}) => canvasTex(bin, w, h, draw, { ...opts, aniso });
  const geo = <T extends THREE.BufferGeometry>(g: T) => bin.add(g);
  const mat = <T extends THREE.Material>(m: T) => bin.add(m);

  // 环境反射：左边一扇四格亮窗（烤漆上映得出窗格）、头顶一块灯、脚下木地板的暖色
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene(); env.background = new THREE.Color('#5d6466');
    const add = (w: number, h: number, pos: THREE.Vector3, color: string, k: number, rotY?: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.copy(pos); if (rotY !== undefined) m.rotation.y = rotY; else m.lookAt(0, 0, 0); env.add(m);
    };
    for (const [dy, dz] of [[-3.6, -2.6], [-3.6, 2.6], [3.6, -2.6], [3.6, 2.6]]) add(4.8, 6.8, new THREE.Vector3(-14, 5 + dy, 5 + dz), '#f2f7fa', 5, Math.PI / 2);
    add(20, 20, new THREE.Vector3(0, 16, 0), '#f2efe9', 0.9);
    add(30, 30, new THREE.Vector3(0, -12, 0), '#a0907c', 0.35);
    add(8, 8, new THREE.Vector3(12, 3, 10), '#f4f1ea', 0.8);
    const rt = pm.fromScene(env, 0.03); bin.add(rt);
    scene.environment = rt.texture; scene.environmentIntensity = 0.42;
    env.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    pm.dispose();
  }

  /* 材质 */
  const peel = tex(1024, 1024, (x, w, h) => { x.fillStyle = '#808080'; x.fillRect(0, 0, w, h); blotches(x, rnd, w, h, 5000, 2, 9, ['255,255,255', '0,0,0'], 0.07); }, { srgb: false, repeat: [2, 3] });
  const enamelRough = tex(512, 1024, (x, w, h) => {
    x.fillStyle = 'rgb(92,92,92)'; x.fillRect(0, 0, w, h);
    blotches(x, rnd, w, h, 120, 10, 40, ['150,150,150'], 0.35);
    for (let i = 0; i < 26; i++) {   // 把手一侧：手摸出来的亮印
      const cx = w * (0.8 + rnd() * 0.16), cy = h * (0.3 + rnd() * 0.3), r = 14 + rnd() * 26;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(40,40,40,0.55)'); g.addColorStop(1, 'rgba(40,40,40,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, r * 0.7, r, rnd(), 0, Math.PI * 2); x.fill();
    }
  }, { srgb: false });
  const enamel = mat(new THREE.MeshPhysicalMaterial({ color: '#f2f3ef', roughness: 1, roughnessMap: enamelRough, bumpMap: peel, bumpScale: 0.6, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.9 }));
  const bodyMat = mat(new THREE.MeshPhysicalMaterial({ color: '#eceee9', roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3, bumpMap: peel, bumpScale: 0.4 }));
  const linerMat = mat(new THREE.MeshStandardMaterial({ color: '#f4f7f7', roughness: 0.55, side: THREE.BackSide }));
  const linerFront = mat(new THREE.MeshStandardMaterial({ color: '#f4f7f7', roughness: 0.55 }));
  const gasketMat = mat(new THREE.MeshStandardMaterial({ color: '#c9cfcf', roughness: 0.85 }));
  const brushed = tex(64, 512, (x, w, h) => { x.fillStyle = 'rgb(105,105,105)'; x.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${(0.05 + rnd() * 0.12).toFixed(3)})`; x.fillRect(rnd() * w, 0, 0.6 + rnd() * 1.4, h); } }, { srgb: false });
  const steel = mat(new THREE.MeshStandardMaterial({ color: '#c8ccce', metalness: 1, roughness: 1, roughnessMap: brushed, envMapIntensity: 1.2 }));
  const glassMat = mat(new THREE.MeshPhysicalMaterial({ color: '#e9f1f3', roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false, clearcoat: 1 }));
  const binMat = mat(new THREE.MeshPhysicalMaterial({ color: '#e3eef1', roughness: 0.25, transparent: true, opacity: 0.38, depthWrite: false, clearcoat: 0.8 }));

  /* 房间：墙、地、旁边的台面 */
  const room = new THREE.Group(); scene.add(room);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, shadows = true) => {
    const o = new THREE.Mesh(geo(g), m); o.castShadow = o.receiveShadow = shadows; parent.add(o); return o;
  };
  {
    const wallTex = tex(512, 512, (x, w, h) => { x.fillStyle = '#d9e4e8'; x.fillRect(0, 0, w, h); blotches(x, rnd, w, h, 260, 18, 110, ['120,140,150', '255,255,255'], 0.07); speckle(x, rnd, w, h, 4000, 0.05, ['rgba(90,110,120,A)', 'rgba(255,255,255,A)']); }, { repeat: [3, 3] });
    const wall = mesh(new THREE.PlaneGeometry(80, 40), mat(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.96 })), room);
    wall.castShadow = false; wall.position.set(0, 16, -D - 0.6);
    const floorTex = tex(512, 512, (x, w, h) => {
      x.fillStyle = '#cdb79b'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) { x.strokeStyle = `rgba(${rnd() < 0.6 ? '120,92,64' : '240,226,206'},${(0.04 + rnd() * 0.1).toFixed(3)})`; x.lineWidth = 0.6 + rnd() * 1.5; const y = rnd() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + rnd() * 6 - 3, w * 0.7, y + rnd() * 6 - 3, w, y + rnd() * 4 - 2); x.stroke(); }
      for (let y = 0; y < h; y += 64) { x.fillStyle = 'rgba(90,70,50,0.18)'; x.fillRect(0, y, w, 1.5); }
    }, { repeat: [6, 6] });
    const floor = mesh(new THREE.PlaneGeometry(80, 60), mat(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 })), room);
    floor.castShadow = false; floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 10);
    const C0 = W / 2 + 0.15, CW = 12, CH = 8.8;
    const cabTex = tex(512, 512, (x, w, h) => { x.fillStyle = '#cdd8db'; x.fillRect(0, 0, w, h); blotches(x, rnd, w, h, 80, 20, 80, ['255,255,255', '110,130,140'], 0.05); x.fillStyle = 'rgba(70,90,100,0.35)'; x.fillRect(w * 0.5 - 1, 0, 2, h); x.fillRect(0, h * 0.18, w, 2); });
    mesh(new RoundedBoxGeometry(CW, CH - 0.5, D - 0.2, 2, 0.05), mat(new THREE.MeshStandardMaterial({ map: cabTex, roughness: 0.6 })), room).position.set(C0 + CW / 2, (CH - 0.5) / 2, -D / 2 - 0.1);
    const oak = tex(1024, 256, (x, w, h) => {
      x.fillStyle = '#c9a77d'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { x.strokeStyle = `rgba(${rnd() < 0.6 ? '110,78,48' : '240,222,196'},${(0.05 + rnd() * 0.12).toFixed(3)})`; x.lineWidth = 0.5 + rnd() * 1.6; const y = rnd() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.33, y + rnd() * 8 - 4, w * 0.66, y + rnd() * 8 - 4, w, y + rnd() * 6 - 3); x.stroke(); }
      speckle(x, rnd, w, h, 3000, 0.08, ['rgba(80,56,36,A)']);
    });
    mesh(new RoundedBoxGeometry(CW + 0.2, 0.42, D + 0.25, 2, 0.08), mat(new THREE.MeshStandardMaterial({ map: oak, roughness: 0.5 })), room).position.set(C0 + CW / 2, CH - 0.2, -D / 2 + 0.1);
    for (const hx of [C0 + 2.2, C0 + 8]) mesh(new RoundedBoxGeometry(1.4, 0.16, 0.2, 2, 0.06), steel, room).position.set(hx, CH - 1.6, 0.05);
    const tiles = tex(512, 512, (x, w, h) => {
      x.fillStyle = '#c3c9c8'; x.fillRect(0, 0, w, h);
      const tw = 128, th = 64;
      for (let r = 0; r < h / th; r++) for (let c = -1; c < w / tw + 1; c++) {
        const ox = c * tw + (r % 2 ? tw / 2 : 0) + 3, oy = r * th + 3;
        const g = x.createLinearGradient(ox, oy, ox, oy + th); g.addColorStop(0, '#f7f8f6'); g.addColorStop(1, `rgb(${232 + rnd() * 10 | 0},${236 + rnd() * 8 | 0},${234 + rnd() * 8 | 0})`);
        x.fillStyle = g; x.fillRect(ox, oy, tw - 6, th - 6);
      }
    }, { repeat: [3, 2] });
    const splash = mesh(new THREE.PlaneGeometry(CW, 6), mat(new THREE.MeshPhysicalMaterial({ map: tiles, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 })), room);
    splash.castShadow = false; splash.position.set(C0 + CW / 2, CH + 3, -D - 0.58);
    const kettle = new THREE.Group(); kettle.position.set(C0 + 2.6, CH, -2.6); room.add(kettle);
    const prof = [[0, 0], [1.05, 0], [1.2, 0.2], [1.25, 0.8], [1.1, 1.5], [0.75, 2.0], [0.42, 2.1], [0.42, 2.25], [0, 2.25]].map(([r, y]) => new THREE.Vector2(r, y));
    const kMat = mat(new THREE.MeshPhysicalMaterial({ color: '#ece7dc', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
    const dark = mat(new THREE.MeshStandardMaterial({ color: '#2f3a38', roughness: 0.45 }));
    mesh(new THREE.LatheGeometry(prof, 48), kMat, kettle);
    mesh(new THREE.SphereGeometry(0.2, 16, 12), dark, kettle).position.y = 2.38;
    const kh = mesh(new THREE.TorusGeometry(0.75, 0.11, 12, 32, Math.PI * 1.1), dark, kettle); kh.position.set(-1.1, 1.35, 0); kh.rotation.z = Math.PI * 0.45;
    const sp = mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.1, 16), kMat, kettle); sp.position.set(1.4, 1.35, 0); sp.rotation.z = -0.9;
    const board = mesh(new RoundedBoxGeometry(3.0, 4.2, 0.22, 3, 0.1), mat(new THREE.MeshStandardMaterial({ map: oak, roughness: 0.55, color: '#e8d6bb' })), room);
    board.position.set(C0 + 6.4, CH + 2.0, -D - 0.25); board.rotation.x = -0.12;
    mesh(new THREE.CylinderGeometry(0.62, 0.48, 1.0, 28), mat(new THREE.MeshStandardMaterial({ color: '#b86f4d', roughness: 0.85 })), room).position.set(C0 + 4.8, CH + 0.5, -4.4);
    const leaf = mat(new THREE.MeshStandardMaterial({ color: '#557a45', roughness: 0.7 }));
    const leafGeo = geo(new THREE.SphereGeometry(0.2, 10, 8));
    for (let i = 0; i < 26; i++) {
      const l = new THREE.Mesh(leafGeo, leaf); l.scale.set(1, 0.45, 0.7); l.castShadow = true;
      const a = rnd() * Math.PI * 2, r = rnd() * 0.55; l.position.set(C0 + 4.8 + Math.cos(a) * r, CH + 1.1 + rnd() * 0.9, -4.4 + Math.sin(a) * r); l.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); room.add(l);
    }
  }

  /* 冰箱：空心箱体，上冷冻下冷藏 */
  const fridge = new THREE.Group(); scene.add(fridge);
  const slab = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, r = 0.12, parent: THREE.Object3D = fridge) => {
    const o = mesh(new RoundedBoxGeometry(w, h, d, 3, r), m, parent); o.position.set(x, y, z); return o;
  };
  const { fridgeDoor: FD, freezerDoor: ZD } = FRIDGE;
  slab(W, H, 0.5, bodyMat, 0, H / 2, -D + 0.25);
  slab(0.5, H, D, bodyMat, -W / 2 + 0.25, H / 2, -D / 2);
  slab(0.5, H, D, bodyMat, W / 2 - 0.25, H / 2, -D / 2);
  slab(W, 0.5, D, bodyMat, 0, H - 0.25, -D / 2);
  slab(W, FD.y0 + 0.3, D, bodyMat, 0, (FD.y0 + 0.3) / 2, -D / 2);
  slab(W - 0.6, 0.35, D - 0.6, bodyMat, 0, (FD.y1 + ZD.y0) / 2, -D / 2 - 0.1);   // 冷冻和冷藏中间的隔板
  const liner = (y0: number, y1: number) => {
    const l = new THREE.Mesh(geo(new THREE.BoxGeometry(W - 1.1, y1 - y0, D - 0.7)), linerMat); l.receiveShadow = true;
    l.position.set(0, (y0 + y1) / 2, -D / 2 - 0.05); fridge.add(l);
  };
  liner(FD.y0 + 0.3, FD.y1 - 0.15); liner(ZD.y0 + 0.2, ZD.y1 - 0.3);
  const shelfGeo = geo(new RoundedBoxGeometry(W - 1.15, 0.08, D - 1.2, 2, 0.03));
  for (const y of [...FRIDGE.shelves.fridge, ...FRIDGE.shelves.freezer]) {
    const g = new THREE.Mesh(shelfGeo, glassMat); g.position.set(0, y - 0.04, -D / 2 - 0.2); g.userData.skip = true; fridge.add(g);
  }
  // 内灯：顶上一条亮片 + 面光 + 往外漏的一点光
  const lamp = (y: number, color: string) => {
    const strip = new THREE.Mesh(geo(new THREE.PlaneGeometry(W - 2.4, 0.35)), mat(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
    strip.rotation.x = Math.PI / 2; strip.position.set(0, y - 0.05, -D / 2); fridge.add(strip);
    const area = new THREE.RectAreaLight(color, 0, W - 1.4, D - 1); area.position.set(0, y - 0.1, -D / 2); area.lookAt(0, 0, -D / 2); fridge.add(area);
    const point = new THREE.PointLight(color, 0, 14, 1.6); point.position.set(0, y - 2, -1.2); fridge.add(point);
    return { strip, area, point };
  };
  const lights = { fridge: lamp(FD.y1 - 0.2, '#eef6ff'), freezer: lamp(ZD.y1 - 0.35, '#e4efff') };

  // 果蔬抽屉：磨砂正面（便宜做法：半透明 + 粗糙，不用透射），拉开时整组往外滑
  const crisper = new THREE.Group(); crisper.position.set(0, FRIDGE.crisper.y0, -D / 2 + 0.1); fridge.add(crisper);
  {
    const front = mesh(new RoundedBoxGeometry(W - 1.3, FRIDGE.crisper.y1 - FRIDGE.crisper.y0, 0.1, 2, 0.04),
      mat(new THREE.MeshPhysicalMaterial({ color: '#e4ecef', roughness: 0.6, transparent: true, opacity: 0.82, depthWrite: false })), crisper, false);
    front.position.set(0, (FRIDGE.crisper.y1 - FRIDGE.crisper.y0) / 2, D / 2 - 0.65); front.userData.crisper = true;
    const lip = mesh(new RoundedBoxGeometry(2.2, 0.28, 0.2, 2, 0.08), linerFront, crisper);
    lip.position.set(0, FRIDGE.crisper.y1 - FRIDGE.crisper.y0 - 0.25, D / 2 - 0.55); lip.userData.crisper = true;
    const floorTray = mesh(new THREE.BoxGeometry(W - 1.3, 0.08, D - 1.4), binMat, crisper, false); floorTray.position.set(0, 0.04, 0);
  }

  // 门：铰链在左
  const door = (y0: number, y1: number, handleY: number, handleLen: number) => {
    const hinge = new THREE.Group(); hinge.position.set(-W / 2 + 0.02, (y0 + y1) / 2, T / 2); fridge.add(hinge);
    const h = y1 - y0;
    const panel = mesh(new RoundedBoxGeometry(W - 0.04, h, T, 4, 0.22), enamel, hinge); panel.position.set(W / 2 - 0.02, 0, 0); panel.userData.door = true;
    const seal = mesh(new RoundedBoxGeometry(W - 0.5, h - 0.4, 0.14, 2, 0.06), gasketMat, hinge, false); seal.position.set(W / 2, 0, -T / 2 - 0.05); seal.userData.door = true;
    const inner = mesh(new RoundedBoxGeometry(W - 1, h - 1, 0.2, 2, 0.08), linerFront, hinge); inner.position.set(W / 2, 0, -T / 2 - 0.12); inner.userData.door = true;
    const handle = new THREE.Group(); handle.position.set(W - 0.62, handleY, T / 2 + 0.012); hinge.add(handle);
    const bar = mesh(new RoundedBoxGeometry(0.34, handleLen, 0.34, 3, 0.15), steel, handle); bar.position.z = 0.62; bar.userData.door = true;
    for (const y of [-handleLen / 2 + 0.4, handleLen / 2 - 0.4]) { const leg = mesh(new RoundedBoxGeometry(0.3, 0.42, 0.66, 2, 0.12), steel, handle); leg.position.set(0, y, 0.3); leg.userData.door = true; }
    return hinge;
  };
  const freezerHinge = door(ZD.y0, ZD.y1, -1.2, 2.6);
  const fridgeHinge = door(FD.y0, FD.y1, 3.3, 4.6);
  freezerHinge.userData.zone = 'freezer'; fridgeHinge.userData.zone = 'fridge';
  /* 光：窗户进来的聚光（带窗格图案）是主光；补光压低 */
  const cookie = tex(512, 512, (x, w, h) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 18;
    const m = 46, b = 22, pw = w / 2 - m - b / 2, ph = h / 2 - m - b / 2;
    x.fillRect(m, m, pw, ph); x.fillRect(w / 2 + b / 2, m, pw, ph); x.fillRect(m, h / 2 + b / 2, pw, ph); x.fillRect(w / 2 + b / 2, h / 2 + b / 2, pw, ph);
  });
  const key = new THREE.SpotLight('#fff0dc', 3.8, 0, THREE.MathUtils.degToRad(26), 0.35, 0);
  key.position.set(-24, 24, 18); key.target.position.set(1.5, 9, -1.5); key.map = cookie;
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  key.shadow.camera.near = 10; key.shadow.camera.far = 80;
  scene.add(key, key.target);
  const windowLight = new THREE.RectAreaLight('#e6f0f6', 1.5, 7, 12); windowLight.position.set(-13, 11, 7); windowLight.lookAt(0, 9, 0); scene.add(windowLight);
  scene.add(new THREE.HemisphereLight('#e8eff2', '#a08d74', 0.32));

  /* ── 会变的部分：食物、门上的纸 ── */
  let contents = new THREE.Group(); scene.add(contents);
  let contentBin = new Bin();
  const rig: KitchenRig = {
    scene, fridgeHinge, freezerHinge, crisper, lights, papers: [], magnets: [], items: [], pickables: [], pens: [],
    setContents: () => {}, dispose: () => {},
  };

  const setContents = (entries: FridgeEntry[], reminders: DoorNoteLine[], receipt: DoorReceipt | null, pantry: PantryList | null, heat: HeatList | null, shop: ShoppingPaper | null, playing: Set<string> = new Set()) => {
    // 换掉上一批：从各自的父级摘下来，再释放
    for (const o of [...rig.items, ...rig.papers.map(p => p.mesh), ...rig.magnets.map(m => m.group)]) o.parent?.remove(o);
    scene.remove(contents); contentBin.dispose();
    contents = new THREE.Group(); scene.add(contents); contentBin = new Bin();
    const cb = contentBin; const cr = mulberry(31);
    const cgeo = <T extends THREE.BufferGeometry>(g: T) => cb.add(g);
    const cmat = <T extends THREE.Material>(m: T) => cb.add(m);
    // 标签、胶带、便利贴、小票：按两倍像素画，凑近看字也清楚
    const ctex = (w: number, h: number, draw: Draw) => canvasTex(cb, w, h, draw, { aniso, scale: 2 });
    rig.pens = [];
    /** 纸底先画一张不带笔迹的底稿，笔迹每帧叠上去：刚发生的那几笔（playing）从 0 开始写 */
    const penTex = (w: number, h: number, drawBase: Draw, marks: PenMark[], paper: DoorPaper['key'], door: 'fridge' | 'freezer', duration: number) => {
      const base = document.createElement('canvas'); base.width = w * 2; base.height = h * 2;
      const bx = base.getContext('2d')!; bx.scale(2, 2); drawBase(bx, w, h);
      const texture = ctex(w, h, () => {});
      const canvas = texture.image as HTMLCanvasElement, x = canvas.getContext('2d')!;
      const render = (progress: (key: string) => number) => {
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, canvas.width, canvas.height); x.drawImage(base, 0, 0);
        x.setTransform(2, 0, 0, 2, 0, 0);
        for (const mark of marks) drawMark(x, mark, progress(mark.key));
        texture.needsUpdate = true;
      };
      const fresh = new Set(marks.filter(mark => playing.has(mark.key)).map(mark => mark.key));
      render(key => fresh.has(key) ? 0 : 1);
      if (fresh.size) rig.pens.push({ render, keys: fresh, start: performance.now() + PEN_DELAY, duration, paper, door });
      return texture;
    };
    const part = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, shadow = true) => {
      const o = new THREE.Mesh(cgeo(g), m); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
    };
    const labelTex = (name: string, band: string, w = 256, h = 160) => ctex(w, h, (x, cw, ch) => {
      x.fillStyle = '#f7f9f8'; x.fillRect(0, 0, cw, ch);
      x.fillStyle = band; x.fillRect(0, ch * 0.58, cw, ch * 0.42);
      x.fillStyle = '#2f3a38'; x.textAlign = 'center'; x.textBaseline = 'middle';
      let size = 46; x.font = `600 ${size}px ${SERIF}`;
      while (x.measureText(name).width > cw - 24 && size > 18) { size -= 2; x.font = `600 ${size}px ${SERIF}`; }
      x.fillText(name, cw / 2, ch * 0.32);
    });
    const tapeTex = (text: string, color = '#e9dfc4', ink = '#3d3a33') => ctex(512, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h); tornTape(x, cr, w, h, color); handLine(x, cr, text, 26, 82, 56, ink, w - 52);
    });
    const BANDS = ['#426479', '#5f8a5c', '#a8584a', '#8a6f45', '#6b5a86'];
    rig.items = [];

    for (const entry of entries) {
      const item = new THREE.Group();
      const size = LOOK_SIZE[entry.look];
      const band = BANDS[hashOf(entry.name) % BANDS.length];
      switch (entry.look) {
        case 'carton': {
          const labelMat = cmat(new THREE.MeshStandardMaterial({ map: labelTex(entry.name, band), roughness: 0.6 }));
          const plain = cmat(new THREE.MeshStandardMaterial({ color: '#f6f8f8', roughness: 0.6 }));
          part(new RoundedBoxGeometry(size.w, size.h * 0.82, size.d, 2, 0.05), [plain, plain, plain, plain, labelMat, plain] as unknown as THREE.Material, item).position.y = size.h * 0.41;
          const roof = part(new THREE.CylinderGeometry(size.w * 0.72, size.w * 0.72, size.d * 0.98, 4, 1), plain, item);
          roof.rotation.set(Math.PI / 2, 0, Math.PI / 4); roof.scale.set(1, 1, 0.42); roof.position.y = size.h * 0.86;
          break;
        }
        case 'eggs': {
          const pulp = cmat(new THREE.MeshStandardMaterial({ color: '#d8d3c6', roughness: 0.95 }));
          part(new RoundedBoxGeometry(size.w, 0.42, size.d, 2, 0.08), pulp, item).position.y = 0.21;
          const shell = cmat(new THREE.MeshStandardMaterial({ color: '#efe2cc', roughness: 0.55 }));
          const eggGeo = cgeo(new THREE.SphereGeometry(0.18, 18, 14));
          const shown = eggVisibleCount(entry.lot);
          for (let i = 0; i < shown; i++) {
            const egg = new THREE.Mesh(eggGeo, shell); egg.scale.set(1, 1.28, 1); egg.castShadow = true;
            egg.position.set(-size.w / 2 + 0.24 + (i % 6) * ((size.w - 0.48) / 5), 0.5, i < 6 ? -0.22 : 0.22); item.add(egg);
          }
          break;
        }
        case 'bottle': {
          const tint = hashOf(entry.name) % 2 ? '#cfe3d8' : '#d6e4ee';
          const prof = [[0, 0], [0.4, 0], [0.42, 0.08], [0.42, 1.55], [0.36, 1.8], [0.18, 2.05], [0.15, 2.25], [0, 2.25]].map(([r, y]) => new THREE.Vector2(r, y));
          part(new THREE.LatheGeometry(prof, 28), cmat(new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.12, transparent: true, opacity: 0.6, clearcoat: 1 })), item);
          const cap = part(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 16), cmat(new THREE.MeshStandardMaterial({ color: band, roughness: 0.4 })), item); cap.position.y = 2.32;
          const lab = part(new THREE.CylinderGeometry(0.43, 0.43, 0.6, 28, 1, true), cmat(new THREE.MeshStandardMaterial({ map: labelTex(entry.name, band, 512, 160), roughness: 0.6 })), item, false); lab.position.y = 0.85;
          break;
        }
        case 'jar': {
          const fill = ['#a8463e', '#8b5a2b', '#c9a548', '#6f7d3c'][hashOf(entry.name) % 4];
          part(new THREE.CylinderGeometry(0.5, 0.5, 0.95, 24), cmat(new THREE.MeshStandardMaterial({ color: fill, roughness: 0.45 })), item).position.y = 0.5;
          part(new THREE.CylinderGeometry(0.55, 0.55, 1.15, 28), cmat(new THREE.MeshPhysicalMaterial({ color: '#e4ece6', roughness: 0.1, transparent: true, opacity: 0.4, clearcoat: 1, depthWrite: false })), item, false).position.y = 0.58;
          part(new THREE.CylinderGeometry(0.58, 0.58, 0.2, 28), cmat(new THREE.MeshStandardMaterial({ color: band, roughness: 0.45 })), item).position.y = 1.25;
          const lab = part(new THREE.CylinderGeometry(0.565, 0.565, 0.42, 28, 1, true), cmat(new THREE.MeshStandardMaterial({ map: labelTex(entry.name, band, 512, 140), roughness: 0.7 })), item, false); lab.position.y = 0.55;
          break;
        }
        case 'box':
        case 'tray':
        case 'bag': {
          if (entry.look === 'box') {   // 保鲜盒：里面一团菜色，盖上一条手写胶带
            const foodColor = ['#9a4b33', '#b8873a', '#6f8a3e', '#c6a07a', '#8a3f3a'][hashOf(entry.name) % 5];
            const blob = part(new RoundedBoxGeometry(size.w - 0.3, size.h * 0.62, size.d - 0.3, 3, 0.25), cmat(new THREE.MeshStandardMaterial({ color: foodColor, roughness: 0.7 })), item); blob.position.y = size.h * 0.34;
            part(new RoundedBoxGeometry(size.w, size.h, size.d, 3, 0.12), cmat(new THREE.MeshPhysicalMaterial({ color: '#eef2f2', roughness: 0.35, transparent: true, opacity: 0.42, depthWrite: false, clearcoat: 0.6 })), item, false).position.y = size.h / 2;
            part(new RoundedBoxGeometry(size.w + 0.1, 0.14, size.d + 0.1, 2, 0.06), cmat(new THREE.MeshStandardMaterial({ color: '#7f9fb1', roughness: 0.5 })), item).position.y = size.h + 0.04;
            const tape = part(new THREE.PlaneGeometry(size.w * 0.8, 0.46), cmat(new THREE.MeshStandardMaterial({ map: tapeTex(tapeLabel(entry.name, entry.lot)), roughness: 0.9, alphaTest: 0.5 })), item, false);
            tape.rotation.x = -Math.PI / 2 + 0.05; tape.position.set(0, size.h + 0.12, 0.2);
            // 盒子正面也看得见胶带：贴一小截垂下来
            const tab = part(new THREE.PlaneGeometry(size.w * 0.8, 0.46), (tape.material as THREE.Material), item, false); tab.position.set(0, size.h - 0.2, size.d / 2 + 0.07);
          } else if (entry.look === 'tray') {   // 肉：泡沫托盘 + 保鲜膜 + 价签
            part(new RoundedBoxGeometry(size.w, 0.22, size.d, 2, 0.06), cmat(new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.9 })), item).position.y = 0.11;
            const meat = part(new RoundedBoxGeometry(size.w - 0.4, 0.3, size.d - 0.4, 3, 0.14), cmat(new THREE.MeshStandardMaterial({ color: /鱼|虾|三文鱼|salmon|fish|shrimp/i.test(entry.name) ? '#e59a7d' : '#b8535a', roughness: 0.55 })), item);
            meat.position.y = 0.36;
            part(new RoundedBoxGeometry(size.w + 0.02, 0.5, size.d + 0.02, 2, 0.12), cmat(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.15, transparent: true, opacity: 0.18, clearcoat: 1, depthWrite: false })), item, false).position.y = 0.26;
            const tag = part(new THREE.PlaneGeometry(1.1, 0.42), cmat(new THREE.MeshStandardMaterial({ map: labelTex(entry.name, band, 256, 100), roughness: 0.7 })), item, false);
            tag.rotation.x = -Math.PI / 2 + 0.12; tag.position.set(0.3, 0.53, 0.25);
          } else {   // 冷冻密封袋：带霜的半透明袋子，白条上手写
            const frost = ctex(256, 256, (x, w, h) => { x.fillStyle = '#e7eef2'; x.fillRect(0, 0, w, h); speckle(x, cr, w, h, 2500, 0.5, ['rgba(255,255,255,A)', 'rgba(180,200,210,A)'], 3); });
            const contentColor = produceTint(entry.name) ?? (/肉|鸡|牛|猪|排骨|meat|beef|pork|chicken/i.test(entry.name) ? '#b8535a' : '#c9b48f');
            const inside = part(new RoundedBoxGeometry(size.w - 0.35, size.h * 0.55, size.d - 0.35, 3, 0.2), cmat(new THREE.MeshStandardMaterial({ color: contentColor, roughness: 0.7 })), item); inside.position.y = size.h * 0.32;
            const bag = part(new RoundedBoxGeometry(size.w, size.h, size.d, 3, 0.3), cmat(new THREE.MeshPhysicalMaterial({ map: frost, roughness: 0.5, transparent: true, opacity: 0.62, depthWrite: false, clearcoat: 0.4 })), item, false); bag.position.y = size.h / 2;
            const strip = part(new THREE.PlaneGeometry(size.w * 0.85, 0.42), cmat(new THREE.MeshStandardMaterial({ map: tapeTex(tapeLabel(entry.name, entry.lot), '#f7f7f2', '#2e4a5e'), roughness: 0.8, alphaTest: 0.5 })), item, false);
            strip.rotation.x = -Math.PI / 2 + 0.05; strip.position.set(0, size.h + 0.02, 0.15);
          }
          break;
        }
        case 'produce': {   // 一小堆：隔着磨砂只看得见颜色
          const tint = produceTint(entry.name) ?? '#4d7f42';
          const pm = cmat(new THREE.MeshStandardMaterial({ color: tint, roughness: 0.65 }));
          const ball = cgeo(new THREE.SphereGeometry(0.36, 16, 12));
          const n = Math.max(2, Math.min(6, Math.ceil(entry.lot.quantity)));
          for (let i = 0; i < n; i++) {
            const b = new THREE.Mesh(ball, pm); b.castShadow = true; b.scale.setScalar(0.85 + cr() * 0.35);
            b.position.set((cr() - 0.5) * 0.9, 0.32 + cr() * 0.3, (cr() - 0.5) * 1.6); item.add(b);
          }
          break;
        }
      }
      item.position.set(...entry.position);
      item.scale.setScalar(entry.scale);
      item.userData.lotId = entry.lot.id; item.userData.zone = entry.zone; item.userData.spot = entry.spot;
      item.traverse(o => { o.userData.lotId = entry.lot.id; });
      const parent = entry.spot === 'crisper' ? crisper : contents;
      if (entry.spot === 'crisper') item.position.set(entry.position[0], 0.1, 0);
      parent.add(item);
      rig.items.push(item);
    }

    /* 门上的纸：便利贴写快过期 / 快用完；小票是最近一次放进来的几样；柜子里是常温柜清单 */
    rig.papers = []; rig.magnets = [];
    const FRONT = T / 2 + 0.012;
    const makePaper = (key: DoorPaper['key'], w: number, h: number, sx: number, sy: number, texture: THREE.Texture, at: [number, number], tilt: number, curl: number, cup: number, glue: number, lines: DoorNoteLine[], rows?: DoorPaper['rows'], door: THREE.Group = fridgeHinge) => {
      const g = cgeo(new THREE.PlaneGeometry(w, h, sx, sy));
      const m = new THREE.Mesh(g, cmat(new THREE.MeshStandardMaterial({ map: texture, roughness: key === 'receipt' ? 0.6 : 0.85, side: THREE.DoubleSide, alphaTest: 0.5 })));
      m.position.set(at[0], at[1], FRONT + 0.01); m.rotation.z = tilt; m.castShadow = m.receiveShadow = true; m.userData.paper = key;
      door.add(m);
      const paper: DoorPaper = { key, mesh: m, w, h, curl, cup, glue, base: (g.attributes.position.array as Float32Array).slice(), s: 0, v: 0, lift: 0, liftV: 0, liftTo: 0, phase: cr() * 6, lines, rows };
      bendPaper(paper, 0); rig.papers.push(paper); return paper;
    };
    if (reminders.length) {
      const sticky = ctex(512, 512, (x, w, h) => {
        fibers(x, cr, w, h, '#e3edd9', '96,120,80');
        const g = x.createLinearGradient(0, 0, 0, h * 0.18); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h * 0.18);
        // 三行固定位置：点哪一行就打开哪一样（KitchenFridgeScene 按 uv 换算）
        reminders.forEach((line, i) => handLine(x, cr, line.text, 40, 150 + i * 116, 60, '#2f4a35', w - 70));
      });
      makePaper('sticky', 2.6, 2.6, 16, 16, sticky, [2.05, 2.6], -0.05, 0.22, 0.02, 0.18, reminders, { top: 90, height: 116, texH: 512 });
    }
    if (receipt && receipt.items.length) {
      // 要吃掉的在前；耐放的在「慢慢吃」那段，字小一号、淡一点（看划掉多少决定什么时候再去买菜，它们不算）
      const slowAt = receipt.items.findIndex(it => it.slow);
      const rows = receipt.items.length + (slowAt >= 0 ? 1 : 0);
      // 纸长跟着内容走（以前按固定公式，底下空一大截）
      const texH = Math.min(Math.round(6.2 / 1.7 * 320), 218 + rows * 44 + 96);
      const ph = texH / 320 * 1.7;
      const date = new Date(receipt.day);
      const W0 = 320, INK = '#2e4a5e', marks: PenMark[] = [];
      // 吃完 / 丢了的那几样：一道墨线划过、字淡下去、右边手写「3 天吃完」——刚吃完的那样一笔一笔写出来
      const measure = document.createElement('canvas').getContext('2d')!;
      receipt.items.forEach((it, i) => {
        if (!it.gone) return;
        const size = it.slow ? 21 : 24, y = 218 + (slowAt >= 0 && i >= slowAt ? i + 1 : i) * 44;
        measure.font = `400 ${size}px ${SANS}`;
        const tw = Math.min(W0 - 140, measure.measureText(it.name).width);
        marks.push({
          key: `gone:${it.lotId}`,
          veils: [{ x: 20, y: y - size, w: W0 - 40, h: size + 10, color: '#f6f6f2', alpha: 0.55, from: 0.05, to: 0.55 }],
          strokes: [{ pts: penPath(cr, 20, y - 8 + cr() * 2, 32 + tw, y - 8 + cr() * 2, 3 + cr() * 2), width: 2.6, color: INK, from: 0, to: 0.5 }],
          notes: [{ text: it.gone, x: W0 - 26, y: y + 2, size: 26, color: it.gone.endsWith('丢了') ? '#8f7a68' : INK, from: 0.5, to: 1 }],
        });
      });
      const paperTex = penTex(W0, texH, (x, w, h) => {
        x.clearRect(0, 0, w, h);
        x.save(); x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h - 18);
        for (let px = w; px > 0; px -= 16) { x.lineTo(px - 8, h - (cr() < 0.5 ? 2 : 14)); x.lineTo(px - 16, h - 18 + cr() * 6); }
        x.closePath(); x.clip();
        fibers(x, cr, w, h, '#f6f6f2', '150,150,140');
        const print = (t: string, px: number, py: number, size = 24, weight = 400, align: CanvasTextAlign = 'left', a = 0.86) => {
          x.globalAlpha = a * (0.85 + cr() * 0.15); x.fillStyle = '#383b3a'; x.font = `${weight} ${size}px ${SANS}`; x.textAlign = align; x.fillText(t, px, py); x.globalAlpha = 1;
        };
        const dash = (py: number) => { x.fillStyle = 'rgba(56,59,58,0.55)'; for (let px = 24; px < w - 24; px += 14) x.fillRect(px, py, 8, 2); };
        print('小厨房 · 采购', w / 2, 112, 30, 500, 'center');
        print(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, w / 2, 148, 20, 400, 'center', 0.7);
        dash(172);
        if (slowAt >= 0) {
          const y = 218 + slowAt * 44;
          dash(y - 26); print('慢 慢 吃', w / 2, y + 4, 18, 400, 'center', 0.55);
        }
        receipt.items.forEach((it, i) => {
          const size = it.slow ? 21 : 24, faint = it.slow ? 0.6 : 1;
          let name = it.name; x.font = `400 ${size}px ${SANS}`;
          while (x.measureText(name).width > w - 140 && name.length > 1) name = name.slice(0, -1);
          const text = name === it.name ? name : `${name}…`, y = 218 + (slowAt >= 0 && i >= slowAt ? i + 1 : i) * 44;
          print(text, 26, y, size, 400, 'left', 0.86 * faint);
          // 吃完的那行数量不印：右边留给手写的「3 天吃完」（笔迹在 marks 里）
          if (!it.gone) print(it.amount, w - 26, y, size - 2, 400, 'right', 0.86 * faint);
        });
        dash(218 + rows * 44 - 12);
        print('放好了', w / 2, h - 50, 20, 400, 'center', 0.65);
        x.restore();
      }, marks, 'receipt', 'fridge', 700);
      const receiptPaper = makePaper('receipt', 1.7, ph, 10, Math.round(ph * 7), paperTex, [4.55, 3.3 - ph / 2 + 1.4], 0.035, 0.34, 0.12, 0.06, receipt.items.map(it => ({ text: it.name, lotId: it.lotId })));
      // 蓝色圆磁贴压着小票顶边
      const g = new THREE.Group(); g.position.set(4.55, receiptPaper.mesh.position.y + ph / 2 - 0.12, FRONT + 0.02); fridgeHinge.add(g);
      const magnet = part(new THREE.CylinderGeometry(0.42, 0.46, 0.24, 40), cmat(new THREE.MeshPhysicalMaterial({ color: '#426479', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 })), g);
      magnet.rotation.x = Math.PI / 2; magnet.position.z = 0.12; magnet.userData.magnet = 'blue';
      rig.magnets.push({ key: 'blue', group: g, paper: receiptPaper, z: 0, v: 0, to: 0, released: false, snapArmed: false });
    }
    // 柜子里：从本子上撕下来的横线纸，贴在冷藏门左下（便利贴下面），绿色方磁贴压住右上角
    if (pantry && pantry.lines.length) {
      const rows = pantry.lines.length + (pantry.more > 0 ? 1 : 0);
      const W0 = 448, TOP = 104, ROW = 54, texH = TOP + rows * ROW + 34;
      const pw = 2.6, ph = pw * texH / W0;
      const listTex = ctex(W0, texH, (x, w, h) => {
        x.clearRect(0, 0, w, h);
        x.save(); x.beginPath(); x.moveTo(0, 22);
        for (let px = 0; px <= w; px += 10) x.lineTo(px, 8 + cr() * 16);
        x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.clip();
        fibers(x, cr, w, h, '#fbfcfa', '120,140,150');
        x.fillStyle = 'rgba(66,100,121,0.22)'; for (let y = TOP + ROW - 10; y < h - 10; y += ROW) x.fillRect(0, y, w, 2);
        handLine(x, cr, '柜子里', 34, 82, 50, '#2e4a5e');
        pantry.lines.forEach((line, i) => {
          const y = TOP + i * ROW + 34;
          handLine(x, cr, line.text, 40, y, 40, '#2e4a5e', w - 170);
          x.font = `30px ${HAND_FONT}`; x.fillStyle = '#5a7486'; x.textAlign = 'right'; x.fillText(line.amount, w - 30, y); x.textAlign = 'left';
        });
        if (pantry.more > 0) handLine(x, cr, `还有 ${pantry.more} 样`, 40, TOP + pantry.lines.length * ROW + 34, 34, '#5a7486');
        x.restore();
      });
      const top = 0.25, at: [number, number] = [2.05, top - ph / 2];
      const listPaper = makePaper('pantry', pw, ph, 14, Math.max(14, Math.round(ph * 6)), listTex, at, 0.06, 0.1, 0.03, 0.12, pantry.lines, { top: TOP - 8, height: ROW, texH });   // 点按区以字为中心（字写在每行上半截）
      const g = new THREE.Group(); g.position.set(at[0] + 0.85, top - 0.16, FRONT + 0.02); fridgeHinge.add(g);
      const magnet = part(new RoundedBoxGeometry(0.9, 0.62, 0.26, 3, 0.1), cmat(new THREE.MeshPhysicalMaterial({ color: '#5f8a5c', roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.12 })), g);
      magnet.position.z = 0.13; magnet.userData.magnet = 'green';
      rig.magnets.push({ key: 'green', group: g, paper: listPaper, z: 0, v: 0, to: 0, released: false, snapArmed: false });
    }
    // 热一热就能吃：冷冻门左半边（右半边留给以后的要买清单），暖黄的格子纸，橙色圆磁贴压住右上角（压中间会挡住标题）。
    // 顶边压低一截：整屏时冷冻门最上面在透明顶栏底下
    if (heat && heat.lines.length) {
      const rows = heat.lines.length + (heat.more > 0 ? 1 : 0);
      const W0 = 420, TOP = 104, ROW = 54, texH = TOP + rows * ROW + 34;
      const pw = 2.8, ph = pw * texH / W0;
      const heatTex = ctex(W0, texH, (x, w, h) => {
        x.clearRect(0, 0, w, h);
        x.save(); x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h - 14);
        for (let px = w; px > 0; px -= 14) x.lineTo(px - 7, h - 4 - cr() * 12);
        x.lineTo(0, h - 14); x.closePath(); x.clip();
        fibers(x, cr, w, h, '#fbf3e4', '170,130,80');
        x.fillStyle = 'rgba(196,112,63,0.13)';   // 淡淡的格子
        for (let gx = 0; gx < w; gx += 27) x.fillRect(gx, 0, 1.5, h);
        for (let gy = 0; gy < h; gy += 27) x.fillRect(0, gy, w, 1.5);
        handLine(x, cr, '热一热就能吃', 30, 78, 42, '#8a4a22', w - 130);
        heat.lines.forEach((line, i) => {
          const y = TOP + i * ROW + 34;
          handLine(x, cr, line.text, 34, y, 38, '#4a3426', w - 150);
          x.font = `28px ${HAND_FONT}`; x.fillStyle = line.amount === '冷藏' || line.amount === '冷冻' ? '#8f7a68' : '#b0502a';
          x.textAlign = 'right'; x.fillText(line.amount, w - 26, y); x.textAlign = 'left';
        });
        if (heat.more > 0) handLine(x, cr, `还有 ${heat.more} 样`, 34, TOP + heat.lines.length * ROW + 34, 32, '#8f7a68');
        x.restore();
      });
      const top = 1.0, at: [number, number] = [1.8, top - ph / 2];
      const heatPaper = makePaper('heat', pw, ph, 14, Math.max(14, Math.round(ph * 6)), heatTex, at, -0.04, 0.12, 0.03, 0.1, heat.lines, { top: TOP - 8, height: ROW, texH }, freezerHinge);
      const g = new THREE.Group(); g.position.set(at[0] + pw / 2 - 0.3, top - 0.1, FRONT + 0.02); freezerHinge.add(g);
      const magnet = part(new THREE.CylinderGeometry(0.36, 0.4, 0.22, 40), cmat(new THREE.MeshPhysicalMaterial({ color: '#c4703f', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 })), g);
      magnet.rotation.x = Math.PI / 2; magnet.position.z = 0.11; magnet.userData.magnet = 'orange';
      rig.magnets.push({ key: 'orange', group: g, paper: heatPaper, z: 0, v: 0, to: 0, released: false, snapArmed: false });
    }
    // 要买清单：冷冻门右半边一条窄的热敏纸，每行前面一个小方框；划掉的打勾、字上一道线。
    // 空着也贴（写「点这里写」），它是加东西的入口。深灰圆磁贴压右上角（压中间会挡住标题）
    if (shop) {
      const rows = Math.max(1, shop.lines.length) + (shop.more > 0 ? 1 : 0);
      const W0 = 340, TOP = 112, ROW = 58, texH = TOP + rows * ROW + 40;
      const pw = 2.3, ph = pw * texH / W0;
      // 打勾的那几行：先在方框里打个勾（短的一笔、长的一笔），再一道线划过名字、字淡下去
      const INK = '#2e4a5e', marks: PenMark[] = [];
      const measure = document.createElement('canvas').getContext('2d')!; measure.font = `400 31px ${SANS}`;
      shop.lines.forEach((line, i) => {
        if (!line.checked) return;
        const y = TOP + i * ROW + 34, tw = Math.min(W0 - 90, measure.measureText(line.text).width);
        marks.push({
          key: `shop:${line.id}`,
          veils: [{ x: 58, y: y - 32, w: W0 - 70, h: 42, color: '#f6f6f2', alpha: 0.55, from: 0.55, to: 0.95 }],
          strokes: [
            { pts: penPath(cr, 25, y - 15, 34, y - 4, 0, 5), width: 3.4, color: INK, from: 0, to: 0.2 },
            { pts: penPath(cr, 34, y - 4, 55, y - 35, -2, 9), width: 3.4, color: INK, from: 0.2, to: 0.45 },
            { pts: penPath(cr, 58, y - 11 + cr() * 2, 66 + tw, y - 11 + cr() * 2, 3 + cr() * 2), width: 3.2, color: INK, from: 0.52, to: 1 },
          ],
          notes: [],
        });
      });
      const shopTex = penTex(W0, texH, (x, w, h) => {
        x.clearRect(0, 0, w, h);
        x.save(); x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h - 16);
        for (let px = w; px > 0; px -= 14) { x.lineTo(px - 7, h - (cr() < 0.5 ? 2 : 12)); x.lineTo(px - 14, h - 16 + cr() * 5); }
        x.closePath(); x.clip();
        fibers(x, cr, w, h, '#f6f6f2', '150,150,140');
        const ink = '#383b3a';
        x.fillStyle = ink; x.globalAlpha = 0.86; x.font = `600 30px ${SANS}`; x.textAlign = 'center'; x.fillText('要买的', w / 2, 70);
        x.fillStyle = 'rgba(56,59,58,0.5)'; for (let px = 20; px < w - 20; px += 13) x.fillRect(px, 92, 7, 2);
        x.globalAlpha = 1; x.textAlign = 'left';
        if (!shop.lines.length) handLine(x, cr, '点这里写', 32, TOP + 34, 36, '#8a8f8c');
        shop.lines.forEach((line, i) => {
          const y = TOP + i * ROW + 34;
          x.strokeStyle = ink; x.lineWidth = 2.6; x.globalAlpha = 0.8; x.strokeRect(22, y - 27, 27, 27);
          let name = line.text; x.font = `400 31px ${SANS}`;
          while (x.measureText(name).width > w - 90 && name.length > 1) name = name.slice(0, -1);
          const text = name === line.text ? name : `${name}…`;
          // 打了勾的字也照常印，勾、划线、淡下去都在 marks 里
          x.globalAlpha = 0.88; x.fillStyle = ink; x.fillText(text, 62, y);
          x.globalAlpha = 1;
        });
        x.globalAlpha = 1;
        if (shop.more > 0) { x.fillStyle = '#6b706d'; x.font = `400 22px ${SANS}`; x.fillText(`还有 ${shop.more} 样`, 62, TOP + shop.lines.length * ROW + 30); }
        x.restore();
      }, marks, 'shop', 'freezer', 640);
      const top = 1.0, at: [number, number] = [4.7, top - ph / 2];
      const shopPaper = makePaper('shop', pw, ph, 10, Math.max(12, Math.round(ph * 7)), shopTex, at, 0.03, 0.26, 0.1, 0.08,
        shop.lines.map(line => ({ text: line.text, lotId: line.id })), { top: TOP - 10, height: ROW, texH }, freezerHinge);
      const g = new THREE.Group(); g.position.set(at[0] + pw / 2 - 0.28, top - 0.1, FRONT + 0.02); freezerHinge.add(g);
      const magnet = part(new THREE.CylinderGeometry(0.34, 0.38, 0.22, 40), cmat(new THREE.MeshPhysicalMaterial({ color: '#3d4a52', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 })), g);
      magnet.rotation.x = Math.PI / 2; magnet.position.z = 0.11; magnet.userData.magnet = 'grey';
      rig.magnets.push({ key: 'grey', group: g, paper: shopPaper, z: 0, v: 0, to: 0, released: false, snapArmed: false });
    }
    rig.pickables = [...rig.items, ...rig.papers.map(p => p.mesh), ...rig.magnets.map(m => m.group), fridgeHinge, freezerHinge, crisper];
  };
  rig.setContents = setContents;
  rig.dispose = () => {
    contentBin.dispose(); bin.dispose();
    key.shadow.map?.dispose();
    scene.clear();
  };
  return rig;
}
