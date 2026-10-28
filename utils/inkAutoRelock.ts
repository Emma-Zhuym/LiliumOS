/**
 * 墨线窗锁屏会自己锁回去（EM，[EM: ink-window-lock]）：像真手机一样，App 切到后台超过 15 分钟，
 * 回来时重新锁上、再看一次那扇窗。阿萌 2026-10-27 定 15 分钟：不要太频繁。
 * 只在锁屏样式是「墨线窗」时这样；用普通锁屏壁纸照旧只在启动时锁一次。
 */
export const INK_RELOCK_AFTER_MS = 15 * 60 * 1000;

/** 双击桌面时钟锁屏：两下点击间隔不超过这么久才算双击 */
export const INK_DOUBLE_TAP_MS = 350;

export function shouldInkRelock(opts: {
  enabled: boolean;
  isLocked: boolean;
  hiddenAt: number | null;
  now: number;
}): boolean {
  const { enabled, isLocked, hiddenAt, now } = opts;
  if (!enabled || isLocked || hiddenAt === null) return false;
  return now - hiddenAt >= INK_RELOCK_AFTER_MS;
}

/** 记一次点击，返回这一下是不是双击的第二下（是的话把记录清掉，免得三连击锁两次） */
export function isSecondTap(lastTapAt: number | null, now: number): boolean {
  return lastTapAt !== null && now - lastTapAt <= INK_DOUBLE_TAP_MS;
}
