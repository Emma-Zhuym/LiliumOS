/** 测试用：上游 xiaohongshu-mcp v2.5 list_feeds 的返回形状（含直播卡、重复、空标题）。 */

export const feedResult = (items = null) => ({
    content: [{
        type: 'text',
        text: JSON.stringify({
            feeds: items ?? [
                { id: 'n1', xsecToken: 'tok1', modelType: 'note', noteCard: { type: 'normal', displayTitle: '秋天第一杯热可可', user: { nickname: '小鹿' }, interactInfo: { likedCount: '1.2万' } } },
                { id: 'live', modelType: 'live_v2', noteCard: {} },
                { id: 'n2', xsecToken: 'tok2', modelType: 'note', noteCard: { type: 'video', displayTitle: '猫咪第一次见雪', user: { nickName: '橘子汽水' }, interactInfo: { likedCount: '356' } } },
                { id: 'n1', modelType: 'note', noteCard: { displayTitle: '秋天第一杯热可可（重复）' } },
                { id: 'n3', modelType: 'note', noteCard: { displayTitle: '' } },
            ],
            count: 5,
        }),
    }],
});
