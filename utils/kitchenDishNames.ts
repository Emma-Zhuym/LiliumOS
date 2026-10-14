/**
 * 按名字猜「这是不是做好的菜」——只用来给放进表单预先打勾、给旧数据补标记（DB v4 迁移）。
 * 认定以批次上存的 foodState 为准，不再每次按名字猜（2026-10-14 重审：沙拉酱、咖喱块、面条被当成菜）。
 * 带「酱 / 块 / 粉 / 料」结尾的是调料、半成品原料，不算菜。
 */
const DISH = /炖|炒|烧|焖|卤|煮|蒸|煎|炸|烤|拌|汤|粥|米饭|炒饭|盖饭|拌面|炒面|汤面|便当|剩菜|咖喱|沙拉|三明治|\b(stew|soup|curry|leftovers?|salad|sandwich)\b/i;
const NOT_DISH = /(酱|块|粉|料|底料|调料|汤圆|汤包)$|^(速冻|冷冻)/;

export const looksLikeDish = (name: string): boolean => DISH.test(name) && !NOT_DISH.test(name.trim());
