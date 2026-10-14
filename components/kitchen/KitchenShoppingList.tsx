import React, { useState } from 'react';
import { Plus, X } from '@phosphor-icons/react';
import type { KitchenShoppingItem } from '../../utils/kitchenDb';

interface Props {
  items: KitchenShoppingItem[];
  /** 快用完的、最近用完又没再买的：点一下加上 */
  suggestions: string[];
  busy: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onClearChecked: () => void;
}

/** 方框 + 手写的勾：打勾时勾一笔画出来（CSS 里按笔画长度走），取消时直接没 */
const Tick: React.FC = () => <svg className="kitchen-shopping-tick" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <path d="M7.2 12.6 L10.6 16 L17.4 7.4" pathLength={1} />
</svg>;

/** 整张要买清单：冷冻门上那张只摆得下六行，这里能加、能删、能清掉划掉的 */
export default function KitchenShoppingList({ items, suggestions, busy, onAdd, onToggle, onRemove, onClearChecked }: Props) {
  const [name, setName] = useState('');
  // 一张单子按写下的先后排，打了勾的留在原地：手写划线才有地方划（换到另一组就成了新的一行，动效播不出来）
  const all = [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const done = all.filter(item => item.checkedAt);
  const row = (item: KitchenShoppingItem) => <li key={item.id} className={item.checkedAt ? 'is-checked' : undefined}>
    <button type="button" className="kitchen-shopping-check" disabled={busy} aria-pressed={!!item.checkedAt}
      aria-label={`${item.checkedAt ? '取消划掉' : '划掉'}：${item.name}`} onClick={() => onToggle(item.id)}>
      <Tick />
      <span className="kitchen-shopping-name">{item.name}</span>
      {item.checkedBy === 'bought' && <small>买回来了</small>}
    </button>
    <button type="button" className="kitchen-icon" disabled={busy} aria-label={`删掉：${item.name}`} onClick={() => onRemove(item.id)}><X size={18} /></button>
  </li>;

  return <div className="kitchen-form">
    <form className="kitchen-shopping-add" onSubmit={event => {
      event.preventDefault();
      void onAdd(name).then(done => { if (done) setName(''); });
    }}>
      <input className="kitchen-field" aria-label="要买什么" placeholder="要买什么？" value={name} maxLength={60} disabled={busy}
        onChange={event => setName(event.target.value)} />
      <button type="submit" className="kitchen-button kitchen-button-primary" disabled={busy || !name.trim()}><Plus size={18} />加上</button>
    </form>
    {suggestions.length > 0 && <div className="kitchen-shopping-suggest">
      <span className="kitchen-shopping-suggest-label">快用完的、刚用完的，点一下加上：</span>
      {suggestions.map(suggestion => <button type="button" key={suggestion} className="kitchen-button" disabled={busy}
        onClick={() => { void onAdd(suggestion); }}><Plus size={14} />{suggestion}</button>)}
    </div>}
    {all.length === 0
      ? <p className="kitchen-empty">还没有要买的。用完一样东西时，也可以在它那页点「加进要买清单」。</p>
      : <ul className="kitchen-shopping-list">{all.map(row)}</ul>}
    {done.length > 0 && <div className="kitchen-actions">
      <span className="kitchen-label">划掉了 {done.length} 样</span>
      <button type="button" className="kitchen-text-button" disabled={busy} onClick={onClearChecked}>清掉划掉的</button>
    </div>}
    <p className="kitchen-note">买回来放进厨房（手动或拍小票）时，名字对得上的会自动划掉。</p>
  </div>;
}
