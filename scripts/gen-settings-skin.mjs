#!/usr/bin/env node
// [EM-START: settings-skin-f]
/**
 * 生成 components/settings/settingsF.css 里「颜色映射」那一段。
 *
 * 设置页换 F 皮不逐行改上游 JSX：扫一遍设置页和它里面渲染的组件，把实际出现的 Tailwind 颜色类
 * （bg / text / border / from，含 /50 这类透明度、开关的 peer-checked:）按色系映射到 F 的变量：
 * - slate / gray / stone … → 中性（文字三档、凹槽、细线）
 * - violet / sky / indigo / pink / teal … 装饰色 → 设置主色（HUE.blue，tint / soft / main / ink）
 * - emerald / green → 成功；amber / orange / yellow → 提醒；red / rose → 危险
 * 开关打开（peer-checked:bg-*）一律主色（APP_CONVENTIONS D：开 = Product Main）。
 *
 * 上游设置页加了新颜色类之后跑一次：node scripts/gen-settings-skin.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CSS = join(ROOT, 'components/settings/settingsF.css');
const BEGIN = '/* ── 颜色映射（scripts/gen-settings-skin.mjs 生成，别手改）── */';
const END = '/* ── 颜色映射结束 ── */';

const sources = [
    'apps/Settings.tsx',
    'components/os/Modal.tsx',
    'components/user/PerCharAvatarPicker.tsx',
    ...readdirSync(join(ROOT, 'components/settings')).filter(name => name.endsWith('.tsx')).map(name => `components/settings/${name}`),
];

const NEUTRAL = new Set(['slate', 'gray', 'zinc', 'stone', 'neutral']);
const OK = new Set(['emerald', 'green', 'lime']);
const WARN = new Set(['amber', 'yellow', 'orange']);
const DANGER = new Set(['red', 'rose']);
const DECOR = new Set(['violet', 'purple', 'indigo', 'sky', 'blue', 'pink', 'teal', 'cyan', 'fuchsia', 'primary']);
const COLOR_FAMILIES = [...NEUTRAL, ...OK, ...WARN, ...DANGER, ...DECOR].join('|');
// 只认真正的颜色名：border-b / text-xs / bg-transparent 这种管线宽、字号的类不能当成颜色
const TOKEN = new RegExp(`^(peer-checked:)?(bg|text|border|from)-(${COLOR_FAMILIES})(?:-(\\d{2,3}))?(?:\\/\\d+)?$`);

/** 一个类该落成哪个变量；null = 不管。 */
const target = (prop, family, shade) => {
    const n = shade ? Number(shade) : 500;
    if (prop === 'from') prop = 'bg';
    if (NEUTRAL.has(family)) {
        if (prop === 'text') return n >= 700 ? '--sf-text' : n >= 500 ? '--sf-text2' : '--sf-text3';
        if (prop === 'bg') return n <= 100 ? '--sf-sunken' : n <= 300 ? '--sf-border-strong' : '--sf-text';
        return n >= 300 ? '--sf-border-strong' : '--sf-border';
    }
    if (OK.has(family)) {
        if (prop === 'text') return '--sf-ok-ink';
        if (prop === 'bg') return n <= 100 ? '--sf-ok-tint' : n <= 300 ? '--sf-ok-soft' : '--sf-ok';
        return n <= 300 ? '--sf-ok-soft' : '--sf-ok';
    }
    if (WARN.has(family)) {
        if (prop === 'text') return '--sf-warn-ink';
        // 琥珀压不住白字：实心的一律落主色
        if (prop === 'bg') return n <= 100 ? '--sf-warn-tint' : n <= 300 ? '--sf-warn-soft' : '--sf-p-main';
        return '--sf-warn-soft';
    }
    if (DANGER.has(family)) {
        if (prop === 'text') return '--sf-danger-ink';
        if (prop === 'bg') return n <= 100 ? '--sf-danger-tint' : n <= 300 ? '--sf-danger-soft' : '--sf-danger';
        return n <= 300 ? '--sf-danger-soft' : '--sf-danger';
    }
    // 其余都是装饰色（violet / sky / indigo / pink / teal / primary …）→ 设置主色
    if (family === 'primary' && !shade) {
        if (prop === 'text') return '--sf-p-ink';
        if (prop === 'border') return '--sf-p-soft';
        return null; // bg-primary 单独处理（带透明度的是 tint，不带的是 main）
    }
    if (prop === 'text') return '--sf-p-ink';
    if (prop === 'bg') return n <= 100 ? '--sf-p-tint' : n <= 300 ? '--sf-p-soft' : '--sf-p-main';
    return n <= 300 ? '--sf-p-soft' : '--sf-p-main';
};

const PROP = { bg: 'background-color', from: 'background-color', text: 'color', border: 'border-color' };
const groups = new Map(); // "prop|var" -> selectors
const add = (prop, cssVar, selector) => {
    const key = `${PROP[prop]}|${cssVar}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(selector);
};

const seen = new Set();
for (const file of sources) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const token of text.match(/[A-Za-z0-9:\-[\]#/.]+/g) ?? []) {
        if (seen.has(token)) continue;
        const match = TOKEN.exec(token);
        if (!match) continue;
        seen.add(token);
        const [, peer, prop, family, shade] = match;
        if (peer) {
            if (prop === 'bg') add('bg', '--sf-p-main', `.settings-f .peer:checked ~ [class~="${token}"]`);
            continue;
        }
        if (family === 'primary' && !shade && prop === 'bg') {
            add('bg', token.includes('/') ? '--sf-p-tint' : '--sf-p-main', `.settings-f [class~="${token}"]`);
            continue;
        }
        const cssVar = target(prop, family, shade);
        if (cssVar) add(prop, cssVar, `.settings-f [class~="${token}"]`);
    }
}

const lines = [BEGIN];
for (const [key, selectors] of [...groups.entries()].sort()) {
    const [prop, cssVar] = key.split('|');
    lines.push(`${[...selectors].sort().join(',\n')} { ${prop}: var(${cssVar}); }`);
}
lines.push(END);

const css = readFileSync(CSS, 'utf8');
const start = css.indexOf(BEGIN);
const stop = css.indexOf(END);
if (start < 0 || stop < 0) throw new Error(`${CSS} 里找不到生成段的起止标记`);
writeFileSync(CSS, css.slice(0, start) + lines.join('\n') + css.slice(stop + END.length));
console.log(`settingsF.css：${seen.size} 个颜色类，${groups.size} 组`);
// [EM-END: settings-skin-f]
