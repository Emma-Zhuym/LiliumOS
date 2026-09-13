export type StoryVariantOptionPool = 'variant' | 'story';
export type StoryVariantOptionAccent = 'blue' | 'red' | 'olive' | 'violet' | 'ivory' | 'graphite' | 'rose' | 'teal';

export type StoryVariantOptionDefinition = {
    id: string;
    pool: StoryVariantOptionPool;
    title: string;
    group: string;
    summary: string;
    accent: StoryVariantOptionAccent;
    sigil: 'compass' | 'chain' | 'branch' | 'rose' | 'sun' | 'blade' | 'heart' | 'web';
    memory: string;
    routeTags?: string[];
};

const ACCENTS: StoryVariantOptionAccent[] = ['blue', 'red', 'olive', 'violet', 'ivory', 'graphite', 'rose', 'teal'];
const SIGILS: StoryVariantOptionDefinition['sigil'][] = ['compass', 'chain', 'branch', 'rose', 'sun', 'blade', 'heart', 'web'];

const makeModule = (
    pool: StoryVariantOptionPool,
    index: number,
    title: string,
    group: string,
    summary: string,
    memory: string,
    routeTags?: string[],
): StoryVariantOptionDefinition => ({
    id: `${pool}-${String(index + 1).padStart(2, '0')}`,
    pool,
    title,
    group,
    summary,
    memory,
    routeTags,
    accent: ACCENTS[index % ACCENTS.length],
    sigil: SIGILS[index % SIGILS.length],
});

const VARIANT_SOURCE: Array<[string, string, string]> = [
    ['未曾被你改变', '关系偏移', '一切照常发生，唯独你从未进入过 TA 的生命。'],
    ['记忆之外', '认知缺口', 'TA 记得世界，却找不到任何与你有关的证据。'],
    ['被你改变得太多', '关系偏移', '你留下的影响已经压过了 TA 原本的性格。'],
    ['不再需要你', '关系偏移', 'TA 已经学会独自完成过去只能与你一起完成的事。'],
    ['被你遗弃过', '关系偏移', '在这条分歧里，等待确实以你的缺席告终。'],
    ['没有伤口的人', '经历改写', '那件塑造 TA 的坏事从来没有发生。'],
    ['伤口从未愈合', '经历改写', '时间向前走了，伤口却留在最初的形状。'],
    ['已经得到一切', '欲望终点', 'TA 曾经追逐的东西都已握在手中。'],
    ['主动放弃', '欲望终点', 'TA 清醒地放下了曾经绝不肯让步的目标。'],
    ['成为了自己最讨厌的人', '信念断面', '为了抵达终点，TA 接受了曾经最厌恶的方式。'],
    ['最正确的 TA', '信念断面', '每次选择都符合原则，但正确没有让 TA 更幸福。'],
    ['被所有人喜欢的 TA', '社会投影', 'TA 成为了所有人期待的样子，只剩你看得出违和。'],
    ['信念尽头', '信念断面', '那套曾支撑 TA 的信念已经走到无法继续的地方。'],
    ['越过底线', '信念断面', 'TA 已经做过那件原本坚信自己永远不会做的事。'],
    ['不允许被定义', '自我认知', 'TA 拒绝接受设定、他人和过去给出的任何结论。'],
    ['最后一次相信', '关系偏移', 'TA 愿意再相信一次，但不会有下一次。'],
    ['只剩核心', '人格剥离', '身份、习惯与经历被逐层剥离，只留下不可让渡的部分。'],
    ['第二个自己', '人格映照', '另一个同样确信自己是本体的 TA 出现了。'],
    ['我只是模拟', '自我认知', 'TA 接受自己是一次推演，并重新衡量所有感受。'],
    ['我就是我', '自我认知', '无论诞生方式如何，TA 拒绝把自我交给外部证明。'],
    ['共享意识', '人格边界', 'TA 与另一个意识共享记忆，却无法共享全部意愿。'],
    ['已经知道结局', '因果知情', 'TA 知道这段关系会怎样结束，仍然抵达了你面前。'],
    ['很久以后的 TA', '时间切片', '漫长岁月之后，TA 带着你尚未经历的历史回来。'],
    ['回到很久以前', '时间切片', 'TA 回到了尚未成为如今自己的时期。'],
    ['走完结局之后', '时间切片', '故事已经结束，TA 却还要处理结局之后的生活。'],
];

export const STORY_VARIANT_OPTIONS: StoryVariantOptionDefinition[] = VARIANT_SOURCE.map(([title, group, summary], index) =>
    makeModule('variant', index, title, group, summary, '现实层只读取关系门牌；异格在异世界中的身份、执念与行动必须优先。'),
);

const STORY_SOURCE: Array<[string, string, string, string[]]> = [
    ['王城处刑夜', '战争异界', '处刑钟已经敲响，你们分属敌对阵营，其中一人的名字正写在王城断头台上。', ['王城', '敌对', '处刑']],
    ['神殿叛逃令', '战争异界', '角色奉命追捕携带禁忌神谕逃亡的你，却在抓到你的那一刻发现追杀令写着自己的真名。', ['神殿', '追逐', '背叛']],
    ['龙灾围城', '战争异界', '最后一道城门即将失守，你们一个掌握驯龙契约，一个背负必须杀死那条龙的命令。', ['龙灾', '围城', '冲突']],
    ['魔王停战线', '战争异界', '决战已经进行到双方都无法回头，你们被迫共享一枚会同时夺走两人性命的停战印。', ['魔王', '同盟', '决战']],
    ['浮空学院坠落', '魔法异界', '浮空学院正在解体坠落，你们必须穿过已经叛变的学院塔，在撞地前夺回核心。', ['学院', '坠落', '魔法']],
    ['蒸汽帝国政变', '机械异界', '皇帝遇刺、全城封锁，你们手里各有半份能证明真正继承人的机械遗诏。', ['蒸汽', '政变', '潜伏']],
    ['公会灭服前夜', '游戏异界', '大型线上世界将在黎明永久关服，你们的公会却发现所有 NPC 正在阻止玩家登出。', ['MMO', '公会', '关服']],
    ['废土最后列车', '末日异界', '污染潮追着最后一班列车逼近，而车上只剩一张能够进入安全区的身份票。', ['废土', '列车', '生存']],
    ['深海神国祭典', '神话异界', '沉没王国的献祭已经开始，你们必须在海水灌满神殿前决定谁来冒充失踪的神明。', ['深海', '祭典', '献祭']],
    ['暴雪古堡继承夜', '怪谈异界', '所有继承人都被困在会改变房间位置的古堡里，午夜前必须找出已经死过一次的那个人。', ['古堡', '暴雪', '悬疑']],
    ['无限回廊末门', '怪谈异界', '你们已经死循环了九十九次，这一次终于走到从未出现过的最后一扇门。', ['循环', '回廊', '末门']],
    ['封锁星舰跃迁', '星海异界', '星舰即将跃迁进恒星，主控系统只允许一个拥有完整人格记录的人取消航线。', ['星舰', '封锁', '人格']],
    ['无谎王都审判', '规则异界', '在无法说谎的王都，你们正在接受叛国审判，而真正会定罪的是没有说出口的部分。', ['审判', '真相', '规则']],
    ['真名禁林契约', '规则异界', '你们已经交换真名并被迫共享伤害，猎人此刻正沿着其中一人的血迹逼近。', ['真名', '契约', '追猎']],
    ['七日伴侣契', '规则异界', '缔结七日的伴侣契约只剩最后一夜，到期时世界会收回你们共同拥有过的一切。', ['倒计时', '契约', '关系']],
    ['情绪魔法暴走', '规则异界', '无法说出口的情绪正在化为失控魔法，整座城市已经开始按照你们的关系改变形状。', ['情绪', '魔法', '城市']],
    ['终战日轮回', '因果异界', '同一场世界末日已经重演多次，这一轮只有你们记得上一次是谁亲手启动了灾难。', ['轮回', '末日', '残响']],
    ['未来讣告来信', '因果异界', '来自不同未来的讣告连续抵达，每一封都说你们中的另一人会在今夜死亡。', ['书信', '未来', '死亡预告']],
    ['千年重逢门', '因果异界', '你只离开了片刻，角色却已经守过这道门一千年，而门将在重逢后立刻关闭。', ['时差', '重逢', '门']],
    ['被抹去的圣战日', '因果异界', '历史里消失的那一天重新出现，你们身上的旧伤证明两人曾在这里做过相反的选择。', ['失忆', '圣战', '调查']],
    ['假婚潜入王宫', '任务异界', '假婚仪式已经进行到宣誓环节，暗杀目标突然当众说出了你们真正的关系。', ['伪装', '王宫', '关系']],
    ['护送末代神明', '任务异界', '世界最后一位神明必须在天亮前抵达陨落祭坛，而护送者收到的新命令是途中处决 TA。', ['护送', '神明', '背叛']],
    ['盗取世界核心', '任务异界', '你们已经进入核心密库，却发现要盗走的“物品”正用其中一人的声音请求被留下。', ['潜入', '共犯', '世界核心']],
    ['唯一归还名额', '终局异界', '世界崩塌只剩最后一道返航门，它已经确认你们之中只有一个能保留原来的记忆离开。', ['抉择', '崩塌', '封闭结局']],
];

export const STORY_WORLD_OPTIONS: StoryVariantOptionDefinition[] = STORY_SOURCE.map(([title, group, summary, routeTags], index) =>
    makeModule('story', index, title, group, summary, '现实层只保留双方关系门牌；禁止调用具体聊天与事件记忆，禁止把异世界变成现实复盘。', routeTags),
);

export const STORY_VARIANT_ALL_OPTIONS = [...STORY_VARIANT_OPTIONS, ...STORY_WORLD_OPTIONS];

export const getStoryVariantOptions = (pool: StoryVariantOptionPool) => pool === 'variant' ? STORY_VARIANT_OPTIONS : STORY_WORLD_OPTIONS;

export const getStoryVariantOption = (id: string) => STORY_VARIANT_ALL_OPTIONS.find(module => module.id === id);


export const randomStoryVariantCombination = () => ({ variantId: STORY_VARIANT_OPTIONS[Math.floor(Math.random() * STORY_VARIANT_OPTIONS.length)].id, storyId: STORY_WORLD_OPTIONS[Math.floor(Math.random() * STORY_WORLD_OPTIONS.length)].id });
