import { describe, expect, it } from 'vitest';
import { SELF_UPDATE_BUNDLE_URL } from '../worker/amsg/src/selfUpdate';
import {
  LILIUM_AMSG_BUNDLE_RAW_URL,
  LILIUM_AMSG_SETUP_GUIDE_URL,
  LILIUM_AMSG_SOURCE_URL,
  LILIUM_AMSG_WRANGLER_RAW_URL,
} from './amsgWorkerSource';
import { AMSG_BUNDLE_VERSION } from './amsgBundleVersion';

describe('LiliumOS AMSG 发布源', () => {
  it('部署、教程与自更新全部指向 LiliumOS 的 worker/amsg', () => {
    for (const url of [
      LILIUM_AMSG_SOURCE_URL,
      LILIUM_AMSG_BUNDLE_RAW_URL,
      LILIUM_AMSG_WRANGLER_RAW_URL,
      LILIUM_AMSG_SETUP_GUIDE_URL,
      SELF_UPDATE_BUNDLE_URL,
    ]) {
      expect(url).toContain('Emma-Zhuym/LiliumOS');
      expect(url).not.toContain('Tosd0/sullyos-workers');
    }
    expect(LILIUM_AMSG_BUNDLE_RAW_URL).toContain('/main/worker/amsg/worker.bundle.js');
    expect(LILIUM_AMSG_WRANGLER_RAW_URL).toContain('/main/worker/amsg/wrangler.toml');
    expect(SELF_UPDATE_BUNDLE_URL).toContain(encodeURIComponent(AMSG_BUNDLE_VERSION));
  });
});
