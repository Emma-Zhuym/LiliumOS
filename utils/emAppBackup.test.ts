import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from './financeDb';
import { exportAllHealthEvents, importAllHealthEvents, saveHealthEvent } from './healthDb';
import { MapDB } from './mapWorlds';
import { ShoppingDB } from './shoppingDb';

beforeEach(async () => {
    await importAllHealthEvents([]);
    await ShoppingDB.importAll({ products: [], cart: [], orders: [], settings: [] });
    await MapDB.importAll([]);
    await FinanceDB.importAll({
        accounts: [],
        categories: [],
        transactions: [],
        taComments: [],
        settings: [],
        recurringRules: [],
    });
});

describe('EM app backup stores', () => {
    it('round-trips health, shopping, map, and all current BankApp stores', async () => {
        await saveHealthEvent({
            id: 'health-1',
            type: 'weight',
            date: '2026-07-28',
            createdAt: 1,
            value: 52.5,
        });
        await ShoppingDB.importAll({
            products: [{ id: 'food-1', name: '午餐', brand: '店', price: 20, note: '', type: 'food', cat: 'meal', fav: false }],
            cart: [{ id: 'food-1', qty: 2 }],
            orders: [{ id: 'order-1', type: 'food', receiver: 'Emma', status: 'active', note: '', placedAt: 1, lines: [{ id: 'food-1', qty: 2 }] }],
            settings: [{ key: 'view', value: 'food' }],
        });
        await MapDB.save({
            id: 'world-1',
            charId: 'char-1',
            genre: 'city',
            tag: 'home',
            tagColor: '#fff',
            tagBg: '#000',
            regions: [{ id: 'region-1', name: '家', glyph: 'H', color: '#fff', x: 50, y: 50, isHome: true }],
        });
        await FinanceDB.saveAccount({ id: 'account-1', name: '现金', type: 'cash', currency: 'CNY', initialBalance: 100, color: '#fff' });
        await FinanceDB.saveCategory({ id: 'category-1', name: '餐饮' });
        await FinanceDB.saveTransaction({ id: 'tx-1', type: 'expense', amount: 20, currency: 'CNY', accountId: 'account-1', categoryId: 'category-1', note: '午餐', timestamp: 1, dateStr: '2026-07-28' });
        await FinanceDB.saveTAComment({ id: 'comment-1', text: '记得吃饭', createdAt: 1 });
        await FinanceDB.saveSetting('currency', 'CNY');
        await FinanceDB.saveRecurringRule({ id: 'rule-1', type: 'expense', amount: 10, currency: 'CNY', accountId: 'account-1', categoryId: 'category-1', note: '订阅', frequency: 'monthly', nextDate: '2026-08-01', enabled: true, createdAt: 1 });

        const backup = {
            health: await exportAllHealthEvents(),
            shopping: await ShoppingDB.exportAll(),
            map: await MapDB.getAll(),
            finance: await FinanceDB.exportAll(),
        };

        await importAllHealthEvents([]);
        await ShoppingDB.importAll({ products: [], cart: [], orders: [], settings: [] });
        await MapDB.importAll([]);
        await FinanceDB.importAll({ accounts: [], categories: [], transactions: [], taComments: [], settings: [], recurringRules: [] });

        await importAllHealthEvents(backup.health);
        await ShoppingDB.importAll(backup.shopping);
        await MapDB.importAll(backup.map);
        await FinanceDB.importAll(backup.finance);

        expect((await exportAllHealthEvents()).map(event => event.id)).toEqual(['health-1']);
        expect((await ShoppingDB.exportAll()).orders.map(order => order.id)).toEqual(['order-1']);
        expect((await MapDB.getAll()).map(world => world.id)).toEqual(['world-1']);
        const restoredFinance = await FinanceDB.exportAll();
        expect(restoredFinance.accounts.map(account => account.id)).toEqual(['account-1']);
        expect(restoredFinance.transactions.map(transaction => transaction.id)).toEqual(['tx-1']);
        expect(restoredFinance.recurringRules.map(rule => rule.id)).toEqual(['rule-1']);
    });

    it('does not clear stores omitted by an older partial backup', async () => {
        await ShoppingDB.importAll({
            orders: [{ id: 'keep-order', type: 'food', receiver: 'Emma', status: 'done', note: '', placedAt: 1, lines: [] }],
        });
        await FinanceDB.saveRecurringRule({ id: 'keep-rule', type: 'expense', amount: 10, currency: 'CNY', accountId: 'a', categoryId: 'c', note: '订阅', frequency: 'monthly', nextDate: '2026-08-01', enabled: true, createdAt: 1 });

        await ShoppingDB.importAll({ cart: [] });
        await FinanceDB.importAll({ accounts: [] });

        expect((await ShoppingDB.getOrders()).map(order => order.id)).toEqual(['keep-order']);
        expect((await FinanceDB.getRecurringRules()).map(rule => rule.id)).toEqual(['keep-rule']);
    });
});
