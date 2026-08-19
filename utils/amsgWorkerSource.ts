/**
 * LiliumOS 主动消息 2.0 Worker 的公开发布源。
 *
 * 前端一键部署、Worker 自更新和设置页教程必须共用这里，不能再各自写一个上游地址。
 * LiliumOS 的 heartbeat / instant chat 协议领先于 SullyOS 通用包；混用会出现“更新成功，
 * 但新版 fire_pack 被旧 Worker 拒绝”的假成功。
 */
export const LILIUM_REPO_URL = 'https://github.com/Emma-Zhuym/LiliumOS';
export const LILIUM_AMSG_SOURCE_URL = `${LILIUM_REPO_URL}/tree/main/worker/amsg`;
export const LILIUM_AMSG_BUNDLE_RAW_URL =
  'https://raw.githubusercontent.com/Emma-Zhuym/LiliumOS/main/worker/amsg/worker.bundle.js';
export const LILIUM_AMSG_WRANGLER_RAW_URL =
  'https://raw.githubusercontent.com/Emma-Zhuym/LiliumOS/main/worker/amsg/wrangler.toml';
export const LILIUM_AMSG_SETUP_GUIDE_URL =
  `${LILIUM_REPO_URL}/blob/main/docs/amsg2-setup-walkthrough.md`;
