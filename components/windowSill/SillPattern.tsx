// [EM-START: window-sill]
/**
 * 牌面上的图案：春日两块果冻、盛夏两层水、初冬霜云和月亮。
 * 平时全部静止；手指（或鼠标）划过牌面才跟着动，松手自己慢慢停（阿萌 2026-11-09 定的手感，
 * 算法照搬画布「C2 · 跟手指动 · 乙」）：
 *   - 水：浅色在上、比深色灵；深色只跟六成、慢半拍；手指底下一大段被慢慢托起，不溅
 *   - 果冻：只有手指碰到的那一小段凹下去或鼓出来再弹回，整块不跟着晃
 *   - 霜和月亮：手指靠近被拨散再聚回；月亮静止时是正圆，划过时藏在里面的小圆被拨出来、大圆缩一点
 *
 * 动的时候直接改 SVG 属性（requestAnimationFrame，按 1/60 秒一步，高刷屏不会变快），不走 React 重渲染。
 * 指针由外面的牌传进来（useFingerTrail），图案本身不接事件，不挡点击和上下滑。
 */

import React, { useEffect, useMemo, useRef } from 'react';

import type { SillTheme } from '../../utils/sillTokens';

// ── 指针 ───────────────────────────────────────────────────────
export interface FingerPoint { x: number; y: number; vx: number; vy: number; t: number }
export interface FingerTrail { p: FingerPoint | null; wake: Set<() => void> }

/** 牌上挂的指针处理：记下手指在牌里的位置和速度，叫醒图案。 */
export const useFingerTrail = () => {
    const trail = useRef<FingerTrail>({ p: null, wake: new Set() }).current;
    const handlers = useMemo(() => {
        const move = (e: React.PointerEvent<HTMLElement>) => {
            const el = e.currentTarget;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const x = ((e.clientX - r.left) / r.width) * el.offsetWidth;
            const y = ((e.clientY - r.top) / r.height) * el.offsetHeight;
            const now = performance.now();
            const prev = trail.p;
            const dt = prev ? Math.max(8, now - prev.t) : 16;
            trail.p = { x, y, vx: prev ? ((x - prev.x) / dt) * 16 : 0, vy: prev ? ((y - prev.y) / dt) * 16 : 0, t: now };
            trail.wake.forEach(fn => fn());
        };
        const leave = () => {
            trail.p = null;
            trail.wake.forEach(fn => fn());
        };
        return { onPointerDown: move, onPointerMove: move, onPointerUp: leave, onPointerLeave: leave, onPointerCancel: leave };
    }, [trail]);
    return { trail, handlers };
};

// ── 形状 ───────────────────────────────────────────────────────
interface Jelly { cx: number; cy: number; R: number; sx: number; sy: number; a2: number; p2: number; a3: number; p3: number; a4: number; p4: number; dir: number; pw: number; amp: number; bd: number[]; bv: number[] }
interface Drop { hx: number; hy: number; x: number; y: number; vx: number; vy: number; k: number; d: number; push: number; r: number }

const B = 40; // 果冻边上一圈点
const N = 44; // 水面上一排点

const jelly = (cx: number, cy: number, R: number, sx: number, sy: number, a2: number, p2: number, a3: number, p3: number, a4: number, p4: number, dir: number, pw: number, amp: number): Jelly =>
    ({ cx, cy, R, sx, sy, a2, p2, a3, p3, a4, p4, dir, pw, amp, bd: new Array(B).fill(0), bv: new Array(B).fill(0) });

const drop = (hx: number, hy: number, r: number, k: number, push: number): Drop => ({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, k, d: 0.9, push, r });

const blobBase = (b: Jelly, i: number) => {
    const t = (i / B) * Math.PI * 2;
    const lobe = Math.pow(0.5 + 0.5 * Math.cos(t - b.dir), b.pw) * b.amp;
    return b.R * (1 + b.a2 * Math.sin(2 * t + b.p2) + b.a3 * Math.sin(3 * t + b.p3) + b.a4 * Math.sin(4 * t + b.p4)) + lobe;
};
const blobPoint = (b: Jelly, i: number): [number, number] => {
    const k = ((i % B) + B) % B;
    const t = (k / B) * Math.PI * 2;
    const r = blobBase(b, k) + b.bd[k];
    return [b.cx + Math.cos(t) * r * b.sx, b.cy + Math.sin(t) * r * b.sy];
};
/** 不规则，但每一处都是圆的（Catmull-Rom 转贝塞尔） */
const blobPath = (b: Jelly) => {
    const p0 = blobPoint(b, 0);
    let d = `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}`;
    for (let i = 0; i < B; i++) {
        const a = blobPoint(b, i - 1), q = blobPoint(b, i), c = blobPoint(b, i + 1), e = blobPoint(b, i + 2);
        d += ` C${(q[0] + (c[0] - a[0]) / 6).toFixed(2)} ${(q[1] + (c[1] - a[1]) / 6).toFixed(2)} ${(c[0] - (e[0] - q[0]) / 6).toFixed(2)} ${(c[1] - (e[1] - q[1]) / 6).toFixed(2)} ${c[0].toFixed(2)} ${c[1].toFixed(2)}`;
    }
    return `${d} Z`;
};
const wavePath = (heights: number[], base: number, amp: number, phase: number, gain = 1) => {
    const px = (i: number) => (i / (N - 1)) * 100;
    const py = (i: number) => base + amp * Math.sin((i / (N - 1)) * Math.PI * 3.2 + phase) + heights[i] * gain;
    let d = `M0 ${py(0).toFixed(2)}`;
    for (let i = 1; i < N - 1; i++) {
        d += ` Q${px(i).toFixed(2)} ${py(i).toFixed(2)} ${((px(i) + px(i + 1)) / 2).toFixed(2)} ${((py(i) + py(i + 1)) / 2).toFixed(2)}`;
    }
    return `${d} L100 ${py(N - 1).toFixed(2)} V104 H0 Z`;
};

/** 小牌（约 167×148）一套尺寸，宽牌（顶卡、大牌）一套尺寸——都是画布上调过的数。 */
const isWide = (w: number) => w >= 250;

const springShapes = (w: number, h: number) => isWide(w)
    ? [jelly(58, h + 26, 90, 1, 1, 0.09, 0.6, 0.05, 2.1, 0.03, 5.5, -0.2, 4, 20), jelly(w - 14, -6, 80, 1.45, 0.62, 0.08, 4.0, 0.08, 2.1, 0.04, 3, 2.6, 4, 0)]
    : [jelly(42, h + 8, 70, 1, 1, 0.09, 0.6, 0.05, 2.1, 0.03, 5.5, -0.2, 4, 20), jelly(w - 3, 4, 56, 1.3, 0.65, 0.08, 4.0, 0.08, 2.1, 0.04, 3, 2.6, 4, 0)];

/** 霜（三颗融成一团）+ 月亮（一颗大的，四颗小的藏在里面）。坐标在右上角那块 180 宽的画里。 */
const winterShapes = (w: number, h: number) => {
    const wide = isWide(w);
    const frost = wide
        ? [drop(150, h - 10, 46, 0.022, 14), drop(84, h + 10, 44, 0.026, 14), drop(178, h - 54, 26, 0.03, 14)]
        : [drop(150, h - 4, 36, 0.022, 14), drop(108, h + 4, 24, 0.026, 14), drop(178, h - 40, 19, 0.03, 14)];
    const [mx, my, mr] = wide ? [124, 44, 27] : [132, 50, 19];
    const s = mr / 19;
    const moon = [
        drop(mx, my, mr, 0.022, 10),
        drop(mx - 6 * s, my - 4 * s, 11 * s, 0.026, 22),
        drop(mx + 6 * s, my + 4 * s, 11 * s, 0.024, 22),
        drop(mx - 5 * s, my + 7 * s, 9 * s, 0.03, 26),
        drop(mx + 7 * s, my - 7 * s, 8 * s, 0.028, 28),
    ];
    return { frost, moon };
};

/** 水面占多高：顶卡 94（阿萌要「再宽一点」），其余牌 45%。 */
const waveHeight = (h: number, hero: boolean) => (hero ? 94 : Math.round(h * 0.45));

// ── 组件 ───────────────────────────────────────────────────────
const SillPattern: React.FC<{ theme: SillTheme; width: number; height: number; hero?: boolean; trail?: FingerTrail }> = ({ theme, width: w, height: h, hero = false, trail }) => {
    const root = useRef<SVGSVGElement | HTMLDivElement | null>(null);
    const kind = theme.id;
    const geo = useMemo(() => {
        if (kind === 'spring') return { blobs: springShapes(w, h) };
        if (kind === 'earlyWinter') return winterShapes(w, h);
        return { h: new Array(N).fill(0), v: new Array(N).fill(0), hb: new Array(N).fill(0) };
    }, [kind, w, h]);
    const gooId = useMemo(() => `sill-goo-${Math.random().toString(36).slice(2, 8)}`, []);

    useEffect(() => {
        if (!trail || !w || !h) return;
        let raf = 0;
        let last = 0;
        let acc = 0;
        const g = geo as any;

        const step = () => {
            let energy = 0;
            const p = trail.p;
            if (kind === 'summer') {
                const hs: number[] = g.h, vs: number[] = g.v, hb: number[] = g.hb;
                const at = p ? (p.x / w) * (N - 1) : -99;
                for (let i = 0; i < N; i++) {
                    let target = 0;
                    let pull = 0.011;
                    const d = Math.abs(i - at);
                    if (p && d < 12) {
                        const fall = 0.5 + 0.5 * Math.cos((d / 12) * Math.PI);
                        target = -13 * fall;
                        pull = 0.011 + 0.012 * fall;
                    }
                    vs[i] += (target - hs[i]) * pull;
                    vs[i] *= 0.94;
                    hs[i] = Math.max(-24, Math.min(24, hs[i] + vs[i]));
                }
                for (let pass = 0; pass < 6; pass++) {
                    const ld = new Array(N).fill(0), rd = new Array(N).fill(0);
                    for (let i = 0; i < N; i++) {
                        if (i > 0) { ld[i] = 0.16 * (hs[i] - hs[i - 1]); vs[i - 1] += ld[i] * 0.5; }
                        if (i < N - 1) { rd[i] = 0.16 * (hs[i] - hs[i + 1]); vs[i + 1] += rd[i] * 0.5; }
                    }
                    for (let i = 0; i < N; i++) {
                        if (i > 0) hs[i - 1] += ld[i];
                        if (i < N - 1) hs[i + 1] += rd[i];
                    }
                }
                for (let i = 0; i < N; i++) {
                    hb[i] += (hs[i] * 0.62 - hb[i]) * 0.05; // 海底更平静
                    energy += Math.abs(vs[i]) + Math.abs(hs[i]) * 0.05 + Math.abs(hb[i] - hs[i] * 0.62) * 0.05;
                }
            } else if (kind === 'spring') {
                const fx = p?.x ?? 0, fy = p?.y ?? 0;
                for (const b of g.blobs as Jelly[]) {
                    const { bd, bv } = b;
                    let side = 0;
                    if (p) {
                        const fd = Math.hypot((fx - b.cx) / b.sx, (fy - b.cy) / b.sy);
                        const fa = Math.atan2((fy - b.cy) / b.sy, (fx - b.cx) / b.sx);
                        const near = Math.round((fa / (Math.PI * 2)) * B + B) % B;
                        side = Math.max(-1, Math.min(1, ((blobBase(b, near) + bd[near] - fd) * Math.min(b.sx, b.sy)) / 14));
                    }
                    for (let i = 0; i < B; i++) {
                        if (p) {
                            const pt = blobPoint(b, i);
                            const dist = Math.hypot(pt[0] - fx, pt[1] - fy);
                            if (dist < 62) {
                                const f = 0.5 - 0.5 * Math.cos(((62 - dist) / 62) * Math.PI);
                                const limit = side > 0 ? 9 : 16;
                                const room = Math.max(0, 1 - Math.abs(bd[i]) / limit);
                                bv[i] += side * f * 0.7 * room;
                            }
                        }
                        bv[i] += -bd[i] * 0.04;
                        bv[i] *= 0.86;
                    }
                    for (let pass = 0; pass < 4; pass++) {
                        const delta = new Array(B).fill(0);
                        for (let i = 0; i < B; i++) delta[i] = ((bd[(i + B - 1) % B] + bd[(i + 1) % B]) / 2 - bd[i]) * 0.3;
                        for (let i = 0; i < B; i++) bd[i] += delta[i];
                    }
                    for (let i = 0; i < B; i++) {
                        bd[i] = Math.max(-16, Math.min(9, bd[i] + bv[i]));
                        energy += Math.abs(bv[i]) + Math.abs(bd[i]) * 0.05;
                    }
                }
            } else {
                const fx = p ? p.x - (w - 180) : 0, fy = p?.y ?? 0;
                for (const group of [g.moon, g.frost] as Drop[][]) {
                    for (const q of group) {
                        let tx = q.hx, ty = q.hy;
                        if (p) {
                            const dx = q.hx - fx, dy = q.hy - fy;
                            const dist = Math.max(1, Math.hypot(dx, dy));
                            if (dist < 70) {
                                const f = (70 - dist) / 70;
                                tx += (dx / dist) * f * q.push;
                                ty += (dy / dist) * f * q.push;
                            }
                        }
                        q.vx = q.vx * q.d + (tx - q.x) * q.k;
                        q.vy = q.vy * q.d + (ty - q.y) * q.k;
                        q.x += q.vx;
                        q.y += q.vy;
                        energy += Math.abs(q.vx) + Math.abs(q.vy) + (Math.abs(q.x - tx) + Math.abs(q.y - ty)) * 0.05;
                    }
                }
            }
            if (p) { p.vx *= 0.8; p.vy *= 0.8; }
            return energy;
        };

        const draw = () => {
            const el = root.current;
            if (!el) return;
            if (kind === 'summer') {
                el.querySelector('[data-wave="back"]')?.setAttribute('d', wavePath(g.h, 26, 5, 2.1, 0.85));
                el.querySelector('[data-wave="front"]')?.setAttribute('d', wavePath(g.hb, 52, 4, 0));
            } else if (kind === 'spring') {
                el.querySelectorAll('[data-blob]').forEach((node, i) => node.setAttribute('d', blobPath(g.blobs[i])));
            } else {
                const place = (sel: string, list: Drop[]) => el.querySelectorAll(sel).forEach((node, i) => {
                    node.setAttribute('cx', list[i].x.toFixed(2));
                    node.setAttribute('cy', list[i].y.toFixed(2));
                });
                place('[data-moon]', g.moon);
                place('[data-frost]', g.frost);
                let out = 0;
                for (let i = 1; i < g.moon.length; i++) out += Math.hypot(g.moon[i].x - g.moon[i].hx, g.moon[i].y - g.moon[i].hy);
                out /= g.moon.length - 1;
                el.querySelector('[data-moon="0"]')?.setAttribute('r', (g.moon[0].r - Math.min(g.moon[0].r * 0.3, out * 0.3)).toFixed(2));
            }
        };

        const tick = (now: number) => {
            raf = 0;
            const dt = last ? Math.min(64, now - last) : 16.67;
            last = now;
            acc += dt;
            let energy = 1;
            let steps = 0;
            while (acc >= 16.67 && steps < 4) { energy = step(); acc -= 16.67; steps++; }
            if (steps) draw();
            if (trail.p || energy > 0.04) raf = requestAnimationFrame(tick);
            else last = 0;
        };
        const wake = () => { if (!raf) { acc = 0; raf = requestAnimationFrame(tick); } };
        trail.wake.add(wake);
        return () => { trail.wake.delete(wake); if (raf) cancelAnimationFrame(raf); };
    }, [trail, geo, kind, w, h, hero]);

    if (!w || !h) return null;

    if (kind === 'summer') {
        const g = geo as { h: number[]; hb: number[] };
        return (
            <svg ref={root as React.Ref<SVGSVGElement>} aria-hidden width="100%" height={waveHeight(h, hero)} viewBox="0 0 100 104" preserveAspectRatio="none"
                style={{ position: 'absolute', left: 0, bottom: 0, display: 'block', pointerEvents: 'none' }}>
                <path data-wave="back" d={wavePath(g.h, 26, 5, 2.1, 0.85)} fill={theme.shape} />
                <path data-wave="front" d={wavePath(g.hb, 52, 4, 0)} fill={theme.block} />
            </svg>
        );
    }
    if (kind === 'spring') {
        const g = geo as { blobs: Jelly[] };
        return (
            <svg ref={root as React.Ref<SVGSVGElement>} aria-hidden width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'hidden', pointerEvents: 'none' }}>
                <path data-blob="0" d={blobPath(g.blobs[0])} fill={theme.shape} />
                <path data-blob="1" d={blobPath(g.blobs[1])} fill={theme.block} />
            </svg>
        );
    }
    const g = geo as { frost: Drop[]; moon: Drop[] };
    return (
        <svg ref={root as React.Ref<SVGSVGElement>} aria-hidden width={180} height={h} style={{ position: 'absolute', right: 0, top: 0, display: 'block', pointerEvents: 'none' }}>
            <defs>
                <filter id={gooId} filterUnits="userSpaceOnUse" x={-40} y={-40} width={260} height={h + 80} colorInterpolationFilters="sRGB">
                    <feGaussianBlur in="SourceGraphic" stdDeviation={5} result="b" />
                    <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
                </filter>
            </defs>
            <g filter={`url(#${gooId})`}>
                {g.frost.map((q, i) => <circle key={i} data-frost={i} cx={q.x} cy={q.y} r={q.r} fill={theme.block} />)}
            </g>
            <g filter={`url(#${gooId})`}>
                {g.moon.map((q, i) => <circle key={i} data-moon={i} cx={q.x} cy={q.y} r={q.r} fill={theme.shape} />)}
            </g>
        </svg>
    );
};

export default SillPattern;
// [EM-END: window-sill]
