import { describe, expect, it } from 'vitest';
import { INK_SEASONS, inkSeasonOf } from './inkSeasons';

describe('inkSeasonOf', () => {
  it('两个月一季，按设备时间的月份走', () => {
    const at = (m: number, d = 15) => inkSeasonOf(new Date(2026, m - 1, d)).id;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => at(m))).toEqual([
      'deepwinter', 'deepwinter', 'spring', 'spring', 'earlysummer', 'earlysummer',
      'midsummer', 'midsummer', 'autumn', 'autumn', 'earlywinter', 'earlywinter',
    ]);
  });

  it('换季在月初零点', () => {
    expect(inkSeasonOf(new Date(2026, 9, 31, 23, 59)).id).toBe('autumn');
    expect(inkSeasonOf(new Date(2026, 10, 1, 0, 0)).id).toBe('earlywinter');
    expect(inkSeasonOf(new Date(2026, 11, 31, 23, 59)).id).toBe('earlywinter');
    expect(inkSeasonOf(new Date(2027, 0, 1, 0, 0)).id).toBe('deepwinter');
  });
});

describe('INK_SEASONS', () => {
  it('初冬的百叶范围跟原来写死的一样', () => {
    expect(INK_SEASONS.earlywinter.blind).toEqual({ left: 7.32, width: 85.25, top: 18.88, bottom: 84.9 });
  });

  it('百叶都在画面里、上边在下边上面', () => {
    for (const s of Object.values(INK_SEASONS)) {
      expect(s.blind.left).toBeGreaterThan(0);
      expect(s.blind.left + s.blind.width).toBeLessThan(100);
      expect(s.blind.top).toBeLessThan(s.blind.bottom);
    }
  });

  it('只有深冬把院子往上挪', () => {
    expect(INK_SEASONS.deepwinter.gardenShift).toBeLessThan(0);
    expect(Object.values(INK_SEASONS).filter((s) => s.gardenShift !== 0)).toHaveLength(1);
  });
});
