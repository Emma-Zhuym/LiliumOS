/**
 * 主动消息 2.0 云端快照的两件小事（2026-10-26，worker 被 390KB 的上传撑过 CPU 上限之后加的）：
 *
 * 1. tool_pack 没变就不重传。它装着角色有史以来全部的每日记忆，只在写 / 改记忆时才变，
 *    以前每聊一轮都整份重传。这里按「worker 地址 + 用户 + 角色」记上次传成功那份的指纹，
 *    一样就跳过。指纹 24 小时过期，过期了照传一次：万一云端那份因为别的原因没了
 *    （换库、手动删表），最多晚一天补回去。
 * 2. 记下最近一次冲刷每个角色各块多大，设置 → 主动消息 2.0 →「高级信息」里看。
 *
 * 只碰 localStorage，读写失败一律当没有。
 */

const TOOL_PACK_SIGS_LS_KEY = 'amsg2_tool_pack_sigs';
const UPLOAD_STATS_LS_KEY = 'amsg2_last_upload_stats';
/** 指纹多久不认（照传一次）。 */
export const TOOL_PACK_SIG_TTL_MS = 24 * 60 * 60 * 1000;

/** cyrb53：够用来判「这份字符串变没变」，不是安全哈希。 */
export const hashStateValue = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}:${text.length}`;
};

type SigMap = Record<string, { sig: string; at: number }>;

const readSigs = (): SigMap => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOOL_PACK_SIGS_LS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed as SigMap : {};
  } catch {
    return {};
  }
};

const writeSigs = (sigs: SigMap) => {
  try {
    if (Object.keys(sigs).length === 0) localStorage.removeItem(TOOL_PACK_SIGS_LS_KEY);
    else localStorage.setItem(TOOL_PACK_SIGS_LS_KEY, JSON.stringify(sigs));
  } catch { /* 写不进去就每次都传，跟以前一样 */ }
};

const sigKey = (scope: string, charId: string) => `${scope}|${charId}`;

/** 云端那份是不是已经是这一份（同一台 worker、同一个用户、指纹没过期）。 */
export const isToolPackUploaded = (scope: string, charId: string, sig: string, now = Date.now()): boolean => {
  const hit = readSigs()[sigKey(scope, charId)];
  return !!hit && hit.sig === sig && now - hit.at < TOOL_PACK_SIG_TTL_MS;
};

export const rememberToolPackUploaded = (scope: string, charId: string, sig: string, now = Date.now()) => {
  const sigs = readSigs();
  sigs[sigKey(scope, charId)] = { sig, at: now };
  writeSigs(sigs);
};

/** 云端状态被清掉了（全清 / 删一个角色）：对应指纹作废，下次照传。不传 charId = 全部作废。 */
export const forgetToolPackUploads = (charId?: string) => {
  if (!charId) { writeSigs({}); return; }
  const sigs = readSigs();
  for (const key of Object.keys(sigs)) {
    if (key.endsWith(`|${charId}`)) delete sigs[key];
  }
  writeSigs(sigs);
};

// ─── 最近一次冲刷的体积 ───

export interface AmsgCharUploadSize {
  name: string;
  /** 整份模板的字数（规则 + 系统提示词 + 最近对话）。 */
  templateChars: number;
  systemPromptChars: number;
  transcriptChars: number;
  /** 最近对话超了上限、更早的被省略了。 */
  transcriptCapped: boolean;
  /** fire_pack 压缩后交给上传的字节数。 */
  firePackBytes: number;
  /** tool_pack 压缩后的字节数；null = 没变，这次没传。 */
  toolPackBytes: number | null;
}

export interface AmsgUploadStats {
  at: number;
  ok: boolean;
  /** 整批条目加密前的字节数（加密 + base64 之后实际上传约再大三分之一）。 */
  totalBytes: number;
  chars: AmsgCharUploadSize[];
}

export const recordAmsgUploadStats = (stats: AmsgUploadStats) => {
  try { localStorage.setItem(UPLOAD_STATS_LS_KEY, JSON.stringify(stats)); } catch { /* 只是给人看的 */ }
};

export const readAmsgUploadStats = (): AmsgUploadStats | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(UPLOAD_STATS_LS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.chars) ? parsed as AmsgUploadStats : null;
  } catch {
    return null;
  }
};

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** 字节 → 「12.3 KB」。 */
export const formatKb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
