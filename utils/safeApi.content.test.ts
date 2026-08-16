import { describe, expect, it } from 'vitest';
import { extractContent, safeResponseJson } from './safeApi';

describe('extractContent structured responses', () => {
    it('reads string content', () => {
        expect(extractContent({ choices: [{ message: { content: ' hello ' } }] })).toBe('hello');
    });

    it('joins OpenAI-style structured text parts', () => {
        expect(extractContent({ choices: [{ message: { content: [
            { type: 'text', text: '你' },
            { type: 'text', text: '好' },
        ] } }] })).toBe('你好');
    });

    it('accepts object content without calling string methods on the object', () => {
        expect(extractContent({ choices: [{ message: { content: { text: 'pong' } } }] })).toBe('pong');
    });
});

describe('native Vertex/Gemini chat response compatibility', () => {
    const nativeResponse = {
        candidates: [{
            content: {
                role: 'model',
                parts: [{
                    functionCall: {
                        name: 'finance_get_spending_summary',
                        args: { start_date: '2026-08-14', end_date: '2026-08-16' },
                        id: 'toolu_vertex_1',
                    },
                }],
            },
            finishReason: 'OTHER',
        }],
        usageMetadata: {
            promptTokenCount: 74987,
            candidatesTokenCount: 88,
            totalTokenCount: 75075,
        },
        modelVersion: 'claude-opus-4-6-thinking',
        responseId: 'msg_vertex_1',
    };

    it('converts a native functionCall wrapped in OpenAI message content', async () => {
        const response = new Response(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: JSON.stringify({ response: nativeResponse }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

        const data = await safeResponseJson(response);
        const call = data.choices[0].message.tool_calls[0];
        expect(data.choices[0].message.content).toBe('');
        expect(data.choices[0].finish_reason).toBe('tool_calls');
        expect(call.id).toBe('toolu_vertex_1');
        expect(call.function.name).toBe('finance_get_spending_summary');
        expect(JSON.parse(call.function.arguments)).toEqual({
            start_date: '2026-08-14',
            end_date: '2026-08-16',
        });
        expect(data.usage).toEqual({ prompt_tokens: 74987, completion_tokens: 88, total_tokens: 75075 });
    });

    it('converts native text while keeping thought text out of the visible reply', async () => {
        const response = new Response(JSON.stringify({
            response: {
                ...nativeResponse,
                candidates: [{
                    content: { parts: [{ text: 'internal', thought: true }, { text: '账本看到了。' }] },
                    finishReason: 'STOP',
                }],
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

        const data = await safeResponseJson(response);
        expect(data.choices[0].message.content).toBe('账本看到了。');
        expect(data.choices[0].message.reasoning_content).toBe('internal');
        expect(data.choices[0].finish_reason).toBe('stop');
    });

    it('does not reinterpret ordinary character JSON as a provider envelope', async () => {
        const content = JSON.stringify({ response: { mood: 'curious' }, candidates: 'not-provider-data' });
        const response = new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

        const data = await safeResponseJson(response);
        expect(data.choices[0].message.content).toBe(content);
    });
});
