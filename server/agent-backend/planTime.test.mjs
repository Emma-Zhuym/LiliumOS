/**
 * 约定时间的解析：模型写自然语言，程序定绝对时刻。认不出的一律 null，由调用方整条丢掉。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAN_HORIZON_MS, parsePlanTime } from './planTime.mjs';

const TZ = 'America/Chicago';
// 2026-09-23 周三，芝加哥 15:00（CDT，UTC-5）
const NOW = new Date('2026-09-23T20:00:00.000Z');
const local = (day, hour, minute = 0) => new Date(Date.UTC(2026, 8, day, hour + 5, minute)).toISOString();
const parse = text => parsePlanTime(text, NOW, TZ)?.toISOString() ?? null;

test('约定时间：星期、周末、下周', () => {
    assert.equal(parse('周六下午'), local(26, 15));
    assert.equal(parse('星期五晚上八点'), local(25, 20));
    assert.equal(parse('礼拜天上午10点半'), local(27, 10, 30));
    assert.equal(parse('周末'), local(26, 14), '只说哪天：默认下午两点');
    assert.equal(parse('下周六'), local(26 + 7, 14));
    assert.equal(parse('下周末晚上'), local(26 + 7, 20));
    // 今天是周三：只说「周二」= 下一个周二；说「这周二」已经过了，不认
    assert.equal(parse('周二中午'), local(29, 12));
    assert.equal(parse('这周二'), null);
});

test('约定时间：今天明天后天、几点几分、中文数字', () => {
    assert.equal(parse('明晚八点'), local(24, 20));
    assert.equal(parse('明天早上7:30'), local(24, 7, 30));
    assert.equal(parse('后天下午三点一刻'), local(25, 15, 15));
    assert.equal(parse('今晚'), local(23, 20));
    assert.equal(parse('今天上午'), null, '已经过去了');
    assert.equal(parse('晚上十二点'), local(24, 0), '晚上十二点 = 第二天零点');
    assert.equal(parse('中午1点'), local(24, 13));
    assert.equal(parse('三点'), local(24, 15), '没写上下午的三点按下午；今天的已过就是明天');
    assert.equal(parse('晚上9点'), local(23, 21), '只说几点：今天还没到就是今天');
    assert.equal(parse('明天夜里两点'), local(24, 2), '夜里两点是凌晨，不加 12');
});

test('约定时间：几号、几月几号', () => {
    assert.equal(parse('25号晚上'), local(25, 20));
    assert.equal(parse('10月3号下午2点'), new Date(Date.UTC(2026, 9, 3, 19)).toISOString());
    assert.equal(parse('二十二号'), null, '这个月的已经过了，下个月的太远');
    assert.equal(parse('2月30号'), null);
});

test('约定时间：说不准的、太远的、乱写的一律不认', () => {
    for (const text of ['改天', '有空的时候', '下次吧', '', null, '2026-09-26T15:00', '12月25号', '25点']) {
        assert.equal(parse(text), null, String(text));
    }
    const far = parsePlanTime('下下周日晚上', NOW, TZ);
    assert.ok(!far || far.getTime() - NOW.getTime() <= PLAN_HORIZON_MS);
});

test('约定时间：按角色时区理解，不按服务器', () => {
    // 同一刻在上海是 9 月 24 日周四凌晨 4 点：「明天」是周五
    assert.equal(parsePlanTime('明天下午', NOW, 'Asia/Shanghai').toISOString(), new Date(Date.UTC(2026, 8, 25, 7)).toISOString());
});
