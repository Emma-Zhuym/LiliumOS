/**
 * 双击桌面时钟锁屏（EM，[EM: ink-window-lock]）：想看一眼墨线窗就在桌面大时钟上快点两下，
 * 跟按真手机的电源键一样。只在锁屏样式是「墨线窗」时有用；单击时钟照旧什么都不做，编辑桌面时不管。
 */
import React, { useRef } from 'react';
import { useOS } from '../../context/OSContext';
import { isSecondTap } from '../../utils/inkAutoRelock';

const InkClockLockTap: React.FC<{ children: React.ReactNode; disabled?: boolean }> = ({ children, disabled }) => {
  const { theme, lock } = useOS();
  const lastTap = useRef<number | null>(null);
  if (theme.lockStyle !== 'inkWindow') return <>{children}</>;
  const onClick = () => {
    if (disabled) return;
    const now = Date.now();
    if (isSecondTap(lastTap.current, now)) {
      lastTap.current = null;
      lock();
    } else {
      lastTap.current = now;
    }
  };
  // touch-action: manipulation —— 不然 iPhone 会把双击当成放大，还会给每次点击加 300ms 延迟
  return <div className="w-full" style={{ touchAction: 'manipulation' }} onClick={onClick}>{children}</div>;
};

export default InkClockLockTap;
