/**
 * healthContextBuilder.ts — 为角色对话构建健康感知摘要
 *
 * 第一层（常驻轻量）：每次对话 system prompt 末尾注入一行，
 * 让角色能自然说出 "今天练完了吧" 或 "你好像没睡好"。
 *
 * 格式示例：
 *   【今日】训练日（背+腿）｜周期第17天
 *   【今日】休息日｜周期第3天（经期）
 *   【今日】训练日（胸+臀）
 */

import { getAllHealthEvents, WorkoutHealthEvent, PeriodHealthEvent, SleepHealthEvent, DietHealthEvent, WeightHealthEvent } from './healthDb';
import { calcCycleStatus } from './cycleCalc';
import { getHealthProfile, calcBMR, calcTDEE, calcDeficit } from './healthProfile';
import { loadExternalHealthDailySummaries, loadExternalHealthSnapshotAndRefresh } from './externalHealth';
import { resolveExerciseCalories } from './healthEnergy';
import { buildExternalHealthRoleContext } from './externalHealthRoleSummary';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 读取今日健康数据，返回轻量注入字符串。
 * 没有任何健康记录时返回 null（不注入，不污染 prompt）。
 */
export async function buildTodayHealthSummary(): Promise<string | null> {
  try {
    // 聊天只读上次成功缓存；过期时在后台刷新，绝不为了等 HA/Tailscale 卡住回复。
    const externalHealth = loadExternalHealthSnapshotAndRefresh({
      maxAgeMs: 5 * 60 * 1000,
      timeoutMs: 8000,
    });
    const allEvents = await getAllHealthEvents();
    const externalHealthByDate = loadExternalHealthDailySummaries();
    if (allEvents.length === 0 && !externalHealth && Object.keys(externalHealthByDate).length === 0) return null;

    const today = todayStr();
    const todayEvents = allEvents.filter(e => e.date === today);
    const periodEvents = allEvents.filter((e): e is PeriodHealthEvent => e.type === 'period');

    const parts: string[] = [];

    // ── 训练 or 休息 ─────────────────────────────────────────
    const workout = todayEvents.find(e => e.type === 'workout') as WorkoutHealthEvent | undefined;
    if (allEvents.length > 0) {
      if (workout) {
        const detail = workout.activities?.length ? workout.activities.join('+')
          : workout.parts.length > 0 ? workout.parts.join('+') : '';
        const label = detail ? `训练日（${detail}）` : '训练日';
        const extra = workout.calories ? `·消耗${workout.calories}kcal` : '';
        parts.push(label + extra);
      } else {
        parts.push('休息日');
      }
    }

    // ── 周期状态 ─────────────────────────────────────────────
    if (periodEvents.length > 0) {
      const cs = calcCycleStatus(periodEvents);
      // 今日有经期记录 → 标注经期
      const todayPeriod = todayEvents.find(e => e.type === 'period');
      if (todayPeriod) {
        parts.push(`周期第${cs.cycleDay}天（经期）`);
      } else {
        parts.push(`周期第${cs.cycleDay}天`);
      }
    }

    // ── 睡眠 ─────────────────────────────────────────────────
    const sleep = todayEvents.find(e => e.type === 'sleep') as SleepHealthEvent | undefined;
    if (sleep) {
      const qLabel = sleep.quality === 'good' ? '良好' : sleep.quality === 'ok' ? '一般' : '差';
      const hrs = (sleep.duration / 60).toFixed(1).replace(/\.0$/, '');
      parts.push(`睡${hrs}h(${qLabel})`);
    }

    // ── 饮食 ─────────────────────────────────────────────────
    const diets = todayEvents.filter(e => e.type === 'diet') as DietHealthEvent[];
    if (diets.length > 0) {
      const totalKcal = diets.reduce((s, d) => s + d.calories, 0);
      parts.push(`摄入${totalKcal}kcal`);
    }

    // ── 症状提示 ─────────────────────────────────────────────
    const todaySymptom = todayEvents.find(e => e.type === 'symptom');
    if (todaySymptom && 'symptoms' in todaySymptom && todaySymptom.symptoms.length > 0) {
      parts.push(`有${todaySymptom.symptoms.slice(0, 2).join('/')}症状`);
    }

    // ── 体重 ─────────────────────────────────────────────────
    const weight = todayEvents.find(e => e.type === 'weight') as WeightHealthEvent | undefined;
    if (weight) parts.push(`体重${weight.value}kg`);

    // ── 热量缺口 ─────────────────────────────────────────────
    const profile = getHealthProfile();
    if (profile) {
      const bmr = calcBMR(profile);
      // [EM: apple-health-active-energy] Apple Health 已含训练活动，不能与手动热量相加。
      const exerciseCal = resolveExerciseCalories(workout?.calories, externalHealth?.activeCaloriesToday);
      const intakeCal = diets.reduce((s, d) => s + d.calories, 0);
      if (exerciseCal > 0 || intakeCal > 0) {
        const target = profile.dailyCalorieTarget ?? calcTDEE(bmr);
        const gap = calcDeficit(target, exerciseCal, intakeCal);
        parts.push(gap >= 0 ? `热量盈余${gap}kcal` : `热量超出${Math.abs(gap)}kcal`);
      }
    }

    // [EM-START: apple-health-role-summary]
    // 角色只常驻读取活动/睡眠等生活节律，不接收血氧或其他生命体征。
    // 七日摘要仅使用已经落地的每日汇总，不在每次聊天时轰炸 HA 历史接口。
    const lines: string[] = buildExternalHealthRoleContext({
      current: externalHealth,
      dailyByDate: externalHealthByDate,
    });
    // [EM-END: apple-health-role-summary]
    if (parts.length > 0) lines.push(`【今日健康】${parts.join('｜')}`);
    if (lines.length === 0) return null;

    // ── 行为指引（按优先级，只触发最高的一条） ──────────────
    const todayPeriod = todayEvents.find(e => e.type === 'period');
    const symptomList = todaySymptom && 'symptoms' in todaySymptom ? todaySymptom.symptoms : [];
    const hasDiscomfort = symptomList.length > 0;

    if (todayPeriod && hasDiscomfort) {
      lines.push(`⚠️ 规则：用户正在经期且身体不适（${symptomList.slice(0, 3).join('、')}）。你必须在本轮对话中主动表达关心和体贴——问她感觉怎么样、需不需要什么、提醒她注意休息。不要等她提起，不要忽视，不要把身体不适当作调情素材。这条优先级高于其他所有角色行为。`);
    } else if (todayPeriod) {
      lines.push(`💡 用户今天在经期，对话中自然地多一些温柔和体贴，可以主动关心她的状态。不必每句都提，但至少在本轮对话中体现一次关心。`);
    } else if (hasDiscomfort) {
      lines.push(`⚠️ 规则：用户今天身体不舒服（${symptomList.slice(0, 3).join('、')}），你必须主动关心她的状况，表达体贴。不要忽视这条信息。`);
    } else if (sleep && sleep.quality === 'poor') {
      lines.push(`💡 用户昨晚没睡好，可以自然地表达关心（"是不是没休息好？"之类）。`);
    }

    return lines.join('\n');
  } catch (err) {
    // 读 DB 失败不能让整个对话崩
    console.warn('[healthContextBuilder] Failed to build summary:', err);
    return null;
  }
}
