import React from 'react';
import type { ShoppingTrip, TripLine } from '../../utils/kitchenAppearance';

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

const hm = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const md = (at: number) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}`; };

// 撤销的：整行淡掉划掉；买回来的已经吃完 / 丢了：名字划掉，数量换成「吃完」
const Line: React.FC<{ line: TripLine; when?: string }> = ({ line, when }) => <li className={line.undone ? 'is-undone' : line.gone ? 'is-gone' : undefined}>
  {when && <span className="kitchen-receipt-time">{when}</span>}
  <span className="kitchen-receipt-name">{line.verb === '放进' ? '' : `${line.verb} `}<span>{line.name}</span>{line.undone && <em>已撤销</em>}</span>
  <span className="kitchen-receipt-amount">{line.gone ?? line.amount}</span>
</li>;

/** 一次采购一张：上半截买回来的，撕痕下面是到下一次采购之前用掉的 */
const KitchenHistoryReceipts: React.FC<{ trips: ShoppingTrip[] }> = ({ trips }) => <ol className="kitchen-receipts">
  {trips.map(trip => {
    const date = new Date(trip.start);
    const { bought, used, discarded, cooked } = trip.tally;
    const tally = [bought && `买 ${bought} 样`, used && `吃掉 ${used}`, cooked && `做了 ${cooked}`, discarded && `丢掉 ${discarded}`].filter(Boolean).join(' · ');
    // 后半截跨好几天：换了一天才写日期
    let lastDay = '';
    return <li key={trip.start} className="kitchen-receipt">
      <div className="kitchen-receipt-paper">
        <header className="kitchen-receipt-head">
          <span><strong>{trip.opening ? '小厨房 · 开张' : '小厨房 · 采购'}</strong><small>NO. {trip.no}</small></span>
          <time dateTime={date.toISOString()}>{md(trip.start)}<small>{WEEKDAYS[date.getDay()]} {hm(trip.start)}</small></time>
        </header>
        {trip.bought.length > 0 && <ul className="kitchen-receipt-lines">
          {trip.bought.map(line => <Line key={line.id} line={line} />)}
        </ul>}
        {trip.after.length > 0 && <>
          {trip.bought.length > 0 && <p className="kitchen-receipt-section">之 后</p>}
          <ul className="kitchen-receipt-lines kitchen-receipt-lines--after">
            {trip.after.map(line => {
              const day = md(line.at), when = day === lastDay ? hm(line.at) : `${day} ${hm(line.at)}`;
              lastDay = day;
              return <Line key={line.id} line={line} when={when} />;
            })}
          </ul>
        </>}
        <footer className="kitchen-receipt-foot">
          <Barcode code={trip.no} />
          <span>{tally || '都撤销了'}</span>
        </footer>
        <p className="kitchen-receipt-tear">— — 沿 此 撕 下 — —</p>
      </div>
      <TornEdge />
    </li>;
  })}
</ol>;

export default KitchenHistoryReceipts;
