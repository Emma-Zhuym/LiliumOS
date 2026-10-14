/**
 * 冰箱里每样东西长什么样、门上的纸写什么（APP_CONVENTIONS P14）。
 *
 * 只读投影：外观由名字和批次状态推出来，不写进库存；猜错了也只是换个容器，数量和位置不受影响。
 * 不逐个建模：包装食品用几种通用容器 + 现写的标签；剩菜和认不出的东西进保鲜盒、盖上贴手写胶带；
 * 散装蔬果放进磨砂抽屉，只显示色块。
 */
import type { KitchenEvent, KitchenFood, KitchenLot, KitchenShoppingItem } from './kitchenDb';
import { hasKitchenEventChange, shoppingMatches } from './kitchenDb';
import { formatEventAmount, formatQuantity } from './kitchenPresentation';
import { looksLikeDish } from './kitchenDishNames';

export type KitchenLook = 'carton' | 'eggs' | 'bottle' | 'jar' | 'box' | 'produce' | 'tray' | 'bag';

const EGGS = /鸡蛋|鸭蛋|鹌鹑蛋|咸蛋|皮蛋|\beggs?\b/i;
const CARTON = /牛奶|酸奶|奶油|果汁|橙汁|苹果汁|豆浆|豆奶|燕麦奶|椰奶|\b(milk|juice|yogh?urt|cream)\b/i;
const BOTTLE = /矿泉水|苏打水|气泡水|可乐|雪碧|汽水|啤酒|饮料|茶饮|\b(water|soda|cola|beer|sprite)\b/i;
const JAR = /酱|蜂蜜|泡菜|腐乳|榨菜|咸菜|黄油|芝士|奶酪|\b(jam|sauce|kimchi|honey|mayo|butter|cheese|pickles?)\b/i;
const MEAT = /肉|鸡|鸭|牛排|排骨|鱼|虾|蟹|贝|扇贝|三文鱼|培根|火腿|香肠|\b(meat|chicken|beef|pork|lamb|steak|fish|shrimp|salmon|bacon|ham|sausage)\b/i;

/** 散装蔬果：名字 → 隔着磨砂看见的那团颜色。顺序有意义，先匹配先用。 */
const PRODUCE: [RegExp, string][] = [
  [/番茄|西红柿|草莓|樱桃|苹果|红椒|甜菜|树莓|\b(tomato|strawberr|cherr|apple|raspberr)/i, '#c4402f'],
  [/胡萝卜|橙子|橘|柑|南瓜|芒果|木瓜|\b(carrot|orange|mandarin|pumpkin|mango)/i, '#d9822b'],
  [/柠檬|香蕉|玉米|黄椒|菠萝|\b(lemon|banana|corn|pineapple)/i, '#e2c044'],
  [/茄子|葡萄|紫甘蓝|蓝莓|洋葱|\b(eggplant|grape|blueberr|onion)/i, '#6b4a78'],
  [/蘑菇|香菇|土豆|姜|蒜|山药|\b(mushroom|potato|ginger|garlic)/i, '#b49a78'],
  [/西兰花|青菜|菠菜|生菜|白菜|油麦菜|黄瓜|青椒|芹菜|葱|香菜|豆角|四季豆|秋葵|西葫芦|牛油果|猕猴桃|青提|\b(broccoli|spinach|lettuce|cabbage|cucumber|celery|scallion|cilantro|bean|zucchini|avocado|kiwi|kale|herb)/i, '#4d7f42'],
];

/** 买来的速冻 / 即食半成品。不写「冷冻」：冷冻牛肉不是热一下就能吃的 */
const READY = /速冻|饺子|水饺|包子|馄饨|云吞|汤包|生煎|锅贴|披萨|比萨|汤圆|元宵|粽子|烧卖|春卷|鸡块|即食|自热|微波|方便面|泡面|\b(pizza|nuggets?|burritos?|dumplings?|gyoza|lasagna|ramen|instant|microwave)\b/i;

/**
 * 自己做的菜 / 剩菜：放进冰箱不算买回来的。只看批次上存的 foodState（放进时勾「自己做的」，
 * 名字只用来预先打勾，见 kitchenDishNames）——2026-10-14 重审前按名字猜，沙拉酱、咖喱块被当成菜。
 */
export const isDish = (foodState?: KitchenLot['foodState']) => foodState === 'leftover' || foodState === 'prepared';

export const produceTint = (name: string): string | null => PRODUCE.find(([pattern]) => pattern.test(name))?.[1] ?? null;

export function kitchenLookFor(name: string, lot: Pick<KitchenLot, 'foodState' | 'storageZone' | 'unit'>): KitchenLook {
  // 做好的、吃剩的：不管原来是什么，都装在保鲜盒里
  if (lot.foodState === 'leftover' || lot.foodState === 'prepared') return 'box';
  if (looksLikeDish(name)) return lot.storageZone === 'freezer' ? 'bag' : 'box';
  if (EGGS.test(name)) return 'eggs';
  if (CARTON.test(name)) return 'carton';
  if (BOTTLE.test(name) || lot.unit === 'large_bottle' || lot.unit === 'small_bottle') return 'bottle';
  if (JAR.test(name) || lot.unit === 'can') return 'jar';
  if (MEAT.test(name)) return lot.storageZone === 'freezer' ? 'bag' : 'tray';
  if (produceTint(name)) return lot.storageZone === 'freezer' ? 'bag' : 'produce';
  // 认不出来的：冷冻的进密封袋，冷藏的进保鲜盒——跟现实里一样，靠贴的字知道是什么
  return lot.storageZone === 'freezer' ? 'bag' : 'box';
}

const monthDay = (value: number | string | undefined): string => {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00`) : new Date(value ?? NaN);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`;
};

/** 保鲜盒和冷冻袋上那条手写胶带：名字 + 放进来的日子。 */
export const tapeLabel = (name: string, lot: Pick<KitchenLot, 'purchasedAt' | 'createdAt'>): string =>
  [name, monthDay(lot.purchasedAt ?? lot.createdAt)].filter(Boolean).join(' ');

/* ── 门上的纸 ── */

export interface DoorNoteLine { text: string; lotId: string }

const DAY = 86_400_000;
const startOfDay = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** 便利贴上一行：左边名字，右边短短一句（过期了 / 明天到期 / 快用完 / 剩一个）；urgent 是过期或今天到期，写红一点 */
export interface StickyLine extends DoorNoteLine { amount: string; urgent: boolean }

/**
 * 便利贴：最要紧的几件事（最多五条）。先是过期 / 快过期（两天内），再是快用完。
 * 只看真的放在冰箱、冷冻和柜子里的；待收纳的还没放好，不提醒。
 * 2026-10-14 阿萌：一句话写一行塞不下，改成名字和状态分两栏，纸跟着条数变长。
 */
export function stickyReminders(lots: KitchenLot[], foods: KitchenFood[], events: KitchenEvent[] = [], now = Date.now(), limit = 5): StickyLine[] {
  const names = new Map(foods.map(food => [food.id, food.name]));
  // 「只剩一个」只对买的时候不止一个的提醒：本来就只买了一颗西兰花，不用天天提醒它只剩一个
  const boughtMany = new Set(events.filter(event => event.type === 'ADD' && !event.undoneAt && event.quantityAfter > 1).map(event => event.lotId));
  const today = startOfDay(now);
  const notes: { rank: number; line: StickyLine }[] = [];
  for (const lot of lots) {
    if (lot.quantity <= 0 || lot.storageZone === 'staging') continue;
    const name = names.get(lot.foodId);
    if (!name) continue;
    if (lot.expiresAt) {
      const due = new Date(`${lot.expiresAt.slice(0, 10)}T00:00:00`).getTime();
      if (Number.isFinite(due)) {
        const days = Math.round((due - today) / DAY);
        if (days < 0) { notes.push({ rank: days, line: { lotId: lot.id, text: name, amount: '过期了', urgent: true } }); continue; }
        if (days <= 2) { notes.push({ rank: days, line: { lotId: lot.id, text: name, amount: `${['今天', '明天', '后天'][days]}到期`, urgent: days === 0 } }); continue; }
      }
    }
    const lowOpened = lot.trackingMode === 'divisible' && lot.quantity <= 1
      && lot.openContainerRemaining !== undefined && lot.openContainerRemaining <= 0.25;
    const lastOne = lot.trackingMode !== 'divisible' && lot.quantity === 1 && (lot.unit === 'piece' || lot.unit === 'item') && boughtMany.has(lot.id);
    if (lowOpened || lastOne) notes.push({ rank: 10, line: { lotId: lot.id, text: name, amount: lastOne ? '剩一个' : '快用完', urgent: false } });
  }
  return notes.sort((a, b) => a.rank - b.rank).slice(0, limit).map(note => note.line);
}

/**
 * 一次采购一张小票（阿萌 2026-10-12 定：一周最多买一次，按天撕会被每天的「吃掉」淹掉）。
 * - 买回来的（放进、不是自己做的菜）前后相隔不到 TRIP_GAP 算同一次；以后拍小票入库，一张照片就是一次。
 * - 两次采购之间吃掉、丢掉、核对、做的菜，接在上一张小票的后半截。
 * - 第一次采购之前的零碎记在「开张」那张。
 * - 撤销本身不单列，被撤销的那一行划掉。
 * 新的一张在前。
 */
export const TRIP_GAP = 2 * 3_600_000;

export interface TripLine {
  id: string; lotId: string; at: number; verb: string; name: string; amount: string; undone: boolean;
  /** 买回来的那一行：这一样现在已经吃完 / 丢了，小票上划掉 */
  gone?: GoneLabel;
  /** 从买回来到吃完 / 丢掉用了多久（「3 天」「2 周」「3 个月」）：看自己吃得多快 */
  lasted?: string;
  /** 耐放的（番茄酱、米面油）：小票上放在「慢慢吃」那段，不算进这次吃到哪了 */
  slow?: boolean;
}

/**
 * 耐放：阿萌用小票划掉多少来决定什么时候再去买菜（2026-10-13），番茄酱这种要吃几个月的
 * 不能让小票一直挂着「没吃完」。看保质期：买回来时能放 30 天以上就算；没填保质期按名字认，
 * 放常温柜的也算。跟放在哪无关——番茄酱照样在冷藏室。
 */
const CONDIMENT = /(酱|露|油|粉|罐头|干)$/;
const LONG_KEEPING = /酱|露|调料|调味|香料|蜂蜜|醋|盐|糖|食用油|橄榄油|菜籽油|花生油|芝麻油|香油|蚝油|黄油|大米|糙米|小米|糯米|面粉|挂面|意面|意大利面|罐头|咖啡豆|茶叶|干货|\b(ketchup|mustard|mayo|sauce|vinegar|honey|oil|rice|flour|pasta|spices?|canned)\b/i;
export const SLOW_DAYS = 30;
export const isLongKeeping = (name: string, lot: Pick<KitchenLot, 'expiresAt' | 'storageZone'> | undefined, boughtAt: number): boolean => {
  // 肉鱼虾是每周采购的主力：冻起来能放几个月也算「要吃掉的」（阿萌 2026-10-14 定：重要冰箱库存）；
  // 酱牛肉这种名字带「酱」的熟食也是。鱼露、虾酱这种结尾是调料的除外
  const meat = MEAT.test(name) && !CONDIMENT.test(name.trim());
  if (meat && lot?.storageZone === 'freezer') return false;
  if (lot?.expiresAt) {
    const expiry = new Date(`${lot.expiresAt.slice(0, 10)}T12:00:00`).getTime();
    if (Number.isFinite(expiry)) return expiry - boughtAt >= SLOW_DAYS * DAY;
  }
  if (lot?.storageZone === 'pantry') return true;
  return !meat && LONG_KEEPING.test(name);
};
export type GoneLabel = '吃完' | '丢了';

/** 用了多久：两周内按天，两个月内按周，再久按月 */
export const lastedText = (from: number, to: number): string => {
  const days = Math.max(0, Math.floor((to - from) / DAY));
  if (days === 0) return '当天';
  if (days < 14) return `${days} 天`;
  if (days < 60) return `${Math.round(days / 7)} 周`;
  return `${Math.round(days / 30)} 个月`;
};

/** 这一批是不是已经没了：数量归零，看最后一笔是丢掉还是吃掉、哪天 */
const goneFor = (lotId: string, lots: Map<string, KitchenLot>, events: KitchenEvent[]): { label: GoneLabel; at: number } | undefined => {
  const lot = lots.get(lotId);
  if (!lot || lot.quantity > 0) return undefined;
  const last = events.filter(event => event.lotId === lotId && event.type !== 'UNDO' && !event.undoneAt)
    .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id))[0];
  return { label: last?.type === 'DISCARD' ? '丢了' : '吃完', at: last?.occurredAt ?? lot.updatedAt };
};

/** 「3 天吃完」「当天吃完」「2 周丢了」 */
export const goneText = (line: Pick<TripLine, 'gone' | 'lasted'>) =>
  line.gone ? `${line.lasted ?? ''}${line.gone}` : '';
export interface ShoppingTrip {
  start: number;
  /** 拍小票放进来的：小票上印的购买日子（中午 12 点），录入晚了几天也按这天算 */
  boughtOn?: number;
  /** 小票号：由开始时间算出，不会变 */
  no: string;
  opening: boolean;
  bought: TripLine[];
  after: TripLine[];
  /** 要吃掉的那些（不算耐放的、撤销的）全划掉了：记录页折起来 */
  finished: boolean;
}

const TRIP_VERBS: Record<KitchenEvent['type'], string> = { ADD: '放进', CONSUME: '吃掉', DISCARD: '丢掉', ADJUST: '核对', UNDO: '撤销' };

export function shoppingTrips(events: KitchenEvent[], foods: KitchenFood[], lots: KitchenLot[] = []): ShoppingTrip[] {
  const names = new Map(foods.map(food => [food.id, food.name]));
  const lotById = new Map(lots.map(lot => [lot.id, lot]));
  const trips: (ShoppingTrip & { lastBuy: number })[] = [];
  const sorted = events.filter(event => event.type !== 'UNDO' && hasKitchenEventChange(event))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  const open = (start: number, opening: boolean) => {
    const trip: ShoppingTrip & { lastBuy: number } = { start, opening, lastBuy: start, bought: [], after: [], finished: false,
      no: ((Math.floor(start / 60_000) * 2654435761) >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-6) };
    trips.push(trip);
    return trip;
  };
  for (const event of sorted) {
    const name = names.get(event.foodId) ?? '食物';
    // 拍小票放进来的一定是买的（速冻饺子名字像菜，但它是买回来的）
    const lot = lotById.get(event.lotId);
    const dish = event.type === 'ADD' && !event.operationId.startsWith('receipt_') && isDish(lot?.foodState);
    const buying = event.type === 'ADD' && event.quantityDelta > 0 && !dish;
    let trip = trips[trips.length - 1];
    const sameTrip = trip && !trip.opening && event.occurredAt - trip.lastBuy <= TRIP_GAP;
    // 买回来的、隔得久了：新开一张（撤销掉的买入不单独开一张）
    if (buying && !sameTrip && !event.undoneAt) {
      trip = open(event.occurredAt, false);
      const printed = event.operationId.startsWith('receipt_') && lot?.purchasedAt ? new Date(`${lot.purchasedAt.slice(0, 10)}T12:00:00`).getTime() : NaN;
      if (Number.isFinite(printed) && printed <= event.occurredAt) trip.boughtOn = printed;
    }
    else if (!trip) trip = open(event.occurredAt, true);
    const line: TripLine = {
      id: event.id, lotId: event.lotId, at: event.occurredAt, name, amount: formatEventAmount(event), undone: Boolean(event.undoneAt),
      // 照菜谱做菜扣掉的（note 是「做番茄炖牛腩」）写「做菜用」，不写「吃掉」
      verb: dish ? '做了' : event.type === 'CONSUME' && event.note?.startsWith('做') ? '做菜用' : TRIP_VERBS[event.type],
    };
    if (buying && (sameTrip || trip.bought.length === 0 && !trip.opening)) {
      const gone = line.undone ? undefined : goneFor(event.lotId, lotById, events);
      const since = trip.boughtOn ?? event.occurredAt;
      if (gone) { line.gone = gone.label; line.lasted = lastedText(since, gone.at); }
      if (isLongKeeping(name, lot, since)) line.slow = true;
      trip.bought.push(line);
      if (!event.undoneAt) trip.lastBuy = event.occurredAt;
    } else {
      trip.after.push(line);
    }
  }
  // 要吃掉的都划了才算吃完；一样要吃掉的都没有（只买了酱料、开张那张）也算
  return trips.reverse().map(({ lastBuy: _lastBuy, ...trip }) => ({
    ...trip, finished: trip.bought.every(line => line.undone || line.slow || !!line.gone),
  }));
}

export interface DoorReceipt { day: number; items: { name: string; amount: string; lotId: string; gone?: string; slow?: boolean }[] }

/**
 * 门上的小票：最近一次采购买回来的几样（跟操作记录里最上面那张是同一次，见 kitchenTrips）。撤销掉的不算。
 * 以后拍小票入库，就是这张小票反过来用。
 */
export function latestReceipt(events: KitchenEvent[], foods: KitchenFood[], lots: KitchenLot[] = [], limit = 8): DoorReceipt | null {
  const trip = shoppingTrips(events, foods, lots).find(item => !item.opening);
  if (!trip) return null;
  // 要吃掉的在前，耐放的排在后面「慢慢吃」那段
  const lines = trip.bought.filter(line => !line.undone);
  const items = [...lines.filter(line => !line.slow), ...lines.filter(line => line.slow)].map(line => ({
    name: line.name, amount: line.amount, lotId: line.lotId, ...(line.gone ? { gone: goneText(line) } : {}), ...(line.slow ? { slow: true } : {}),
  }));
  return items.length ? { day: trip.boughtOn ?? trip.start, items: items.slice(0, limit) } : null;
}

export interface HeatList { lines: (DoorNoteLine & { amount: string })[]; more: number }

/**
 * 「热一热就能吃」：冷冻门上那张（阿萌 2026-10-12 定）。看库存，不是流水：
 * 冷藏、冷冻里还有的自己做的菜 / 剩菜，加上买来的速冻半成品。
 * 冷藏的剩菜放不久，排在前面、快到期的最前；冷冻的放得久，先放进去的先吃。
 */
export function heatList(lots: KitchenLot[], foods: KitchenFood[], now = Date.now(), limit = 5): HeatList | null {
  const names = new Map(foods.map(food => [food.id, food.name]));
  const today = startOfDay(now);
  const ready = lots.filter(lot => lot.quantity > 0 && (lot.storageZone === 'fridge' || lot.storageZone === 'freezer'))
    .map(lot => ({ lot, name: names.get(lot.foodId) ?? '食物' }))
    .filter(({ lot, name }) => isDish(lot.foodState) || READY.test(name));
  if (!ready.length) return null;
  const due = (lot: KitchenLot) => lot.expiresAt ? Math.round((startOfDay(new Date(`${lot.expiresAt}T12:00:00`).getTime()) - today) / DAY) : Infinity;
  ready.sort((a, b) => (a.lot.storageZone === 'fridge' ? 0 : 1) - (b.lot.storageZone === 'fridge' ? 0 : 1)
    || (a.lot.storageZone === 'fridge' ? due(a.lot) - due(b.lot) : 0)
    || a.lot.createdAt - b.lot.createdAt || a.lot.id.localeCompare(b.lot.id));
  const lines = ready.slice(0, limit).map(({ lot, name }) => {
    const days = due(lot);
    const amount = days < 0 ? '过期了' : days === 0 ? '今天吃' : days === 1 ? '明天前' : lot.storageZone === 'fridge' ? '冷藏' : '冷冻';
    return { lotId: lot.id, text: name, amount };
  });
  return { lines, more: ready.length - lines.length };
}

export interface ShoppingLine { id: string; text: string; checked: boolean }
export interface ShoppingPaper { lines: ShoppingLine[]; more: number }

/**
 * 冷冻门右半边的要买清单：先挑没划掉的，空位再给两天内划掉的；挑出来的按写下的先后排——
 * 打了勾的那行留在原地，笔在它身上划过去（不跳到底下，2026-10-14 做手写动效时改）。
 * 最多六行，多的写「还有 N 样」；一样都没有也贴着（写「点这里写」），它是加东西的入口。
 */
export function shoppingPaper(items: KitchenShoppingItem[], now = Date.now(), limit = 6): ShoppingPaper {
  const byWritten = (a: KitchenShoppingItem, b: KitchenShoppingItem) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  const open = items.filter(item => !item.checkedAt).sort(byWritten);
  const done = items.filter(item => item.checkedAt && now - item.checkedAt < 2 * DAY).sort((a, b) => b.checkedAt! - a.checkedAt!);
  const shown = [...open, ...done].slice(0, limit).sort(byWritten);
  const lines = shown.map(item => ({ id: item.id, text: item.name, checked: !!item.checkedAt }));
  return { lines, more: open.length - lines.filter(line => !line.checked).length };
}

/**
 * 要买清单里「要不要加上」的建议：快用完的（便利贴上那种）、最近两周用完了又没再买的。
 * 清单上已经有的不再建议。
 */
export function shoppingSuggestions(lots: KitchenLot[], foods: KitchenFood[], events: KitchenEvent[], items: KitchenShoppingItem[], now = Date.now(), limit = 6): string[] {
  const names = new Map(foods.map(food => [food.id, food.name]));
  const onList = (name: string) => items.some(item => !item.checkedAt && shoppingMatches(item.name, name));
  const stocked = new Set(lots.filter(lot => lot.quantity > 0).map(lot => lot.foodId));
  // 放进来又撤销了的（记错了）不是「刚用完」
  const undoneAdds = new Set(events.filter(event => event.type === 'ADD' && event.undoneAt).map(event => event.lotId));
  const result: string[] = [];
  const push = (name: string | undefined) => { if (name && !onList(name) && !result.includes(name)) result.push(name); };
  for (const line of stickyReminders(lots, foods, events, now, 20)) {
    if (line.amount === '快用完' || line.amount === '剩一个') push(names.get(lots.find(lot => lot.id === line.lotId)?.foodId ?? ''));
  }
  lots.filter(lot => lot.quantity <= 0 && !stocked.has(lot.foodId) && !undoneAdds.has(lot.id) && now - lot.updatedAt < 14 * DAY)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach(lot => { if (!isDish(lot.foodState)) push(names.get(lot.foodId)); });
  return result.slice(0, limit);
}

/**
 * 柜子里分几段（阿萌 2026-10-14）：速食、零食、饮料；米面油和酱料调料不上这张纸（要买她自己写，
 * 拍小票进来照旧在「慢慢吃」）。按名字猜，猜错了批次上记 pantryKind 改过来。顺序有意义：先认调料，
 * 免得「料酒」被当成酒、「糖醋汁」被当成糖。
 */
export type PantryKind = 'ready' | 'snack' | 'drink' | 'staple';
export const PANTRY_KIND_LABELS: Record<PantryKind, string> = { ready: '速食', snack: '零食', drink: '饮料', staple: '米面油调料' };
const STAPLE = /酱|醋|盐|白糖|红糖|冰糖|砂糖|调料|调味|香料|花椒|八角|桂皮|胡椒|味精|鸡精|蚝油|料酒|露|油$|食用油|大米|糙米|小米|糯米|米$|面粉|淀粉|挂面|意面|意大利面|粉丝|蜂蜜|\b(sauce|vinegar|salt|sugar|oil|rice|flour|pasta|spices?|seasoning|honey)\b/i;
const DRINK = /水$|矿泉水|饮料|可乐|雪碧|汽水|苏打|气泡水|果汁|橙汁|茶饮|奶茶|茶$|咖啡|啤酒|酒$|红酒|豆奶|椰子水|牛奶|酸奶饮品|\b(water|soda|cola|juice|coffee|tea|beer|wine|drinks?|milk)\b/i;
const READY_SHELF = /方便面|泡面|拉面|自热|速食|即食|罐头|午餐肉|螺蛳粉|酸辣粉|米线|八宝粥|燕麦|麦片|速冻|饺子|微波|火锅底料|\b(instant|ramen|noodles?|canned|soup|oats?|oatmeal|cereal|mac)\b/i;
export const guessPantryKind = (name: string): PantryKind =>
  STAPLE.test(name) ? 'staple' : DRINK.test(name) ? 'drink' : READY_SHELF.test(name) ? 'ready' : 'snack';
export const pantryKindOf = (name: string, lot: Pick<KitchenLot, 'pantryKind'>): PantryKind => lot.pantryKind ?? guessPantryKind(name);

export interface PantryLine extends DoorNoteLine { amount: string }
/** 纸上一行：段标题（带这段一共几样）或一样东西（段标题那行点了去看整张清单） */
export type PantryRow = { head: string; count: number } | { line: PantryLine };
export interface PantryList { lines: PantryLine[]; rows: PantryRow[]; more: number }

/**
 * 「柜子里」清单：常温柜不做 3D，贴一张手写清单在冷藏门上。按速食 / 零食 / 饮料分段，段名后写这段一共几样；
 * 每类最多写三样（阿萌 2026-10-14：每类写两三个就行，不用全写），门上地方紧时（maxRows，含段名）
 * 三段轮流分名额，至少每类一样；段里最近动过的在前，没写上的点纸去看整张清单。开封的分次包装只写「开封」。
 */
export const PANTRY_PER_KIND = 3;
export function pantryList(lots: KitchenLot[], foods: KitchenFood[], maxRows = 12, perKind = PANTRY_PER_KIND): PantryList | null {
  const names = new Map(foods.map(food => [food.id, food.name]));
  const inPantry = lots.filter(lot => lot.quantity > 0 && lot.storageZone === 'pantry')
    .map(lot => ({ lot, name: names.get(lot.foodId) ?? '食物' }))
    .filter(({ lot, name }) => pantryKindOf(name, lot) !== 'staple')
    .sort((a, b) => b.lot.updatedAt - a.lot.updatedAt || a.lot.id.localeCompare(b.lot.id));
  if (!inPantry.length) return null;
  const groups = (['ready', 'snack', 'drink'] as const)
    .map(kind => ({ kind, items: inPantry.filter(({ lot, name }) => pantryKindOf(name, lot) === kind) }))
    .filter(group => group.items.length);
  // 段名各占一行，剩下的名额三段轮流分（至少每段一样）
  const take = groups.map(() => 0);
  let budget = Math.max(groups.length, maxRows - groups.length);
  for (let progressed = true; budget > 0 && progressed;) {
    progressed = false;
    groups.forEach((group, i) => {
      if (budget > 0 && take[i] < Math.min(perKind, group.items.length)) { take[i] += 1; budget -= 1; progressed = true; }
    });
  }
  const rows: PantryRow[] = [], lines: PantryLine[] = [];
  groups.forEach((group, i) => {
    rows.push({ head: PANTRY_KIND_LABELS[group.kind], count: group.items.length });
    for (const { lot, name } of group.items.slice(0, take[i])) {
      const line = {
        lotId: lot.id,
        text: name,
        amount: lot.trackingMode === 'divisible' && lot.openContainerRemaining !== undefined && lot.quantity <= 1
          ? '开封' : formatQuantity(lot.quantity, lot.unit),
      };
      rows.push({ line }); lines.push(line);
    }
  });
  return { lines, rows, more: inPantry.length - lines.length };
}
