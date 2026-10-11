/**
 * 冰箱里每样东西长什么样、门上的纸写什么（APP_CONVENTIONS P14）。
 *
 * 只读投影：外观由名字和批次状态推出来，不写进库存；猜错了也只是换个容器，数量和位置不受影响。
 * 不逐个建模：包装食品用几种通用容器 + 现写的标签；剩菜和认不出的东西进保鲜盒、盖上贴手写胶带；
 * 散装蔬果放进磨砂抽屉，只显示色块。
 */
import type { KitchenEvent, KitchenFood, KitchenLot } from './kitchenDb';
import { formatEventAmount } from './kitchenPresentation';

export type KitchenLook = 'carton' | 'eggs' | 'bottle' | 'jar' | 'box' | 'produce' | 'tray' | 'bag';

const EGGS = /鸡蛋|鸭蛋|鹌鹑蛋|咸蛋|皮蛋|\beggs?\b/i;
const CARTON = /牛奶|酸奶|奶油|果汁|橙汁|苹果汁|豆浆|豆奶|燕麦奶|椰奶|\b(milk|juice|yogh?urt|cream)\b/i;
const BOTTLE = /矿泉水|苏打水|气泡水|可乐|雪碧|汽水|啤酒|饮料|茶饮|\b(water|soda|cola|beer|sprite)\b/i;
const JAR = /酱|蜂蜜|泡菜|腐乳|榨菜|咸菜|黄油|芝士|奶酪|\b(jam|sauce|kimchi|honey|mayo|butter|cheese|pickles?)\b/i;
/** 做好的菜：名字里带做法，就算含「番茄」「牛」也不是生食材（番茄炖牛腩、葱油拌面） */
const DISH = /炖|炒|烧|焖|卤|煮|蒸|煎|炸|烤|拌|汤|粥|饭|面条|拌面|炒面|饺子|包子|馄饨|便当|剩菜|咖喱|沙拉|三明治|\b(stew|soup|curry|leftovers?|salad|sandwich|noodles?|dumplings?)\b/i;
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

export const produceTint = (name: string): string | null => PRODUCE.find(([pattern]) => pattern.test(name))?.[1] ?? null;

export function kitchenLookFor(name: string, lot: Pick<KitchenLot, 'foodState' | 'storageZone' | 'unit'>): KitchenLook {
  // 做好的、吃剩的：不管原来是什么，都装在保鲜盒里
  if (lot.foodState === 'leftover' || lot.foodState === 'prepared') return 'box';
  if (DISH.test(name)) return lot.storageZone === 'freezer' ? 'bag' : 'box';
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

/**
 * 便利贴：最要紧的三件事。先是过期 / 快过期（两天内），再是快用完。
 * 只看真的放在冰箱、冷冻和柜子里的；待收纳的还没放好，不提醒。
 */
export function stickyReminders(lots: KitchenLot[], foods: KitchenFood[], events: KitchenEvent[] = [], now = Date.now(), limit = 3): DoorNoteLine[] {
  const names = new Map(foods.map(food => [food.id, food.name]));
  // 「只剩一个」只对买的时候不止一个的提醒：本来就只买了一颗西兰花，不用天天提醒它只剩一个
  const boughtMany = new Set(events.filter(event => event.type === 'ADD' && !event.undoneAt && event.quantityAfter > 1).map(event => event.lotId));
  const today = startOfDay(now);
  const notes: { rank: number; line: DoorNoteLine }[] = [];
  for (const lot of lots) {
    if (lot.quantity <= 0 || lot.storageZone === 'staging') continue;
    const name = names.get(lot.foodId);
    if (!name) continue;
    if (lot.expiresAt) {
      const due = new Date(`${lot.expiresAt.slice(0, 10)}T00:00:00`).getTime();
      if (Number.isFinite(due)) {
        const days = Math.round((due - today) / DAY);
        if (days < 0) { notes.push({ rank: days, line: { lotId: lot.id, text: `${name}过期了` } }); continue; }
        if (days <= 2) { notes.push({ rank: days, line: { lotId: lot.id, text: `${name}${['今天', '明天', '后天'][days]}到期` } }); continue; }
      }
    }
    const lowOpened = lot.trackingMode === 'divisible' && lot.quantity <= 1
      && lot.openContainerRemaining !== undefined && lot.openContainerRemaining <= 0.25;
    const lastOne = lot.trackingMode !== 'divisible' && lot.quantity === 1 && lot.unit === 'piece' && boughtMany.has(lot.id);
    if (lowOpened || lastOne) notes.push({ rank: 10, line: { lotId: lot.id, text: lastOne ? `${name}只剩一个` : `${name}快用完了` } });
  }
  return notes.sort((a, b) => a.rank - b.rank).slice(0, limit).map(note => note.line);
}

export interface DoorReceipt { day: number; items: { name: string; amount: string; lotId: string }[] }

/**
 * 小票：最近一次「放进食物」的那一天，那天放进来的几样。撤销掉的不算。
 * 以后拍小票入库，就是这张小票反过来用。
 */
export function latestReceipt(events: KitchenEvent[], foods: KitchenFood[], limit = 8): DoorReceipt | null {
  const names = new Map(foods.map(food => [food.id, food.name]));
  const adds = events.filter(event => event.type === 'ADD' && !event.undoneAt && event.quantityDelta > 0);
  if (!adds.length) return null;
  const last = Math.max(...adds.map(event => event.occurredAt));
  const day = startOfDay(last);
  const items = adds
    .filter(event => event.occurredAt >= day && event.occurredAt < day + DAY)
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .map(event => ({ name: names.get(event.foodId) ?? '食物', amount: formatEventAmount(event), lotId: event.lotId }));
  return { day, items: items.slice(0, limit) };
}
