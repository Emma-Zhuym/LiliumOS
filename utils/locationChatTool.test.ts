import { beforeEach, describe, expect, it } from 'vitest';
import { saveLocationAwareness } from './locationService';
import {
  LOCATION_CHAT_TOOL,
  buildLocationChatToolSystemBlock,
  executeLocationChatTool,
  isLocationChatToolEnabled,
} from './locationChatTool';

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
});
