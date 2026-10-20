/**
 * 生活小事里「跟谁来往」由程序挑，并且不许把聊过的事再聊一遍（2026-10-19）。
 *
 * 实测一周：昂哥约卫斯理「下周二晚上喝酒」约了 8 次、李文给陆时确认「周一家宴菜单」确认了 7 次、
 * 周鹏约陈照「下周六打 rank」约了 6 次。原因有两层：
 * - 约定一直挂在提示词里（「你跟别人约好、还没到时间的事」），模型抽到「跟朋友聊几句」就拿它当话题重聊；
 * - 挑人交给模型，它总挑同一个（2026-10-09 把名单倒过来排过，不够）。
 * 所以：程序挑最久没来往的那个人；提示词里列出最近两三天跟谁聊过什么、哪些事已经约好了；
 * 落地前再按字面查一遍，跟同一个人聊的跟最近哪次差不多，就当这一跳没写生活小事。
 */

import { coverage } from './pocket.mjs';

export const PARTNER_LOOKBACK_MS = 72 * 60 * 60 * 1000;
/** 跟同一个人的这段话被最近某次盖住这么多，就算重聊。按一周真实记录定的：重聊的落在 0.47–1，不同的话题在 0.3 以下。 */
export const REPEAT_CHAT_COVERAGE = 0.45;

const linesText = life => [
    life?.detail ?? '',
    ...(Array.isArray(life?.lines) ? life.lines.map(line => line?.text ?? '') : []),
].join(' ').trim();

/** 最近三天生活小事里来往过的人：名字 → 次数、最近一次、最近那次聊了什么。 */
export const recentPartners = (db, charId, now = new Date()) => {
    const rows = db.prepare(
        `SELECT started_at, episode FROM model_runs
          WHERE char_id = ? AND ok = 1 AND shadow = 0 AND episode IS NOT NULL AND started_at >= ?
          ORDER BY id ASC`,
    ).all(charId, new Date(now.getTime() - PARTNER_LOOKBACK_MS).toISOString());
    const byName = new Map();
    for (const row of rows) {
        let life = null;
        try { life = JSON.parse(row.episode)?.life ?? null; } catch { /* 截断的 JSON 跳过 */ }
        if (!life || (life.kind !== 'chat' && life.kind !== 'social')) continue;
        const name = typeof life.with === 'string' ? life.with.trim() : '';
        if (!name) continue;
        const prev = byName.get(name) ?? { name, count: 0, lastAt: null, texts: [] };
        prev.count += 1;
        prev.lastAt = row.started_at;
        prev.texts.push(linesText(life));
        byName.set(name, prev);
    }
    return [...byName.values()];
};

/**
 * 这次跟谁：圈子里最近三天没来往过的优先，都来往过就挑最久以前那个；同样久的随机。
 * 圈子空着就不挑（模型可以写新认识的人）。
 */
export const pickPartner = (circle = [], partners = [], rng = Math.random) => {
    const people = (Array.isArray(circle) ? circle : []).filter(person => person?.name);
    if (!people.length) return null;
    const lastAt = name => {
        const seen = partners.find(partner => partner.name === name);
        return seen?.lastAt ? Date.parse(seen.lastAt) : 0;
    };
    const oldest = Math.min(...people.map(person => lastAt(person.name)));
    const pool = people.filter(person => lastAt(person.name) === oldest);
    // 只有一个人时不取随机数：心跳的随机序列是测试钉死的，别平白多吃一个
    return pool.length === 1 ? pool[0] : (pool[Math.floor(rng() * pool.length)] ?? pool[0]);
};

/** 跟同一个人的这段，跟最近三天里哪次聊的差不多，就是在重聊。 */
export const isRepeatChat = (life, partners = []) => {
    if (!life || (life.kind !== 'chat' && life.kind !== 'social')) return false;
    const seen = partners.find(partner => partner.name === String(life.with ?? '').trim());
    if (!seen) return false;
    const text = linesText(life);
    if (!text) return false;
    return seen.texts.some(previous => previous && coverage(text, previous) >= REPEAT_CHAT_COVERAGE);
};

/** 写给模型的那段：这次跟谁、最近跟谁聊过什么、哪些已经约好了不用再约。 */
export const formatPartnerBrief = ({ partner = null, partners = [], plans = [] } = {}) => {
    const lines = [];
    if (partner) {
        lines.push(`这次是跟「${partner.name}」${partner.relation ? `（${partner.relation}）` : ''}有点来往，with 就写这个名字。`);
    }
    const recent = partners
        .slice()
        .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
        .slice(0, 4)
        .map(p => `${p.name}（${p.count} 次，最近一次聊的是：${(p.texts[p.texts.length - 1] || '').slice(0, 60)}）`);
    if (recent.length) lines.push(`你这两三天已经跟这些人来往过：${recent.join('；')}。聊过的别再聊一遍。`);
    if (plans.length) {
        lines.push(`这些事已经约好了，不用再约一遍、也别拿它当这次的话题：${plans.map(t => t.title).join('、')}。`);
    }
    lines.push('这次聊点新的：对方那边最近发生的事、你这边刚遇到的、一个随口的玩笑或者吐槽都行。');
    return lines.join('\n');
};
