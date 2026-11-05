/**
 * cycleCalc.ts — 经期周期推算（纯计算，无副作用）
 *
 * 输入：经期事件列表（PeriodHealthEvent[]），可选的身体信号（分泌物、症状）
 * 输出：CycleStatus（当前周期天数、预测下次、排卵窗口）
 *
 * 2026-11-04 按阿萌自己的身体算（她：排卵那几天疯狂出水；乳头开始硬痛后两周左右来）：
 * 排卵前那段长短不定，排卵后到来月经那段每个人比较固定。所以这一轮有信号就从信号往后推——
 * 最后一天湿透 + X、乳头开始痛 + Y，X / Y 从她以前几轮的记录里学（没学到之前按 14 天）。
 * 没有信号才退回「上次开始 + 平均周期」。
 */

import type { DischargeAmount, PeriodHealthEvent } from './healthDb';

export interface CycleStatus {
  /** 当前周期第几天（从最近经期开始算，最小1） */
  cycleDay: number;
  /** 预测下次开始日（YYYY-MM-DD）*/
  nextPredictedStart: string;
  /** 预测范围字符串，如 "6月17日 ~ 6月20日" */
  nextRangeStr: string;
  /** 排卵窗口（YYYY-MM-DD[]）：这一轮记了出水就是那几天，否则按下次开始往回推 */
  ovulationWindow: string[];
  /** 排卵窗口从哪来：observed 她记的出水 / estimated 按信号推 / predicted 按周期推 */
  ovulationSource: 'observed' | 'estimated' | 'predicted';
  /** 下次预测从哪推：cycle 平均周期 / peak 最后一天湿透 / breast 乳头开始痛 */
  nextSource: 'cycle' | 'peak' | 'breast';
  /** 给她看的一句（这一轮的信号），没有就空 */
  signalNote: string;
  /** 以前几轮实际隔了几天（最近的在后），让她看见是怎么学的 */
  learned: { afterPeak: number[]; afterBreast: number[] };
  /** 数据不足或变异系数大时标注不确定 */
  uncertain: boolean;
  /** 最近经期开始日（YYYY-MM-DD）*/
  lastPeriodStart: string | null;
  /** 平均周期长度（天）*/
  avgCycleLength: number;
}

// ── 工具函数 ───────────────────────────────────────────────────────────────────

function dateStrToTimestamp(d: string): number {
  return new Date(d + 'T00:00:00').getTime();
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateCN(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ── 核心：从经期事件列表提取「周期开始日」数组 ──────────────────────────────────

/**
 * 连续的经期天被视为一次周期。
 * 找到每次连续段的第一天作为 periodStart。
 */
function extractPeriodStarts(events: PeriodHealthEvent[]): string[] {
  if (events.length === 0) return [];

  // 按日期升序
  const dates = [...new Set(events.map(e => e.date))].sort();
  const starts: string[] = [];

  for (let i = 0; i < dates.length; i++) {
    const prev = i > 0 ? dates[i - 1] : null;
    const curr = dates[i];
    if (!prev) {
      starts.push(curr);
      continue;
    }
    // 如果和上一个间隔 > 2 天，视为新一次经期
    const gap = (dateStrToTimestamp(curr) - dateStrToTimestamp(prev)) / 86400000;
    if (gap > 2) starts.push(curr);
  }

  return starts;
}

// ── 身体信号 ───────────────────────────────────────────────────────────────────

export interface CycleSigns {
  discharge?: { date: string; amount: DischargeAmount }[];
  symptoms?: { date: string; symptoms: string[] }[];
}

/** 出水多到算排卵期的那两档 */
export const isFertileDischarge = (amount: DischargeAmount) => amount === 'wet' || amount === 'soaked';
/** 胸那一类：乳头硬痛、乳房胀痛，或者她自己加的带「乳」「胸痛 / 胸胀」的 */
export const isBreastSymptom = (name: string) => /乳|胸[痛胀]/.test(name);

/** 默认间隔：她说「两周左右」，教科书也是 12–14 天 */
const DEFAULT_GAP = 14;
/** 学的时候最多看最近几轮 */
const LEARN_CYCLES = 6;
/** 周期前几天是经期，那几天的胸痛不算信号 */
const SIGNAL_FROM_DAY = 6;

const diffDays = (a: string, b: string) => Math.round((dateStrToTimestamp(b) - dateStrToTimestamp(a)) / 86400000);
const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mean = (xs: number[]) => Math.round(xs.reduce((s, v) => s + v, 0) / xs.length);

/** 一轮（[from, to)）里的信号：最后一天出水、第一天胸痛 */
function signalsIn(from: string, to: string | null, fertile: string[], breast: string[]) {
  const inside = (d: string) => d >= from && (to === null || d < to);
  const peak = fertile.filter(inside).pop() ?? null;
  const breastStart = breast.find(d => inside(d) && diffDays(from, d) + 1 >= SIGNAL_FROM_DAY) ?? null;
  return { fertileDays: fertile.filter(inside), peak, breastStart };
}

// ── 主函数 ─────────────────────────────────────────────────────────────────────

export function calcCycleStatus(periodEvents: PeriodHealthEvent[], signs: CycleSigns = {}, now: Date = new Date()): CycleStatus {
  const todayTs = new Date(now).setHours(0, 0, 0, 0);
  const todayStr = localDateStr(new Date(todayTs));

  const periodStarts = extractPeriodStarts(periodEvents);
  const fertile = [...new Set((signs.discharge ?? []).filter(d => isFertileDischarge(d.amount)).map(d => d.date))].sort();
  const breast = [...new Set((signs.symptoms ?? []).filter(s => s.symptoms.some(isBreastSymptom)).map(s => s.date))].sort();

  // 没有任何经期数据
  if (periodStarts.length === 0) {
    return {
      cycleDay: 1,
      nextPredictedStart: addDays(todayStr, 28),
      nextRangeStr: `约 ${formatDateCN(addDays(todayStr, 26))} ~ ${formatDateCN(addDays(todayStr, 30))}`,
      ovulationWindow: [],
      ovulationSource: 'predicted',
      nextSource: 'cycle',
      signalNote: '',
      learned: { afterPeak: [], afterBreast: [] },
      uncertain: true,
      lastPeriodStart: null,
      avgCycleLength: 28,
    };
  }

  const lastStart = periodStarts[periodStarts.length - 1];
  const cycleDay = Math.max(
    1,
    Math.floor((todayTs - dateStrToTimestamp(lastStart)) / 86400000) + 1
  );

  // 计算历史周期长度
  const cycleLengths: number[] = [];
  for (let i = 1; i < periodStarts.length; i++) {
    const len = Math.round(
      (dateStrToTimestamp(periodStarts[i]) - dateStrToTimestamp(periodStarts[i - 1])) / 86400000
    );
    // 过滤明显异常值（< 15 或 > 45 天）
    if (len >= 15 && len <= 45) cycleLengths.push(len);
  }

  let avgCycleLength = 28;
  let uncertain = true;

  if (cycleLengths.length >= 2) {
    avgCycleLength = Math.round(
      cycleLengths.reduce((s, v) => s + v, 0) / cycleLengths.length
    );
    // 变异系数检测
    const mean = avgCycleLength;
    const sd = Math.sqrt(
      cycleLengths.reduce((s, v) => s + (v - mean) ** 2, 0) / cycleLengths.length
    );
    const cv = sd / mean;
    uncertain = cv > 0.15;
  } else if (cycleLengths.length === 1) {
    avgCycleLength = cycleLengths[0];
    uncertain = true;
  }

  // 以前几轮：信号之后实际隔了几天来
  const afterPeak: number[] = [];
  const afterBreast: number[] = [];
  for (let i = 1; i < periodStarts.length; i++) {
    const { peak, breastStart } = signalsIn(periodStarts[i - 1], periodStarts[i], fertile, breast);
    if (peak) { const gap = diffDays(peak, periodStarts[i]); if (gap >= 7 && gap <= 20) afterPeak.push(gap); }
    if (breastStart) { const gap = diffDays(breastStart, periodStarts[i]); if (gap >= 4 && gap <= 20) afterBreast.push(gap); }
  }
  const learned = { afterPeak: afterPeak.slice(-LEARN_CYCLES), afterBreast: afterBreast.slice(-LEARN_CYCLES) };
  const peakGap = learned.afterPeak.length ? mean(learned.afterPeak) : DEFAULT_GAP;
  const breastGap = learned.afterBreast.length ? mean(learned.afterBreast) : DEFAULT_GAP;

  // 这一轮到今天为止的信号
  const cur = signalsIn(lastStart, addDays(todayStr, 1), fertile, breast);

  let nextPredictedStart = addDays(lastStart, avgCycleLength);
  let nextSource: CycleStatus['nextSource'] = 'cycle';
  let spread = 2;
  if (cur.breastStart) {
    nextPredictedStart = addDays(cur.breastStart, breastGap);
    nextSource = 'breast';
    uncertain = learned.afterBreast.length < 2;
    spread = uncertain ? 2 : 1;
  } else if (cur.peak) {
    nextPredictedStart = addDays(cur.peak, peakGap);
    nextSource = 'peak';
    uncertain = learned.afterPeak.length < 2;
    spread = uncertain ? 2 : 1;
  }
  const rangeStart = addDays(nextPredictedStart, -spread);
  const rangeEnd   = addDays(nextPredictedStart, spread);
  const nextRangeStr = `${formatDateCN(rangeStart)} ~ ${formatDateCN(rangeEnd)}`;

  // 排卵窗口：记了出水就是那几天（加上最后一天的第二天），否则从下次开始往回推
  let ovulationWindow: string[] = [];
  let ovulationSource: CycleStatus['ovulationSource'] = 'predicted';
  if (cur.fertileDays.length > 0) {
    ovulationWindow = [...new Set([...cur.fertileDays, addDays(cur.peak!, 1)])];
    ovulationSource = 'observed';
  } else {
    const ovulation = addDays(nextPredictedStart, -peakGap);
    const from = nextSource === 'cycle' ? -3 : -2;
    for (let d = from; d <= 1; d++) ovulationWindow.push(addDays(ovulation, d));
    ovulationSource = nextSource === 'cycle' ? 'predicted' : 'estimated';
  }

  let signalNote = '';
  if (cur.peak) {
    const sinceLastWet = diffDays(cur.peak, todayStr);
    signalNote = sinceLastWet <= 1 && !cur.breastStart
      ? '这两天在出水，可能就是排卵期'
      : `估计 ${formatDateCN(cur.peak)} 前后排过卵`;
  } else if (cur.breastStart) {
    signalNote = `${formatDateCN(cur.breastStart)} 开始胸痛，排卵大概已经过了`;
  }

  return {
    cycleDay,
    nextPredictedStart,
    nextRangeStr,
    ovulationWindow,
    ovulationSource,
    nextSource,
    signalNote,
    learned,
    uncertain,
    lastPeriodStart: lastStart,
    avgCycleLength,
  };
}
