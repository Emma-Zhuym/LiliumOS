import React from 'react';
import type { HistoryReceipt } from '../../utils/kitchenPresentation';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 小票号算出来的条形码：粗细由号码决定，同一天永远长一个样 */
const Barcode: React.FC<{ code: string }> = ({ code }) => {
  const bars: { x: number; w: number }[] = [];
  let x = 0, seed = parseInt(code, 16) || 1;
  for (let i = 0; i < 34; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const w = 1 + (seed >>> 13) % 3, gap = 1 + (seed >>> 7) % 2;
    bars.push({ x, w }); x += w + gap;
  }
  return <svg className="kitchen-receipt-barcode" viewBox={`0 0 ${x} 20`} preserveAspectRatio="none" aria-hidden="true">
    {bars.map(bar => <rect key={bar.x} x={bar.x} y={0} width={bar.w} height={20} />)}
  </svg>;
};

/** 撕开的下沿 */
const TornEdge: React.FC = () => <svg className="kitchen-receipt-edge" viewBox="0 0 120 4" preserveAspectRatio="none" aria-hidden="true">
  <path d={`M0 0 ${Array.from({ length: 30 }, (_, i) => `L${i * 4 + 2} 4 L${i * 4 + 4} 0`).join(' ')} Z`} />
</svg>;

const KitchenHistoryReceipts: React.FC<{ receipts: HistoryReceipt[] }> = ({ receipts }) => <ol className="kitchen-receipts">
  {receipts.map(receipt => {
    const date = new Date(receipt.day);
    const tally = [receipt.added && `放进 ${receipt.added}`, receipt.used && `用掉 ${receipt.used}`].filter(Boolean).join(' · ');
    return <li key={receipt.day} className="kitchen-receipt">
      <div className="kitchen-receipt-paper">
        <header className="kitchen-receipt-head">
          <span><strong>小厨房</strong><small>NO. {receipt.no}</small></span>
          <time dateTime={date.toISOString().slice(0, 10)}>{date.getMonth() + 1}/{date.getDate()}<small>{WEEKDAYS[date.getDay()]}</small></time>
        </header>
        <ul className="kitchen-receipt-lines">
          {receipt.lines.map(line => <li key={line.id} className={line.undone ? 'is-undone' : undefined}>
            <span className="kitchen-receipt-time">{line.time}</span>
            <span className="kitchen-receipt-name">{line.verb} {line.name}{line.undone && <em>已撤销</em>}</span>
            <span className="kitchen-receipt-amount">{line.amount}</span>
          </li>)}
        </ul>
        <footer className="kitchen-receipt-foot">
          <Barcode code={receipt.no} />
          <span>{tally || '只是看了看'}</span>
        </footer>
        <p className="kitchen-receipt-tear">— — 沿 此 撕 下 — —</p>
      </div>
      <TornEdge />
    </li>;
  })}
</ol>;

export default KitchenHistoryReceipts;
