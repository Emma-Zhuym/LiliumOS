/**
 * ShoppingApp.tsx — 角色扮演购物模块「投喂站」
 *
 * 8 屏：商城首页 / 网购列表 / 外卖列表 / 购物车 / 确认下单 / 订单列表 / 订单详情 / 新增商品
 * 双业务线配色：网购=Teal / 外卖=Amber
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CaretLeft, CaretRight, CaretDown, Plus, Minus, House, Package, CheckCircle, ShoppingCart, Clock, PencilSimple, Trash } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { ShoppingDB, type ShopProduct, type CartItem, type ShopOrder } from '../utils/shoppingDb';
import { sweepFoodDeliveries } from '../utils/shoppingDeliverySweep';
import { DB } from '../utils/db';
import { F, S, R, HUE, STATUS } from '../utils/clayTokens';

type Screen = 'home' | 'net' | 'food' | 'cart' | 'checkout' | 'orders' | 'detail' | 'add';

const TEAL = HUE.teal;
const AMBER = HUE.amber;
const pal = (type: 'net' | 'food') => type === 'food' ? AMBER : TEAL;

const CAT_PATHS: Record<string, string[]> = {
  drink: ['m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8', 'M5 8h14', 'M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0', 'm12 8 1-6h2'],
  dessert: ['M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8', 'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1', 'M2 21h20', 'M7 8v2M12 8v2M17 8v2'],
  meal: ['M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 3 0 0 0-5 5v6c0 1.1.9 2 2 2h3z', 'M18 15v7'],
  toy: ['M20 12v10H4V12', 'M2 7h20v5H2z', 'M12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'],
  flower: ['M12 7.5a4.5 4.5 0 1 1 4.5 4.5', 'M12 7.5A4.5 4.5 0 1 0 7.5 12', 'M12 7.5V9', 'M7.5 12a4.5 4.5 0 1 0 4.5 4.5', 'M7.5 12H9', 'M16.5 12a4.5 4.5 0 1 1-4.5 4.5', 'M16.5 12H15', 'M12 16.5V15', 'M12 12h.01'],
  jewelry: ['M6 3h12l4 6-10 13L2 9z', 'M11 3 8 9l4 13 4-13-3-6', 'M2 9h20'],
  snack: ['M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5', 'M8.5 8.5v.01', 'M16 15.5v.01', 'M12 12v.01', 'M11 17v.01', 'M7 14v.01'],
  digital: ['M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', 'M11 19h2'],
  beauty: ['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  other: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
};

const ALL_CATS: [string, string][] = [
  ['drink', '饮料'], ['dessert', '甜点'], ['meal', '正餐'], ['toy', '玩偶'], ['flower', '花束'],
  ['jewelry', '首饰'], ['snack', '零食'], ['digital', '数码'], ['beauty', '美妆'], ['book', '书'], ['other', '其他'],
];

const CatIcon: React.FC<{ cat: string; color: string; size: number }> = ({ cat, color, size }) => {
  const paths = CAT_PATHS[cat] || CAT_PATHS.other;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
};

const mono = (s: string) => s?.trim()[0] || '?';

const CharAvatar: React.FC<{ name: string; avatar?: string; size: number; bg?: string }> = ({ name, avatar, size, bg }) => {
  if (avatar) {
    return <img src={avatar} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return (
    <div className="flex items-center justify-center shrink-0" style={{ width: size, height: size, borderRadius: '50%', background: bg || F.surfaceSunken, fontSize: size * 0.38, fontWeight: 700, color: F.textTertiary }}>
      {mono(name)}
    </div>
  );
};
const yuan = (n: number) => '¥' + (Math.round(n * 100) / 100).toString().replace(/\.00$/, '');

// ── Shared UI Components ──

const IconBtn: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button onClick={onClick} className="flex items-center justify-center active:translate-y-[1px] transition-transform"
    style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
    {children}
  </button>
);

const SunkenBox: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={className} style={{ padding: 5, borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken, display: 'flex', gap: 5 }}>
    {children}
  </div>
);

const SegBtn: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button onClick={onClick} className="flex-1 flex items-center justify-center transition-all"
    style={{
      height: 40, borderRadius: R.medium, fontSize: 14, fontWeight: active ? 600 : 500, cursor: 'pointer',
      background: active ? F.surfaceRaised : 'transparent', color: active ? F.textPrimary : F.textSecondary,
      boxShadow: active ? S.raisedSoft : 'none',
    }}>
    {label}
  </button>
);

const InputField: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input {...props} className="w-full outline-none transition-all"
    style={{ height: 52, padding: '0 18px', borderRadius: R.input, background: F.surfaceSunken, boxShadow: S.sunken,
      border: '1px solid transparent', fontSize: 15, color: F.textPrimary, fontFamily: 'inherit' }}
    onFocus={e => { e.target.style.borderColor = F.accent; e.target.style.background = F.appBg; e.target.style.boxShadow = S.raisedSoft; }}
    onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = F.surfaceSunken; e.target.style.boxShadow = S.sunken; }} />
);

const AddBtn: React.FC<{ onClick: () => void; color: string }> = ({ onClick, color }) => (
  <button onClick={onClick} className="flex items-center justify-center shrink-0 active:scale-90 transition-transform"
    style={{ width: 30, height: 30, borderRadius: R.small, background: color, boxShadow: S.raisedSoft }}>
    <Plus size={16} weight="bold" color={F.surfaceRaised} />
  </button>
);

const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex flex-col items-center justify-center gap-3" style={{ padding: '60px 0', borderRadius: R.smallCard, background: F.surfaceSunken, boxShadow: S.sunken }}>
    {icon}
    <span style={{ fontSize: 14, color: F.textTertiary }}>{text}</span>
  </div>
);

// ── Main App ──

const ShoppingApp: React.FC = () => {
  const { closeApp, characters } = useOS();
  const [screen, setScreen] = useState<Screen>('home');
  const screenStack = React.useRef<Screen[]>(['home']);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [ordersTab, setOrdersTab] = useState<'active' | 'done'>('active');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [receiver, setReceiver] = useState('');
  const [receiverCharId, setReceiverCharId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [toast, setToast] = useState('');
  const [customEtaMin, setCustomEtaMin] = useState<number | null>(null);
  const [showEtaPicker, setShowEtaPicker] = useState(false);
  const [isGiftFromChar, setIsGiftFromChar] = useState(false);

  // add/edit form
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set());
  const [fName, setFName] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fNote, setFNote] = useState('');
  const [fType, setFType] = useState<'net' | 'food'>('food');
  const [fCat, setFCat] = useState('drink');

  const roles = characters.map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));

  const refresh = useCallback(async () => {
    await sweepFoodDeliveries();
    const [p, c, o] = await Promise.all([ShoppingDB.getProducts(), ShoppingDB.getCart(), ShoppingDB.getOrders()]);
    setProducts(p);
    setCart(c);
    setOrders(o.sort((a, b) => b.placedAt - a.placedAt));
  }, []);

  useEffect(() => {
    (async () => {
      await ShoppingDB.init();
      await refresh();
      if (roles.length > 0 && !receiver) { setReceiver(roles[0].name); setReceiverCharId(roles[0].id); }
      setLoading(false);
    })();
  }, [refresh]);

  const go = (s: Screen) => {
    screenStack.current.push(s);
    setScreen(s);
    if (s === 'checkout') { setCustomEtaMin(null); setShowEtaPicker(false); setIsGiftFromChar(false); }
  };
  const back = () => {
    screenStack.current.pop();
    const prev = screenStack.current[screenStack.current.length - 1] || 'home';
    setScreen(prev);
  };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1400);
  };

  const addToCart = async (id: string) => {
    const existing = cart.find(c => c.id === id);
    const item: CartItem = existing ? { id, qty: existing.qty + 1 } : { id, qty: 1 };
    await ShoppingDB.saveCartItem(item);
    await refresh();
    flash('已加入购物车');
  };

  const updateQty = async (id: string, delta: number) => {
    const existing = cart.find(c => c.id === id);
    if (!existing) return;
    const newQty = existing.qty + delta;
    if (newQty <= 0) {
      await ShoppingDB.removeCartItem(id);
    } else {
      await ShoppingDB.saveCartItem({ ...existing, qty: newQty });
    }
    await refresh();
  };

  const composingRef = React.useRef(false);

  const updateCartNote = (id: string, note: string) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, note: note || undefined } : c));
  };

  const flushCartNote = async (id: string, note: string) => {
    const existing = cart.find(c => c.id === id);
    if (existing) await ShoppingDB.saveCartItem({ ...existing, note: note || undefined });
  };

  const placeOrder = async () => {
    if (cart.length === 0) return;
    const firstProduct = products.find(p => p.id === cart[0].id);
    const type = firstProduct?.type || 'net';
    const now = Date.now();
    const defaultMin = type === 'food'
      ? (firstProduct?.shop ? ShoppingDB.getShopEta(firstProduct.shop) : 30)
      : 3 * 24 * 60;
    const etaTimestamp = now + (customEtaMin ?? defaultMin) * 60 * 1000;

    const order: ShopOrder = {
      id: 'o' + now,
      type,
      receiver,
      receiverCharId: receiverCharId || undefined,
      status: 'active',
      note: noteText || (isGiftFromChar ? '' : '记得趁热喝,爱你 ♡'),
      placedAt: now,
      etaTimestamp,
      lines: cart.map(c => ({ id: c.id, qty: c.qty, ...(c.note ? { note: c.note } : {}) })),
      ...(isGiftFromChar ? { isGiftFromChar: true } : {}),
    };
    await ShoppingDB.saveOrder(order);
    await ShoppingDB.clearCart();
    setNoteText('');
    setCurrentOrderId(order.id);
    await refresh();
    screenStack.current = ['home', 'orders'];
    setScreen('orders');
    setOrdersTab('active');
    flash(isGiftFromChar ? `已下单 · ${receiver} 送的礼物` : '已下单 · 送给 ' + receiver);
  };

  const saveProduct = async () => {
    if (!fName || !fPrice) { flash('请填名称和价格'); return; }
    const isEdit = !!editingProductId;
    const id = editingProductId || ('p' + Date.now());
    const existing = isEdit ? products.find(p => p.id === id) : null;
    const np: ShopProduct = {
      id, name: fName, brand: fBrand, price: parseFloat(fPrice) || 0,
      note: fNote, type: fType, cat: fCat,
      shop: fType === 'food' ? (fBrand || fName) : undefined,
      fav: existing?.fav ?? false,
    };
    await ShoppingDB.saveProduct(np);
    clearForm();
    await refresh();
    back();
    flash(isEdit ? '已保存' : '已加入商城');
  };

  const startEdit = (p: ShopProduct) => {
    setEditingProductId(p.id);
    setFName(p.name); setFBrand(p.brand); setFPrice(String(p.price));
    setFNote(p.note); setFType(p.type); setFCat(p.cat);
    go('add');
  };

  const deleteProduct = async (id: string) => {
    await ShoppingDB.deleteProduct(id);
    await ShoppingDB.removeCartItem(id);
    clearForm();
    await refresh();
    back();
    flash('已删除');
  };

  const clearForm = () => {
    setEditingProductId(null);
    setFName(''); setFBrand(''); setFPrice(''); setFNote('');
  };

  const orderTitle = (o: ShopOrder) => {
    const totalQty = o.lines.reduce((a, l) => a + l.qty, 0);
    const first = products.find(x => x.id === o.lines[0]?.id);
    const name = first?.name || '';
    return totalQty > 1 ? `${name} 等${totalQty}件` : name;
  };

  // derived
  const cartCount = cart.reduce((a, c) => a + c.qty, 0);
  const cartTotal = cart.reduce((a, c) => {
    const p = products.find(x => x.id === c.id);
    return a + (p ? p.price * c.qty : 0);
  }, 0);
  const netProducts = products.filter(p => p.type === 'net');
  const foodItems = products.filter(p => p.type === 'food');
  const shopOrder: string[] = [];
  foodItems.forEach(p => { if (p.shop && !shopOrder.includes(p.shop)) shopOrder.push(p.shop); });
  const foodShops = shopOrder.map(shop => ({
    shop,
    etaText: '约 ' + ShoppingDB.getShopEta(shop) + ' 分钟送达',
    items: foodItems.filter(p => p.shop === shop),
  }));
  const findAvatar = (name: string) => roles.find(r => r.name === name)?.avatar;
  const favProducts = products.filter(p => p.fav).slice(0, 4);
  const activeOrders = orders.filter(o => o.status === 'active');
  const doneOrders = orders.filter(o => o.status === 'done');
  const shownOrders = ordersTab === 'active' ? activeOrders : doneOrders;
  const currentOrder = orders.find(o => o.id === currentOrderId);

  const formatEta = (o: ShopOrder) => {
    if (o.status === 'done') return '已送达';
    if (!o.etaTimestamp) return '配送中';
    const remaining = Math.max(0, o.etaTimestamp - Date.now());
    if (o.type === 'food') {
      const mins = Math.ceil(remaining / 60000);
      return mins > 0 ? `还有 ${mins} 分钟送达` : '即将送达';
    }
    const d = new Date(o.etaTimestamp);
    return `预计 ${d.getMonth() + 1}月${d.getDate()}日 送达`;
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: F.appBg }}>
        <div style={{ fontSize: 14, color: F.textTertiary }}>加载中...</div>
      </div>
    );
  }

  // ── Cart Badge Button ──
  const CartBtn: React.FC = () => (
    <IconBtn onClick={() => go('cart')}>
      <ShoppingCart size={20} weight="bold" color={F.textPrimary} />
      {cartCount > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center" style={{
          minWidth: 18, height: 18, padding: '0 4px', borderRadius: R.pill,
          background: STATUS.danger.main, color: F.surfaceRaised, fontSize: 11, fontWeight: 700, border: `2px solid ${F.surface}`,
        }}>{cartCount}</span>
      )}
    </IconBtn>
  );

  // ── Tab Bar ──
  const TabBar: React.FC = () => (
    <div className="flex gap-1.5 shrink-0" style={{ padding: 8, borderRadius: R.panel, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedMedium }}>
      {[
        { key: 'home' as Screen, label: '商城', icon: House },
        { key: 'orders' as Screen, label: '订单', icon: Package },
      ].map(({ key, label, icon: Icon }) => {
        const active = screen === key;
        return (
          <button key={key} onClick={() => { screenStack.current = ['home', ...(key === 'home' ? [] : [key])]; setScreen(key); }}
            className="flex-1 flex flex-col items-center gap-1 transition-all" style={{
              padding: '8px 0', borderRadius: R.smallCard, cursor: 'pointer',
              background: active ? F.surfaceRaised : 'transparent', boxShadow: active ? S.raisedSoft : 'none',
            }}>
            <Icon size={22} weight="bold" color={active ? F.accent : F.textTertiary} />
            <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? F.accent : F.textTertiary }}>{label}</span>
          </button>
        );
      })}
    </div>
  );

  // ── SCREEN: Home ──
  const renderHome = () => (
    <>
      {/* 网购 / 外卖 入口 */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => go('net')} className="flex flex-col gap-2.5 active:scale-[.98] transition-transform text-left"
          style={{ borderRadius: R.bigCard, background: TEAL.tint, padding: 16, boxShadow: S.raisedSoft }}>
          <div className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.medium, background: TEAL.main, boxShadow: S.raisedSoft }}>
            <ShoppingCart size={24} weight="bold" color={F.surfaceRaised} />
          </div>
          <div><div style={{ fontSize: 16, fontWeight: 600, color: TEAL.ink }}>网购</div><div style={{ fontSize: 12, color: TEAL.ink, opacity: 0.7, marginTop: 2 }}>按日期送达</div></div>
        </button>
        <button onClick={() => go('food')} className="flex flex-col gap-2.5 active:scale-[.98] transition-transform text-left"
          style={{ borderRadius: R.bigCard, background: AMBER.tint, padding: 16, boxShadow: S.raisedSoft }}>
          <div className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.medium, background: AMBER.main, boxShadow: S.raisedSoft }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={F.surfaceRaised} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
              <path d="M3 11h18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M7 15v3M17 15v3" />
            </svg>
          </div>
          <div><div style={{ fontSize: 16, fontWeight: 600, color: AMBER.ink }}>外卖</div><div style={{ fontSize: 12, color: AMBER.ink, opacity: 0.7, marginTop: 2 }}>按时长送达</div></div>
        </button>
      </div>

      {/* 进行中的订单 */}
      {activeOrders.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1 pt-1.5">
            <span style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>进行中的订单</span>
            <button onClick={() => { go('orders'); setOrdersTab('active'); }} style={{ fontSize: 13, color: F.textTertiary }}>查看全部</button>
          </div>
          {activeOrders.slice(0, 2).map(o => {
            const c = pal(o.type);
            const title = orderTitle(o);
            return (
              <button key={o.id} onClick={() => { setCurrentOrderId(o.id); go('detail'); }}
                className="flex items-center gap-3.5 active:scale-[.99] transition-transform text-left"
                style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: '14px 16px', boxShadow: S.raisedSoft }}>
                <div className="shrink-0" style={{ width: 44, height: 44, borderRadius: R.medium, overflow: 'hidden', background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CharAvatar name={o.receiver} avatar={findAvatar(o.receiver)} size={44} bg={c.tint} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{title}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: c.main }}>{formatEta(o)}</div>
                </div>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={F.textTertiary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            );
          })}
        </>
      )}

      {/* 常送给 TA */}
      {favProducts.length > 0 && (
        <>
          <div className="px-1 pt-1.5" style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>常送给 TA</div>
          <div className="grid grid-cols-2 gap-3">
            {favProducts.map(p => {
              const c = pal(p.type);
              return (
                <div key={p.id} style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.large, overflow: 'hidden', boxShadow: S.raisedSoft }}>
                  <div className="flex items-center justify-center" style={{ height: 76, background: c.tint }}>
                    <CatIcon cat={p.cat} color={c.ink} size={34} />
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: F.textTertiary }}>{p.brand}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{p.name}</div>
                    <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>{yuan(p.price)}</span>
                      <AddBtn onClick={() => addToCart(p.id)} color={c.main} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 空态引导 */}
      {products.length === 0 && (
        <EmptyState
          icon={<ShoppingCart size={24} weight="bold" color={F.textTertiary} />}
          text="记下你真会买的东西送给 TA"
        />
      )}
    </>
  );

  // ── SCREEN: Net List ──
  const renderNetList = () => (
    <>
      <div className="grid grid-cols-2 gap-3">
        {netProducts.map(p => (
          <div key={p.id} className="relative" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.large, overflow: 'hidden', boxShadow: S.raisedSoft }}>
            <button onClick={() => startEdit(p)} className="absolute top-2 right-2 flex items-center justify-center active:scale-90 transition-transform"
              style={{ width: 28, height: 28, borderRadius: R.tiny, background: `${F.surface}cc`, backdropFilter: 'blur(4px)' }}>
              <PencilSimple size={14} weight="bold" color={F.textTertiary} />
            </button>
            <div className="flex items-center justify-center" style={{ height: 104, background: TEAL.tint }}>
              <CatIcon cat={p.cat} color={TEAL.ink} size={34} />
            </div>
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: F.textTertiary }}>{p.brand}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{p.name}</div>
              <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: TEAL.ink }}>{yuan(p.price)}</span>
                <AddBtn onClick={() => addToCart(p.id)} color={TEAL.main} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => { clearForm(); setFType('net'); setFCat('toy'); go('add'); }}
        className="flex items-center justify-center gap-2 active:scale-[.99] transition-transform"
        style={{ height: 52, borderRadius: R.smallCard, border: `1.5px dashed ${TEAL.soft}`, background: 'transparent', color: TEAL.ink, fontSize: 15, fontWeight: 600 }}>
        <Plus size={18} weight="bold" />新增网购商品
      </button>
    </>
  );

  // ── SCREEN: Food List (shop grouped, collapsible) ──
  // [EM-START: shopping-scroll]
  const toggleShop = (shop: string) => {
    setExpandedShops(prev => {
      const next = new Set(prev);
      if (next.has(shop)) next.delete(shop); else next.add(shop);
      return next;
    });
  };

  const renderFoodList = () => (
    <>
      {foodShops.map(s => {
        const open = expandedShops.has(s.shop);
        return (
          <div key={s.shop} className="shrink-0" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden', boxShadow: S.raisedSoft }}>
            <button onClick={() => toggleShop(s.shop)} className="flex items-center gap-3 w-full active:scale-[.99] transition-transform" style={{ padding: '14px 16px', cursor: 'pointer', background: 'transparent', textAlign: 'left' }}>
              <div className="flex items-center justify-center shrink-0" style={{ width: 44, height: 44, borderRadius: R.medium, background: AMBER.tint, fontSize: 18, fontWeight: 700, color: AMBER.ink }}>
                {mono(s.shop)}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>{s.shop}</div>
                <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 1 }}>{s.etaText}</div>
              </div>
              <div style={{ fontSize: 12, color: F.textTertiary, marginRight: 2 }}>{s.items.length} 件</div>
              <CaretDown size={16} weight="bold" color={F.textTertiary} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }} />
            </button>
            {open && (<>
              <div
                className="overflow-y-auto"
                style={{
                  maxHeight: 'min(42vh, 320px)',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehaviorY: 'contain',
                  touchAction: 'pan-y',
                }}
              >
                {s.items.map(p => (
                  <React.Fragment key={p.id}>
                    <div style={{ height: 1, background: F.divider, margin: '0 16px' }} />
                    <div className="flex items-center gap-3" style={{ padding: '12px 16px' }}>
                      <button onClick={() => startEdit(p)} className="flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                        style={{ width: 28, height: 28, borderRadius: R.tiny, background: F.surfaceSunken }}>
                        <PencilSimple size={14} weight="bold" color={F.textTertiary} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{p.name}</div>
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: AMBER.ink }}>{yuan(p.price)}</span>
                      <AddBtn onClick={() => addToCart(p.id)} color={AMBER.main} />
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ height: 1, background: F.divider, margin: '0 16px' }} />
              <button onClick={() => { clearForm(); setFType('food'); setFCat('drink'); setFBrand(s.shop); go('add'); }}
                className="flex items-center justify-center gap-1.5 w-full active:scale-[.98] transition-transform"
                style={{ padding: '10px 16px', background: 'transparent', color: AMBER.ink, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <Plus size={14} weight="bold" />添加商品
              </button>
            </>)}
          </div>
        );
      })}
      <button onClick={() => { clearForm(); setFType('food'); setFCat('drink'); go('add'); }}
        className="shrink-0 flex items-center justify-center gap-2 active:scale-[.99] transition-transform"
        style={{ height: 52, borderRadius: R.smallCard, border: `1.5px dashed ${AMBER.soft}`, background: 'transparent', color: AMBER.ink, fontSize: 15, fontWeight: 600 }}>
        <Plus size={18} weight="bold" />新增外卖商品
      </button>
    </>
  );
  // [EM-END: shopping-scroll]

  // ── SCREEN: Cart ──
  const renderCart = () => {
    const cartLines = cart.map(c => {
      const p = products.find(x => x.id === c.id);
      if (!p) return null;
      const cp = pal(p.type);
      return { ...c, p, cp };
    }).filter(Boolean) as { id: string; qty: number; note?: string; p: ShopProduct; cp: typeof TEAL }[];

    return (
      <>
        {cartLines.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={24} weight="bold" color={F.textTertiary} />}
            text="购物车还是空的"
          />
        ) : (
          cartLines.map(c => (
            <div key={c.id} style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.large, padding: '14px 16px', boxShadow: S.raisedSoft }}>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center shrink-0" style={{ width: 46, height: 46, borderRadius: R.medium, background: c.cp.tint }}>
                  <CatIcon cat={c.p.cat} color={c.cp.ink} size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{c.p.name}</div>
                  {c.p.brand && <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 1 }}>{c.p.brand}</div>}
                </div>
                {/* sunken stepper */}
                <div className="flex items-center gap-2" style={{ padding: 4, borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}>
                  <button onClick={() => updateQty(c.id, -1)} className="flex items-center justify-center active:scale-90 transition-transform"
                    style={{ width: 26, height: 26, borderRadius: R.tiny, background: F.surfaceRaised, boxShadow: S.raisedSoft, color: F.textSecondary }}>
                    <Minus size={14} weight="bold" />
                  </button>
                  <span style={{ minWidth: 18, textAlign: 'center', fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{c.qty}</span>
                  <button onClick={() => updateQty(c.id, 1)} className="flex items-center justify-center active:scale-90 transition-transform"
                    style={{ width: 26, height: 26, borderRadius: R.tiny, background: F.surfaceRaised, boxShadow: S.raisedSoft, color: F.textSecondary }}>
                    <Plus size={14} weight="bold" />
                  </button>
                </div>
              </div>
              <input
                value={c.note ?? ''}
                onChange={e => updateCartNote(c.id, e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={e => { composingRef.current = false; flushCartNote(c.id, (e.target as HTMLInputElement).value); }}
                onBlur={e => flushCartNote(c.id, e.target.value)}
                placeholder="备注：三分糖 · 去冰"
                style={{ width: '100%', marginTop: 10, padding: '8px 12px', fontSize: 13, color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.small, border: 'none', boxShadow: S.sunken, outline: 'none' }}
              />
            </div>
          ))
        )}
      </>
    );
  };

  // ── SCREEN: Checkout ──
  const renderCheckout = () => {
    const cartLines = cart.map(c => {
      const p = products.find(x => x.id === c.id);
      if (!p) return null;
      const cp = pal(p.type);
      return { ...c, p, cp };
    }).filter(Boolean) as { id: string; qty: number; note?: string; p: ShopProduct; cp: typeof TEAL }[];

    const firstProduct = cartLines[0]?.p;
    const isFood = firstProduct?.type === 'food';
    const C = isFood ? AMBER : TEAL;
    const defaultEtaMin = isFood && firstProduct?.shop
      ? ShoppingDB.getShopEta(firstProduct.shop) : (isFood ? 30 : 3 * 24 * 60);
    const etaMin = customEtaMin ?? defaultEtaMin;
    const foodOptions = [15, 20, 25, 30, 45, 60];
    const netDayOptions = [1, 2, 3, 5, 7, 14];

    return (
      <>
        {/* 角色选择 */}
        <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>
          {isGiftFromChar ? '谁送的' : '收货角色'}
        </div>
        <div className="flex gap-2.5 overflow-x-auto" style={{ paddingBottom: 4 }}>
          {roles.map(r => {
            const active = receiver === r.name;
            return (
              <button key={r.id} onClick={() => { setReceiver(r.name); setReceiverCharId(r.id); }}
                className="flex flex-col items-center gap-1.5 active:scale-[.98] transition-transform" style={{ cursor: 'pointer' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%', overflow: 'hidden',
                  border: active ? `3px solid ${C.main}` : '3px solid transparent',
                  background: active ? C.main : F.surfaceSunken,
                  boxShadow: active ? S.raisedSoft : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CharAvatar name={r.name} avatar={r.avatar} size={50} bg={active ? C.main : F.surfaceSunken} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: active ? C.ink : F.textTertiary }}>{r.name}</span>
              </button>
            );
          })}
        </div>

        {/* 礼物方向切换 */}
        <button onClick={() => setIsGiftFromChar(v => !v)}
          className="flex items-center gap-3 active:scale-[.99] transition-transform"
          style={{ padding: '12px 16px', borderRadius: R.smallCard, background: isGiftFromChar ? C.tint : F.surface, border: `1px solid ${isGiftFromChar ? C.soft : F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <div style={{
            width: 36, height: 20, borderRadius: R.pill, padding: 2,
            background: isGiftFromChar ? C.main : F.surfaceSunken,
            boxShadow: isGiftFromChar ? S.raisedSoft : S.sunken,
            transition: 'background 0.2s, box-shadow 0.2s',
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', background: F.surfaceRaised, boxShadow: S.raisedSoft,
              transform: isGiftFromChar ? 'translateX(16px)' : 'translateX(0)',
              transition: 'transform 0.2s',
            }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: isGiftFromChar ? C.ink : F.textSecondary }}>
            这是 {receiver} 送给我的
          </span>
        </button>

        {/* 商品 */}
        <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>商品</div>
        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden', boxShadow: S.raisedSoft }}>
          {cartLines.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && <div style={{ height: 1, background: F.divider, margin: '0 16px' }} />}
              <div className="flex items-center gap-3.5" style={{ padding: '14px 16px' }}>
                <div className="flex items-center justify-center shrink-0" style={{ width: 48, height: 48, borderRadius: R.medium, background: c.cp.tint }}>
                  <CatIcon cat={c.p.cat} color={c.cp.ink} size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{c.p.name}</div>
                  {(c.p.brand || c.note) && <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 1 }}>{c.p.brand}{c.note ? ' · ' + c.note : ''}</div>}
                  <div style={{ fontSize: 13, color: c.cp.ink, fontWeight: 600, marginTop: 2 }}>{yuan(c.p.price)}</div>
                </div>
                {/* sunken stepper */}
                <div className="flex items-center gap-2" style={{ padding: 4, borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}>
                  <button onClick={() => updateQty(c.id, -1)} className="flex items-center justify-center active:scale-90 transition-transform"
                    style={{ width: 28, height: 28, borderRadius: R.tiny, background: F.surfaceRaised, boxShadow: S.raisedSoft, color: F.textSecondary }}>
                    <Minus size={14} weight="bold" />
                  </button>
                  <span style={{ minWidth: 16, textAlign: 'center', fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{c.qty}</span>
                  <button onClick={() => updateQty(c.id, 1)} className="flex items-center justify-center active:scale-90 transition-transform"
                    style={{ width: 28, height: 28, borderRadius: R.tiny, background: c.cp.main, boxShadow: S.raisedSoft, color: F.surfaceRaised }}>
                    <Plus size={14} weight="bold" />
                  </button>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* 预计送达 */}
        <div>
          <button onClick={() => setShowEtaPicker(v => !v)} className="flex items-center gap-3 w-full"
            style={{ height: 52, padding: '0 18px', borderRadius: R.input, background: F.surfaceSunken, boxShadow: S.sunken, cursor: 'pointer' }}>
            <Clock size={18} weight="bold" color={F.textTertiary} />
            <span style={{ fontSize: 14, color: F.textSecondary }}>预计送达</span>
            <span className="flex-1" />
            <span style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>
              {isFood ? `约 ${etaMin} 分钟后` : `约 ${Math.round(etaMin / 60 / 24)} 天后`}
            </span>
            <CaretRight size={16} weight="bold" color={F.textTertiary}
              style={{ transform: showEtaPicker ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          {showEtaPicker && (
            <div className="flex flex-wrap gap-2" style={{ marginTop: 10, padding: '0 4px' }}>
              {(isFood ? foodOptions : netDayOptions).map(v => {
                const min = isFood ? v : v * 24 * 60;
                const active = etaMin === min;
                return (
                  <button key={v} onClick={e => { e.stopPropagation(); setCustomEtaMin(min); setShowEtaPicker(false); }}
                    className="active:scale-95 transition-transform"
                    style={{
                      height: 36, padding: '0 16px', borderRadius: R.button, fontSize: 13, fontWeight: 600,
                      background: active ? C.main : F.surfaceRaised,
                      color: active ? F.surfaceRaised : F.textSecondary,
                      boxShadow: S.raisedSoft,
                    }}>
                    {isFood ? `${v} 分钟` : `${v} 天`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 留言 */}
        <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>
          {isGiftFromChar ? `${receiver} 的留言` : '写给 TA 的话'}
        </div>
        <InputField value={noteText} onChange={e => setNoteText(e.target.value)}
          placeholder={isGiftFromChar ? '给你买的，不用谢~' : '记得趁热喝,爱你 ♡'} />
      </>
    );
  };

  // ── SCREEN: Orders ──
  const renderOrders = () => (
    <>
      <SunkenBox>
        <SegBtn label="进行中" active={ordersTab === 'active'} onClick={() => setOrdersTab('active')} />
        <SegBtn label="已完成" active={ordersTab === 'done'} onClick={() => setOrdersTab('done')} />
      </SunkenBox>
      {shownOrders.length === 0 ? (
        <EmptyState icon={<Package size={22} weight="bold" color={F.textTertiary} />} text="这里还没有订单" />
      ) : (
        shownOrders.map(o => {
          const c = pal(o.type);
          const title = orderTitle(o);
          const total = o.lines.reduce((a, l) => { const p = products.find(x => x.id === l.id); return a + (p ? p.price * l.qty : 0); }, 0);
          return (
            <button key={o.id} onClick={() => { setCurrentOrderId(o.id); go('detail'); }}
              className="flex flex-col gap-3 active:scale-[.99] transition-transform text-left"
              style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: 16, boxShadow: S.raisedSoft }}>
              <div className="flex items-center gap-2.5">
                <div className="shrink-0" style={{ width: 36, height: 36, borderRadius: R.small, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.tint }}>
                  <CharAvatar name={o.receiver} avatar={findAvatar(o.receiver)} size={36} bg={c.tint} />
                </div>
                <div className="flex-1"><span style={{ fontSize: 12, color: F.textTertiary }}>{o.type === 'food' ? '外卖' : '网购'} · {o.isGiftFromChar ? `来自 ${o.receiver}` : `送给 ${o.receiver}`}</span></div>
                <span className="shrink-0" style={{
                  padding: '4px 10px', borderRadius: R.pill, fontSize: 12, fontWeight: 600,
                  background: o.status === 'done' ? HUE.gray.tint : c.tint,
                  color: o.status === 'done' ? F.textSecondary : c.ink,
                }}>{o.status === 'done' ? '已完成' : (o.type === 'food' ? '配送中' : '运送中')}</span>
              </div>
              <div className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{title}</div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: F.textSecondary }}>{formatEta(o)}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>{yuan(total)}</span>
              </div>
            </button>
          );
        })
      )}
    </>
  );

  // ── SCREEN: Order Detail ──
  const renderDetail = () => {
    if (!currentOrder) return null;
    const o = currentOrder;
    const c = pal(o.type);
    const total = o.lines.reduce((a, l) => { const p = products.find(x => x.id === l.id); return a + (p ? p.price * l.qty : 0); }, 0);

    return (
      <>
        {/* receiver hero */}
        <div className="flex items-center gap-3" style={{ padding: '14px 16px', borderRadius: R.bigCard, background: c.tint, boxShadow: S.raisedSoft }}>
          <div className="shrink-0" style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', boxShadow: S.raisedSoft }}>
            <CharAvatar name={o.receiver} avatar={findAvatar(o.receiver)} size={48} bg={c.main} />
          </div>
          <div className="flex-1">
            <div style={{ fontSize: 13, opacity: 0.75, color: c.ink }}>{o.isGiftFromChar ? '来自' : '送给'}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: c.ink }}>{o.receiver}</div>
          </div>
          <span style={{ padding: '5px 12px', borderRadius: R.pill, background: F.surface, fontSize: 12, fontWeight: 600, color: c.ink }}>
            {o.status === 'done' ? '已完成' : (o.type === 'food' ? '配送中' : '运送中')}
          </span>
        </div>

        {/* timeline */}
        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: '18px 18px 6px', boxShadow: S.raisedSoft }}>
          {/* placed */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center" style={{ width: 20 }}>
              <span style={{ width: 14, height: 14, borderRadius: R.pill, flexShrink: 0, background: c.main, boxShadow: `0 0 0 3px ${c.tint}` }} />
              <span style={{ flex: 1, width: 2, minHeight: 20, background: c.main }} />
            </div>
            <div className="flex-1 pb-3.5">
              <div style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>已下单</div>
              <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 1 }}>{formatTime(o.placedAt)}</div>
            </div>
          </div>
          {/* mid */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center" style={{ width: 20 }}>
              <span style={{ width: 14, height: 14, borderRadius: R.pill, flexShrink: 0, background: c.main, boxShadow: `0 0 0 3px ${c.tint}` }} />
              <span style={{ flex: 1, width: 2, minHeight: 20, background: o.status === 'done' ? c.main : F.surfaceSunken }} />
            </div>
            <div className="flex-1 pb-3.5">
              <div style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{o.type === 'food' ? '配送中' : '运送中'}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1, color: c.main }}>
                {o.etaTimestamp
                  ? (o.type === 'food'
                    ? `预计 ${new Date(o.etaTimestamp).getHours()}:${String(new Date(o.etaTimestamp).getMinutes()).padStart(2, '0')} 送达`
                    : `预计 ${new Date(o.etaTimestamp).getMonth() + 1}月${new Date(o.etaTimestamp).getDate()}日 送达`)
                  : '配送中'}
              </div>
            </div>
          </div>
          {/* arrive */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center" style={{ width: 20 }}>
              <span style={{ width: 14, height: 14, borderRadius: R.pill, flexShrink: 0,
                background: o.status === 'done' ? c.main : F.surfaceSunken,
                boxShadow: o.status === 'done' ? `0 0 0 3px ${c.tint}` : S.sunken }} />
            </div>
            <div className="flex-1 pb-3">
              <div style={{ fontSize: 14, fontWeight: o.status === 'done' ? 700 : 600, color: o.status === 'done' ? c.ink : F.textTertiary }}>送达</div>
            </div>
          </div>
        </div>

        {/* items */}
        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden', boxShadow: S.raisedSoft }}>
          {o.lines.map((l, i) => {
            const p = products.find(x => x.id === l.id);
            if (!p) return null;
            return (
              <div key={l.id} className="flex items-center gap-3.5" style={{ padding: '12px 16px' }}>
                <div className="flex items-center justify-center shrink-0" style={{ width: 44, height: 44, borderRadius: R.medium, background: c.tint }}>
                  <CatIcon cat={p.cat} color={c.ink} size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 1 }}>{l.note ? l.note + ' · ' : ''}×{l.qty}</div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: c.ink }}>{yuan(p.price * l.qty)}</span>
              </div>
            );
          })}
        </div>

        {/* messages */}
        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: 16, boxShadow: S.raisedSoft }} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={c.main} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>留言</span>
          </div>
          {/* user bubble - right */}
          <div className="flex justify-end">
            <div style={{ maxWidth: '78%', padding: '10px 14px', borderRadius: `${R.medium}px ${R.medium}px 4px ${R.medium}px`, background: c.main, boxShadow: S.raisedSoft }}>
              <span style={{ fontSize: 14, color: F.surfaceRaised, lineHeight: 1.5 }}>{o.note}</span>
            </div>
          </div>
          {/* char reply - left */}
          <div className="flex gap-2.5 items-end">
            <div className="shrink-0" style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden' }}>
              <CharAvatar name={o.receiver} avatar={findAvatar(o.receiver)} size={32} bg={c.tint} />
            </div>
            <div style={{ maxWidth: '78%', padding: '10px 14px', borderRadius: `4px ${R.medium}px ${R.medium}px ${R.medium}px`, background: o.charReply ? c.tint : F.surfaceSunken }}>
              <span style={{ fontSize: 13, color: o.charReply ? c.ink : F.textTertiary, lineHeight: 1.5, fontStyle: o.charReply ? 'normal' : 'italic' }}>
                {o.charReply || `送达后,${o.receiver}的回应会出现在这里…`}
              </span>
            </div>
          </div>
        </div>
      </>
    );
  };

  // ── SCREEN: Add / Edit Product ──
  const renderAdd = () => (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>商品名称</div>
      <InputField value={fName} onChange={e => setFName(e.target.value)} placeholder="草莓蛋糕" />
      <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>店铺 / 品牌</div>
      <InputField value={fBrand} onChange={e => setFBrand(e.target.value)} placeholder="奈雪的茶" />
      <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>价格</div>
      <InputField value={fPrice} onChange={e => setFPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="38" inputMode="numeric" />
      <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>类型</div>
      <SunkenBox>
        <SegBtn label="外卖(按时长)" active={fType === 'food'} onClick={() => setFType('food')} />
        <SegBtn label="网购(按日期)" active={fType === 'net'} onClick={() => setFType('net')} />
      </SunkenBox>
      <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>类目</div>
      <div className="flex flex-wrap gap-2">
        {ALL_CATS.map(([key, label]) => {
          const sel = fCat === key;
          return (
            <button key={key} onClick={() => setFCat(key)} className="inline-flex items-center gap-1.5 transition-all"
              style={{
                height: 34, padding: '0 12px', borderRadius: R.pill, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: sel ? HUE.brown.tint : F.surface, color: sel ? HUE.brown.ink : F.textSecondary,
                border: `1px solid ${sel ? F.accent : F.borderSoft}`,
              }}>
              <CatIcon cat={key} color={sel ? HUE.brown.ink : F.textTertiary} size={16} />
              {label}
            </button>
          );
        })}
      </div>
      {/* save/delete inside scroll area so keyboard doesn't cover them */}
      <div className="flex gap-3" style={{ paddingTop: 8 }}>
        {editingProductId && (
          <button onClick={() => deleteProduct(editingProductId)} className="flex items-center justify-center active:translate-y-[1px] transition-transform"
            style={{ width: 52, height: 52, borderRadius: R.smallCard, background: F.surfaceSunken, boxShadow: S.sunken }}>
            <Trash size={20} weight="bold" color={STATUS.danger.main} />
          </button>
        )}
        <button onClick={saveProduct} className="flex-1 flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ height: 52, borderRadius: R.smallCard, background: F.textPrimary, color: F.surfaceRaised, fontSize: 16, fontWeight: 600, boxShadow: S.raisedMedium }}>
          {editingProductId ? '保存修改' : '加入商城'}
        </button>
      </div>
    </>
  );

  // ── Layout ──
  const showTab = screen === 'home' || screen === 'orders';
  const showCartFooter = screen === 'cart' && cartCount > 0;

  // Screen-specific TopBar config (rendered outside scroll container)
  const topBarConfig: Record<Screen, { title: string; onBack: () => void; right?: React.ReactNode } | null> = {
    home: { title: '投喂站', onBack: closeApp, right: <div className="relative"><CartBtn /></div> },
    net: { title: '网购', onBack: back, right: <div className="relative"><CartBtn /></div> },
    food: { title: '外卖', onBack: back, right: <div className="relative"><CartBtn /></div> },
    cart: { title: '购物车', onBack: back },
    checkout: { title: '确认订单', onBack: back },
    orders: { title: '我的订单', onBack: closeApp },
    detail: { title: '订单详情', onBack: back },
    add: { title: editingProductId ? '编辑商品' : '新增商品', onBack: () => { clearForm(); back(); } },
  };

  return (
    <div className="h-full flex flex-col" style={{ background: F.appBg }}>
      {/* TopBar outside scroll container */}
      {topBarConfig[screen] && (
        <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
          <div className="relative flex items-center justify-between py-3" style={{ minHeight: 44, padding: '0 20px' }}>
            <IconBtn onClick={topBarConfig[screen]!.onBack}>
              <CaretLeft size={20} weight="bold" color={F.textSecondary} />
            </IconBtn>
            <span className="absolute left-0 right-0 flex justify-center font-semibold pointer-events-none" style={{ fontSize: 16, color: F.textPrimary }}>{topBarConfig[screen]!.title}</span>
            {topBarConfig[screen]!.right || <div style={{ width: 44 }} />}
          </div>
        </div>
      )}
      {/* scrollable content */}
      {/* [EM: shopping-page-scroll] */}
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5"
        style={{
          padding: '8px 20px 16px',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          touchAction: 'pan-y',
        }}
      >
        {screen === 'home' && renderHome()}
        {screen === 'net' && renderNetList()}
        {screen === 'food' && renderFoodList()}
        {screen === 'cart' && renderCart()}
        {screen === 'checkout' && renderCheckout()}
        {screen === 'orders' && renderOrders()}
        {screen === 'detail' && renderDetail()}
        {screen === 'add' && renderAdd()}
      </div>

      {/* bottom area */}
      <div className="shrink-0" style={{ padding: '0 20px', paddingBottom: 'calc(18px + var(--safe-bottom))' }}>{/* [EM: safe-bottom] */}
        {showCartFooter && (
          <div className="flex items-center gap-3.5" style={{ padding: '12px 16px', borderRadius: R.bigCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedMedium }}>
            <div className="flex-1">
              <div style={{ fontSize: 13, color: F.textTertiary }}>已选 {cartCount} 件</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: F.textPrimary }}>{yuan(cartTotal)}</div>
            </div>
            <button onClick={() => go('checkout')} className="inline-flex items-center active:translate-y-[1px] transition-transform"
              style={{ height: 44, padding: '0 24px', borderRadius: R.button, background: F.textPrimary, color: F.surfaceRaised, fontSize: 15, fontWeight: 600, boxShadow: S.raisedSoft }}>
              去结算
            </button>
          </div>
        )}
        {screen === 'checkout' && (() => {
          const fp = products.find(p => cart.some(c => c.id === p.id));
          const cc = fp?.type === 'food' ? AMBER : TEAL;
          return (
            <div className="flex items-center gap-3.5">
              <div className="flex-1">
                <span style={{ fontSize: 13, color: F.textTertiary }}>合计</span>
                <div style={{ fontSize: 22, fontWeight: 700, color: cc.ink }}>{yuan(cartTotal)}</div>
              </div>
              <button onClick={placeOrder} className="inline-flex items-center active:translate-y-[1px] transition-transform"
                style={{ height: 52, padding: '0 32px', borderRadius: R.button, background: cc.main, color: F.surfaceRaised, fontSize: 16, fontWeight: 600, boxShadow: S.raisedMedium }}>
                下单
              </button>
            </div>
          );
        })()}
        {screen === 'detail' && currentOrder?.status === 'active' && (
          <button onClick={async () => {
            const o = currentOrder!;
            const orderLines = o.lines.map(l => {
              const p = products.find(x => x.id === l.id);
              return p ? { name: p.name, qty: l.qty, price: p.price } : null;
            }).filter(Boolean) as { name: string; qty: number; price: number }[];
            const items = orderLines.map(l => l.name);
            const total = orderLines.reduce((s, l) => s + l.price * l.qty, 0);
            const typeLabel = o.type === 'food' ? '外卖' : '快递';
            await ShoppingDB.saveOrder({ ...o, status: 'done', awaitingReply: true });
            if (o.receiverCharId) {
              const kind = o.isGiftFromChar ? 'gift_delivered' : 'delivery_arrived';
              await DB.saveMessage({ charId: o.receiverCharId, role: 'user', type: 'interaction', content: `📦`, metadata: { kind, typeLabel, items, receiver: o.receiver, isGiftFromChar: !!o.isGiftFromChar, orderLines, total, orderType: o.type, note: o.note } });
            }
            await refresh();
            flash('已确认收货 ✓');
          }} className="w-full flex items-center justify-center gap-2 active:translate-y-[1px] transition-transform"
            style={{ height: 48, borderRadius: R.button, background: pal(currentOrder.type).main, color: F.surfaceRaised, fontSize: 15, fontWeight: 600, boxShadow: S.raisedMedium }}>
            <CheckCircle size={20} weight="bold" />
            确认收货
          </button>
        )}
        {showTab && <TabBar />}
      </div>

      {/* toast */}
      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20" style={{ bottom: 120, padding: '12px 20px', borderRadius: R.button, background: F.textPrimary, color: F.surfaceRaised, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: S.floating }}>
          {toast}
        </div>
      )}
    </div>
  );
};

export default ShoppingApp;
