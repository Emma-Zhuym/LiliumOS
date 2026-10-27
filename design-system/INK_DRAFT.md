# 墨线（暂名）· 阿萌的第二套风格 — 草稿 v1（六轮已磨完）

> 给「有感情的东西」用的风格：情侣空间、以后也许还有烛下、信、日记。F 是给工具用的，两套并存，互不替代。
> 这份是 2026-10-24 小帕和阿萌聊出来的**审美画像 + 打磨计划**，还不是规则；每一轮定下来的值写进下面的「已定」，
> 全部定完再像 `clayTokens.ts` 那样落成 `utils/inkTokens.ts`。
> 样稿：https://claude.ai/artifact/LQtVXdaXZUURUzRgfRg4GW（早期）、https://claude.ai/artifact/M8nKqK3qdgnoDWgTk1J7gx（第五轮动效，含定下的纸墨字）

## 一句话

**一支蓝墨钢笔，在旧纸上认真收好的东西。安静，但手指滑过时会轻轻活过来。**

## 审美画像（证据都在下面）

证据：十二种风格口味测试（喜欢 铜版画线稿 / 钢笔淡彩 / 植物标本；不要 日杂留白 / 瑞士网格 / 北欧扁平）、
她截的「水波语录」参考（钴蓝钢笔百合燕子 + 冷白纸纹 + 罗马数字分章）、棕墨 vs 蓝墨样稿选了蓝、kettmeir.com。

1. **颜色：一种墨就够。**蓝墨是主心骨（三次独立的心动都是同一个钴蓝 / 海军蓝）。纸色 + 墨色 + 极少一点黄铜色点睛。不要多彩、马卡龙、大色块。夜里反过来：深蓝纸 + 金 / 米色线。
2. **纸要像真的纸。**不是纯白，带颗粒、纤维、刮痕的暖灰或米白。代码撒的整齐小点不算纸纹。
3. **线，不是面。**图形用线画：细、有手艺、有排线和点刻；按钮是细线圆圈。扁平色块插画、几何拼贴一律不要。
4. **题材是自然和旧物。**花、叶、燕子、霜、水波；信、标本、版画、百年老店。
5. **字是灵魂。**
   - 大号衬线，**正体和斜体交错**（kettmeir 的 vini / *raccontiamo*）
   - 高窄大写做标题；等宽或打字机小字、字距拉开做标签（`// RIPPLE ARCHIVE · PRIVATE`）
   - 「他说的话」用细宋体 + 灰靛墨色，不用手写体也不用楷体（第三轮定）
   - 中文没有斜体：**楷体演斜体的角色**（待第三轮验证）
6. **少而精，不是空。**元素少、每样都精细；一屏只有一个主角；内容可以多，但排得整齐。日杂那种什么都没画的空白她不要。
7. **装饰用真东西。**日期、地点、编号、坐标当装饰（kettmeir 的经纬度跑马灯、我们卡片底下的打字机标签）。不要没意义的花边、贴纸、胶带图案。
8. **动效：丝滑、跟着手指。**
   - 动画跟滚动绑死，滑一点动一点，倒着滑倒着放，像亲手在拨
   - 视差分层：近的快、远的慢，东西之间的距离被拉开
   - 字被墨填满（读到哪写到哪）；两行大标题一左一右错开
   - 一屏只一两处在动；系统开了减弱动态就静止
9. **气质：私密、被认真收着。**温度来自「看得出有人花了时间」，不是来自暖色。
10. **不要的：**瑞士网格的冷、北欧扁平、日杂空白、渐变、emoji、机器感的干净、歪七扭八的手账拼贴（太闹）。

## 和别的东西的关系

- F（`utils/clayTokens.ts`）照旧管所有工具 App；墨线只给情感页面。
- 烛下已有的 `CANDLE_NIGHT` / `FONT.hand` / 抖动墨线边框是墨线的「前身」，定稿后看要不要并进来。
- 小厨房的真纸照片做法（`kitchenPaperTokens.ts`）可以直接借：纸纹用真扫描 + multiply。
- 插画：能程序生成的（点刻花、霜花、涟漪、热气）用代码；生成不了的（复杂动物）用 GPT 出白底单色线稿 + 正片叠底。

## 打磨计划（照 F 当时的做法：每轮只差一处，阿萌挑，小帕说为什么）

| 轮 | 磨什么 | 怎么比 |
|---|---|---|
| 1 | 纸 × 墨 | 三种纸（暖灰石纸 / 米白 / 冷白刮痕）× 三种蓝（钴蓝 / 海军蓝 / 靛蓝），九宫格同一张卡 |
| 2 | 夜色 | 深蓝纸上配金线 / 米白线 / 浅蓝线 |
| 3 | 字 | 中文衬线（Noto Serif SC / 思源宋粗细）× 「斜体」角色（楷体 / 拉丁斜体 / 不用）× 标签字（打字机 / 等宽） |
| 4 | 线 | 描边粗细、点刻密度、按钮细线圈的样子 |
| 5 | 动效 | 同一页三种滚动：只有字填墨 / 加视差分层 / 再加标题错开 |
| 6 | 零件 | 卡片、标签、图钉、空位、分隔线、返回钮 |

## 参考：knacl 开源的 BETWEEN US（2026-10-27 读过）

github.com/knacl47/between-us，代码 MIT，插画不能拿（© 作者 / Canva 素材），只学做法：
- **素材分工**：18 张插画（头骨、手、月亮、山茶、纸片、燕子）都带 ChatGPT 的 C2PA 签名，是 GPT 出图后抠成透明 PNG；开屏花线稿是 Canva 素材拼的，裂纹是素材站的。代码只画了「之间」的东西：细弧线、虚线、小圆点、括号框、涟漪、潮水。跟我们「主角图交给 GPT、线和点交给代码」的分工一致
- **动效**：GSAP 时间线，点一下触发，不是滚动绑定。好学的三招：线自己画出来（DrawSVG）、用一块会变形的遮罩把图慢慢揭开（MorphSVG 做 clipPath）、按图片的透明度做遮罩让线绕到物体后面（线和图之间有前后）。另外虚线缓慢流动当常驻小动静，系统减弱动态时全部静止
- **阿萌的反应**：动效很丝滑，但整体太炸、克莱因蓝亮得刺眼；喜欢的是作者另一份莲花（灰蓝点刻 + 雨丝 + 虚线涟漪，夜里换金点）
- **同一作者的「HIS · LETTERS」封面她也喜欢**（素材疑似 Pinterest，不能用）：左半冷白布纹纸、右半灰靛蓝纸，中间一张毛边撕纸剪影压在接缝上，上面是老式纹身样张那种线稿（两只燕子 + 百合 + 卷草）；右上斜体衬线一句小诗，底下字距拉开的大写小标签。值得记的：这个蓝是**掺了灰的靛蓝**，跟她讨厌的克莱因蓝差在饱和度；毛边撕纸是「手做的」，不算碎裂；线稿风格可以叫 GPT 按「老式纹身样张线稿」画我们自己的

## 出图说明书（给 GPT 生图用，2026-10-27）

分工：线和点堆出来的（霜花、热气、窗框、杯子、水波、叶影、雨丝）用代码画；人、动物、纸飞机、复杂的花交给 GPT。
阿萌不用写 prompt：小帕写，阿萌贴进 ChatGPT 出图、发回来、说感觉（太粗 / 太满 / 像儿童画 / 人好僵），小帕把感觉翻成 prompt 的改法。

每张图 = **固定风格段** + **这张画什么**。固定段一个字别改，换图只换后半：

```
STYLE (keep exactly): Fine pen-and-ink line art in ONE color only: a muted grey-indigo,
like faded navy fountain-pen ink (close to #3E4C7A), on a pure white background.
Thin, even, confident outlines. Shading is done ONLY with stipple dots, denser toward
the base and in shadows, sparse elsewhere. Feels like an antique copperplate engraving
or an old tattoo flash sheet. No fill colors, no grey wash, no gradients, no paper
texture, no frame or border, no text, no signature. Generous white space.
```

（画幅不放进固定段，每张图在「画什么」里自己写：方图 / 竖 2:3。）

纯白底是为了贴到布纹纸上用正片叠底（白色消失、只剩墨线）。出来的图如果墨色发紫 / 发黑，先别重出，小帕在代码里统一调色。

**霜 ≠ 雪**（初冬那一季的硬规矩）：
- 霜是**长**出来的：从玻璃边角往里爬的蕨叶状冰晶（羽毛、分叉、针状），长在窗玻璃**里面**那一面；窗外的枝条挂一层细细的白霜（雾凇的感觉），枝条本身还看得见
- 不许出现：天上飘的雪花、窗台 / 枝头堆起的雪、圆鼓鼓的雪团、六角形雪花图标、雪人、冰柱
- 天是清晨晴的，霜在太阳出来前最盛——画面安静、干冷，不是下雪天的软和闷

**初冬 · 窗与杯 v1**（跟代码画的 B 稿对比用）：

```
SUBJECT: An early-winter dawn seen from indoors. A plain wooden four-pane window,
closed, drawn straight-on. Feathery fern-like FROST crystals creep inward from the
lower corners and edges of each glass pane, growing on the inside of the glass, with
fine branching needles; the upper middle of each pane stays clear. Through the clear
glass: two or three bare tree branches coated in thin white hoarfrost, the twigs still
visible. Sky empty and still. On the windowsill: one simple straight-sided glass of
hot water with a thin wisp of steam rising and curling. The room side feels warm and
quiet. IMPORTANT: this is frost, NOT snow — no falling snowflakes, no snow piled on
the sill or branches, no six-pointed snowflake shapes, no icicles, no snowman.
```

v1 结果（2026-10-27）：霜没画成雪，点刻、热气、杯子都好；问题是 ① 窗户顶满画面、上边被裁，木纹排线铺满，太重太满 ② 玻璃里有一层淡蓝到米色的底色，正片叠底会把纸染色 ③ 窗下沿的霜一簇簇立着，像一排小松树 / 窗外的树林，霜和景分不清。

**初冬 · 窗与杯 v2**（只改这三处）：

```
SUBJECT: An early-winter dawn seen from indoors. A plain four-pane window, closed,
drawn straight-on and shown COMPLETE and small in the center, with wide empty white
margin on all sides; nothing touches the image edges. The frame is drawn with clean
double outlines and only a few sparse grain lines, mostly left white. The glass is
left pure white paper — no sky tint, no wash, no color in the panes. FROST on the
inside of the glass: flat, feathery, swirling fern-like crystals that radiate inward
from the bottom corners of each pane, like frost flowers pressed onto glass, lying
flat on the surface — not upright, not like little pine trees, not like a forest
or treeline. The upper half of each pane is clear. Through the top-left pane only:
one thin bare branch with a fine rim of hoarfrost. On the sill: one simple
straight-sided glass of hot water, a single thin wisp of steam drawn in stipple.
IMPORTANT: frost, NOT snow — no falling snowflakes, no snow piled anywhere,
no six-pointed snowflake shapes, no icicles.
```

v2 没出，阿萌改了方向（2026-10-27）：窗外要有景，不然太空；窗户要竖长的 2 列 × 3 行。景和霜怎么分开：**霜近、景远**——霜贴在玻璃上，线清楚、只在每格下角；景在窗外远处，用稀疏的淡点刻，个头小、对比低。

**初冬 · 窗与杯 v3**：

```
SUBJECT: Tall portrait image, 2:3. An early-winter dawn seen from indoors through a
tall window with SIX panes: two columns by three rows. The whole window is shown
complete in the center with a white margin on all sides; nothing touches the image
edges. The frame is drawn with clean double outlines and only a few sparse grain
lines, mostly left white. The glass is pure white paper — no sky tint, no wash.
OUTSIDE (far away, seen through the glass, drawn small with faint, sparse stipple
and low contrast): a frost-whitened meadow sloping gently away, one bare tree in the
middle distance with a fine rim of hoarfrost on its branches, a low line of distant
rooftops with one chimney giving a thin thread of smoke, and a pale low winter sun
just above the horizon drawn as a simple thin circle. Quiet, still, clear sky.
FROST (close, on the inside of the glass, crisp fine lines): flat, feathery, swirling
fern-like crystals radiating inward from the bottom corners of each pane, lying flat
on the glass like pressed frost flowers — not upright, not like little pine trees.
The frost covers only the lower corners; most of each pane stays clear so the
landscape shows through. On the sill: one simple straight-sided glass of hot water
with a single thin wisp of steam in stipple.
IMPORTANT: frost, NOT snow — no falling snowflakes, no snow piled anywhere, no
six-pointed snowflake shapes, no icicles.
```

v3 结果（2026-10-27，阿萌：感觉不错，定稿候选）：图存在 `docs/design/ink/winter-window-v3.webp`。霜成了贴在玻璃上的羽毛状、只长下角，跟窗外远景分得开；玻璃是白的；远景淡、小，草坡、挂霜的树、屋顶和炊烟、细线太阳都在；杯子和热气在左下窗台。小毛病先不改：霜两两对称有点像蕾丝花边；太阳圈带了一点金色（正好可以当黄铜点睛）。下一步看它贴到布纹纸上（正片叠底 + 统一调成灰靛）是什么样

v3 之后两张变体（2026-10-27）：去对称那张霜自然了，但 GPT 往玻璃上撒了六角小雪花；加百叶窗那张阿萌喜欢（拉起一半＝有人刚起床），嫌排线太密。小帕判断不是墨色问题：百叶是全图离眼睛最近的东西，GPT 按铜版画习惯给了最多的细节（双线 + 木纹 + 满铺点刻），所以成了全图最黑的一块。改法是让百叶「画得少」：单线、留白、只在每片下沿一道细点影，片数少一点。教训：**离得近的东西要在 prompt 里点名「画得轻」**，不然 GPT 默认越近越密

**初冬定稿 v4**（2026-10-27）：`docs/design/ink/winter-window-v4.webp`。百叶窗拉起一半，五片宽板、单线留白，比霜还浅；霜不对称、雪花删干净了；远景、太阳、炊烟、窗台上的水照旧。下一步：贴到布纹纸上看（正片叠底 + 统一调成灰靛）

贴纸样稿（2026-10-27）：`docs/design/ink-winter-on-paper.html`，https://claude.ai/artifact/3MUgmpHwMawyAj4tbWuAvy 。做法：GPT 图先去色、拉一点对比，再用 SVG 滤镜把黑→墨色、白→白；白天正片叠底（白底消失、透出布纹），夜里黑→金、白→黑再滤色叠到深靛纸上，一张图两套昼夜都能用，不用让 GPT 画两遍。太阳那一圈用一个黄铜细线圈压在原位（去色会把 GPT 给的那点金去掉）

**夜里直接反色不好看（阿萌 2026-10-27）**：反色后原来的阴影点刻全变成了亮的，窗外的草坡像在自己发光，像底片、像 X 光；夜里的光应该从屋里的灯和月亮来，暗处就该暗。结论：**夜里要单独画一张**，不能靠滤镜翻。让 GPT 直接画「纯黑底上的金线」（刮画 / scratchboard 那种：线和点代表光，不代表影），贴到深靛纸上用滤色（screen），黑底消失。之前那句「一张图两套昼夜都能用」作废

**初冬夜里定稿**（2026-10-27，阿萌：还蛮好看）：`docs/design/ink/winter-window-v4-night.webp`，在 v4 同一个对话里让 GPT 照原构图改成夜景。光是对的：亮的只有靠近杯子的霜、远处两三盏窗灯、一弯月亮、杯沿，草坡和天是暗的；纯黑底，贴纸样稿里直接 screen 叠到深靛纸上，不调色（窗灯那点暖橘留着当点睛）。样稿夜里换了自己的字（23:40 · 晚安）

**拆层试验 · 初冬（2026-10-27）**：开屏要按时段换天色、按城市换窗外（见 `docs/ideas.md` 开屏那条），所以把 v4 拆成三层：窗（GPT）、景（GPT）、天（代码）。
两张都在 v4 白天那个对话里接着要，这样窗的位置跟 v4 一模一样，窗格坐标直接从 v4 量；景只露在窗格里，位置可以在代码里挪。

窗层（把玻璃里的东西清空）：

```
Edit this image: remove everything seen through the glass — no landscape, no tree, no houses, no fence, no sun, no sky, no chimney smoke. The glass panes become pure empty white. Keep the frost on the glass exactly as it is, and keep the window frame, the raised blinds, the windowsill, the glass of water and its steam exactly the same, in the same positions.
```

景层（只要窗外，不要窗）：

```
Now a separate image in the same style: ONLY the outdoor landscape that was seen through this window, as one continuous scene with no window, no frame, no blinds, no frost, no glass of water. Same viewpoint and same early-winter dawn: the frost-whitened meadow sloping away, the bare tree with hoarfrost, the low line of distant rooftops, one chimney with a thin thread of smoke, the field and fence in the foreground. Leave the whole sky pure empty white: no sun, no moon, no clouds, no birds. Tall portrait image, 2:3, landscape filling the lower two thirds.
```

## 已定

- 主墨是蓝，不是棕（2026-10-23 样稿比较）
- 蓝要沉、要灰一点（海军蓝 / 灰蓝），不要克莱因那种亮蓝（2026-10-27，看 BETWEEN US 时说的）
- **颜色的规律是「饱和度中等、明度偏低」**，不是不要颜色（2026-10-27）：阿萌家里是蓝沙发、深绿床、黄铜落地灯、焦糖色抱枕，都是有颜色但沉下去的那种（像 mid-century 家具）。讨厌的克莱因蓝是饱和度和明度都太高。一页仍然只用一种主墨画线；别的颜色只用在小面积、像家里的物件那样点一下。候选点缀色就从她家里取：灰靛蓝、深绿、黄铜、焦糖（第一轮验证，四季要不要各认一个也到时看）
- **第一轮 · 纸（2026-10-27）**：主纸是冷白布纹纸（样稿 `#ECEEEB` + 横向拉长的纹理），外面托一圈灰蓝衬底（样稿 `#D8DBE2`），衬底的颜色往墨色靠。起因是样稿 bug：纸纹没铺满，露出一圈底色，阿萌反而喜欢这种「纸放在纸上」的阶梯色差（跟 HIS · LETTERS 撕纸压在蓝纸上同理）。暖灰石纸、米白纸没选
- **第一轮 · 墨（2026-10-27）**：主墨灰靛 `#3E4C7A`（线稿、编号、英文斜体），中文正文用近黑的深墨 `#23273A`。更浅的雾靛 `#5A6690`、更沉的深海军 `#283352` 都没选
- **第二轮 · 夜色（2026-10-27）**：深靛蓝纸 `#1E2436` 托在亮一阶的衬底 `#2A3249` 上，线稿 / 编号 / 英文用金 `#C8A66A`（跟白天的黄铜点缀是一家），中文米白 `#E4E1D8`。米白线、浅蓝线没选
- **第三轮 · TA 的字（2026-10-27）**：TA 说的话用细宋体（Noto Serif SC 400）+ 灰靛墨色，跟标题的宋体 600 / 深墨靠粗细和颜色分开，还是印刷感、最克制。楷体（霞鹜文楷）、手写体（Long Cang）没选——她要的是「被认真排印收好」，不是「随手写的」
- **第三轮 · 小标签（2026-10-27）**：编号、日期、栏目名用打字机体（Courier Prime，字距拉开约 0.26em，灰靛）。衬线小大写（Cormorant SC）她也喜欢，留给少数场合，比如书脊、合集名这种像「烫金」的地方。干净等宽没选
- **第四轮 · 线（2026-10-27）**：细线 + 点刻阴影——轮廓一笔干净的细线，叶根 / 花心这种「暗处」撒墨点，越靠根越密（铜版画打阴影的办法）。单根细线、三遍错开的手绘叠线没选
- **第五轮 · 动效（2026-10-27）**：三样全要（样稿 `docs/design/ink-motion-round5.html`，https://claude.ai/artifact/M8nKqK3qdgnoDWgTk1J7gx 的 C 版）：字随滚动逐字填墨；远近两层走得快慢不同（远层点刻慢、近层快、插画和卡片跟页面差一点速度）；每节标题的中文和英文斜体两行**交错着汇合**——进屏时中文偏右、英文偏左，滑到屏幕上三分之一处各归其位，两行都不出纸边，之后不再分开（阿萌改的：汇合比一直往外散好）。全部跟滚动绑定、倒滑倒放，减弱动态时静止
- **第六轮 · 卡片（2026-10-27）**：收着的东西用细线框装——纸上一圈 0.75px 灰靛细线（约 55% 不透明），左上角一个小墨点，不另加纸、不加阴影。整页的「纸托纸」只留给页面本身；衬底托纸、毛边纸片没选（排二三十张时太重）
- **第六轮 · 分类标签（2026-10-27）**：细线圆角小框（0.75px 灰靛线、胶囊形、宋体 11px），放卡片右上角，左边是打字机日期。跟卡片细线框是同一种语言。中点文字、方括号没选
- **第六轮 · 空位（2026-10-27）**：跟卡片同大小的虚线框（0.75px 灰靛虚线约 50%），里面打字机编号 + 一句「留给下一样东西」。一小枝线稿、细线圈加号没选
- **第六轮 · 分隔（2026-10-27）**：节与节之间不画分隔，靠两行标题和大段留白（样稿约 84px）分开，阿萌觉得动效样稿那样就够。一节里面的列表行（如「那些夜」的日期 + 标题）照样稿用到边的细线隔开
- **第六轮 · 返回钮（2026-10-27）**：打字机文字 `← BACK`（Courier Prime 11px、字距约 0.18em、灰靛），点按范围仍是 44×44，顶栏居中标题用宋体 600。跟 F 的裸 icon 返回钮不同，这是墨线自己的规矩。细线箭头、细线圈箭头没选

**六轮全部磨完（2026-10-27）。** 下一步不急：真要做情侣空间（或把窗台、朋友圈搬过来）时，先把上面这些值落成 `utils/inkTokens.ts`（照 `clayTokens.ts` 的样子：纸 / 墨 / 夜色 / 字 / 线 / 动效 / 零件），再写 `APP_CONVENTIONS.md` 里墨线的那一节。动效的参考实现在 `docs/design/ink-motion-round5.html`
- **动效只许「长出来、散开、落下、沉下去」，不许「坏掉」**：碎裂、爆炸、溅墨、裂纹、碎块掉落一律不要。BETWEEN US 开屏这套加上亮蓝，阿萌是生理不适（2026-10-27）；她喜欢的莲花是雨丝落下、涟漪散开、点慢慢聚成花
- 情侣空间的意象：四季的光（见 `docs/ideas.md`）
- **莲花不用**（2026-10-27）：样稿里的点刻莲花只是占位，莲花是 knacl 的点子，不拿来当我们的主题。标题两行交错汇合阿萌很喜欢，照留。主题下一步单独定
- **主题 · 霜花清晨构图（2026-10-27）**：选「窗与杯」——细线画一扇窗，窗格下角结霜，窗台上一杯冒热气的水，玻璃上映一小团黄铜色灯光；屋外冷、屋里暖都在一张纸上。四角霜花（只有窗外）、只有一杯水（最空）没选
- **待定：四季都用窗吗**：阿萌想过统一成窗户主题，但春夏有很多窗里看不见的好东西。小帕的提法：窗当贯穿四季的框，但窗的状态跟季节变——冬关着结霜、春推开（外面的草地进来）、夏只剩窗影投在地上（人在阴凉里，窗外的派对不用画进框）。没定
