# LiliumOS Agent Instructions

LiliumOS 是 Emma 基于 SullyOS 维护的个人 fork。开始仓库工作前先阅读 `.claude/CLAUDE.md`；其中的 EM 功能清单、哨兵约定、架构原则和吸收上游的规则同样适用于 Codex。判断当前功能进度时以 `docs/roadmap.md`（接下来做什么、待验收）和 `docs/changelog.md`（做完了什么）为准，不从旧规格标题推断状态。

## 改动日志

每完成一件事（合进 `main` 或上线），在 `docs/changelog.md` 对应月份最上面加一条：日期 · 标题、**操作：Codex（Elias）**、提交号 / PR、改了什么。格式见该文件开头。做完的事从 `docs/roadmap.md` 的「做了，等验收」里删掉或更新。

## MacBook / Mac mini 代码同步

Emma 会在 MacBook 和 Mac mini 上交替修改 LiliumOS。日常开发以自己的 `origin` 仓库作为代码交接点（2026-09-12 用户明确要求）。

1. 开工前检查当前分支、远端跟踪关系和未提交改动；确认目标分支后先 `git pull --ff-only`，读完远端新增改动再开始编辑。
2. 若有未提交改动、分支分叉或冲突，先保留现场并说明情况；不得自动丢弃改动、覆盖文件、stash、reset 或强推。需要取舍的冲突交给 Emma 决定。
3. 完成已授权改动并通过相应验证后，检查 diff，只提交本次任务的文件，再 push 到 `origin` 的对应分支；普通开发的 commit / push 已获得此项长期授权，无需每次重复询问。
4. 推送前再次检查远端是否前进。若推送被拒绝，先取回并检查另一台电脑的改动，解决并重新验证后再推送；不得使用 force push。
5. 收尾说明当前分支、提交号、pull / push 结果及未提交内容。未推送的代码不能称为已经跨电脑同步；换电脑后仍需先 pull，避免两台同时修改同一分支。
6. 本约定仅适用于自己的 `origin` 日常协作；SullyOS 上游同步、验收分支推进 `main` 和相应 push 仍遵循下方独立审批闸门。

## 仓库文档跨 Agent 交接

LiliumOS 默认只用 Git 跟踪的仓库文档在 Claude Code、Codex、两台电脑和 cloud session 之间交接。Engram 不再是本项目的开工或收尾步骤；不要自动调用 `get_resume_brief`、`wrap_up_session`、`add_lesson` 或 `add_decision`，也不用在收尾时报告“Engram 未写入”。只有 Emma 当次明确要求使用 Engram 时才调用，并继续遵守其 strict 审核。

1. 开工先 pull，再按任务读取 `docs/changelog.md`、`docs/roadmap.md`、`docs/ideas.md`、相关 `docs/spec-*.md` 和 `notes/todo.md`；Git 中的当前文件与提交历史是事实来源。
2. 新点子只进 `docs/ideas.md`；决定做或待验收的进 `docs/roadmap.md`；完成项进 `docs/changelog.md`；跨 session 的完整实施契约进对应 `docs/spec-<功能名>.md`；纯代码层欠账进 `notes/todo.md`。
3. 一项工作没做完就要换 Agent 时，在已有相关 spec 或 todo 中补“已完成 / 已验证 / 未解决 / 下一步”，不要另开同类交接清单；更新后随代码一起 commit / push。
4. 密码、API key、token、cookie、个人敏感数据、论文受限原文和未经确认的推测不得写入仓库文档。

## 吸收上游审批闸门（最高优先级）

不再整体合并 SullyOS 上游（2026-10-21 Emma 定），只挑真正不错的功能吸收进来，做法见 `.claude/CLAUDE.md`「吸收上游功能」。能干净套上，不代表用户想要这个功能。任何吸收都必须分成“只读调研”和“动手吸收”两个阶段：

1. 调研阶段可以 `git fetch`、查看 log/diff、读取代码和测试，但不得创建或切换验收分支，不得 merge、rebase、cherry-pick、commit 或 push。
2. 调研完成后必须先向 Emma 汇报：提交范围和规模、所有用户可见新功能、行为变化、修复与工程改动、和 EM 功能的重叠或冲突，以及逐项建议保留/排除/改造的方案。
3. 汇报后必须等待 Emma 明确批准。`看看`、`研究一下`、`看看上游有啥`、`合并看看`、`看看怎么合`只授权调研，不授权执行；只有类似“按这份清单开始”“这些全部要”“把 A/B/C 拿进来”的明确答复才算批准。
4. 即使 cherry-pick 能干净套上，只要新增或改变用户可见功能，也必须在执行前列入清单让 Emma 决定。不得把技术上套得上误当成产品上默认接受。
5. 获批后才能建立验收分支 `upstream-picks-YYYY-MM-DD` 并执行（2026-10-15 及以前叫 `merge-upstream-YYYY-MM-DD`）。机械冲突按文档和 EM 哨兵处理；涉及产品行为、UI、数据语义或两套功能取舍的冲突，停下来再次询问。
6. 验收分支验证完成后先汇报结果。推进 `main` 和 push `main` 需要独立、明确的批准，不能从“同意建立验收分支”推断。
7. 如果误操作，立即停止，准确报告 main、工作分支和远端状态；未经 Emma 允许不得通过删除分支、reset 或 force push 自行掩盖。

这条规则高于“主动完成任务”或“套得上就直接拿进来”等一般工作习惯。
