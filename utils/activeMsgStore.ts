import { mergeInboxDelivery } from './inboxDelivery';
import {
  ActiveMsg2GlobalConfig,
  ActiveMsg2InboxMessage,
  Amsg2ExpiredNoticeRecord,
  InstantPushOutboundSession,
  InstantPushPendingToolCall,
  InstantPushReasoningBufferEntry,
} from '../types';

const DB_NAME = 'ActiveMsg';
// v2 (Phase 2 Round 1): added outbound_sessions / pending_tool_calls / reasoning_buffer
// for agentic-loop /continue resume + reasoning correlation.
// IMPORTANT: once a client opens v2, downgrade to a v1 codebase will fail to open this DB.
const DB_VERSION = 2;
const STORE_KV = 'kv';
const STORE_INBOX = 'inbox';
const STORE_OUTBOUND_SESSIONS = 'outbound_sessions';
const STORE_PENDING_TOOL_CALLS = 'pending_tool_calls';
const STORE_REASONING_BUFFER = 'reasoning_buffer';
const GLOBAL_CONFIG_KEY = 'global-config';

// [EM-START: inbox-durable-claim]
/**
 * 认领的租约。同一页面的冲刷是串行的，不会重复认领；这个时长挡的是另一个标签页正在处理，
 * 也决定页面被杀之后那条消息最多等多久被捡回来（前台巡查 3 秒一跳，到期就捡）。
 */
export const INBOX_CLAIM_LEASE_MS = 90_000;

// amsg-instant 0.8+ 一个 user turn 可能产 N 条 push (multi-chunk
// pushPayloads). FCM 投递不严格保序, 必须按 (sessionId, messageIndex) 排序
// 才能拿到正确气泡顺序. 没 sessionId 的 (老 worker / proactive push 等)
// 走 sentAt fallback 保持兼容.
const sortInboxMessages = (messages: ActiveMsg2InboxMessage[]): ActiveMsg2InboxMessage[] =>
  messages.sort((a, b) => {
    const aSess = a.metadata?.sessionId as string | undefined;
    const bSess = b.metadata?.sessionId as string | undefined;
    if (aSess && aSess === bSess) {
      const aIdx = Number(a.metadata?.messageIndex ?? 0);
      const bIdx = Number(b.metadata?.messageIndex ?? 0);
      return aIdx - bIdx;
    }
    return (a.sentAt || a.receivedAt) - (b.sentAt || b.receivedAt);
  });
// [EM-END: inbox-durable-claim]

const EXPIRED_NOTICES_PREFIX = 'amsg2_expired_notices_';
const EXPIRED_NOTICES_MAX = 10;
const EXPIRED_NOTICES_TTL_MS = 48 * 3600_000;

type KvRecord<T = unknown> = {
  id: string;
  value: T;
};

// Keep the shared web/PWA build unchanged. The private Capacitor build may
// provide its own Worker URL so the native shell works without manual setup.
const capacitorDefaultWorkerUrl = import.meta.env.VITE_AMSG_NATIVE_PUSH === 'true'
  ? String(import.meta.env.VITE_AMSG_DEFAULT_WORKER_URL || '').trim()
  : '';

const defaultGlobalConfig: ActiveMsg2GlobalConfig = {
  userId: '',
  workerUrl: capacitorDefaultWorkerUrl,
};

// 单例连接缓存。同 utils/db.ts 的根因: 原本每个 op 都新开一条 ActiveMsg 连接且从不
// close, 跟主库一起在并发下撑爆 Chromium backing store, 连带 SW 写 inbox 也失败。
// 复用同一条连接, 并在连接被外部失效 (版本升级 / 浏览器强制关闭) 时清缓存自愈。
let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // onblocked 不是终态: 先 reject, 但底层 open request 还活着, 占用方关闭后仍会触发
    // onsuccess。用 settled 标记 promise 已 settle, 让迟到的连接被 close 而非泄漏成
    // 一条没人持有、却能 block 后续升级 / 删库的孤儿连接。
    // 清缓存一律先比对 dbPromise === promise: onclose/onerror 等都是异步回调, 若期间已
    // 重开并缓存了新 promise (如 SW withInboxTx 强关后重试), 陈旧连接的回调不能把新单例
    // 误清, 否则又凭空多开一条连接 (见 amsg-sw 2.3.0 同款守卫)。
    let settled = false;

    request.onerror = () => {
      if (dbPromise === promise) dbPromise = null; // 打开失败别缓存 rejected promise
      settled = true;
      reject(request.error);
    };
    request.onblocked = () => {
      // SW or another tab holds an older version; can't upgrade. Reject so callers don't hang.
      if (dbPromise === promise) dbPromise = null;
      settled = true;
      reject(new Error('IndexedDB open blocked — close other tabs / unregister SW and retry'));
    };
    request.onsuccess = () => {
      const db = request.result;
      // 已经 reject 过 (onblocked / onerror): 迟到的连接没人接收, 直接 close, 否则它开着
      // 会 block 后续升级 / deleteDatabase。
      if (settled) {
        try { db.close(); } catch { /* ignore */ }
        return;
      }
      // 另一个 tab / SW 升级版本时主动 close 让位 + 清缓存; 强制关闭时也清缓存自愈。
      db.onversionchange = () => {
        db.close();
        if (dbPromise === promise) dbPromise = null;
      };
      db.onclose = () => {
        if (dbPromise === promise) dbPromise = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_INBOX)) {
        db.createObjectStore(STORE_INBOX, { keyPath: 'messageId' });
      }

      // Phase 2 Round 1 stores (v1 → v2 migration is additive — no data touch on existing stores)
      if (!db.objectStoreNames.contains(STORE_OUTBOUND_SESSIONS)) {
        db.createObjectStore(STORE_OUTBOUND_SESSIONS, { keyPath: 'sessionId' });
      }

      if (!db.objectStoreNames.contains(STORE_PENDING_TOOL_CALLS)) {
        db.createObjectStore(STORE_PENDING_TOOL_CALLS, { keyPath: 'sessionId' });
      }

      if (!db.objectStoreNames.contains(STORE_REASONING_BUFFER)) {
        db.createObjectStore(STORE_REASONING_BUFFER, { keyPath: 'sessionId' });
      }
    };
  });

  dbPromise = promise;
  return promise;
};

const getKv = async <T>(id: string): Promise<T | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readonly');
    const request = tx.objectStore(STORE_KV).get(id);
    request.onsuccess = () => resolve((request.result as KvRecord<T> | undefined)?.value ?? null);
    request.onerror = () => reject(request.error);
  });
};

const setKv = async <T>(id: string, value: T): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    tx.objectStore(STORE_KV).put({ id, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// XHS 跨轮笔记缓冲: round 1 工具跑完写, round 2 [[XHS_SHARE]]/评论/点赞 重放时读.
// 存在 KV 是因为内存单例 (pushLastXhsNotesRef) 跨 SW 唤醒 / 页面回收会清空 —— 移动端
// instant 流程的 round 1 与 round 2 之间常隔一次后台重载, 笔记一丢 XHS_SHARE 就静默掉卡片.
const XHS_SESSION_NOTES_PREFIX = 'xhs_session_notes:';
const XHS_SESSION_NOTES_TTL_MS = 3 * 60 * 60 * 1000;

export type XhsSessionNotes = {
  notes: unknown[];
  xsecTokens: Array<[string, string]>;
  savedAt: number;
};

// 写入时顺手清理过期条目, 防 KV 无界增长 (outbound_sessions 本身也没清理, 这里不重蹈覆辙).
const pruneStaleXhsSessionNotes = async (): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      const cutoff = Date.now() - XHS_SESSION_NOTES_TTL_MS;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const rec = cursor.value as KvRecord<{ savedAt?: number }> | undefined;
        if (rec && typeof rec.id === 'string' && rec.id.startsWith(XHS_SESSION_NOTES_PREFIX)) {
          const savedAt = Number(rec.value?.savedAt ?? 0);
          if (savedAt < cutoff) cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* prune 尽力而为, 失败不影响主流程 */ }
};

const generateUuidV4 = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export const ActiveMsgStore = {
  async getGlobalConfig(): Promise<ActiveMsg2GlobalConfig> {
    const stored = await getKv<ActiveMsg2GlobalConfig>(GLOBAL_CONFIG_KEY);
    const config = { ...defaultGlobalConfig, ...(stored || {}) };
    // Older App installs may already have persisted an empty URL. Fill only
    // that empty value in the private build; an explicit non-empty URL wins.
    if (!config.workerUrl?.trim() && capacitorDefaultWorkerUrl) {
      config.workerUrl = capacitorDefaultWorkerUrl;
    }
    return config;
  },

  async saveGlobalConfig(updates: Partial<ActiveMsg2GlobalConfig>): Promise<ActiveMsg2GlobalConfig> {
    const current = await this.getGlobalConfig();
    const next: ActiveMsg2GlobalConfig = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
    await setKv(GLOBAL_CONFIG_KEY, next);
    return next;
  },

  async ensureUserId(): Promise<string> {
    const current = await this.getGlobalConfig();
    if (current.userId) return current.userId;

    const userId = generateUuidV4();
    await this.saveGlobalConfig({ userId });
    return userId;
  },

  async saveInboxMessage(message: ActiveMsg2InboxMessage): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite');
      const store = tx.objectStore(STORE_INBOX);
      const previous = store.get(message.messageId);
      previous.onsuccess = () => {
        const merged = mergeInboxDelivery(message, previous.result);
        delete merged.claimedAt; // [EM: inbox-durable-claim] 写回来的（重试 / 等齐）要能被下一趟立刻认领，不等租约
        store.put(merged);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Inbox delivery aborted'));
    });
  },

  /**
   * 收件箱里现在有几条。**只数个数，不读内容**——给前台那趟定期巡查用。
   *
   * 巡查每几秒就要跑一次，不能每回都把整表读出来再原样丢掉。count() 不反序列化任何
   * 记录，空表时几乎不花时间；数出来是 0 就到此为止，有货才去走完整的冲刷。
   */
  async countInboxMessages(): Promise<number> {
    const db = await openDB();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readonly');
      const request = tx.objectStore(STORE_INBOX).count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  },

  async listInboxMessages(): Promise<ActiveMsg2InboxMessage[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readonly');
      const request = tx.objectStore(STORE_INBOX).getAll();
      request.onsuccess = () => {
        const messages = (request.result || []) as ActiveMsg2InboxMessage[];
        messages.sort((a, b) => (a.sentAt || a.receivedAt) - (b.sentAt || b.receivedAt));
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // [EM-START: inbox-durable-claim]
  // 认领要处理的消息：单事务 getAll + 打标记，跨 tab / SW 的 readwrite 事务是串行的，
  // 同一条不会被两趟同时认领。
  //
  // 原来是取走就从库里删（consumeInboxMessages），处理期间消息只在内存里。2026-10-30 陆时
  // 那条就这么没的：取信箱销了账、消息进收件箱，冲刷刚取走它一秒，页面被系统杀掉重载，
  // 内存里那份跟着没了，mini 信箱和本机收件箱都已经没有这一条。
  // 现在处理完才删（settleInboxMessage）。认领超过租约还在的，说明上一趟死在半路：
  // 计一次重试再认领，走现成的重试清场（删半成品气泡、副作用不重放），不会写重。
  async claimInboxMessages(now: number = Date.now()): Promise<ActiveMsg2InboxMessage[]> {
    const db = await openDB();
    return new Promise<ActiveMsg2InboxMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite');
      const store = tx.objectStore(STORE_INBOX);
      const request = store.getAll();
      let messages: ActiveMsg2InboxMessage[] = [];
      request.onsuccess = () => {
        const all = (request.result || []) as ActiveMsg2InboxMessage[];
        messages = sortInboxMessages(all
          .filter((m) => !m.claimedAt || now - m.claimedAt >= INBOX_CLAIM_LEASE_MS)
          .map((m) => ({
            ...m,
            claimedAt: now,
            ...(m.claimedAt ? { processAttempts: (m.processAttempts ?? 0) + 1 } : {}),
          })));
        messages.forEach((m) => store.put(m));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(messages);
      tx.onabort = () => reject(tx.error || new Error('inbox claim aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },

  /** 这条有着落了（落库 / 按规则丢弃 / 重试到头），可以从收件箱删了。 */
  async settleInboxMessage(messageId: string): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite');
      tx.objectStore(STORE_INBOX).delete(messageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('inbox settle aborted'));
    });
  },
  // [EM-END: inbox-durable-claim]

  /** 取走并清空收件箱。[EM: inbox-durable-claim] 冲刷已改走 claimInboxMessages，这里只剩测试清场在用。 */
  async consumeInboxMessages(): Promise<ActiveMsg2InboxMessage[]> {
    const db = await openDB();
    return new Promise<ActiveMsg2InboxMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite');
      const store = tx.objectStore(STORE_INBOX);
      const request = store.getAll();
      let messages: ActiveMsg2InboxMessage[] = [];
      request.onsuccess = () => {
        messages = sortInboxMessages((request.result || []) as ActiveMsg2InboxMessage[]);
        messages.forEach((m) => store.delete(m.messageId));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(messages);
      tx.onabort = () => reject(tx.error || new Error('inbox consume aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── Phase 2 Round 1: outbound_sessions ──────────────────────────────────
  // sendInstantPush 写, /continue 续跑读, /continue 完成后 delete.

  async saveOutboundSession(record: InstantPushOutboundSession): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOUND_SESSIONS, 'readwrite');
      tx.objectStore(STORE_OUTBOUND_SESSIONS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getOutboundSession(sessionId: string): Promise<InstantPushOutboundSession | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOUND_SESSIONS, 'readonly');
      const request = tx.objectStore(STORE_OUTBOUND_SESSIONS).get(sessionId);
      request.onsuccess = () => resolve((request.result as InstantPushOutboundSession | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteOutboundSession(sessionId: string): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOUND_SESSIONS, 'readwrite');
      tx.objectStore(STORE_OUTBOUND_SESSIONS).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── XHS 跨轮笔记缓冲 (持久化) ─────────────────────────────────────────────
  async saveXhsSessionNotes(
    sessionId: string,
    payload: { notes: unknown[]; xsecTokens: Array<[string, string]> },
  ): Promise<void> {
    if (!sessionId) return;
    await setKv<XhsSessionNotes>(`${XHS_SESSION_NOTES_PREFIX}${sessionId}`, {
      notes: payload.notes,
      xsecTokens: payload.xsecTokens,
      savedAt: Date.now(),
    });
    await pruneStaleXhsSessionNotes();
  },

  async getXhsSessionNotes(sessionId: string): Promise<XhsSessionNotes | null> {
    if (!sessionId) return null;
    return getKv<XhsSessionNotes>(`${XHS_SESSION_NOTES_PREFIX}${sessionId}`);
  },

  // ─── Phase 2 Round 2 wire: pending_tool_calls ─────────────────────────────
  // SW writes when worker emits messageKind='tool_request'; main thread consumes
  // on startup (or via postMessage). Atomic claim mirrors consumeInboxMessages.
  // Round 1: empty by design (worker still 0.6 one-shot, won't emit tool_request).

  async savePendingToolCall(record: InstantPushPendingToolCall): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_TOOL_CALLS, 'readwrite');
      tx.objectStore(STORE_PENDING_TOOL_CALLS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async consumePendingToolCalls(): Promise<InstantPushPendingToolCall[]> {
    const db = await openDB();
    return new Promise<InstantPushPendingToolCall[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_TOOL_CALLS, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_TOOL_CALLS);
      const request = store.getAll();
      let calls: InstantPushPendingToolCall[] = [];
      request.onsuccess = () => {
        calls = (request.result || []) as InstantPushPendingToolCall[];
        calls.sort((a, b) => a.createdAt - b.createdAt);
        calls.forEach((c) => store.delete(c.sessionId));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(calls);
      tx.onabort = () => reject(tx.error || new Error('pending tool calls consume aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── Phase 2 Round 2 wire: reasoning_buffer ───────────────────────────────
  // New amsg-sw generic multipart restores complete reasoning payloads before
  // business handling, so SW now writes a flat reasoningContent. Keep chunks[]
  // fallback for pending rows written by older SW versions.

  async saveReasoning(record: InstantPushReasoningBufferEntry): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REASONING_BUFFER, 'readwrite');
      tx.objectStore(STORE_REASONING_BUFFER).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async claimReasoning(sessionId: string): Promise<InstantPushReasoningBufferEntry | null> {
    const db = await openDB();
    return new Promise<InstantPushReasoningBufferEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_REASONING_BUFFER, 'readwrite');
      const store = tx.objectStore(STORE_REASONING_BUFFER);
      const request = store.get(sessionId);
      let entry: InstantPushReasoningBufferEntry | null = null;
      request.onsuccess = () => {
        const r = request.result as InstantPushReasoningBufferEntry | undefined;
        if (r) {
          const chunks = r.chunks ?? [];
          const reasoningContent = chunks.length > 0
            ? [...chunks]
                .sort((a, b) =>
                  a.messageIndex !== b.messageIndex
                    ? a.messageIndex - b.messageIndex
                    : a.chunkIndex - b.chunkIndex,
                )
                .map((c) => c.reasoningContent)
                .join('')
            : (r.reasoningContent ?? '');
          entry = { ...r, reasoningContent };
          store.delete(sessionId);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(entry);
      tx.onabort = () => reject(tx.error || new Error('reasoning claim aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * 客户端镜像 SW 的 clearReasoningBuffer — 启动续跑 / 异常恢复路径主动调,
   * 避免 reasoning_buffer 里残留早期 round 的内心戏污染最终 thinking chain.
   * 跟 SW 的 clearReasoningBuffer 字节等价.
   */
  async clearReasoning(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REASONING_BUFFER, 'readwrite');
      tx.objectStore(STORE_REASONING_BUFFER).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('reasoning clear aborted'));
    });
  },

  // ─── pending_emotion_evals (KV-backed) ────────────────────────────────────
  // 当 push 落库后, useChatAI 没 mount 这个 char 时, 写一条 pending 记录占位; 用户切到
  // 这个 chat 时 useChatAI useEffect drain. 在线 (已 mount) 时 dispatch 事件直接跑, 仍
  // 写记录占位以防 listener 没成功跑 (例如 useChatAI 此刻还在 mount 中事件错过).
  //
  // Key: `pending_emotion_eval:${charId}` in STORE_KV. 一个 charId 一条记录: 多条 push 累积
  // 时最新 push 覆盖, drain 时一次性 eval (eval 看最新 messages, 不需要 N 次).
  // 用 KV 不开新 store: 单 charId 单记录 + 不需要复杂查询, KV 完全够用.

  async setPendingEmotionEval(charId: string, lastPushMsgId: string): Promise<void> {
    if (!charId) return;
    await setKv(`pending_emotion_eval:${charId}`, {
      charId,
      lastPushMsgId,
      addedAt: Date.now(),
    });
  },

  async getPendingEmotionEval(charId: string): Promise<{ charId: string; lastPushMsgId: string; addedAt: number } | null> {
    if (!charId) return null;
    return getKv<{ charId: string; lastPushMsgId: string; addedAt: number }>(`pending_emotion_eval:${charId}`);
  },

  async clearPendingEmotionEval(charId: string): Promise<void> {
    if (!charId) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).delete(`pending_emotion_eval:${charId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── 防穿帮闸·作废回执台账 ───

  async getExpiredNotices(charId: string): Promise<Amsg2ExpiredNoticeRecord[]> {
    const list = await getKv<Amsg2ExpiredNoticeRecord[]>(`${EXPIRED_NOTICES_PREFIX}${charId}`);
    return Array.isArray(list) ? list : [];
  },

  /** 合并新候选（按 id 去重），顺手清 48h 前的老记录，封顶 10 条防无界增长。 */
  async upsertExpiredNotices(charId: string, records: Amsg2ExpiredNoticeRecord[]): Promise<Amsg2ExpiredNoticeRecord[]> {
    const byId = new Map((await this.getExpiredNotices(charId)).map((r) => [r.id, r]));
    for (const record of records) {
      if (!byId.has(record.id)) byId.set(record.id, record);
    }
    const cutoff = Date.now() - EXPIRED_NOTICES_TTL_MS;
    const alive = [...byId.values()]
      .filter((r) => r.createdAt >= cutoff)
      .sort((a, b) => b.occurrenceMs - a.occurrenceMs);
    // 超限时先淘汰已告知的（Codex #11）——「作废 ≠ 消失」是设计底线，未告知回执
    // 不允许被静默截断；真溢出（病态场景）保最新未告知并 warn 留痕。
    let next = alive;
    if (alive.length > EXPIRED_NOTICES_MAX) {
      const unnotified = alive.filter((r) => !r.notifiedAt);
      const notified = alive.filter((r) => r.notifiedAt);
      next = [...unnotified, ...notified].slice(0, EXPIRED_NOTICES_MAX);
      if (unnotified.length > EXPIRED_NOTICES_MAX) {
        console.warn('[ActiveMsgStore] 未告知作废回执超上限，最旧的被截断', { charId, dropped: unnotified.length - EXPIRED_NOTICES_MAX });
      }
    }
    await setKv(`${EXPIRED_NOTICES_PREFIX}${charId}`, next);
    return next;
  },

  async markExpiredNoticesNotified(charId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const next = (await this.getExpiredNotices(charId)).map((r) =>
      idSet.has(r.id) ? { ...r, notifiedAt: r.notifiedAt ?? Date.now() } : r);
    await setKv(`${EXPIRED_NOTICES_PREFIX}${charId}`, next);
  },
};

/**
 * 后端连接那几样：连上用户自己那台 Worker 需要的全部东西。
 *
 * 它们合起来就是那台 Worker 的钥匙——地址加主密钥能解开 D1 里所有密文，用户 id 决定
 * 读得到哪一份数据（数据按它分区），共享密钥是端点的门禁。少一样都连不成，所以要摘
 * 就得一起摘。
 */
const BACKEND_CONNECTION_KEYS = ['workerUrl', 'serverToken', 'masterKey', 'userId'] as const;

/** 这份备份里带着后端连接吗（带了的话，谁拿到这个文件谁就能连上那台 Worker）。 */
export const backupHasBackendConnection = (
  config: ActiveMsg2GlobalConfig | null | undefined,
): boolean => !!config?.workerUrl?.trim();

/**
 * 导入时问一句要不要连上备份里的后端。程序分不清这份文件是自己的还是别人的
 * （换新设备时用户 id 本来就对不上），只有拿着文件的人知道，所以把话问出去。
 */
export const askRestoreBackendConnection = (workerUrl: string): boolean => {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  return window.confirm(
    `这份备份里带着一个主动消息 2.0 的后端连接：\n\n${workerUrl}\n\n`
    + '如果这是你自己导出的备份，点「确定」连上它。\n\n'
    + '如果是别人给你的，点「取消」——连上去的话，你的 API 密钥和聊天记录会被写进对方那台服务器。\n\n'
    + '（不连也不影响其它数据导入，之后可以在设置里手动填。）',
  );
};

/**
 * 备份用：把主动消息 2.0 的全局配置取出来（即时对话开关等）。
 *
 * 这份配置存在自己的 `ActiveMsg` 库里，不在主库那份 store 清单内，所以必须单独取一次
 * 挂进备份包。
 *
 * **后端连接默认不带走。** 备份文件是会被分享出去的——发一份角色合集给朋友，就等于把
 * 自己那台 Worker 的钥匙一起发了。换设备恢复自己的备份才需要这几样，让用户自己勾。
 */
export async function exportAmsg2GlobalConfig(
  options: { includeBackendConnection?: boolean } = {},
): Promise<ActiveMsg2GlobalConfig | undefined> {
  try {
    const config = await ActiveMsgStore.getGlobalConfig();
    if (!config.workerUrl?.trim()) return undefined;
    if (options.includeBackendConnection) return config;
    const stripped = { ...config };
    for (const key of BACKEND_CONNECTION_KEYS) delete stripped[key];
    // 摘完只剩几个开关。全是默认值的话备份里干脆别出现这个键。
    return Object.keys(stripped).length > 0 ? stripped : undefined;
  } catch (e) {
    console.warn('[amsg2] 读取全局配置失败，备份将不含这一项', e);
    return undefined;
  }
}

/**
 * 备份用：把上面那份配置写回去。
 *
 * `instantChatSupported` 不还原——它记的是「上次探到那台 Worker 跑不跑得动即时对话」，
 * 是一次探测的结果而不是用户的选择。备份里那个值可能已经过时（Worker 后来更新过 / 退回过），
 * 照抄回来要么白挡一次、要么在跑不动的 Worker 上放行。留空表示「还没探过」，
 * 握手时会补探一次，之后就有准数了。
 *
 * **后端连接要调用方点头才还原**（`allowBackendConnection`）。不点头就只还原那几个开关，
 * 本机原有的连接不会被顶掉，本地其它数据照常导入。
 */
export async function importAmsg2GlobalConfig(
  config: ActiveMsg2GlobalConfig | null | undefined,
  options: { allowBackendConnection?: boolean } = {},
): Promise<void> {
  if (!config || typeof config !== 'object') return;
  const { instantChatSupported: _dropped, ...restorable } = config;
  if (!options.allowBackendConnection) {
    for (const key of BACKEND_CONNECTION_KEYS) delete restorable[key];
  }
  if (Object.keys(restorable).length === 0) return;
  await ActiveMsgStore.saveGlobalConfig({ ...restorable, instantChatSupported: undefined });
}

export const maskActiveMsgUserId = (userId: string) => {
  if (!userId) return '未生成';
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 8)}••••${userId.slice(-8)}`;
};
