// [EM-START: heartbeat-api-chain]
/**
 * Mac mini 心跳的主 API 1–4、副 API 1–4（阿萌 2026-11-14，全局一份）。
 *
 * 主：TA 醒来想做什么、说什么，按 1→4 试，全挂了只推通知，不降到副（副多是 flash / 便宜模型）。
 * 副：补朋友圈亲友评论这类杂活，按 1→4 试；没排就跟那一跳用上的那条。
 * 都没排：心跳照旧只用窗台里给每个角色选的那条。
 *
 * 选的是设置里的 API 预设；同步时把 Key 推给 mini（固定名 chain-main-1… / chain-sub-1…），
 * 再把顺序写进 mini 的设置。排短了，多出来的那几条在 mini 上删掉，Key 不留。
 * 选择存本机，不进备份（顺序在 mini 上也有一份）。
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

/** 同步要做什么：空位、找不到的预设跳过，后面的往前补（主 1 空着、主 2 有，就是从主 2 开始试）。 */
export const planApiChainSync = (choice: ApiChainChoice, presets: ApiPreset[]): ApiChainPlan => {
    const plan: ApiChainPlan = { puts: [], deletes: [], order: { main: [], sub: [] }, skipped: [] };
    for (const tier of ['main', 'sub'] as const) {
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
    const summary = plan.order.main.length || plan.order.sub.length
        ? `已同步：主 ${plan.order.main.length} 条、副 ${plan.order.sub.length} 条`
        : '已清空，心跳照旧用窗台里选的那条';
    return plan.skipped.length ? `${summary}（跳过了没填全的：${plan.skipped.join('、')}）` : summary;
};
// [EM-END: heartbeat-api-chain]
