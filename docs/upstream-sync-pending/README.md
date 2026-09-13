# 上游同步调研与历史材料

`merge-upstream-2026-09-12` 已完成批准范围的实现，等待 Emma 体验及单独批准推进 main；main 保持 `b61078f6`。当前状态和完整证据以 [验收记录](../upstream-sync-2026-09-12.md) 文末为准。

- `upstream-sync-review.md` 保存第 1–4 节原始产品清单，旧推荐已被用户后续选择覆盖。
- `voice-favorites-plan.md` 已实现为无需 TTS 的文字语音收藏。
- `standalone-plan.md` 已实现为剧情内独立异格，直接组合 + 本地随机；不再依赖活动室。
- `github-backup.patch` 是已应用的历史材料，不要重复应用。以当前源码为准。

续接先确认分支与未提交改动；保存现场后 pull 对应分支。根据实际失败做定向检查，不反复重跑已经通过的测试。main 推进/push、部署和 Engram strict 审核分别处理，不从验收分支授权推断。
