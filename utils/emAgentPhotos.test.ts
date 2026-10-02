// [EM-START: heartbeat-photos]
import { describe, expect, it } from 'vitest';

import { parsePhotoBubble } from './emAgentPhotos';

describe('心跳消息里的照片', () => {
    it('认后端教的写法', () => {
        expect(parsePhotoBubble('[[SEND_PHOTO: steamed sea bass on a white plate, no people in frame]]'))
            .toBe('steamed sea bass on a white plate, no people in frame');
        expect(parsePhotoBubble('  [[send_photo：a kitchen island with grocery bags]]  ')).toBe('a kitchen island with grocery bags');
    });

    it('也认模型模仿聊天记录写出来的中文描述', () => {
        expect(parsePhotoBubble('[一张照片：白瓷盘里一条清蒸鲈鱼，葱丝姜丝铺满]')).toBe('白瓷盘里一条清蒸鲈鱼，葱丝姜丝铺满');
        expect(parsePhotoBubble('【照片：厨房岛台上堆着超市购物袋】')).toBe('厨房岛台上堆着超市购物袋');
        expect(parsePhotoBubble('[你发了一张照片：窗外的晚霞]')).toBe('窗外的晚霞');
    });

    it('普通的话、夹在句子里的不算', () => {
        expect(parsePhotoBubble('早饭吃了什么')).toBeNull();
        expect(parsePhotoBubble('我刚拍了一张照片：你看看')).toBeNull();
        expect(parsePhotoBubble('给你看 [[SEND_PHOTO: x]] 好看吧')).toBeNull();
        expect(parsePhotoBubble('[[SEND_PHOTO: ]]')).toBeNull();
    });
});
// [EM-END: heartbeat-photos]
