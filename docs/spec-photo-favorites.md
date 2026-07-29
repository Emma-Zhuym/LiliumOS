# 照片收藏 + 查手机轮播 spec

> **实施状态（2026-07-28）：已完成。** 相册星标、全部/收藏筛选、查手机收藏优先轮播、无收藏回退，以及角色通过聊天指令收藏照片均已接入；备份沿现有 Gallery 数据走。

roadmap #8 落地方案。两块：相册标星收藏 + 查手机照片小组件只轮播收藏照片。

## 数据层（types.ts + 存储）

- `GalleryImage`（types.ts ~2288）加一个字段：
  ```ts
  favorited?: boolean;   // 收藏标记，undefined 视为 false
  ```
- 无迁移成本：旧数据没有该字段即未收藏。
- 更新走现有 galleryImages 的保存路径（Gallery 已有 review 编辑，复用同一条 update 通道）。

## 相册端（apps/Gallery.tsx）

- 图片查看态加星标按钮（Star icon，收藏后实心）；网格缩略图右上角小星角标显示收藏态。
- 按钮形态遵守 design-system §0.3（44px 凸起圆钮）/ 缩略图角标用小尺寸例外（≤20px，非独立可点 icon，随图片整体点击）。
- 可选：网格顶部加"全部 / 收藏"筛选，形态 = §B 凹槽底座+凸起白选中。

## 查手机端（apps/CheckPhone.tsx）

现状：~386 行加载 gallery 图片按时间排序取前 4，photo widget（~3087 行 2×2 区块）静态显示 `galleryPhotos[0]`。

改动：
1. 加载逻辑：`favorited === true` 的照片优先；**一张收藏都没有时回退到最近 4 张**（保持现有行为，别让 widget 变空白）。
2. 轮播：widget 内 `setInterval`（建议 5s）循环切换，crossfade 过渡（两层 img 叠加切 opacity，避免闪白）。组件卸载/页面不可见时清 timer（`visibilitychange`）。
3. 收藏照片多于 4 张时全部进轮播池（不再 slice(0,4)，上限给个 12 防止内存），随机起始位。

## 可选 Phase 2（本次不做，记录想法）

角色在聊天中自动收藏用户发的照片——agentic tool 或消息后处理标记 `favorited`，让"查手机看到的照片"带角色的偏好感。

## EM 惯例

- 改动集中在 Gallery.tsx / CheckPhone.tsx / types.ts，均为已有 EM 触点；上游文件改动处加 `[EM-START/END: photo-favorites]` 哨兵注释，完工后把功能记入 `.claude/CLAUDE.md` EM 功能清单。

## 验收

1. 相册里给 2 张照片标星 → 查手机 widget 只轮播这 2 张，5s 切换有过渡
2. 取消全部收藏 → widget 回退显示最近照片（不空白）
3. 星标状态刷新页面后仍在（持久化生效）
4. 长时间停留查手机页 → 无内存泄漏/timer 堆积（切后台回来只有一个 timer）
