import { describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import {
  buildPollinationsImageUrl,
  generateChatImage,
  pickCharacterImageReference,
  resolveImageGenerationConfig,
} from './imageGeneration';

const character = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'c1',
  name: '莉莉',
  avatar: 'https://example.com/avatar.png',
  description: '',
  systemPrompt: '',
  memories: [],
  ...patch,
});

describe('image generation configuration', () => {
  it('keeps the legacy free provider as the zero-config default', () => {
    expect(resolveImageGenerationConfig()).toMatchObject({
      provider: 'pollinations-free',
      useCharacterReference: true,
    });
    expect(buildPollinationsImageUrl('hello world', 12)).toContain('hello%20world');
  });

  it('uses the active skin normal portrait before default sprites and avatar', () => {
    const char = character({
      activeSkinSetId: 'winter',
      dateSkinSets: [{ id: 'winter', name: '冬装', sprites: { normal: 'data:image/png;base64,V0lOVEVS' } }],
      sprites: { normal: 'data:image/png;base64,REVGQVVMVA==', chibi: 'blobref:chibi' },
    });
    expect(pickCharacterImageReference(char)).toBe('data:image/png;base64,V0lOVEVS');
  });

  it('never treats an emoji avatar or chibi sprite as a facial reference', () => {
    expect(pickCharacterImageReference(character({ avatar: '🌷', sprites: { chibi: 'blobref:chibi' } }))).toBeUndefined();
  });
});

describe('generateChatImage', () => {
  it('does not fetch for the built-in free provider', async () => {
    const fetchImpl = vi.fn();
    const result = await generateChatImage({ prompt: 'at home', char: character(), seed: 7, fetchImpl: fetchImpl as any });
    expect(result.provider).toBe('pollinations-free');
    expect(result.referenceUsed).toBe(false);
    expect(result.url).toContain('seed=7');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uploads the active portrait to the edits endpoint when enabled', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 }));
    const result = await generateChatImage({
      prompt: 'reading by a window',
      char: character({ sprites: { normal: 'data:image/png;base64,QUJD' } }),
      config: { provider: 'openai-compatible', baseUrl: 'https://img.example/v1', apiKey: 'k', model: 'image-model', useCharacterReference: true },
      fetchImpl: fetchImpl as any,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = (fetchImpl as any).mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>;
    expect(calls[0][0]).toBe('https://img.example/v1/images/edits');
    expect(calls[0][1]?.body).toBeInstanceOf(FormData);
    expect((calls[0][1]?.body as FormData).get('image[]')).toBeInstanceOf(Blob);
    expect(result).toMatchObject({ referenceUsed: true, url: 'data:image/png;base64,QUJD' });
  });

  it('falls back to text generation when the model rejects reference images', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'unsupported image' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.png' }] }), { status: 200 }));
    const result = await generateChatImage({
      prompt: 'reading',
      char: character({ sprites: { normal: 'data:image/png;base64,QUJD' } }),
      config: { provider: 'openai-compatible', baseUrl: 'https://img.example/v1', model: 'text-only' },
      fetchImpl: fetchImpl as any,
    });
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      'https://img.example/v1/images/edits',
      'https://img.example/v1/images/generations',
    ]);
    expect(result.referenceUsed).toBe(false);
    expect(result.warning).toContain('不支持参考图');
  });
});
