import React, { useState } from 'react';
import { goneText, type ShoppingTrip, type TripLine } from '../../utils/kitchenAppearance';

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

// 撤销的：整行淡掉划掉；吃完 / 丢了：名字划掉，数量换成「3 天吃完」（看自己吃得多快，不做统计数字）；
// 吃了一些的：数量旁边用笔写「剩 5 件」（2026-11-04，原来要去下面一串流水里自己算）。
// 点一行：还有的打开改余量，没了的打开详情页（那一样的来龙去脉在详情页）
const OpenLot = React.createContext<(lotId: string) => void>(() => {});
const Line: React.FC<{ line: TripLine }> = ({ line }) => {
  const open = React.useContext(OpenLot);
  return <li>
    <button type="button" className={`kitchen-receipt-row${line.undone ? ' is-undone' : line.gone ? ' is-gone' : ''}`} onClick={() => open(line.lotId)}>
      <span className="kitchen-receipt-name"><span>{line.name}</span>{line.undone && <em>已撤销</em>}</span>
      {line.gone ? <span className="kitchen-receipt-amount">{goneText(line)}</span>
        : <span className="kitchen-receipt-qty"><span className="kitchen-receipt-amount">{line.amount}</span>{line.left && <em className="kitchen-receipt-left">剩 {line.left}</em>}</span>}
    </button>
  </li>;
};

/** 一张完整的小票：买回来的，要吃掉的在前、耐放的在「慢慢吃」那段 */
const Receipt: React.FC<{ trip: ShoppingTrip }> = ({ trip }) => {
  // 拍小票进来的写小票上的日子（没有几点几分）；手动放进的写放进来的时刻
  const day = trip.boughtOn ?? trip.start, date = new Date(day);
  const eat = trip.bought.filter(line => !line.slow), slow = trip.bought.filter(line => line.slow);
  return <>
    <div className="kitchen-receipt-paper">
      <header className="kitchen-receipt-head">
        <span><strong>小厨房 · 采购</strong><small>NO. {trip.no}</small></span>
        <time dateTime={date.toISOString()}>{md(day)}<small>{WEEKDAYS[date.getDay()]}{trip.boughtOn ? '' : ` ${hm(trip.start)}`}</small></time>
      </header>
      {eat.length > 0 && <ul className="kitchen-receipt-lines">
        {eat.map(line => <Line key={line.id} line={line} />)}
      </ul>}
      {slow.length > 0 && <>
        <p className="kitchen-receipt-section">慢 慢 吃</p>
        <ul className="kitchen-receipt-lines kitchen-receipt-lines--slow">
          {slow.map(line => <Line key={line.id} line={line} />)}
        </ul>
      </>}
      <footer className="kitchen-receipt-foot">
        <Barcode code={trip.no} />
      </footer>
      <p className="kitchen-receipt-tear">— — 沿 此 撕 下 — —</p>
    </div>
    <TornEdge />
  </>;
};

/**
 * 小票分两块（阿萌 2026-10-13：看划掉多少决定什么时候再去买菜）：
 * 还没吃完的整张展开，新的在上；要吃掉的都划掉了的折成一条窄纸条放在下面，点开再看整张。
 * 耐放的（慢慢吃）不算，番茄酱不会让旧小票一直挂在上面。
 */
const KitchenHistoryReceipts: React.FC<{ trips: ShoppingTrip[]; onOpenLot: (lotId: string) => void }> = ({ trips, onOpenLot }) => {
  const [openKeys, setOpenKeys] = useState<Set<number>>(() => new Set());
  const going = trips.filter(trip => !trip.finished), done = trips.filter(trip => trip.finished);
  const toggle = (key: number) => setOpenKeys(keys => { const next = new Set(keys); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <OpenLot.Provider value={onOpenLot}>
    {going.length > 0 && <ol className="kitchen-receipts">
      {going.map(trip => <li key={trip.start} className="kitchen-receipt"><Receipt trip={trip} /></li>)}
    </ol>}
    {done.length > 0 && <>
      <p className="kitchen-receipts-label"><span>吃完了的小票</span></p>
      <ol className="kitchen-receipts kitchen-receipts--done">
        {done.map(trip => {
          const expanded = openKeys.has(trip.start), day = trip.boughtOn ?? trip.start, date = new Date(day);
          const eaten = trip.bought.filter(line => !line.undone && !line.slow), slow = trip.bought.filter(line => !line.undone && line.slow);
          return <li key={trip.start} className={`kitchen-receipt${expanded ? ' is-open' : ''}`}>
            {/* 折起来：一截撕下来的短小票——日期、一小段条形码，那次买的东西划掉了排一行，慢慢吃的淡淡跟在后面 */}
            <button type="button" className="kitchen-receipt-stub" aria-expanded={expanded} onClick={() => toggle(trip.start)}
              aria-label={`${md(day)} 采购的小票，${expanded ? '收起' : '展开'}`}>
              <span className="kitchen-receipt-stub-head">
                <time dateTime={date.toISOString()}>{md(day)}<small>{WEEKDAYS[date.getDay()]}</small></time>
                {expanded ? <span className="kitchen-receipt-stub-fold">收起</span> : <Barcode code={trip.no} />}
              </span>
              {/* 展开时整张小票就在下面，票根只留日期和「收起」，不重复 */}
              {!expanded && <span className="kitchen-receipt-stub-items">
                {eaten.map(line => <s key={line.id}>{line.name}</s>)}
                {slow.length > 0 && <em>· {slow.map(line => line.name).join('、')}慢慢吃</em>}
              </span>}
            </button>
            {expanded ? <Receipt trip={trip} /> : <TornEdge />}
          </li>;
        })}
      </ol>
    </>}
  </OpenLot.Provider>;
};

export default KitchenHistoryReceipts;
