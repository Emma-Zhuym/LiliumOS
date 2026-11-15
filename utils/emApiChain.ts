// [EM-START: heartbeat-api-chain]
/**
 * 主 API 1–4、副 API 1–4（阿萌 2026-11-14，全局一份）。
 *
 * 主 = 聊天：先用角色自己绑的那条（或全局主 API），不通再按主 1→4 接着试（一样的跳过）。
 *   本机生成在 useChatAI 里试；交给 mini 的那一轮把备用一起送去，mini 自己试。只在手机上用，不传 Key 到 mini 存着。
 * 副 = 心跳：mini 心跳按副 1→4 试（补评论这类杂活跟那一跳用上的那条），全挂了推通知。
 *   没排就照旧只用窗台里给每个角色选的那条。同步时把副的 Key 推给 mini（固定名 chain-sub-1…），
 *   再把顺序写进 mini 的设置；排短了多出来的在 mini 上删掉，Key 不留。
 * 选择存本机，不进备份。
 */

import type { ApiPreset } from '../types';
import { AgentBackend } from './emAgentBackend';

export const API_CHAIN_SLOTS = 4;
export type ApiChainTier = 'main' | 'sub';
export interface ApiChainChoice { main: string[]; sub: string[] }

const STORAGE_KEY = 'em_agent_api_chain_v1';

const slots = (list: unknown): string[] => {
    const arr = Array.isArray(list) ? list.map(v => (typeof v === 'string' ? v : '')) : [];
    return Array.from({ length: API_CHAIN_SLOTS }, (_, i) => arr[i] ?? '');
};

export const loadApiChain = (): ApiChainChoice => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return { main: slots(parsed.main), sub: slots(parsed.sub) };
    } catch {
        return { main: slots([]), sub: slots([]) };
    }
};

export const saveApiChain = (choice: ApiChainChoice) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ main: slots(choice.main), sub: slots(choice.sub) })); } catch { /* 存不下就只在 mini 上 */ }
};

export const chainRef = (tier: ApiChainTier, index: number) => `chain-${tier}-${index + 1}`;

const complete = (preset: ApiPreset | undefined): preset is ApiPreset =>
    Boolean(preset?.config?.baseUrl && preset.config.apiKey && preset.config.model);

export interface ApiChainPlan {
    puts: { ref: string; baseUrl: string; model: string; apiKey: string }[];
    deletes: string[];
    order: { main: string[]; sub: string[] };
    /** 选了但找不到 / 没填全的预设（被删了、Key 空着），同步时跳过 */
    skipped: string[];
}

export interface ChatFallbackApi { baseUrl: string; apiKey: string; model: string; name: string }

/** 聊天这一轮本来的 API 不通时，按主 1→4 接着试哪几条（跟本来那条「地址 + 模型」一样的跳过）。 */
export const chatFallbackApis = (
    primary: { baseUrl?: string; model?: string },
    presets: ApiPreset[],
    choice: ApiChainChoice = loadApiChain(),
): ChatFallbackApi[] => {
    const keyOf = (api: { baseUrl?: string; model?: string }) => `${String(api.baseUrl || '').replace(/\/+$/, '')}|${api.model || ''}`;
    const seen = new Set([keyOf(primary)]);
    const out: ChatFallbackApi[] = [];
    for (const id of slots(choice.main).filter(Boolean)) {
        const preset = presets.find(p => p.id === id);
        if (!complete(preset) || seen.has(keyOf(preset.config))) continue;
        seen.add(keyOf(preset.config));
        out.push({ baseUrl: preset.config.baseUrl, apiKey: preset.config.apiKey, model: preset.config.model, name: preset.name });
    }
    return out;
};

/** 同步要做什么：空位、找不到的预设跳过，后面的往前补（主 1 空着、主 2 有，就是从主 2 开始试）。 */
export const planApiChainSync = (choice: ApiChainChoice, presets: ApiPreset[]): ApiChainPlan => {
    const plan: ApiChainPlan = { puts: [], deletes: [], order: { main: [], sub: [] }, skipped: [] };
    // 主 API 是聊天的，只在手机上用，不推给 mini；只同步副（心跳）
    for (const tier of ['sub'] as const) {
        const picked = slots(choice[tier]).filter(Boolean);
        const usable: ApiPreset[] = [];
        for (const id of picked) {
            const preset = presets.find(p => p.id === id);
            if (complete(preset)) usable.push(preset);
            else plan.skipped.push(presets.find(p => p.id === id)?.name || id);
        }
        usable.forEach((preset, i) => {
            const ref = chainRef(tier, i);
            plan.puts.push({ ref, baseUrl: preset.config.baseUrl, model: preset.config.model, apiKey: preset.config.apiKey });
            plan.order[tier].push(ref);
        });
        for (let i = usable.length; i < API_CHAIN_SLOTS; i += 1) plan.deletes.push(chainRef(tier, i));
    }
    return plan;
};

/** 推 Key、删多余、写顺序。返回给她看的一句话。 */
export const syncApiChain = async (choice: ApiChainChoice, presets: ApiPreset[]): Promise<string> => {
    const plan = planApiChainSync(choice, presets);
    for (const put of plan.puts) await AgentBackend.putCredential(put);
    await AgentBackend.putSettings({ apiChain: plan.order });
    // 删在写顺序之后：先删的话，删掉、顺序还没改的那一下，心跳会去找不在的凭据
    for (const ref of plan.deletes) await AgentBackend.deleteCredential(ref).catch(() => false);
    // 上一版把主 API 也推过去了，顺手删掉
    for (let i = 0; i < API_CHAIN_SLOTS; i += 1) await AgentBackend.deleteCredential(chainRef('main', i)).catch(() => false);
    const summary = plan.order.sub.length
        ? `已同步：心跳按副 API ${plan.order.sub.length} 条依次试`
        : '已清空，心跳照旧用窗台里选的那条';
    return plan.skipped.length ? `${summary}（跳过了没填全的：${plan.skipped.join('、')}）` : summary;
};
// [EM-END: heartbeat-api-chain]
