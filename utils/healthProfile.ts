/**
 * healthProfile.ts — 健康档案 + BMR 计算
 *
 * 存 localStorage，独立于 IndexedDB 健康事件
 */

import { readLiliumOSStorage, writeLiliumOSStorage } from './liliumosStorage';

export type FitnessGoal = 'maintain' | 'cut' | 'bulk';

export interface HealthProfile {
  heightCm: number;
  weightKg: number;
  age: number;
  sex: 'F' | 'M';
  bodyFatPct?: number;
  goal?: FitnessGoal;
  dailyCalorieTarget?: number;
  workoutCalorieTarget?: number;
  sleepMinuteTarget?: number;
}

const KEY = 'liliumos_health_profile';
const LEGACY_KEYS = ['sullyem_health_profile'];

export function getHealthProfile(): HealthProfile | null {
  try {
    const raw = readLiliumOSStorage(KEY, LEGACY_KEYS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveHealthProfile(p: HealthProfile): void {
  writeLiliumOSStorage(KEY, JSON.stringify(p), LEGACY_KEYS);
}

// ── BMR 公式 ────────────────────────────────────────────────────────────────

/** Mifflin-St Jeor（通用最准） */
function bmrMifflinStJeor(p: HealthProfile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'M' ? base + 5 : base - 161;
}

/** Katch-McArdle（知道体脂率时更准） */
function bmrKatchMcArdle(weightKg: number, bodyFatPct: number): number {
  const leanMass = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * leanMass;
}

/** 自动选最优公式 */
export function calcBMR(p: HealthProfile): number {
  if (p.bodyFatPct != null && p.bodyFatPct > 0) {
    return Math.round(bmrKatchMcArdle(p.weightKg, p.bodyFatPct));
  }
  return Math.round(bmrMifflinStJeor(p));
}

/** TDEE = BMR × 轻度活跃系数 */
const ACTIVITY_FACTOR = 1.4;

export function calcTDEE(bmr: number): number {
  return Math.round(bmr * ACTIVITY_FACTOR);
}

/** 根据目标推荐每日摄入 */
export function recommendCalories(bmr: number, goal: FitnessGoal): number {
  const tdee = calcTDEE(bmr);
  switch (goal) {
    case 'cut':  return tdee - 400;
    case 'bulk': return tdee + 300;
    default:     return tdee;
  }
}

/** 热量缺口 = 目标 + 运动消耗 - 饮食摄入。正 = 还有余量，负 = 超了 */
export function calcDeficit(target: number, exerciseCal: number, intakeCal: number): number {
  return target + exerciseCal - intakeCal;
}
