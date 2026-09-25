# Emma Soft Clay UI — Design System Rules (v1.0「F」)

> **For any agent (Claude Code, etc.) building UI in this system.**
> These rules are **binding**. Use `utils/clayTokens.ts` (mirrored in `tokens.json` / `tokens.css`) as the
> *only* source of color, radius, shadow, spacing, type, overlay and motion values. **Never invent new hex
> values, radii, or shadows.** If a value you need isn't in the tokens, ask — don't improvise.
>
> v1.0 换皮「F」于 2026-09-25 由 Emma 定稿，替换 v0.1 的「凹凸并存」。取舍过程与七套备选方案见
> https://claude.ai/artifact/4WQXnVEqsbsGbhGcuWbmD3

---

## 0. The feel (read first)

```
底子：中性、通透、不发黄——纯白卡片落在 #F8F9F7 上，靠明度差分层
质感：全平。没有投影，没有凹陷内阴影；层次 = 1px 细线 + 明度差 + 动效
浮层：浮在内容上面的东西（sheet、提示条）是 iOS 18 的雾面玻璃，透出来的是自己的内容
颜色：五颜六色，但每个颜色的饱和度都封了顶
```

v0.1 的 warm-soft-clay（奶黄底、双层暖投影、带白高光的内阴影、圆角 20/24）已废弃。
「凹槽」「白块」这些说法保留，但现在它们只是平底色块，不带任何阴影。

---

## 1. Color usage ratio (HARD RULE)

```
Neutral foundation        ~75%   (app bg, surfaces, borders, text)
Module / product Tint     ~18%   (large soft fills, card backgrounds)
Bright Main color          ~7%   (icons, rails, progress, selected, button core)
```

- **Large areas are never high-saturation.** High saturation only on: icons, thin rails,
  progress fills, selected states, primary-button cores.
- **Per screen, at most:** `1 primary hue` + `1 secondary hue` + `1 status color`.

## 2. Foundation tokens (`F`)

| Token | Value | Use |
|---|---|---|
| appBg | `#F8F9F7` | page base — neutral, slightly cool, never yellow |
| surface | `#FFFFFF` | default card / sheet（纯白，和 appBg 拉开明度差 = 通透感的来源） |
| surfaceWarm | `#F2F4F0` | subtle secondary fill |
| surfaceSunken | `#EDEFEA` | inputs, segmented base, wells — **flat, no inset shadow** |
| surfaceRaised | `#FFFFFF` | selected block on a sunken base |
| textPrimary | `#23262A` | headings, numbers, bare icons (**never pure black**) |
| textSecondary | `#5D635F` | body |
| textTertiary | `#959B96` | captions, placeholders |
| borderSoft | `#E3E6E0` | default 1px border — now the main separator |
| borderStrong | `#CBCFC8` | emphasized border, selected well in Health calendar |
| divider | `#EBEEE8` | hairlines |
| accent | `#B4402F` | 朱砂 — focus ring, today ring, overdue |

## 3. Hue system — pick, don't hardcode business names

Every hue = **Tint / Soft / Main / Ink**, 16 hues, computed by one OKLCH rule (not hand-picked):

```
Tint   L .952 / C .019     大面积浅底、卡片背景（带一点灰调）
Soft   L .885 / C .06      轻强调、选中底、标签底
Main   L .57–.84 / C ≤.135 图标、按钮、进度、边条、圆环
Ink    L .44–.47 / C .095  深色文字、强调数字
```

Main 的亮度按色相走：**黄、橙、黄绿提亮**（暖色一压饱和就发棕发土——旧琥珀的问题），蓝、靛压暗。
**amber / yellow / lime 太亮，白字压不住**：只做圆点、图标、圆环，不做白字按钮底；暖色按钮用 orange。

Give each product a `Product Color` + its Tint/Soft/Ink. Borrow **sparingly** from other hues.
Rule of thumb: bleed on foundation → **Tint**. Memorable → **Main**. Carry text → **Ink**. Just emotion → **Soft**.

## 4. Status colors (`STATUS`, fixed, separate from product hues)

`success = green` · `warning = amber` · `danger = red` · `info = blue` — each tint/main/ink from the palette above.
Badges = Tint bg + Ink text. danger.main (`#CA6862`) is dark enough for a white-text destructive button.

## 5. Radius (`R`)

```
tiny 4 · small 8 · medium 10 (button / input / smallCard) · large 12 (bigCard) · panel 14 · sheet 16 · pill 999
```
比 v0.1 整体收一档：大圆角吃掉屏幕占比，组件显得小。**Do not** go back to 20+ on cards.

## 6. Elevation — 全平

`S.raisedSoft / raisedMedium / floating / sunken` 名字保留给旧代码引用，**值全部是 `none`**。

- 卡片、sheet、按钮之间靠 **1px borderSoft** 和 **surface（纯白）与 appBg 的明度差** 分开。
- 凹槽（输入框、切换 bar 底座、进度轨道）= surfaceSunken 平底色块。
- 选中项 = surfaceRaised 白块，**滑动**到位（见 §11），不靠阴影「凸起」。
- **禁止**手写 `boxShadow: '... rgba(...)'`、`drop-shadow()`、SVG `feDropShadow`。
  唯一允许的 box-shadow 写法：用纯色做的描边环（例如时间线圆点外的 `0 0 0 4px ${F.surface}` 白环）。

### 6.1 Overlay（`OVERLAY`）— 浮在内容上面的东西

只有 sheet、提示条（以后的 tab bar）用雾面材质；**普通卡片不许加玻璃**。

| 用途 | 取值 |
|---|---|
| sheet 底 | `OVERLAY.bg` rgba(250,251,249,.66) + `OVERLAY.blur` blur(26px) saturate(175%) |
| sheet 顶边 | `OVERLAY.edge`（1px 白高光）+ `OVERLAY.hairline`（0.5px 墨色发丝线，box-shadow） |
| sheet 里的凹槽 | `OVERLAY.well` rgba(118,124,140,.12) |
| 提示条 | `OVERLAY.toastBg`（比背景深一档）+ `OVERLAY.toastEdge`（1px 墨色 14%） |
| 遮罩 | 手机 sheet 不压暗（`OVERLAY.scrim` = transparent）；桌面弹窗、要打断用户的确认框用 `OVERLAY.scrimModal` |

## 7. Component recipes

**Info card** — surface, radius 12, padding 12–14, 1px borderSoft.
**Module record card** — Module *Tint* bg, radius 12, padding 12–14, 4px left rail (Module Main)，34–44 icon box
(radius 8, Module Tint 或 Main)。
**Hero card** — surface, radius 14, 1px borderSoft; one per screen.
**Primary button** — h46, radius 10, bg textPrimary / accent / Product Main, white text 15/600;
pressed = `scale(.95)`（`clay-press`）。
**Secondary button** — h44, radius 10, surface, 1px borderSoft.
**Icon button** — **bare**: no bg, no border, no shadow; icon 21px bold textPrimary（返回箭头 22）;
hit area 44×44; pressed = opacity .4. See `iconButtonBare`.
**Segmented** — surfaceSunken container radius 10, padding 2; options ~32px high;
selected = absolutely-positioned surfaceRaised block that **slides** (340ms `MOTION.easeSheet`).
**Input** — h48, radius 10, surfaceSunken (in overlays: `OVERLAY.well`), transparent 1px border;
focus = 1px accent. **No glow, no inset.**
**Progress track** — flat surfaceSunken groove; fill = Main.
**Ring progress** — flat surfaceSunken groove track. Fill = Hue Main, round cap, starts at 12 o'clock,
draws in on mount (outer → inner, 100ms apart). Overfill (>100%): continue on the **same ring path** from the top —
no offset, no thickening, no inner/outer rings. Overfill arc start = exactly Main (zero seam), then deepen
**linearly along the arc** to Hue **Ink** with a round cap. No drop shadow on arcs.
**Bottom sheet** — see §6.1; radius 16 top, 36×4 grab, `clay-sheet-in`; autofocus with `{ preventScroll: true }`.
**Toast** — `components/os/ClayToast`; see §6.1; `clay-toast-in`.

## 8. Typography (`FONT`)

Body `Noto Sans SC`（中文界面别太细）. Headings **`Noto Serif SC`**（`FONT.heading`）—— 只给三处：
- App 顶栏居中标题：`FONT.navTitle` 17/700
- sheet / 弹窗标题：17/700
- section 小标题：`FONT.sectionTitle` 15.5/600

数字（圆环中心、金额、月份标签）、正文、标签、按钮**一律无衬线**。
Scale: `display 30/38/600 · title 24/32/600 · section 18/26/600 · body 15/23/400 · bodyStrong 15/23/600 ·
caption 13/18/400 · tiny 12/16/400`. Text is near-black, **never `#000`**.

## 9. Spacing

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64`. Use flex/grid + `gap`, not ad-hoc margins.
Page margin mobile 20 · card gap 10–12 · section gap 20–24（比 v0.1 收紧一档，把屏幕占比还给内容）.

## 10. Icons

Stroke 2px, round cap+join. Sizes 18 / 21 / 26; icon hit area 44.
Module icons may use Module Main; **label text stays near-black**, not gray.

## 11. Motion (`MOTION` + `utils/clayMotion.css`)

没有投影以后，深度靠动来表达。
- Curves: `ease` cubic-bezier(.2,.8,.2,1) 出场；`easeSheet` (.32,.72,0,1) 浮层与滑块，不回弹；
  `easePop` (.34,1.36,.64,1) **只给**提示条和选中日。
- Durations: `tap 100 · hover 140 · cardMove 180 · sheet 240 · page 280`；`sheetIn 460 · toastIn 560 · toastOut 380`。
- Press: bare icon → opacity .4；button/chip/day → scale(.95)；card → scale(.985)。按下 70ms，松开 240ms。
- 一屏只一个 hero 时刻（健康：三环画出；日历：选中日弹 + 清单升起）。退场比进场快。
- All motion respects `prefers-reduced-motion` (handled in clayMotion.css).

---

## Enforcement checklist (agent must self-verify before shipping)

- [ ] Every color/radius/spacing value comes from tokens — zero raw hex/px invented.
- [ ] **Zero hand-written shadows** (`boxShadow` with rgba, `drop-shadow`, `feDropShadow`).
- [ ] Screen uses ≤ 1 primary + 1 secondary hue + 1 status color; no white text on amber/yellow/lime.
- [ ] Large fills use Tint, not Main.
- [ ] Icon buttons are bare with a 44×44 hit area; nav + section titles are serif, numbers are not.
- [ ] Overlays (sheet / toast) use `OVERLAY`; ordinary cards are not glass.
- [ ] Segmented selection slides; no pure black text; no focus glow; no radius above 16 except pills.
