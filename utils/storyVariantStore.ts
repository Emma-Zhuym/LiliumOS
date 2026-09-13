// [EM: standalone-story-variants] Runs and their dialogue commit together.
import { openDB } from './db';
import type { Message, StoryVariantRecord, StoryVariantIdentityCard, StoryVariantSimulationRun, StoryVariantSimulationReply } from '../types';

const STORE = 'story_variants';
const thread = (id: string) => `story-variant:${id}`;
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});
async function transact<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await openDB();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let value: T;
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('异格存档读写失败'));
        tx.onabort = () => reject(tx.error || new Error('异格保存已取消，原存档保留'));
        void work(tx).then(result => { value = result; }).catch(error => {
            reject(error);
            try { tx.abort(); } catch { /* transaction already ended */ }
        });
    });
}

export function validateStoryVariantBackup(records: unknown, messages?: Message[]): void {
    if (!Array.isArray(records)) throw new Error('异格备份格式错误');
    const ids = new Set<string>();
    const cards = new Map<string, StoryVariantIdentityCard>();
    const runs = new Map<string, StoryVariantSimulationRun>();
    for (const record of records) {
        if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)
            || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) throw new Error('异格备份含无效或重复记录');
        ids.add(record.id);
        if (record.kind === 'card') {
            if (typeof record.charId !== 'string' || !record.charId || !record.profile
                || !['title', 'identity', 'steelSeal', 'patchCost', 'openingScene', 'openingLine'].every(key => typeof record.profile[key] === 'string' && record.profile[key].trim())
                || typeof record.variantId !== 'string' || typeof record.storyId !== 'string') throw new Error('异格身份卡不完整');
            cards.set(record.id, record);
        } else if (record.kind === 'run') {
            if (!Number.isInteger(record.interactionsUsed) || record.interactionsUsed < 0 || record.interactionsUsed > 50 || record.maxInteractions !== 50
                || !['active', 'archived'].includes(record.status)
                || (record.status === 'active' && (record.interactionsUsed >= 50 || record.archivedAt != null))
                || (record.status === 'archived' && (!Number.isFinite(record.archivedAt) || !['completed', 'emergency'].includes(record.archiveReason)))) throw new Error('异格进度不完整');
            runs.set(record.id, record);
        } else throw new Error('异格备份含未知记录类型');
    }
    for (const run of runs.values()) if (!cards.has(run.cardId)) throw new Error('异格故事缺少身份卡');
    if (messages === undefined) return;
    const turns = new Map<string, Set<string>>();
    for (const message of messages) {
        if (message.metadata?.source !== 'story_variant' && !message.charId?.startsWith('story-variant:')) continue;
        const run = runs.get(message.metadata?.storyVariantRunId);
        const turn = message.metadata?.storyVariantTurn;
        if (!run || message.charId !== thread(run.id) || message.metadata?.source !== 'story_variant'
            || message.metadata?.storyVariantCardId !== run.cardId || !Number.isInteger(turn) || turn < 1 || turn > run.interactionsUsed
            || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('异格正文与存档进度不一致');
        const seen = turns.get(run.id) || new Set<string>();
        const key = `${turn}:${message.role}`;
        if (seen.has(key)) throw new Error('异格备份含重复回合');
        seen.add(key); turns.set(run.id, seen);
    }
    for (const run of runs.values()) if ((turns.get(run.id)?.size || 0) !== run.interactionsUsed * 2) throw new Error('异格备份缺少正文');
}

export const StoryVariantStore = {
    list: () => transact([STORE], 'readonly', async tx => {
        const records = await request<StoryVariantRecord[]>(tx.objectStore(STORE).getAll());
        validateStoryVariantBackup(records);
        return records;
    }),
    saveCard: (card: StoryVariantIdentityCard) => transact([STORE], 'readwrite', async tx => {
        validateStoryVariantBackup([card]);
        await request(tx.objectStore(STORE).put(card));
        return card;
    }),
    start: (cardId: string) => {
        const now = Date.now();
        const run: StoryVariantSimulationRun = { kind: 'run', id: `variant_run_${crypto.randomUUID()}`, cardId, createdAt: now, updatedAt: now, status: 'active', interactionsUsed: 0, maxInteractions: 50 };
        return transact([STORE], 'readwrite', async tx => {
            const store = tx.objectStore(STORE);
            if ((await request<StoryVariantRecord | undefined>(store.get(cardId)))?.kind !== 'card') throw new Error('未找到异格身份卡');
            await request(store.add(run));
            return run;
        });
    },
    getRun: (id: string) => transact([STORE], 'readonly', async tx => {
        const run = await request<StoryVariantRecord | undefined>(tx.objectStore(STORE).get(id));
        if (!run || run.kind !== 'run') throw new Error('未找到这段异格故事');
        return run;
    }),
    messages: (id: string) => transact(['messages'], 'readonly', async tx => {
        const rows = await request<Message[]>(tx.objectStore('messages').index('charId').getAll(thread(id)));
        return rows.filter(row => row.metadata?.source === 'story_variant' && row.metadata?.storyVariantRunId === id).sort((a, b) => a.id - b.id);
    }),
    commitTurn: (input: { runId: string; cardId: string; expectedTurn: number; operationId: string; userText: string; reply: StoryVariantSimulationReply }) => transact([STORE, 'messages'], 'readwrite', async tx => {
        const store = tx.objectStore(STORE);
        const run = await request<StoryVariantSimulationRun | undefined>(store.get(input.runId));
        if (!run || run.kind !== 'run' || run.cardId !== input.cardId) throw new Error('异格存档已变化，请重新进入');
        if (run.lastOperationId === input.operationId) return run;
        if (run.status !== 'active' || run.interactionsUsed !== input.expectedTurn || run.interactionsUsed >= 50) throw new Error('故事进度已变化，请重新进入；已生成正文仍留在当前页面');
        const turn = run.interactionsUsed + 1, now = Date.now();
        const metadata = { source: 'story_variant', storyVariantRunId: run.id, storyVariantCardId: run.cardId, storyVariantMode: 'offline', storyVariantTurn: turn };
        const messages = tx.objectStore('messages');
        await request(messages.add({ charId: thread(run.id), role: 'user', type: 'text', content: input.userText, timestamp: now, metadata }));
        await request(messages.add({ charId: thread(run.id), role: 'assistant', type: 'text', content: input.reply.character, timestamp: now + 1,
            metadata: { ...metadata, storyVariantWorldNarration: input.reply.worldNarration, ...(input.reply.directorState ? { storyVariantDirectorState: input.reply.directorState } : {}) } }));
        const next: StoryVariantSimulationRun = { ...run, interactionsUsed: turn, updatedAt: now, lastOperationId: input.operationId,
            ...(turn === 50 ? { status: 'archived', archivedAt: now, archiveReason: 'completed' } : {}) };
        await request(store.put(next));
        return next;
    }),
    archive: (id: string) => transact([STORE], 'readwrite', async tx => {
        const store = tx.objectStore(STORE);
        const run = await request<StoryVariantSimulationRun | undefined>(store.get(id));
        if (!run || run.kind !== 'run') throw new Error('未找到故事');
        if (run.status === 'archived') return run;
        const next: StoryVariantSimulationRun = { ...run, status: 'archived', archivedAt: Date.now(), updatedAt: Date.now(), archiveReason: 'emergency' };
        await request(store.put(next)); return next;
    }),
    share: async (runId: string, text: string) => {
      let sharedMessage: { charId: string; id: number } | undefined;
      const savedRun = await transact([STORE, 'messages', 'characters'], 'readwrite', async tx => {
        const store = tx.objectStore(STORE);
        const run = await request<StoryVariantSimulationRun | undefined>(store.get(runId));
        if (!run || run.kind !== 'run' || run.status !== 'archived') throw new Error('请先封存故事');
        const card = await request<StoryVariantIdentityCard | undefined>(store.get(run.cardId));
        if (!card || !await request(tx.objectStore('characters').get(card.charId))) throw new Error('原角色已不存在，仍可下载故事');
        if (run.sharedAt) return run;
        const now = Date.now();
        const messageId = await request(tx.objectStore('messages').add({ charId: card.charId, role: 'user', type: 'text', content: text, timestamp: now,
            metadata: { source: 'story_variant_share', storyVariantRunId: run.id } }));
        sharedMessage = { charId: card.charId, id: Number(messageId) };
        const next = { ...run, sharedAt: now, updatedAt: now };
        await request(store.put(next)); return next;
      });
      // 与私聊保存一致：提交后清除浏览器清库遗留的旧记忆水位，保证分享可进入上下文。
      if (sharedMessage) {
        try {
          const key = `mp_lastMsgId_${sharedMessage.charId}`;
          if (Number(localStorage.getItem(key)) >= sharedMessage.id) localStorage.removeItem(key);
        } catch { /* 本机存储不可用不影响已提交的故事 */ }
      }
      return savedRun;
    },
};
