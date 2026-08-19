import { describe, expect, it } from 'vitest';
import {
    ensureRequestedPhotoDirective,
    isExplicitPhotoRequest,
    normalizeAssistantActionFormatting as normalize,
} from './assistantActionFormat';

describe('normalizeAssistantActionFormatting', () => {
    it('修复单括号与展示态表情，并保持规范标签幂等', () => {
        expect(normalize('[SEND_EMOJI: 开心]')).toBe('[[SEND_EMOJI: 开心]]');
        expect(normalize('[表情：小狗泪丧]')).toBe('[[SEND_EMOJI: 小狗泪丧]]');
        expect(normalize('[[SEND_EMOJI: 开心]]')).toBe('[[SEND_EMOJI: 开心]]');
    });

    it('修复转账 ACTION 的单括号，不碰普通转账叙述', () => {
        expect(normalize('[ACTION:TRANSFER|to=user|amount=520]'))
            .toBe('[[ACTION:TRANSFER|to=user|amount=520]]');
        expect(normalize('[ACTION:TRANSFER: 13]')).toBe('[[ACTION:TRANSFER:13]]');
        expect(normalize('[ACTION:TRANSFER_ACCEPT]')).toBe('[[ACTION:TRANSFER_ACCEPT]]');
        expect(normalize('我刚给你转了 520，记得收')).toBe('我刚给你转了 520，记得收');
    });

    it('兼容单括号与 virtual-phone 中文照片标签', () => {
        expect(normalize('[SEND_PHOTO: candid selfie]')).toBe('[[SEND_PHOTO: candid selfie]]');
        expect(normalize('[照片:使用参考图:窗边自拍]')).toBe('[[SEND_PHOTO: 窗边自拍]]');
        expect(normalize('[[照片：雨夜街景]]')).toBe('[[SEND_PHOTO: 雨夜街景]]');
    });

    it('明确索图且模型漏标签时补一次，否定请求与已有标签不补', () => {
        expect(isExplicitPhotoRequest('哥哥发个自拍看看')).toBe(true);
        expect(isExplicitPhotoRequest('不用发自拍啦')).toBe(false);
        expect(ensureRequestedPhotoDirective('等一下', '发个自拍看看')).toContain('[[SEND_PHOTO: candid smartphone selfie');
        expect(ensureRequestedPhotoDirective('好\n[[SEND_PHOTO: existing prompt]]', '发个自拍看看'))
            .toBe('好\n[[SEND_PHOTO: existing prompt]]');
        expect(ensureRequestedPhotoDirective('好呀', '不用发自拍啦')).toBe('好呀');
    });

    it('修复 LIFE 单括号和生活记录展示摘要', () => {
        expect(normalize('[LIFE:MED|布洛芬]')).toBe('[[LIFE:MED|布洛芬]]');
        expect(normalize('[生活记录：支出 13（西瓜汁）]'))
            .toBe('[[LIFE:EXPENSE|13|西瓜汁]]');
        expect(normalize('[生活记录：吃药 · 布洛芬]')).toBe('[[LIFE:MED|布洛芬]]');
        expect(normalize('[生活记录：锻炼 · 跑步 30分钟]'))
            .toBe('[[LIFE:EXERCISE|跑步|30分钟]]');
        expect(normalize('[生活记录：生理期开始]')).toBe('[[LIFE:PERIOD_START]]');
    });

    it('不把带历史状态的卡片或普通方括号文字变成副作用', () => {
        expect(normalize('[生活记录：支出 13（西瓜汁）（已有记录，未重复添加）]'))
            .toBe('[生活记录：支出 13（西瓜汁）（已有记录，未重复添加）]');
        expect(normalize('她发了一个开心表情')).toBe('她发了一个开心表情');
        expect(normalize('我看了[那本书]')).toBe('我看了[那本书]');
    });
});
