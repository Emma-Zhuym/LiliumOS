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
import { refreshExternalHealthSnapshot } from './externalHealth';
import { resolveExerciseCalories } from './healthEnergy';

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
    const [allEvents, externalHealth] = await Promise.all([
      getAllHealthEvents(),
      refreshExternalHealthSnapshot({ maxAgeMs: 5 * 60 * 1000, timeoutMs: 1800 }),
    ]);
    if (allEvents.length === 0 && !externalHealth) return null;

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

    const lines: string[] = [];
    if (externalHealth) {
      const externalParts: string[] = [];
      if (externalHealth.stepsToday !== undefined) externalParts.push(`步数${Math.round(externalHealth.stepsToday)}`);
      if (externalHealth.activeCaloriesToday !== undefined) externalParts.push(`活动${Math.round(externalHealth.activeCaloriesToday)}kcal`);
      if (externalHealth.exerciseMinutesToday !== undefined) externalParts.push(`锻炼${Math.round(externalHealth.exerciseMinutesToday)}分钟`);
      if (externalHealth.sleepHoursLastNight !== undefined) externalParts.push(`昨夜睡${externalHealth.sleepHoursLastNight.toFixed(1).replace(/\.0$/, '')}h`);
      if (externalHealth.latestHeartRate !== undefined) externalParts.push(`心率${Math.round(externalHealth.latestHeartRate)}`);
      if (externalHealth.restingHeartRate !== undefined) externalParts.push(`静息心率${Math.round(externalHealth.restingHeartRate)}`);
      if (externalHealth.hrvMs !== undefined) externalParts.push(`HRV ${Math.round(externalHealth.hrvMs)}ms`);
      if (externalHealth.bloodPressureSystolic !== undefined && externalHealth.bloodPressureDiastolic !== undefined) {
        externalParts.push(`血压${Math.round(externalHealth.bloodPressureSystolic)}/${Math.round(externalHealth.bloodPressureDiastolic)}`);
      }
      if (externalHealth.bloodOxygenPercent !== undefined) externalParts.push(`血氧${Math.round(externalHealth.bloodOxygenPercent)}%`);
      if (externalHealth.bodyTemperatureCelsius !== undefined) externalParts.push(`体温${externalHealth.bodyTemperatureCelsius.toFixed(1)}℃`);
      if (externalHealth.bloodGlucoseMgDl !== undefined) externalParts.push(`血糖${Math.round(externalHealth.bloodGlucoseMgDl)}mg/dL`);
      if (externalHealth.vo2Max !== undefined) externalParts.push(`VO₂max ${externalHealth.vo2Max.toFixed(1)}`);
      if (externalHealth.latestWeightKg !== undefined) externalParts.push(`体重${externalHealth.latestWeightKg}kg`);
      if (externalHealth.bodyFatPercent !== undefined) externalParts.push(`体脂${externalHealth.bodyFatPercent.toFixed(1)}%`);
      const workoutStartedAt = externalHealth.lastWorkout?.startedAt;
      if (workoutStartedAt) {
        const workoutDate = new Date(workoutStartedAt);
        if (!Number.isNaN(workoutDate.getTime()) && todayStr() === `${workoutDate.getFullYear()}-${String(workoutDate.getMonth() + 1).padStart(2, '0')}-${String(workoutDate.getDate()).padStart(2, '0')}`) {
          const kind = externalHealth.lastWorkout?.type?.replace(/([a-z])([A-Z])/g, '$1 $2') || '训练';
          const duration = externalHealth.lastWorkout?.durationMinutes;
          externalParts.push(`Apple Watch ${kind}${duration !== undefined ? ` ${Math.round(duration)}分钟` : ''}`);
        }
      }
      const fetchedAt = Date.parse(externalHealth.fetchedAt);
      const stale = Number.isFinite(fetchedAt) && Date.now() - fetchedAt > 6 * 60 * 60 * 1000;
      if (externalParts.length > 0) lines.push(`【Apple Health${stale ? '·数据可能过期' : ''}】${externalParts.join('｜')}`);
    }
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
