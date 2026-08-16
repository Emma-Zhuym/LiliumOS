/**
 * intifaceClient.ts — Intiface Central 原生 WebSocket 客户端
 *
 * EM 独有功能。单例模式，全局复用同一个连接。
 * 直接实现 Buttplug 协议 v3（纯 JSON），不依赖 buttplug.js 库。
 *
 * 用法：
 *   import { intifaceClient } from './intifaceClient';
 *   await intifaceClient.connect('ws://localhost:12345');
 *   await intifaceClient.vibrate(75);
 *   await intifaceClient.stopAll();
 */

// ── 类型 ──────────────────────────────────────────────────────────────────────

export type IntifaceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface IntifaceDevice {
  index: number;
  name: string;
  displayName?: string;
  /** 设备支持的执行器（振动、旋转等） */
  actuators: Array<{
    index: number;
    type: string;           // "Vibrate" | "Oscillate" | "Rotate" | ...
    stepCount: number;       // 最大步数（如 1000）
  }>;
}

type DeviceListener = (devices: IntifaceDevice[]) => void;
type StatusListener = (status: IntifaceStatus, error?: string) => void;

// ── 主类 ──────────────────────────────────────────────────────────────────────

class IntifaceClientSingleton {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private _status: IntifaceStatus = 'disconnected';
  private _devices: IntifaceDevice[] = [];
  private _currentIntensity = 0;
  private patternTimer: ReturnType<typeof setTimeout> | null = null;
  private durationTimer: ReturnType<typeof setTimeout> | null = null;

  private deviceListeners = new Set<DeviceListener>();
  private statusListeners = new Set<StatusListener>();

  // ── 状态查询 ───────────────────────────────────────────────────────────────

  get status(): IntifaceStatus { return this._status; }
  get connected(): boolean { return this._status === 'connected'; }
  get devices(): IntifaceDevice[] { return [...this._devices]; }
  get currentIntensity(): number { return this._currentIntensity; }

  // ── 事件监听 ───────────────────────────────────────────────────────────────

  onDevicesChange(cb: DeviceListener): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitDevices() {
    this.deviceListeners.forEach(cb => cb([...this._devices]));
  }

  private setStatus(s: IntifaceStatus, error?: string) {
    this._status = s;
    this.statusListeners.forEach(cb => cb(s, error));
  }

  // ── 底层 WebSocket 消息 ────────────────────────────────────────────────────

  /** 发消息给 Intiface，返回 Promise 等响应 */
  private sendMsg(type: string, data: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    const id = ++this.msgId;
    const msg = JSON.stringify([{ [type]: { Id: id, ...data } }]);
    console.log('[Intiface] →', msg);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(msg);
      // 5 秒超时
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for response to ${type}`));
        }
      }, 5000);
    });
  }

  /** 处理 Intiface 发来的消息 */
  private handleMessage(raw: string) {
    console.log('[Intiface] ←', raw);
    let msgs: Array<Record<string, Record<string, unknown>>>;
    try { msgs = JSON.parse(raw); } catch { return; }

    for (const msg of msgs) {
      const type = Object.keys(msg)[0];
      const data = msg[type];
      const id = data.Id as number;

      switch (type) {
        case 'ServerInfo':
        case 'Ok':
        case 'ScanningFinished':
          this.pending.get(id)?.resolve(data);
          this.pending.delete(id);
          break;

        case 'Error':
          console.error('[Intiface] Error:', data.ErrorMessage);
          this.pending.get(id)?.reject(new Error(data.ErrorMessage as string));
          this.pending.delete(id);
          break;

        case 'DeviceAdded':
          this.addDevice(data);
          break;

        case 'DeviceList': {
          // RequestDeviceList 的响应：包含 Intiface 里已经连好的设备
          const list = (data.Devices as Array<Record<string, unknown>> | undefined) ?? [];
          for (const d of list) this.addDevice(d);
          this.pending.get(id)?.resolve(data);
          this.pending.delete(id);
          break;
        }

        case 'DeviceRemoved':
          this._devices = this._devices.filter(d => d.index !== (data.DeviceIndex as number));
          this.emitDevices();
          break;

        default:
          // 忽略其他消息类型
          break;
      }
    }
  }

  /** 解析设备信息（DeviceAdded 消息和 DeviceList 里的条目格式相同） */
  private addDevice(data: Record<string, unknown>) {
    const index = data.DeviceIndex as number;
    const name = data.DeviceName as string;
    const displayName = data.DeviceDisplayName as string | undefined;

    // 协议 v3：DeviceMessages.ScalarCmd 是执行器数组
    // [{ StepCount: 1000, ActuatorType: "Vibrate", FeatureDescriptor: "" }, ...]
    const actuators: IntifaceDevice['actuators'] = [];
    const messages = data.DeviceMessages as Record<string, unknown> | undefined;

    const scalarCmd = messages?.ScalarCmd;
    if (Array.isArray(scalarCmd)) {
      (scalarCmd as Array<Record<string, unknown>>).forEach((attr, i) => {
        actuators.push({
          index: i,
          type: (attr.ActuatorType as string) ?? 'Vibrate',
          stepCount: (attr.StepCount as number) ?? 20,
        });
      });
    }

    console.log('[Intiface] Device added:', { index, name, displayName, actuators });

    // 去重（避免重复添加）
    this._devices = this._devices.filter(d => d.index !== index);
    this._devices.push({ index, name, displayName, actuators });
    this.emitDevices();
  }

  // ── 连接 / 断开 ────────────────────────────────────────────────────────────

  async connect(url = 'ws://localhost:12345'): Promise<void> {
    if (this._status === 'connecting' || this._status === 'connected') return;
    this.setStatus('connecting');

    // 关掉上一条可能还挂着的连接，避免它的事件之后串进来
    if (this.ws) {
      try { this.ws.onclose = null; this.ws.onerror = null; this.ws.close(); } catch { /* ignore */ }
    }

    const ws = new WebSocket(url);
    this.ws = ws;
    // 只有 this.ws === ws 时才允许这条连接的事件改动单例状态，
    // 防止旧连接的迟到事件（onclose/onerror）覆盖新连接已经成功的状态
    const isCurrent = () => this.ws === ws;

    try {
      let timeoutId: ReturnType<typeof setTimeout>;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { clearTimeout(timeoutId); resolve(); };
        ws.onerror = () => { clearTimeout(timeoutId); reject(new Error(`WebSocket connection failed to ${url}`)); };
        timeoutId = setTimeout(() => reject(new Error(`WebSocket connection timeout to ${url}`)), 5000);
      });

      ws.onmessage = (e) => { if (isCurrent()) this.handleMessage(e.data); };
      ws.onclose = () => {
        if (!isCurrent()) return;
        this.cleanup();
        this.setStatus('disconnected');
        this.emitDevices();
      };
      ws.onerror = () => {}; // onclose 会处理

      // 握手
      const info = await this.sendMsg('RequestServerInfo', {
        ClientName: 'LiliumOS',
        MessageVersion: 3,
      }) as Record<string, unknown>;
      console.log('[Intiface] Connected to:', info.ServerName, 'v' + info.MessageVersion);

      // 请求已连接的设备列表
      await this.sendMsg('RequestDeviceList', {});

      // 开始扫描新设备
      try { await this.sendMsg('StartScanning', {}); } catch { /* 已在扫描 */ }

      if (!isCurrent()) return; // 连接过程中已经被更新的连接顶替

      // 如果服务器要求 ping，定时发送
      const maxPingTime = info.MaxPingTime as number;
      if (maxPingTime > 0) {
        this.pingTimer = setInterval(() => {
          this.sendMsg('Ping', {}).catch(() => {});
        }, Math.floor(maxPingTime / 2));
      }

      this.setStatus('connected');
    } catch (e) {
      if (!isCurrent()) return; // 旧连接的失败，不能覆盖当前状态
      this.cleanup();
      this.setStatus('error', e instanceof Error ? e.message : String(e));
    }
  }

  async disconnect(): Promise<void> {
    this.stopPattern();
    await this.stopAll();
    this.ws?.close();
    this.cleanup();
    this.setStatus('disconnected');
    this.emitDevices();
  }

  private cleanup() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.ws = null;
    this._devices = [];
    this._currentIntensity = 0;
    this.pending.clear();
  }

  async rescan(): Promise<void> {
    if (!this.connected) return;
    try { await this.sendMsg('StartScanning', {}); } catch { /* ignore */ }
  }

  // ── 控制命令 ───────────────────────────────────────────────────────────────

  /** 震动，强度 0–100（0 = 停止） */
  async vibrate(intensity: number): Promise<void> {
    if (!this.connected || this._devices.length === 0) return;
    const clamped = Math.max(0, Math.min(100, Math.round(intensity)));
    this._currentIntensity = clamped;
    const scalar = clamped / 100;  // 协议用 0.0–1.0

    for (const device of this._devices) {
      // 筛出所有震动类执行器
      const vibrateActuators = device.actuators.filter(
        a => a.type === 'Vibrate' || a.type === 'Oscillate'
      );

      if (vibrateActuators.length > 0) {
        try {
          await this.sendMsg('ScalarCmd', {
            DeviceIndex: device.index,
            Scalars: vibrateActuators.map(a => ({
              Index: a.index,
              Scalar: scalar,
              ActuatorType: a.type,
            })),
          });
        } catch (e) {
          console.warn('[Intiface] vibrate failed:', e);
        }
      }
    }
  }

  /** 立即停止所有设备，清除 pattern */
  async stopAll(): Promise<void> {
    this.stopPattern();
    this._currentIntensity = 0;
    if (!this.connected) return;
    try {
      await this.sendMsg('StopAllDevices', {});
    } catch { /* ignore */ }
  }

  // ── Pattern 执行器 ──────────────────────────────────────────────────────────

  private stopPattern() {
    if (this.patternTimer) {
      clearTimeout(this.patternTimer);
      this.patternTimer = null;
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  /**
   * 执行震动模式
   * @param intensity   目标强度 0–100
   * @param pattern     'steady' | 'pulse' | 'wave'
   * @param duration_ms 持续毫秒，省略则持续到下次调用
   */
  async runPattern(
    intensity: number,
    pattern: 'steady' | 'pulse' | 'wave' = 'steady',
    duration_ms?: number,
  ): Promise<void> {
    this.stopPattern();
    if (intensity === 0) { await this.stopAll(); return; }

    switch (pattern) {
      case 'steady':
        await this.vibrate(intensity);
        break;
      case 'pulse':
        await this._runPulse(intensity);
        break;
      case 'wave':
        await this._runWave(intensity);
        break;
    }

    if (duration_ms && duration_ms > 0) {
      this.durationTimer = setTimeout(() => this.stopAll(), duration_ms);
    }
  }

  // pulse：每 350ms 在 intensity ↔ 0 交替
  private async _runPulse(intensity: number) {
    let on = true;
    const tick = async () => {
      await this.vibrate(on ? intensity : 0);
      on = !on;
      this.patternTimer = setTimeout(tick, 350);
    };
    await tick();
  }

  // wave：sin 波，4 秒一周期
  private async _runWave(intensity: number) {
    const period = 4000;
    const steps = 50;
    const stepMs = period / steps;
    let step = 0;
    const tick = async () => {
      const t = (step % steps) / steps;
      const v = Math.round(intensity * Math.sin(Math.PI * t));
      await this.vibrate(v);
      step++;
      this.patternTimer = setTimeout(tick, stepMs);
    };
    await tick();
  }
}

// ── 全局单例 ───────────────────────────────────────────────────────────────────

export const intifaceClient = new IntifaceClientSingleton();

// iOS 息屏会冻结 WebSocket，解锁回来自动重连
if (typeof document !== 'undefined') {
  let lastUrl: string | null = null;

  intifaceClient.onStatusChange((s) => {
    if (s === 'connected') {
      lastUrl = localStorage.getItem('intiface-url') || 'ws://localhost:12345';
    } else if (s === 'disconnected') {
      lastUrl = null;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (intifaceClient.status !== 'disconnected') return;
    const url = lastUrl ?? localStorage.getItem('intiface-url');
    if (!url) return;
    console.log('[Intiface] 页面回到前台，自动重连…');
    intifaceClient.connect(url).catch(() => {});
  });
}

// Vite HMR：模块被热替换时关掉旧连接，否则旧实例的 WebSocket 会一直
// 占着 Intiface 的客户端坑位（Intiface 同时只接受一个客户端），
// 新实例永远连不上
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    intifaceClient.disconnect().catch(() => {});
  });
}
