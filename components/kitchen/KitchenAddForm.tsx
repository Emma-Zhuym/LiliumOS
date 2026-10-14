import React, { useState } from 'react';
import type { AddKitchenLotInput, KitchenStorageZone, KitchenTrackingMode, KitchenUnit } from '../../utils/kitchenDb';
import { STORAGE_UNIT_OPTIONS, UNIT_LABELS, ZONE_LABELS } from '../../utils/kitchenPresentation';
import { looksLikeDish } from '../../utils/kitchenDishNames';

interface Props {
  initialZone: KitchenStorageZone;
  busy: boolean;
  onAdd: (input: AddKitchenLotInput) => Promise<void>;
}

export default function KitchenAddForm({ initialZone, busy, onAdd }: Props) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<KitchenUnit>('item');
  const [zone, setZone] = useState(initialZone);
  const [trackingMode, setTrackingMode] = useState<KitchenTrackingMode>('count');
  const [packageSize, setPackageSize] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  // 「自己做的」：没动过这个勾就跟着名字猜（番茄炖牛腩打上、沙拉酱不打），动过就听人的
  const [homemade, setHomemade] = useState<boolean | null>(null);
  const isHomemade = homemade ?? looksLikeDish(name);

  return <form className="kitchen-form" onSubmit={event => {
    event.preventDefault();
    void onAdd({ name, quantity: Number(quantity), unit, storageZone: zone, trackingMode, packageSize, expiresAt, foodState: isHomemade ? 'prepared' : 'raw' });
  }}>
    <p className="kitchen-note">买回来的，慢慢放好。</p>
    <label className="kitchen-label">是什么食物？
      <input className="kitchen-field" aria-label="食物名称" placeholder="例如：鸡蛋、牛奶" value={name}
        required maxLength={120} onChange={event => setName(event.target.value)} disabled={busy} />
    </label>
    <label className="kitchen-check-line">
      <input type="checkbox" aria-label="自己做的菜" checked={isHomemade} disabled={busy} onChange={event => setHomemade(event.target.checked)} />
      <span>自己做的菜 / 剩菜<small className="kitchen-label-hint">不算买回来的</small></span>
    </label>
    <div className="kitchen-form-row">
      <label className="kitchen-label">有多少
        <input className="kitchen-field" aria-label="数量" type="number" inputMode="decimal" min="0.001" step="any"
          required value={quantity} onChange={event => setQuantity(event.target.value)} disabled={busy} />
      </label>
      <label className="kitchen-label">单位
        <select className="kitchen-field" aria-label="单位" value={unit} disabled={busy} onChange={event => {
          const next = event.target.value as KitchenUnit;
          setUnit(next);
        }}>{STORAGE_UNIT_OPTIONS.map(value => <option key={value} value={value}>{UNIT_LABELS[value]}</option>)}</select>
      </label>
    </div>
    <label className="kitchen-label">放在哪里
      <select className="kitchen-field" aria-label="收纳位置" value={zone} disabled={busy}
        onChange={event => setZone(event.target.value as KitchenStorageZone)}>
        {Object.entries(ZONE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <details className="kitchen-form-details">
      <summary>包装与用量 <span>选填</span></summary>
      <label className="kitchen-label">平时怎么用
        <select className="kitchen-field" aria-label="用量记录方式" value={trackingMode} disabled={busy}
          onChange={event => setTrackingMode(event.target.value as KitchenTrackingMode)}>
          <option value="count">一整件一整件用 · 如鸡蛋</option>
          <option value="divisible">一件分几次用 · 如牛奶、牛肉</option>
        </select>
      </label>
      <label className="kitchen-label">每件包装的规格
        <input className="kitchen-field" aria-label="包装规格" value={packageSize} disabled={busy}
          placeholder="照小票写，例如 1 gal、18 ct、12 oz" onChange={event => setPackageSize(event.target.value)} />
      </label>
      <p className="kitchen-note">不称也没关系。填了规格，以后就能直接记“约剩 700 ml”。</p>
      <label className="kitchen-label">保质期到哪天
        <input className="kitchen-field" aria-label="保质期" type="date" value={expiresAt} disabled={busy}
          onChange={event => setExpiresAt(event.target.value)} />
      </label>
    </details>
    <button type="submit" className="kitchen-button kitchen-button-primary" disabled={busy || !name.trim() || !quantity.trim()}>
      {busy ? '正在放好…' : '放进厨房'}
    </button>
  </form>;
}
