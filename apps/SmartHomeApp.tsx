import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  CaretLeft,
  ChatCircleDots,
  CheckCircle,
  Gear,
  House,
  Lamp,
  Lightbulb,
  Moon,
  Plus,
  Power,
  Sparkle,
  WarningCircle,
  Wind,
  X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { F, HUE, MOTION, R, S, SP, STATUS } from '../utils/clayTokens';
import {
  createDemoSmartHomeDevices,
  enableHomeAssistantMcp,
  fetchSmartHomeDevices,
  loadSmartHomeConfig,
  saveSmartHomeConfig,
  sendSmartHomeCommand,
  testHomeAssistantConnection,
  type SmartHomeCommand,
  type SmartHomeConfig,
  type SmartHomeDevice,
} from '../utils/smartHome';

type MainTab = 'devices' | 'scenes';
type Screen = 'main' | 'settings';

const PRODUCT = HUE.cyan;
const SECONDARY = HUE.amber;

const IconButton: React.FC<{
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}> = ({ onClick, label, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="flex shrink-0 items-center justify-center active:translate-y-[1px] transition-transform"
    style={{
      width: 44,
      height: 44,
      borderRadius: R.pill,
      background: F.surfaceRaised,
      border: `1px solid ${F.borderSoft}`,
      boxShadow: S.raisedSoft,
      transitionDuration: MOTION.tap,
    }}
  >
    {children}
  </button>
);

const BackButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <IconButton onClick={onClick} label="返回">
    <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
  </IconButton>
);

const TopBar: React.FC<{
  title: string;
  onBack: () => void;
  action?: React.ReactNode;
}> = ({ title, onBack, action }) => (
  <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
    <div className="relative flex items-center px-5 py-3">
      <BackButton onClick={onBack} />
      <span
        className="pointer-events-none absolute left-0 right-0 flex justify-center text-[16px] font-semibold"
        style={{ color: F.textPrimary }}
      >
        {title}
      </span>
      {action ? <div className="ml-auto flex gap-2">{action}</div> : null}
    </div>
  </div>
);

const Toggle: React.FC<{ checked: boolean; disabled?: boolean; onChange: () => void; label: string }> = ({
  checked,
  disabled,
  onChange,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={event => {
      event.stopPropagation();
      onChange();
    }}
    className="relative shrink-0 disabled:opacity-50"
    style={{
      width: 48,
      height: 28,
      borderRadius: R.pill,
      background: checked ? PRODUCT.main : F.surfaceSunken,
      boxShadow: S.sunken,
      transition: `background ${MOTION.hover} ${MOTION.ease}`,
    }}
  >
    <span
      className="absolute top-1 flex items-center justify-center"
      style={{
        width: 20,
        height: 20,
        left: checked ? 24 : 4,
        borderRadius: R.pill,
        background: F.surfaceRaised,
        boxShadow: S.raisedSoft,
        transition: `left ${MOTION.card} ${MOTION.ease}`,
      }}
    />
  </button>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-[18px] font-semibold" style={{ color: F.textPrimary }}>
    {children}
  </h2>
);

const deviceSummary = (device: SmartHomeDevice): string => {
  if (!device.available) return '不可用';
  if (device.kind === 'light') {
    if (device.state !== 'on') return '已关闭';
    return device.brightness === undefined ? '已开启' : `亮度 ${device.brightness}%`;
  }
  if (device.kind === 'fan') {
    if (device.state !== 'on') return '已关闭';
    if (device.presetMode === 'sleep') return '睡眠模式';
    return device.percentage === undefined ? '运行中' : `风速 ${device.percentage}%`;
  }
  return '轻触运行';
};

const DeviceIcon: React.FC<{ device: SmartHomeDevice }> = ({ device }) => {
  if (device.kind === 'fan') return <Wind size={22} weight="bold" color={F.surfaceRaised} />;
  if (device.kind === 'scene') return <Sparkle size={22} weight="bold" color={F.surfaceRaised} />;
  return <Lightbulb size={22} weight="bold" color={F.surfaceRaised} />;
};

const DeviceRow: React.FC<{
  device: SmartHomeDevice;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}> = ({ device, busy, onOpen, onToggle }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    }}
    className="flex w-full items-center gap-3 text-left active:translate-y-[1px] transition-transform"
    style={{
      minHeight: 72,
      padding: SP[3],
      color: F.textPrimary,
      transitionDuration: MOTION.tap,
    }}
  >
    <span
      className="flex shrink-0 items-center justify-center"
      style={{ width: 44, height: 44, borderRadius: R.small, background: PRODUCT.main }}
    >
      <DeviceIcon device={device} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] font-semibold">{device.name}</span>
      <span className="mt-1 block text-[13px]" style={{ color: device.available ? F.textTertiary : STATUS.warning.ink }}>
        {busy ? '正在同步' : deviceSummary(device)}
      </span>
    </span>
    <Toggle
      checked={device.state === 'on'}
      disabled={!device.available || busy}
      label={`${device.name}${device.state === 'on' ? '关闭' : '开启'}`}
      onChange={onToggle}
    />
  </div>
);

const DeviceList: React.FC<{
  devices: SmartHomeDevice[];
  busyIds: Set<string>;
  onOpen: (device: SmartHomeDevice) => void;
  onToggle: (device: SmartHomeDevice) => void;
}> = ({ devices, busyIds, onOpen, onToggle }) => (
  <div
    className="overflow-hidden"
    style={{ borderRadius: R.bigCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}
  >
    {devices.map((device, index) => (
      <React.Fragment key={device.entityId}>
        {index > 0 ? <div style={{ height: 1, marginLeft: 72, background: F.divider }} /> : null}
        <DeviceRow
          device={device}
          busy={busyIds.has(device.entityId)}
          onOpen={() => onOpen(device)}
          onToggle={() => onToggle(device)}
        />
      </React.Fragment>
    ))}
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="flex flex-col items-center justify-center gap-3 text-center"
    style={{ minHeight: 144, padding: SP[4], borderRadius: R.smallCard, background: F.surfaceSunken, boxShadow: S.sunken }}
  >
    <House size={22} weight="bold" style={{ color: F.textTertiary }} />
    <span className="text-[13px]" style={{ color: F.textTertiary }}>{text}</span>
  </div>
);

const Segmented: React.FC<{
  options: { label: string; value: string | number }[];
  value?: string | number;
  onChange: (value: string | number) => void;
}> = ({ options, value, onChange }) => (
  <div className="flex" style={{ padding: SP[0], gap: SP[0], borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
    {options.map(option => {
      const active = option.value === value;
      return (
        <button
          type="button"
          key={String(option.value)}
          onClick={() => onChange(option.value)}
          className="flex-1 whitespace-nowrap text-[13px] transition-transform active:translate-y-[1px]"
          style={{
            height: 40,
            borderRadius: R.medium,
            background: active ? F.surfaceRaised : 'transparent',
            color: active ? F.textPrimary : F.textSecondary,
            boxShadow: active ? S.raisedSoft : 'none',
            fontWeight: active ? 600 : 400,
            transitionDuration: MOTION.tap,
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const RangeControl: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  valueText: string;
  startLabel: string;
  endLabel: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}> = ({ label, value, min, max, step, disabled, valueText, startLabel, endLabel, onChange, onCommit }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] font-semibold" style={{ color: F.textSecondary }}>{label}</span>
      <span className="text-[13px] font-semibold tabular-nums" style={{ color: PRODUCT.ink }}>{valueText}</span>
    </div>
    <div style={{ padding: `${SP[2]}px ${SP[3]}px`, borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={event => onChange(Number(event.currentTarget.value))}
        onPointerUp={event => onCommit(Number(event.currentTarget.value))}
        onKeyUp={event => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            onCommit(Number(event.currentTarget.value));
          }
        }}
        className="block w-full disabled:opacity-50"
        style={{ height: 28, accentColor: PRODUCT.main }}
      />
      <div className="mt-1 flex justify-between text-[11px]" style={{ color: F.textTertiary }}>
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  </div>
);

const ControlSheet: React.FC<{
  device: SmartHomeDevice;
  busy: boolean;
  onClose: () => void;
  onCommand: (command: SmartHomeCommand) => void;
}> = ({ device, busy, onClose, onCommand }) => {
  const on = device.state === 'on';
  const minColorTemp = device.minColorTempKelvin || 2000;
  const maxColorTemp = device.maxColorTempKelvin || 6500;
  const [brightnessDraft, setBrightnessDraft] = useState(device.brightness ?? 100);
  const [colorTempDraft, setColorTempDraft] = useState(device.colorTempKelvin ?? minColorTemp);
  const presetOptions = (device.presetModes || []).slice(0, 4).map(mode => ({
    label: mode === 'sleep' ? '睡眠' : mode === 'auto' ? '自动' : mode === 'manual' ? '手动' : mode,
    value: mode,
  }));

  useEffect(() => {
    setBrightnessDraft(device.brightness ?? 100);
    setColorTempDraft(device.colorTempKelvin ?? minColorTemp);
  }, [device.entityId, device.brightness, device.colorTempKelvin, minColorTemp]);

  return (
    <div className="absolute inset-0 flex items-end" style={{ background: 'rgba(46,42,40,.35)' }} onClick={onClose}>
      <div
        className="w-full animate-slide-up"
        style={{
          padding: `${SP[2]}px ${SP[4]}px calc(var(--safe-bottom) + ${SP[4]}px)`,
          borderRadius: `${R.sheet}px ${R.sheet}px 0 0`,
          background: F.surface,
          boxShadow: S.floating,
        }}
        onClick={event => event.stopPropagation()}
      >
        <div className="mx-auto mb-3" style={{ width: 36, height: 4, borderRadius: R.pill, background: F.borderStrong }} />
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.small, background: PRODUCT.main }}>
            <DeviceIcon device={device} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold" style={{ color: F.textPrimary }}>{device.name}</h2>
            <p className="text-[13px]" style={{ color: F.textTertiary }}>{deviceSummary(device)}</p>
          </div>
          <IconButton onClick={onClose} label="关闭">
            <X size={20} weight="bold" style={{ color: F.textSecondary }} />
          </IconButton>
        </div>

        <div className="mt-6 flex flex-col gap-5">
          {device.kind === 'light' ? (
            <>
              <RangeControl
                label="亮度"
                value={brightnessDraft}
                min={1}
                max={100}
                step={1}
                disabled={busy || !device.available}
                valueText={`${brightnessDraft}%`}
                startLabel="暗"
                endLabel="亮"
                onChange={setBrightnessDraft}
                onCommit={value => onCommand({ entityId: device.entityId, kind: 'light', action: 'set_brightness', value })}
              />
              {device.minColorTempKelvin && device.maxColorTempKelvin ? (
                <RangeControl
                  label="色温"
                  value={colorTempDraft}
                  min={minColorTemp}
                  max={maxColorTemp}
                  step={50}
                  disabled={busy || !device.available}
                  valueText={`${colorTempDraft} K`}
                  startLabel="暖"
                  endLabel="冷"
                  onChange={setColorTempDraft}
                  onCommit={value => onCommand({ entityId: device.entityId, kind: 'light', action: 'set_color_temp', value })}
                />
              ) : null}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold" style={{ color: F.textSecondary }}>风速</span>
                <Segmented
                  value={device.percentage}
                  options={[
                    { label: '低', value: 33 },
                    { label: '中', value: 66 },
                    { label: '高', value: 100 },
                  ]}
                  onChange={value => onCommand({ entityId: device.entityId, kind: 'fan', action: 'set_percentage', value })}
                />
              </div>
              {presetOptions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: F.textSecondary }}>模式</span>
                  <Segmented
                    value={device.presetMode}
                    options={presetOptions}
                    onChange={value => onCommand({ entityId: device.entityId, kind: 'fan', action: 'set_preset', value })}
                  />
                </div>
              ) : null}
            </>
          )}
          <button
            type="button"
            disabled={busy || !device.available}
            onClick={() => onCommand({ entityId: device.entityId, kind: device.kind, action: on ? 'turn_off' : 'turn_on' })}
            className="flex w-full items-center justify-center gap-2 text-[15px] font-semibold active:translate-y-[1px] disabled:opacity-50"
            style={{
              height: 48,
              borderRadius: R.button,
              background: on ? F.textPrimary : PRODUCT.main,
              color: F.surface,
              boxShadow: S.raisedSoft,
            }}
          >
            <Power size={20} weight="bold" />
            {busy ? '正在同步' : on ? '关闭设备' : '开启设备'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AddSheet: React.FC<{
  target: MainTab;
  connected: boolean;
  loading: boolean;
  onClose: () => void;
  onAction: () => void;
}> = ({ target, connected, loading, onClose, onAction }) => {
  const isDevices = target === 'devices';
  return (
    <div className="absolute inset-0 flex items-end" style={{ background: 'rgba(46,42,40,.35)' }} onClick={onClose}>
      <div
        className="w-full animate-slide-up"
        style={{ padding: `${SP[2]}px ${SP[4]}px calc(var(--safe-bottom) + ${SP[4]}px)`, borderRadius: `${R.sheet}px ${R.sheet}px 0 0`, background: F.surface, boxShadow: S.floating }}
        onClick={event => event.stopPropagation()}
      >
        <div className="mx-auto mb-3" style={{ width: 36, height: 4, borderRadius: R.pill, background: F.borderStrong }} />
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.small, background: PRODUCT.main }}>
            {isDevices ? <Lamp size={22} weight="bold" color={F.surfaceRaised} /> : <Sparkle size={22} weight="bold" color={F.surfaceRaised} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold">添加{isDevices ? '设备' : '场景'}</h2>
            <p className="mt-1 text-[13px]" style={{ color: F.textTertiary }}>由 Home Assistant 统一管理</p>
          </div>
          <IconButton onClick={onClose} label="关闭">
            <X size={20} weight="bold" style={{ color: F.textSecondary }} />
          </IconButton>
        </div>
        <p className="mt-5 text-[14px] leading-6" style={{ color: F.textSecondary }}>
          {isDevices
            ? '先在 Home Assistant 完成设备配网，再回到这里同步。这样 LiliumOS 和角色控制会使用同一份设备清单。'
            : '场景在 Home Assistant 中创建并保存，回到这里同步后，LiliumOS 和角色都能运行同一场景。'}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={onAction}
          className="mt-5 flex w-full items-center justify-center gap-2 text-[15px] font-semibold active:translate-y-[1px] disabled:opacity-50"
          style={{ height: 48, borderRadius: R.button, background: PRODUCT.main, color: F.surface, boxShadow: S.raisedSoft }}
        >
          {connected ? <ArrowsClockwise size={20} weight="bold" /> : <Gear size={20} weight="bold" />}
          {loading ? '正在同步' : connected ? `同步${isDevices ? '设备' : '场景'}` : '前往连接设置'}
        </button>
      </div>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  type?: 'text' | 'password';
  placeholder?: string;
  onChange: (value: string) => void;
}> = ({ label, value, type = 'text', placeholder, onChange }) => (
  <label className="flex flex-col gap-2">
    <span className="text-[13px] font-semibold" style={{ color: F.textSecondary }}>{label}</span>
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect="off"
      onChange={event => onChange(event.target.value)}
      className="w-full outline-none"
      style={{
        height: 52,
        padding: `0 ${SP[3]}px`,
        borderRadius: R.input,
        background: F.surfaceSunken,
        color: F.textPrimary,
        border: `1px solid ${F.borderSoft}`,
        boxShadow: S.sunken,
        fontSize: 15,
      }}
    />
  </label>
);

const SmartHomeApp: React.FC = () => {
  const { closeApp } = useOS();
  const [screen, setScreen] = useState<Screen>('main');
  const [tab, setTab] = useState<MainTab>('devices');
  const [config, setConfig] = useState<SmartHomeConfig>(() => loadSmartHomeConfig());
  const [draft, setDraft] = useState<SmartHomeConfig>(() => loadSmartHomeConfig());
  const [devices, setDevices] = useState<SmartHomeDevice[]>(() => createDemoSmartHomeDevices());
  const [selected, setSelected] = useState<SmartHomeDevice | null>(null);
  const [addTarget, setAddTarget] = useState<MainTab | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async (nextConfig = config) => {
    if (nextConfig.demoMode || !nextConfig.baseUrl.trim()) {
      setDevices(current => current.length ? current : createDemoSmartHomeDevices());
      setLoading(false);
      return true;
    }
    setLoading(true);
    try {
      const next = await fetchSmartHomeDevices(nextConfig);
      setDevices(next);
      setMessage(null);
      return true;
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '同步失败' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh(config);
  }, [config, refresh]);

  const lights = useMemo(() => devices.filter(device => device.kind === 'light'), [devices]);
  const fans = useMemo(() => devices.filter(device => device.kind === 'fan'), [devices]);
  const scenes = useMemo(() => devices.filter(device => device.kind === 'scene'), [devices]);
  const activeCount = devices.filter(device => device.kind !== 'scene' && device.state === 'on').length;
  const unavailableCount = devices.filter(device => device.kind !== 'scene' && !device.available).length;

  const updateDemoDevice = (command: SmartHomeCommand) => {
    setDevices(current => current.map(device => {
      if (device.entityId !== command.entityId) return device;
      if (command.action === 'turn_on') return { ...device, state: 'on' };
      if (command.action === 'turn_off') return { ...device, state: 'off' };
      if (command.action === 'set_brightness') return { ...device, state: 'on', brightness: Number(command.value) };
      if (command.action === 'set_color_temp') return { ...device, state: 'on', colorTempKelvin: Number(command.value) };
      if (command.action === 'set_percentage') return { ...device, state: 'on', percentage: Number(command.value), presetMode: 'manual' };
      if (command.action === 'set_preset') return { ...device, state: 'on', presetMode: String(command.value) };
      return device;
    }));
  };

  const runCommand = async (command: SmartHomeCommand) => {
    if (config.demoMode) {
      updateDemoDevice(command);
      if (command.action === 'activate') setMessage({ type: 'success', text: '场景已运行' });
      return;
    }
    setBusyIds(current => new Set(current).add(command.entityId));
    try {
      await sendSmartHomeCommand(config, command);
      await refresh(config);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '控制失败' });
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(command.entityId);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!selected) return;
    const next = devices.find(device => device.entityId === selected.entityId);
    if (next) setSelected(next);
  }, [devices, selected?.entityId]);

  const toggleDevice = (device: SmartHomeDevice) => void runCommand({
    entityId: device.entityId,
    kind: device.kind,
    action: device.state === 'on' ? 'turn_off' : 'turn_on',
  });

  const allOff = async () => {
    const active = devices.filter(device => device.kind !== 'scene' && device.state === 'on');
    for (const device of active) {
      await runCommand({ entityId: device.entityId, kind: device.kind, action: 'turn_off' });
    }
  };

  const handleAddAction = async () => {
    if (config.demoMode || !config.baseUrl.trim()) {
      setAddTarget(null);
      setDraft(config);
      setMessage(null);
      setScreen('settings');
      return;
    }
    const target = addTarget;
    const synced = await refresh(config);
    setAddTarget(null);
    if (synced) setMessage({ type: 'success', text: target === 'scenes' ? '场景已同步' : '设备已同步' });
  };

  const saveDraft = () => {
    const next = { ...draft, demoMode: draft.demoMode || !draft.baseUrl.trim() };
    saveSmartHomeConfig(next);
    setConfig(next);
    setDraft(next);
    setMessage({ type: 'success', text: '连接设置已保存' });
    setScreen('main');
  };

  const testDraft = async () => {
    setLoading(true);
    try {
      await testHomeAssistantConnection({ ...draft, demoMode: false });
      setMessage({ type: 'success', text: 'Home Assistant 已连接' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '连接失败' });
    } finally {
      setLoading(false);
    }
  };

  const enableRoleControl = async () => {
    setLoading(true);
    try {
      const result = await enableHomeAssistantMcp({ ...draft, demoMode: false });
      setDraft(result.config);
      setConfig(result.config);
      setMessage({ type: 'success', text: '角色控制已启用' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'MCP 连接失败' });
    } finally {
      setLoading(false);
    }
  };

  if (screen === 'settings') {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: F.appBg, color: F.textPrimary }}>
        <TopBar title="连接设置" onBack={() => setScreen('main')} />
        <div className="flex-1 overflow-y-auto px-5" style={{ paddingBottom: `calc(var(--safe-bottom) + ${SP[5]}px)` }}>
          <div className="flex flex-col gap-5 pb-8">
            <div
              className="flex items-center gap-3"
              style={{ padding: SP[3], borderRadius: R.bigCard, background: PRODUCT.tint, boxShadow: S.raisedSoft }}
            >
              <span className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.small, background: PRODUCT.main }}>
                <House size={22} weight="bold" color={F.surfaceRaised} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">演示模式</span>
                <span className="block text-[13px]" style={{ color: F.textSecondary }}>使用本机模拟设备</span>
              </span>
              <Toggle checked={draft.demoMode} label="演示模式" onChange={() => setDraft(value => ({ ...value, demoMode: !value.demoMode }))} />
            </div>

            <Field label="Home Assistant 地址" value={draft.baseUrl} placeholder="https://ha.example.com" onChange={baseUrl => setDraft(value => ({ ...value, baseUrl }))} />
            <Field label="长期访问令牌" type="password" value={draft.token} onChange={token => setDraft(value => ({ ...value, token }))} />
            <Field label="代理地址" value={draft.proxyUrl} placeholder="可选" onChange={proxyUrl => setDraft(value => ({ ...value, proxyUrl }))} />
            <Field label="代理密钥" type="password" value={draft.proxyKey} placeholder="可选" onChange={proxyKey => setDraft(value => ({ ...value, proxyKey }))} />

            {message ? (
              <div
                className="flex items-start gap-2 text-[13px]"
                style={{
                  padding: SP[2],
                  borderRadius: R.medium,
                  background: message.type === 'success' ? STATUS.success.tint : STATUS.danger.tint,
                  color: message.type === 'success' ? STATUS.success.ink : STATUS.danger.ink,
                }}
              >
                {message.type === 'success'
                  ? <CheckCircle size={18} weight="bold" className="shrink-0" />
                  : <WarningCircle size={18} weight="bold" className="shrink-0" />}
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={loading || !draft.baseUrl.trim() || !draft.token.trim()}
                onClick={() => void testDraft()}
                className="flex items-center justify-center gap-2 whitespace-nowrap text-[15px] font-semibold active:translate-y-[1px] disabled:opacity-50"
                style={{ height: 44, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, boxShadow: S.raisedSoft }}
              >
                <ArrowsClockwise size={18} weight="bold" />
                测试连接
              </button>
              <button
                type="button"
                disabled={loading || !draft.baseUrl.trim() || !draft.token.trim()}
                onClick={() => void enableRoleControl()}
                className="flex items-center justify-center gap-2 whitespace-nowrap text-[15px] font-semibold active:translate-y-[1px] disabled:opacity-50"
                style={{ height: 44, borderRadius: R.button, background: SECONDARY.tint, border: `1px solid ${SECONDARY.soft}`, color: SECONDARY.ink, boxShadow: S.raisedSoft }}
              >
                <ChatCircleDots size={18} weight="bold" />
                角色控制
              </button>
            </div>
            <button
              type="button"
              onClick={saveDraft}
              className="flex w-full items-center justify-center text-[15px] font-semibold active:translate-y-[1px]"
              style={{ height: 48, borderRadius: R.button, background: PRODUCT.main, color: F.surface, boxShadow: S.raisedSoft }}
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusText = config.demoMode ? '演示中' : loading ? '同步中' : message?.type === 'error' ? '连接异常' : '已连接';
  const statusPalette = config.demoMode ? STATUS.info : message?.type === 'error' ? STATUS.danger : STATUS.success;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: F.appBg, color: F.textPrimary }}>
      <TopBar
        title="共栖舱"
        onBack={closeApp}
        action={(
          <>
            <IconButton onClick={() => setAddTarget(tab)} label={tab === 'devices' ? '添加设备' : '添加场景'}>
              <Plus size={20} weight="bold" style={{ color: PRODUCT.ink }} />
            </IconButton>
            <IconButton onClick={() => { setDraft(config); setMessage(null); setScreen('settings'); }} label="连接设置">
              <Gear size={20} weight="bold" style={{ color: F.textSecondary }} />
            </IconButton>
          </>
        )}
      />

      <div className="flex-1 overflow-y-auto px-5" style={{ paddingBottom: `calc(var(--safe-bottom) + ${SP[6]}px)` }}>
        <div className="flex flex-col gap-6 pb-6">
          <section
            style={{ padding: SP[4], borderRadius: R.panel, background: PRODUCT.tint, boxShadow: S.raisedMedium }}
          >
            <div className="flex items-start gap-4">
              <span className="flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: R.smallCard, background: PRODUCT.main }}>
                <House size={26} weight="bold" color={F.surfaceRaised} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[24px] font-semibold leading-8">我的房间</h1>
                  <span className="text-[12px]" style={{ padding: `${SP[0]}px ${SP[1]}px`, borderRadius: R.pill, background: statusPalette.tint, color: statusPalette.ink }}>
                    {statusText}
                  </span>
                </div>
                <p className="mt-1 text-[13px]" style={{ color: F.textSecondary }}>
                  {activeCount > 0 ? `${activeCount} 台设备正在运行` : '设备都已关闭'}
                  {unavailableCount > 0 ? `，${unavailableCount} 台不可用` : ''}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void refresh(config)}
                className="flex items-center justify-center gap-2 whitespace-nowrap text-[13px] font-semibold active:translate-y-[1px]"
                style={{ height: 44, borderRadius: R.button, background: F.surfaceRaised, color: PRODUCT.ink, boxShadow: S.raisedSoft }}
              >
                <ArrowsClockwise size={18} weight="bold" />
                刷新状态
              </button>
              <button
                type="button"
                disabled={activeCount === 0}
                onClick={() => void allOff()}
                className="flex items-center justify-center gap-2 whitespace-nowrap text-[13px] font-semibold active:translate-y-[1px] disabled:opacity-50"
                style={{ height: 44, borderRadius: R.button, background: F.textPrimary, color: F.surface, boxShadow: S.raisedSoft }}
              >
                <Power size={18} weight="bold" />
                全部关闭
              </button>
            </div>
          </section>

          {message?.type === 'error' ? (
            <div className="flex items-start gap-2 text-[13px]" style={{ padding: SP[2], borderRadius: R.medium, background: STATUS.danger.tint, color: STATUS.danger.ink }}>
              <WarningCircle size={18} weight="bold" className="shrink-0" />
              <span>{message.text}</span>
            </div>
          ) : null}

          {tab === 'devices' ? (
            <>
              <section className="flex flex-col gap-3">
                <SectionTitle>灯光</SectionTitle>
                {lights.length ? <DeviceList devices={lights} busyIds={busyIds} onOpen={setSelected} onToggle={toggleDevice} /> : <EmptyState text="尚未发现灯光设备" />}
              </section>
              <section className="flex flex-col gap-3">
                <SectionTitle>空气</SectionTitle>
                {fans.length ? <DeviceList devices={fans} busyIds={busyIds} onOpen={setSelected} onToggle={toggleDevice} /> : <EmptyState text="尚未发现空气设备" />}
              </section>
            </>
          ) : (
            <section className="flex flex-col gap-3">
              <SectionTitle>场景</SectionTitle>
              {scenes.length ? (
                <div className="grid grid-cols-2 gap-3">
                  {scenes.map(scene => (
                    <button
                      type="button"
                      key={scene.entityId}
                      disabled={!scene.available || busyIds.has(scene.entityId)}
                      onClick={() => void runCommand({ entityId: scene.entityId, kind: 'scene', action: 'activate' })}
                      className="flex min-w-0 flex-col items-start gap-3 text-left active:translate-y-[1px] disabled:opacity-50"
                      style={{ minHeight: 128, padding: SP[3], borderRadius: R.bigCard, background: SECONDARY.tint, border: `1px solid ${SECONDARY.soft}`, boxShadow: S.raisedSoft }}
                    >
                      <span className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.small, background: SECONDARY.main }}>
                        <Moon size={22} weight="bold" color={F.surfaceRaised} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold">{scene.name}</span>
                        <span className="mt-1 block text-[13px]" style={{ color: F.textSecondary }}>轻触运行</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : <EmptyState text="尚未发现 Home Assistant 场景" />}
            </section>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center px-5" style={{ paddingBottom: `calc(var(--safe-bottom) + ${SP[2]}px)` }}>
        <div className="pointer-events-auto flex" style={{ width: '100%', maxWidth: 320, padding: SP[0], gap: SP[0], borderRadius: R.panel, background: F.surface, boxShadow: S.raisedMedium }}>
          {([
            { id: 'devices' as const, label: '设备', icon: Lamp },
            { id: 'scenes' as const, label: '场景', icon: Sparkle },
          ]).map(item => {
            const active = tab === item.id;
            const TabIcon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setTab(item.id)}
                className="flex flex-1 items-center justify-center gap-2 text-[13px] font-semibold active:translate-y-[1px]"
                style={{ height: 44, borderRadius: R.bigCard, background: active ? F.surfaceRaised : 'transparent', color: active ? F.textPrimary : F.textTertiary, boxShadow: active ? S.raisedSoft : 'none' }}
              >
                <TabIcon size={18} weight="bold" color={active ? PRODUCT.main : F.textTertiary} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <ControlSheet
          device={selected}
          busy={busyIds.has(selected.entityId)}
          onClose={() => setSelected(null)}
          onCommand={command => void runCommand(command)}
        />
      ) : null}

      {addTarget ? (
        <AddSheet
          target={addTarget}
          connected={!config.demoMode && Boolean(config.baseUrl.trim())}
          loading={loading}
          onClose={() => setAddTarget(null)}
          onAction={() => void handleAddAction()}
        />
      ) : null}
    </div>
  );
};

export default SmartHomeApp;
