import { describe, expect, it } from 'vitest';
import { INK_SKY_STOPS } from './inkTokens';
import {
  hourOf, isInkNight, moonArcAt, moonPhase, moonShape, REFERENCE_NEW_MOON_MS, seededRandom,
  skyTintAt, sunAt, SYNODIC_MONTH_DAYS,
} from './inkSky';

describe('isInkNight', () => {
  it('19 点到 6 点算夜里，两头的边界各归一边', () => {
    expect(isInkNight(5.99)).toBe(true);
    expect(isInkNight(6)).toBe(false);
    expect(isInkNight(18.99)).toBe(false);
    expect(isInkNight(19)).toBe(true);
    expect(isInkNight(0)).toBe(true);
    expect(isInkNight(23.5)).toBe(true);
  });
});

describe('hourOf', () => {
  it('换成小数小时', () => {
    expect(hourOf(new Date(2026, 9, 27, 7, 30))).toBe(7.5);
  });
});

describe('skyTintAt', () => {
  it('落在节点上就是那个节点的颜色', () => {
    const noon = INK_SKY_STOPS.find((s) => s[0] === 12)!;
    const t = skyTintAt(12);
    expect(t.top).toEqual(noon[1]);
    expect(t.topAlpha).toBeCloseTo(noon[2]);
    expect(t.horizon).toEqual(noon[3]);
    expect(t.horizonAlpha).toBeCloseTo(noon[4]);
  });

  it('两个节点中间取一半', () => {
    // 9:00 → 12:00 的中点
    const t = skyTintAt(10.5);
    expect(t.top[0]).toBeCloseTo((150 + 158) / 2);
    expect(t.horizonAlpha).toBeCloseTo((0.22 + 0.24) / 2);
  });

  it('表外贴着两头，不外推', () => {
    expect(skyTintAt(5)).toEqual(skyTintAt(6));
    expect(skyTintAt(20)).toEqual(skyTintAt(19));
  });
});

describe('sunAt', () => {
  it('7:10 出、17:10 落、12:10 最高', () => {
    expect(sunAt(7 + 10 / 60).elevation).toBeCloseTo(0);
    expect(sunAt(17 + 10 / 60).elevation).toBeCloseTo(0);
    expect(sunAt(12 + 10 / 60).elevation).toBeCloseTo(1);
    expect(sunAt(6.5).elevation).toBeLessThan(-0.05);
  });

  it('从左往右走，贴地平线偏橙、升高了偏黄铜', () => {
    expect(sunAt(8).x).toBeLessThan(sunAt(16).x);
    const low = sunAt(7.3).color, high = sunAt(12).color;
    expect(low[2]).toBeLessThan(high[2]); // 橙色蓝分量更少
  });
});

describe('moonPhase', () => {
  it('参照新月那一刻是 0，过半个朔望月是满月', () => {
    expect(moonPhase(REFERENCE_NEW_MOON_MS)).toBeCloseTo(0);
    expect(moonPhase(REFERENCE_NEW_MOON_MS + (SYNODIC_MONTH_DAYS / 2) * 864e5)).toBeCloseTo(0.5);
  });

  it('参照点之前也落在 0–1', () => {
    const p = moonPhase(Date.UTC(1999, 0, 1));
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  });

  it('真实日子：2024-04-23 满月、2024-04-08 日全食那天是新月', () => {
    expect(moonPhase(Date.UTC(2024, 3, 23, 23, 49))).toBeCloseTo(0.5, 1);
    const eclipse = moonPhase(Date.UTC(2024, 3, 8, 18, 21));
    expect(Math.min(eclipse, 1 - eclipse)).toBeLessThan(0.03);
  });
});

describe('moonShape', () => {
  it('新月整个挖空、满月整个补满、上弦亮右边', () => {
    expect(moonShape(0)).toEqual({ litRight: true, terminator: 1, bulge: false });
    expect(moonShape(0.5).bulge).toBe(true);
    expect(moonShape(0.5).terminator).toBeCloseTo(1);
    expect(moonShape(0.25).litRight).toBe(true);
    expect(moonShape(0.25).terminator).toBeCloseTo(0);
    expect(moonShape(0.8).litRight).toBe(false);
  });
});

describe('moonArcAt', () => {
  it('19 点从左边贴地平线出来，半夜最高，6 点到右边', () => {
    expect(moonArcAt(19)).toEqual({ x: 0.2, lift: 0 });
    expect(moonArcAt(0.5).lift).toBeCloseTo(0.5);
    expect(moonArcAt(6).x).toBeCloseTo(0.8);
    expect(moonArcAt(6).lift).toBeCloseTo(0);
  });
});

describe('seededRandom', () => {
  it('同一个种子出同一串数', () => {
    const a = seededRandom(7), b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
