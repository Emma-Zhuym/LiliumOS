// utils/activeMsgClient.toolPackSkip.test.ts
//
// 回归守卫（2026-10-26）：tool_pack 装着角色全部每日记忆，以前每聊一轮整份重传。
// 现在没变就不传；被拒 / 云端清空之后必须照传，不然 worker 到点读不到 tool_pack 硬失败。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reiClient } = vi.hoisted(() => ({
  reiClient: {
    init: vi.fn(),
    putClientState: vi.fn(),
    getClientState: vi.fn(),
    getCapabilities: vi.fn(),
    putLlmCredentials: vi.fn(),
    deleteLlmCredentials: vi.fn(),
    _encrypt: vi.fn(),
  },
}));
vi.mock('@rei-standard/amsg-client', () => ({ ReiClient: vi.fn(() => reiClient) }));
vi.mock('./keepAlive', () => ({
  KeepAlive: { init: vi.fn().mockResolvedValue(undefined), reregister: vi.fn().mockResolvedValue(undefined) },
}));

const TEST_USER_ID = '3f2b1c8a-9d4e-4a1b-8c2d-000000000044';
const globalConfig: Record<string, unknown> = {
  userId: TEST_USER_ID,
  workerUrl: 'https://amsg.example.workers.dev',
  serverToken: '',
  llmCredentialsSupported: true,
};
vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: {
    ensureUserId: async () => TEST_USER_ID,
    getGlobalConfig: async () => ({ ...globalConfig }),
    saveGlobalConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ActiveMsgClient } from './activeMsgClient';
import { amsgStateNamespace } from './amsgFirePack';
import { forgetAllCredIds } from './amsgLlmCredentials';
import { resetStateClock } from './amsgStateClock';
import { forgetToolPackUploads, readAmsgUploadStats } from './amsgUploadStats';
import { ChatPrompts } from './chatPrompts';
import { DB } from './db';

const charWith = (memories: unknown[]) => ({
  id: 'char-tool-pack', name: '小满', memories,
  activeMsg2Config: { enabled: true, tasks: [] },
} as any);

const sync = (char: any) => ActiveMsgClient.syncCharFirePacks([{
  char,
  config: { enabled: true, tasks: [] } as any,
  userProfile: { name: '小明' } as any,
  groups: [],
  realtimeConfig: {} as any,
}]);

const keysOfCall = (n: number): string[] => reiClient.putClientState.mock.calls[n][0].map((e: any) => e.key);

beforeEach(() => {
  localStorage.clear();
  forgetToolPackUploads();
  resetStateClock();
  forgetAllCredIds();
  reiClient.init.mockReset().mockResolvedValue(undefined);
  reiClient.putClientState.mockReset().mockResolvedValue({ success: true });
  reiClient.getClientState.mockReset().mockResolvedValue({ success: true, data: { entries: [] } });
  reiClient.getCapabilities.mockReset().mockResolvedValue({ serverVersion: '2.6.0-next.27', features: [] });
  vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([] as any);
  vi.spyOn(DB, 'getEmojis').mockResolvedValue([] as any);
  vi.spyOn(DB, 'getEmojiCategories').mockResolvedValue([] as any);
  vi.spyOn(ChatPrompts, 'buildSystemPrompt').mockResolvedValue('SYS');
  vi.spyOn(ChatPrompts, 'buildMessageHistory').mockReturnValue({ apiMessages: [] } as any);
  vi.spyOn(ChatPrompts, 'filterVisibleEmojis').mockReturnValue({ emojis: [], categories: [] } as any);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => ({
    status: 200,
    text: async () => JSON.stringify({ success: true, data: {} }),
    headers: new Headers({ 'content-type': 'application/json' }),
  })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tool_pack 没变就不重传', () => {
  it('第一次带上，第二次内容没变只传 fire_pack', async () => {
    const char = charWith([{ date: '2026-10-01', summary: '去看海' }]);
    await sync(char);
    await sync(char);
    expect(keysOfCall(0)).toEqual(['fire_pack', 'tool_pack']);
    expect(keysOfCall(1)).toEqual(['fire_pack']);
  });

  it('记忆变了就照传', async () => {
    await sync(charWith([{ date: '2026-10-01', summary: '去看海' }]));
    await sync(charWith([{ date: '2026-10-01', summary: '去看海' }, { date: '2026-10-02', summary: '吃火锅' }]));
    expect(keysOfCall(1)).toEqual(['fire_pack', 'tool_pack']);
  });

  it('上传失败不记指纹，下次照传', async () => {
    const char = charWith([]);
    reiClient.putClientState.mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(sync(char)).rejects.toThrow('Load failed');
    await sync(char);
    expect(keysOfCall(1)).toContain('tool_pack');
  });

  it('tool_pack 那条被服务端拒了不记指纹', async () => {
    const char = charWith([]);
    reiClient.putClientState.mockResolvedValueOnce({
      success: true,
      data: { rejected: [{ namespace: amsgStateNamespace(char.id), key: 'tool_pack', message: 'bad' }] },
    });
    await sync(char);
    await sync(char);
    expect(keysOfCall(1)).toContain('tool_pack');
  });

  it('清了这个角色的云端状态之后照传', async () => {
    const char = charWith([]);
    await sync(char);
    await ActiveMsgClient.clearCharClientState(char.id).catch(() => {});
    await sync(char);
    expect(keysOfCall(reiClient.putClientState.mock.calls.length - 1)).toContain('tool_pack');
  });
});

describe('最近一次上传的体积', () => {
  it('成功的那批按角色记下各块大小，没传的记忆包记 null', async () => {
    const char = charWith([{ date: '2026-10-01', summary: '去看海' }]);
    await sync(char);
    const first = readAmsgUploadStats()!;
    expect(first.ok).toBe(true);
    expect(first.chars[0]).toMatchObject({ name: '小满', systemPromptChars: 3, transcriptCapped: false });
    expect(first.chars[0].toolPackBytes).toBeGreaterThan(0);
    expect(first.totalBytes).toBeGreaterThan(first.chars[0].firePackBytes);

    await sync(char);
    expect(readAmsgUploadStats()!.chars[0].toolPackBytes).toBeNull();
  });

  it('失败的那批也记，标成失败', async () => {
    reiClient.putClientState.mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(sync(charWith([]))).rejects.toThrow();
    expect(readAmsgUploadStats()!.ok).toBe(false);
  });
});
