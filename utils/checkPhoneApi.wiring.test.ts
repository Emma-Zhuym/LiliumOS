import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('CheckPhone independent API wiring', () => {
    it('routes every CheckPhone generation path through the resolved API', () => {
        const source = read('apps/CheckPhone.tsx');
        expect(source).toContain('resolveCheckPhoneApi(phoneApiConfig, apiConfig)');
        expect(source).toContain('aria-label="查手机 API 设置"');
        expect(source).toContain('api: effectiveApiConfig as any');
        expect(source).not.toMatch(/fetch\(`\$\{apiConfig\.baseUrl/);
        expect(source).not.toContain('api: apiConfig as any');
        expect(source).not.toContain('apiConfig: apiConfig as any');
    });
});
