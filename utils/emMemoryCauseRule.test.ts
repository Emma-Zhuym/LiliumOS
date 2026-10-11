// [EM-START: memory-keep-cause]
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emMemoryCauseRule } from './emPromptAddons';

describe('记忆整理：冲突要写清起因', () => {
    it('规则写明起因、正确事实和标签用原话', () => {
        const rule = emMemoryCauseRule('阿萌');
        expect(rule).toContain('具体因为什么');
        expect(rule).toContain('正确的事实');
        expect(rule).toContain('阿萌自己用的说法');
    });

    it('整理记忆的提示词里接上了这条', () => {
        const source = readFileSync('utils/memoryPalace/extraction.ts', 'utf8');
        expect(source).toContain('${emMemoryCauseRule(userLabel)}');
    });
});
// [EM-END: memory-keep-cause]
