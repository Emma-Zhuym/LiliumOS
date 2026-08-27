/**
 * 统一健康页与角色摘要使用的运动热量来源。
 * Apple Health 的活动能量覆盖全天活动；有该值时不再叠加手动训练热量，避免重复计算。
 */
export function resolveExerciseCalories(
  manualWorkoutCalories?: number,
  externalActiveCalories?: number,
): number {
  const value = externalActiveCalories ?? manualWorkoutCalories ?? 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
