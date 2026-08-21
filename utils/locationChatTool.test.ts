import { beforeEach, describe, expect, it } from 'vitest';
import { saveLocationAwareness } from './locationService';
import {
  LOCATION_CHAT_TOOL,
  buildLocationChatToolSystemBlock,
  executeLocationChatTool,
  isLocationChatToolEnabled,
  shouldPreferLocalLocationTool,
} from './locationChatTool';

const userMessage = (content: string): any => ({
  id: 1, charId: 'char-1', role: 'user', type: 'text', content, timestamp: Date.now(),
});

describe('locationChatTool', () => {
  beforeEach(() => localStorage.clear());

  it('is unavailable until the user creates a zone', () => {
    expect(isLocationChatToolEnabled()).toBe(false);
    expect(LOCATION_CHAT_TOOL.function.name).toBe('get_user_coarse_location');
  });

  it('never exposes coordinates in the model-facing description', () => {
    const text = `${LOCATION_CHAT_TOOL.function.description}\n${buildLocationChatToolSystemBlock()}`;
    expect(text).toContain('粗略');
    expect(text).not.toContain('latitude');
    expect(text).not.toContain('longitude');
  });

  it('honors the privacy switch before requesting GPS', async () => {
    saveLocationAwareness({ enabled: false, zones: [], lastSnapshot: null });
    await expect(executeLocationChatTool()).resolves.toMatchObject({ success: false, status: 'disabled' });
  });

  it('keeps explicit location requests on the local tool path', () => {
    expect(shouldPreferLocalLocationTool([userMessage('你看看我现在在哪里？')])).toBe(true);
    expect(shouldPreferLocalLocationTool([userMessage('我到家了吗')])).toBe(true);
    expect(shouldPreferLocalLocationTool([userMessage('调用一下定位工具')])).toBe(true);
    expect(shouldPreferLocalLocationTool([userMessage('今天在学校好困')])).toBe(false);
  });
});
