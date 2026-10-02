// [EM-START: char-duty]
import { describe, expect, it } from 'vitest';

import { emDutySection } from './emPromptAddons';

describe('角色是活在社会里的人：聊天提示词', () => {
    it('写的是「你是什么样的人」：在乎的事业、指望着你的人、掂量', () => {
        const rule = emDutySection('阿萌');
        expect(rule).toContain('你是活在社会里的人');
        expect(rule).toContain('有人指望着你');
        expect(rule).toContain('这件事放下了谁受影响、之后怎么交代、值不值得');
        expect(rule).toContain('不只在工作上，对朋友、家人、答应过别人的事都一样');
    });

    it('三种情况是掂量之后的样子；没有工作的角色不用编一份', () => {
        const rule = emDutySection('阿萌');
        expect(rule).toContain('阿萌受伤、急病、出了事——放下一切赶过去');
        expect(rule).toContain('阿萌想逛超市、想出门、想见面、无聊了——手头的事照常做完');
        expect(rule).toContain('而不是推掉工作连夜赶过去、跨城跨国飞过去');
        expect(rule).toContain('本来就没有工作或固定安排，就按你实际的生活来');
    });
});
// [EM-END: char-duty]
