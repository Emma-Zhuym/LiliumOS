// [EM-START: contact-groups]
/**
 * 查手机联系人的分组：家人 / 朋友 / 工作 / 学校 / 生活服务 / 网友 / 其他。
 *
 * 分组是「TA 的社交圈长什么样」的最粗一层，和 kind（真人 / 虚构）是两回事：
 * 一个真人角色可以是 TA 的同事，一个虚构 NPC 可以是 TA 的发小。
 *
 * 不给某个角色定制：分组是固定的一份清单，任何角色的通讯录都按同一套认。
 * 老联系人没有 group 字段，按 identity（关系备注）里的关键词推断，不用迁移、不用重新生成；
 * 推断错了用户手动改一下，就会锁住（groupManual），后面的扫描不会改回去。
 */

import type { ContactGroupId, PhoneContact } from '../types';

export interface ContactGroupDef {
    id: ContactGroupId;
    label: string;
    /** 给用户和模型看的一句话说明。 */
    hint: string;
}

/** 显示顺序就是这里的顺序。 */
export const CONTACT_GROUPS: ContactGroupDef[] = [
    { id: 'family', label: '家人', hint: '父母、配偶、兄弟姐妹、亲戚' },
    { id: 'friend', label: '朋友', hint: '发小、老友、玩得来的人' },
    { id: 'work', label: '工作', hint: '同事、上司、下属、客户、合作方' },
    { id: 'school', label: '学校', hint: '同学、老师、学长学姐、室友' },
    { id: 'service', label: '生活服务', hint: '司机、医生、房东、邻居、常去的店' },
    { id: 'online', label: '网友', hint: '网上认识的人、游戏和社群里的人' },
    { id: 'other', label: '其他', hint: '不好归类，或者不太熟的人' },
];

export const CONTACT_GROUP_IDS: ContactGroupId[] = CONTACT_GROUPS.map(group => group.id);

const LABEL_BY_ID = new Map(CONTACT_GROUPS.map(group => [group.id, group.label]));
export const contactGroupLabel = (id: ContactGroupId): string => LABEL_BY_ID.get(id) ?? '其他';

/** 模型有时会吐中文或近义词，这里都收成固定的 id。认不出就返回 undefined，交给推断。 */
const ALIASES: Record<string, ContactGroupId> = {
    family: 'family', 家人: 'family', 家庭: 'family', 亲人: 'family', 亲戚: 'family',
    friend: 'friend', friends: 'friend', 朋友: 'friend', 好友: 'friend',
    work: 'work', job: 'work', colleague: 'work', 工作: 'work', 同事: 'work', 职场: 'work', 公司: 'work',
    school: 'school', 学校: 'school', 同学: 'school', 学业: 'school', 校园: 'school',
    service: 'service', 生活服务: 'service', 服务: 'service', 生活: 'service',
    online: 'online', 网友: 'online', 线上: 'online', 网络: 'online',
    other: 'other', 其他: 'other', 其它: 'other', 未分类: 'other',
};

export const normalizeContactGroup = (raw: unknown): ContactGroupId | undefined => {
    if (typeof raw !== 'string') return undefined;
    return ALIASES[raw.trim().toLowerCase()];
};

/**
 * 从关系备注里猜分组。顺序有讲究，越容易被别的词带偏的越靠前：
 * 「网友」里带「友」、「游戏公司同事」里带「游戏」，所以线上只认很具体的几个词。
 */
const RULES: Array<[ContactGroupId, RegExp]> = [
    ['online', /网友|群友|笔友|队友|粉丝|主播|彼方/],
    ['family', /父亲|母亲|爸|妈|爷爷|奶奶|外公|外婆|祖父|祖母|哥哥|姐姐|弟弟|妹妹|兄弟姐妹|叔叔|婶|伯父|伯母|姑姑|姑妈|姨妈|小姨|舅|表[哥姐弟妹]|堂[哥姐弟妹]|亲戚|家人|家属|老婆|老公|妻子|丈夫|夫人|前妻|前夫|未婚夫|未婚妻|配偶|姐夫|嫂|儿子|女儿|孩子|岳父|岳母|婆婆|公公|继父|继母/],
    ['friend', /朋友|哥们|闺蜜|死党|发小|好友|老友|损友|搭子|兄弟/],
    ['service', /司机|医生|大夫|护士|房东|邻居|保姆|管家|保镖|快递|外卖|教练|律师|会计|理发|裁缝|店|摊/],
    ['school', /同学|老师|教授|导师|辅导员|班主任|学长|学姐|学弟|学妹|室友|社团|校友|助教/],
    ['work', /同事|上司|领导|老板|总监|经理|主管|下属|秘书|助理|特助|客户|甲方|乙方|合作|供应商|董事|股东|合伙人|同行|前辈|搭档|组长|部门/],
];

export const inferContactGroup = (identity?: string, note?: string): ContactGroupId | undefined => {
    // 关系备注是最直接的证据；没有时才看备注开头，备注通常一大段、会提到好几种关系，不能整段拿来猜。
    const text = identity?.trim() || note?.trim().slice(0, 40) || '';
    if (!text) return undefined;
    return RULES.find(([, pattern]) => pattern.test(text))?.[0];
};

/** 这个联系人到底算哪一组：明确指定的 > 按关系备注推断的 > 其他。 */
export const resolveContactGroup = (contact: Pick<PhoneContact, 'group' | 'identity' | 'note'>): ContactGroupId =>
    normalizeContactGroup(contact.group) ?? inferContactGroup(contact.identity, contact.note) ?? 'other';

export interface ContactSection {
    group: ContactGroupDef;
    contacts: PhoneContact[];
}

/** 按分组切成段，空的组不出现；组内保持传进来的顺序（调用方已经按最近联系排好）。 */
export const groupContacts = (contacts: PhoneContact[]): ContactSection[] =>
    CONTACT_GROUPS
        .map(group => ({ group, contacts: contacts.filter(contact => resolveContactGroup(contact) === group.id) }))
        .filter(section => section.contacts.length > 0);

/** 写进生成提示词的分组说明：让模型每个联系人都归一组。 */
export const CONTACT_GROUP_PROMPT = `"group" 从这几个里选一个（写英文 id）：${CONTACT_GROUPS.map(group => `${group.id}=${group.label}（${group.hint}）`).join('；')}`;
// [EM-END: contact-groups]
