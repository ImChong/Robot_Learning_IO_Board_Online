# Robot Learning IO Board — 建设计划

> 用「模块 + 连线」的节点图，把热门人形机器人强化学习项目的**输入、输出、奖励函数**画成可交互的网页。
> 首批覆盖 **SONIC** 与 **BeyondMimic**，每个项目可在**训练态**（含奖励函数设置）与**部署态**之间切换。

本文是设计文档，确定「做什么、做成什么样、怎么分阶段做」。文末附录 A/B 是已经逐项核对过一手实现的内容基线，也是首版数据文件的输入。

> **实施状态**：M0–M4 已完成，页面可运行（`python3 -m http.server 8080`）。相对本文的三处偏差：
> KaTeX 改为本地自带而非 CDN（受限网络下 CDN 不可靠，且省掉 SRI 哈希这一处易错的手工维护点）；
> 对比模式做成「当前项目 vs 一个选定对象」的逐项对照表，而不是两块并排画布（画布并排在同屏下都太挤，
> 表格信息密度更高，而且比全部项目并排更能随项目数量扩展）；
> 项目切换从顶栏页签改成可搜索的下拉，项目文件改为按需加载（见下节）。
> M5 与「加第三个项目」仍未开始。

### 面向「项目数量增长」的三处改造

首版按 2 个项目实现，以下三处到十几个项目就会顶不住，已一并改掉：

| 原实现 | 到规模后的问题 | 现在的做法 |
|---|---|---|
| 顶栏平铺项目页签 | 放不下，横向挤爆顶栏 | 可搜索、按方法族分组的下拉；搜索命中项目名、副标题与关键词；`P` 打开、`[` `]` 切换、上下键 + 回车选中 |
| 启动时 `Promise.all` 拉取全部项目文件 | N 个项目就是 N 次请求、首屏越来越慢 | 按需加载 + 缓存。`projects.json` 冗余了 `name` / `subtitle` / `group` / `keywords`，让选择器不必先下载项目文件；校验脚本保证冗余字段与项目文件一致 |
| 对比视图把全部项目并排 | 十几列的表排不下也读不动 | 只比两个：当前项目 vs 一个选定的对比对象（`vs` 参数进 URL，可分享） |

---

## 1. 目标与非目标

### 目标

1. **一眼看清一条策略吃什么、吐什么**。观测项、参考项、特权项、动作项、奖励项各自是一个模块，模块之间用连线表达数据流，每个模块标注维度、频率、来源、真机可得性。
2. **训练态 / 部署态可切换**。同一个项目切换视图后，能直接看到「训练时有、部署时没有」的模块被摘掉（特权观测、奖励、终止条件），以及部署时新增的模块（状态估计器、ONNX 运行时、多速率命令环）。
3. **横向可比**。SONIC 与 BeyondMimic 用同一套模块语汇和同一套配色描述，使「规模化预训练」与「精确物理 + 失败采样」两条路线的差异落在图上而不是文字里。
4. **数字可追溯**。每个模块的维度和权重都能点开看到出处（论文章节、仓库文件路径、配置项名），避免变成一张凭印象画的示意图。

### 非目标

- 不做训练/推理的实际运行或可视化回放，页面是**静态数据驱动**的说明性图表。
- 不做通用节点图编辑器。布局由数据决定，用户只做浏览、切换、展开，不做拖拽建模（阶段 5 可选加「拖拽微调 + 导出坐标」）。
- 不覆盖全部人形 RL 项目。首版只做 SONIC 与 BeyondMimic，把数据结构打磨到「加第三个项目只写一个 JSON」的程度。

---

## 2. 内容范围：四张图

首版共四个视图，构成 2 × 2 矩阵：

| | 训练态（Training） | 部署态（Deployment） |
|---|---|---|
| **BeyondMimic** | Isaac Lab 跟踪环境：160 维策略观测 + 286 维特权 critic 观测 + 9 项奖励 + 4 项终止 | 导出策略：154 维观测（去掉两项依赖状态估计的量）→ 29 维关节目标 → PD |
| **SONIC** | 三编码器 → FSQ → 共享 decoder；10 帧本体历史 + 10 帧未来参考；12–14 项奖励 + 辅助重建损失 | ONNX encoder/decoder 成套，50 Hz；观测按 YAML 清单拼接（默认 154 维，token 版 64 + 90 维） |

选这两个项目的理由：它们是同一范式（whole-body motion tracking）的两个极端——BeyondMimic 是小数据单平台的最小可交付基线，SONIC 是亿级帧规模化预训练 + 统一 token 接口。**它们的奖励项集合高度重叠**（SONIC 的 9 项基础奖励与 BeyondMimic 逐项同名同权重），差异集中在观测的时序深度、上游接口和额外的正则项上。这个「同源但分叉」的关系本身就是页面最有信息量的一条结论。

---

## 3. 与参考页的对齐

页面的分类语汇沿用 Robotics Notebooks 两个概念页，保证读者可以在两边无缝对照：

- 输入侧：[人形机器人运控策略的观测输入](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-observation-inputs) 的**五类**划分（按「部署是否可得」切）
- 奖励侧：[人形机器人运控常见奖励函数分类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-reward-functions) 的**六类**划分（按「替谁说话」切）

### 3.1 输入五类 → 节点分组（沿用）

| 代号 | 类别 | 在本页面中的角色 |
|---|---|---|
| A | 本体感知 | 关节 q/dq、IMU 角速度、重力投影、上一动作 |
| B | 指令与参考 | 参考关节轨迹、anchor 相对位姿、VR 三点、SMPL 关节 |
| C | 历史与时序上下文 | 帧堆叠深度（SONIC = 10 帧）、未来参考窗口 |
| D | 外部感知 | 两个项目均为盲式跟踪，本类留空并显式标注「本项目不使用」 |
| E | 特权信息（仅训练） | critic 侧的 body_pos/body_ori/base_lin_vel 等 |

### 3.2 奖励六类 → 奖励面板分组（沿用）

任务与跟踪 / 姿态与稳定 / 步态与接触 / 能效与平滑 / 安全与硬件 / 风格与模仿。
跟踪系策略的特点是 A 类与 F 类合流（参考跟踪本身就是任务奖励），页面要显式说明这一点，否则读者会疑惑为什么没有独立的「步态相位」项。

### 3.3 输出五类 → 本项目新增

参考页目前没有输出侧的对偶分类，这是本项目可以补上的一块。提议按「这个输出流向哪里」切五类：

| 代号 | 类别 | 典型内容 | 是否下发硬件 |
|---|---|---|---|
| O1 | 关节目标 | 关节位置 setpoint（PD 参考），维度 = 可控 DoF | 是 |
| O2 | 直接力矩 | 关节力矩 / 前馈项 | 是 |
| O3 | 残差动作 | 叠加在基线控制器（WBC / 运动学规划器）之上的增量 | 是（合成后） |
| O4 | 分层接口输出 | 统一 token / latent，供下游 decoder 或上游 VLA 对接 | 否（策略内部或跨模块） |
| O5 | 辅助头 | 价值函数、重建头、估计器输出、判别器分数 | 否（仅训练或仅监控） |

配套的**动作后处理链**在图上单独画成一串串联模块，因为这段是真机翻车的高频位置：

```
策略原始输出 → 裁剪（action_clip） → 逐关节缩放（action_scale） → 加默认站姿偏移
→ PD 控制器（stiffness / damping / armature） → 力矩限幅（effort_limit） → 电机
```

两个项目在这条链上是同构的（都是 O1 类关节位置目标 + PD），差别只在 action_scale 的计算方式和 clip 阈值——正好可以用同一组模块 + 不同参数值来渲染，验证数据模型的表达力。

---

## 4. 数据模型

全部内容放在 `data/` 下的 JSON，页面不硬编码任何项目知识。核心是一个「项目 → 模式 → 图」的三层结构。

### 4.1 顶层

```jsonc
{
  "id": "beyondmimic",
  "name": "BeyondMimic",
  "subtitle": "精确物理建模 + 失败率驱动自适应采样",
  "robot": { "name": "Unitree G1", "dof": 29, "tracked_bodies": 14 },
  "rates": { "policy_hz": 50, "sim_hz": 200, "note": "decimation=4, sim_dt=0.005" },
  "links": { "paper": "...", "code": "...", "project": "..." },
  "modes": { "train": { /* Graph */ }, "deploy": { /* Graph */ } }
}
```

### 4.2 图（Graph）

```jsonc
{
  "lanes": ["source", "reference", "proprio", "history", "privileged",
            "network", "action", "actuation", "learning"],
  "nodes": [ /* Node */ ],
  "edges": [ /* Edge */ ],
  "rewards": [ /* RewardTerm，仅 train 模式 */ ],
  "terminations": [ /* TerminationTerm，仅 train 模式 */ ],
  "callouts": [ /* 图上的批注气泡 */ ]
}
```

### 4.3 节点（Node）

```jsonc
{
  "id": "obs.motion_anchor_pos_b",
  "lane": "reference",
  "class": "B",                       // 输入五类 / 输出五类代号
  "label": "参考 anchor 相对位置",
  "dim": 3,
  "dim_expr": "3",                    // 可读的维度算式，如 "29 × 10"
  "unit": "m",
  "acquisition": "estimate",          // direct | filter | estimate | given | sim-only | derived
  "availability": "deploy-hard",      // deploy-ok | deploy-hard | train-only
  "noise": "U(-0.25, 0.25)",          // 训练时注入的观测噪声
  "freq_hz": 50,
  "desc": "参考 anchor 位姿在机器人 anchor 系下的位置差。",
  "note": "真机需要全局位置估计；上游提供了去掉本项的 wo-state-estimation 变体。",
  "source": {
    "repo": "HybridRobotics/whole_body_tracking",
    "path": "source/.../tracking/tracking_env_cfg.py",
    "symbol": "ObservationsCfg.PolicyCfg.motion_anchor_pos_b"
  },
  "confidence": "verified"            // verified | derived | inferred
}
```

三个字段是这个页面的核心表达力，不能省：

- **`acquisition`（怎么拿到）** —— 直读 / 滤波 / 学习估计 / 上层给定 / 仿真直读 / 推导。这是参考页反复强调的「工程关键问题」。
- **`availability`（部署可得性）** —— 决定该节点在 deploy 视图里是否出现、以及是否要画成虚线降级形态。
- **`confidence`（可信度）** —— `verified` = 从一手仓库配置逐项核对；`derived` = 由核对过的项算出（如总维度求和）；`inferred` = 论文/文档口径推断，未在代码中定位。页面用角标区分，不让推断值伪装成事实。

### 4.4 连线（Edge）

```jsonc
{
  "from": "obs.motion_anchor_pos_b",
  "to": "net.actor",
  "kind": "obs",        // obs | ref | action | reward | grad | distill | privileged | feedback
  "style": "solid",     // solid | dashed（dashed = 仅训练期存在 / 信息搬运）
  "label": "3"          // 可选，边上标维度
}
```

### 4.5 奖励项（RewardTerm）

```jsonc
{
  "id": "motion_body_pos",
  "group": "A",                         // 奖励六类代号
  "label": "关键连杆相对位置跟踪",
  "weight": 1.0,
  "form": "\\exp(-\\lVert e \\rVert^2 / \\sigma^2)",   // KaTeX
  "params": { "std": 0.3 },
  "target": "14 个关键连杆",
  "direction": "positive",
  "desc": "...",
  "source": { /* 同 Node */ },
  "confidence": "verified"
}
```

奖励面板按 `group` 折叠成六个分区，每项显示权重、公式、参数、方向。两个项目共有的项要能横向对齐显示（阶段 4 的对比视图依赖这个）。

### 4.6 布局策略

**不引入图布局库**。节点的 `lane` 决定它落在第几列，列内按数组顺序纵向排布，列宽和行距由 CSS 变量控制。连线用三次贝塞尔从源节点右锚点连到目标节点左锚点，同一目标的多条入边在目标侧做扇形收拢。

理由：这类「输入 → 网络 → 输出」的图天然是分层 DAG，泳道布局比力导向布局稳定得多（每次打开位置一致，方便截图和讨论），而且实现成本低、无依赖。代价是节点顺序需要人工调，但内容是手写 JSON，本来就要人工调。

---

## 5. 页面与交互

### 5.1 布局

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏：站点名 · 项目 Tab [SONIC | BeyondMimic] · 主题切换       │
├──────────────────────────────────────────────────────────────┤
│ 模式切换：[ 训练态 ] [ 部署态 ] [ 对比 ]   图例  ·  筛选器     │
├────────────────────────────────────────────┬─────────────────┤
│                                            │  详情抽屉        │
│              节点图画布（SVG）              │  ─ 模块说明      │
│         泳道分列 · 贝塞尔连线 · 缩放平移     │  ─ 维度构成      │
│                                            │  ─ 真机如何获得  │
│                                            │  ─ 出处链接      │
├────────────────────────────────────────────┴─────────────────┤
│ 奖励函数面板（仅训练态）：六类折叠 · 权重条 · KaTeX 公式        │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 关键交互

| 交互 | 行为 |
|---|---|
| 切换项目 | 换数据源，画布做淡入淡出重绘；保持当前模式与滚动位置 |
| 切换训练/部署 | **同一批节点做位置补间动画**：共有节点平移到新位置，`train-only` 节点淡出并收缩，部署新增节点淡入。这个动画是页面的核心表达——「奖励和特权观测消失了，策略权重留下了」 |
| hover 节点 | 高亮该节点的完整上下游链路，其余节点降透明度 |
| click 节点 | 右侧抽屉展开详情；URL 同步 `?p=sonic&mode=train&n=obs.gravity_dir`，可分享可回退 |
| click 奖励项 | 在画布上高亮该奖励项作用的目标模块（如 `joint_limit` 高亮关节限位与执行器节点） |
| 筛选器 | 按输入五类 A–E、按 `availability`、按 `confidence` 过滤显示 |
| 对比模式 | 左右并排两个项目的同一模式，共有节点用连接线对齐，差异节点标 `+ / −` |
| 键盘 | `1/2` 切项目，`T/D` 切模式，`Esc` 关抽屉，方向键在节点间移动 |

### 5.3 图例与视觉编码

| 编码维度 | 视觉手段 |
|---|---|
| 输入/输出类别（A–E / O1–O5） | 节点主色（六色板，与参考页分类语义一致） |
| 部署可得性 | 边框：实线 = 可得；点线 = 需估计；灰底斜纹 = 仅训练 |
| 获取方式 | 节点左上角小图标（传感器 / 滤波器 / 网络 / 上层 / 仿真） |
| 维度大小 | 节点宽度按 `log(dim)` 轻微缩放，让 580 维的未来参考在视觉上重于 3 维的角速度 |
| 连线类型 | 颜色 + 虚实：观测流（蓝实）、参考流（青实）、动作流（橙实）、奖励/梯度（紫虚）、蒸馏/信息搬运（灰虚） |
| 可信度 | 右上角角标：无 = verified，`≈` = derived，`?` = inferred |

深色为默认主题，提供浅色切换；中文正文用系统无衬线栈，维度和路径用等宽字体。

### 5.4 无障碍与降级

- 节点图之外提供**同数据的表格视图**（`?view=table`），也作为无 JS / 屏幕阅读器 / 打印的降级路径。
- 所有颜色编码都有文字或形状冗余，不单靠色相区分。
- 画布支持键盘遍历，节点为 `role="button"` 且带 `aria-describedby`。

---

## 6. 技术选型与目录结构

**零构建静态站，部署到 GitHub Pages。**

| 决策 | 选择 | 理由 |
|---|---|---|
| 框架 | 无框架，原生 ES modules | 内容量级（4 张图 × 数十节点）远不到需要虚拟 DOM 的规模；无构建步骤意味着改 JSON 就能预览，也和参考站（vanilla JS + d3）的工程习惯一致 |
| 渲染 | 内联 SVG，手写布局 | 连线是核心视觉，SVG 的路径与动画能力足够；避免 Canvas 带来的可访问性与文本渲染问题 |
| 公式 | KaTeX（CDN，与参考站同版本 0.16.x） | 奖励公式必须排版正确；KaTeX 体积小、无需构建 |
| 动画 | Web Animations API + CSS transition | 模式切换的位置补间用 `element.animate()`，无需动画库 |
| 数据 | 静态 JSON，运行时 `fetch` | 便于外部校验脚本读取；也让「加一个项目 = 加一个 JSON + 一行注册」成立 |
| 校验 | JSON Schema + 一个 Node 脚本 | 在 CI 里检查节点 id 唯一、边两端存在、维度求和自洽、`source` 必填 |

```
Robot_Learning_IO_Board/
├── index.html
├── assets/
│   ├── style.css
│   └── theme-init.js            # 主题偏好，避免首帧闪白
├── src/
│   ├── main.js                  # 入口：路由、状态、事件
│   ├── data.js                  # 加载与校验数据
│   ├── layout.js                # 泳道布局：节点 → 坐标
│   ├── render-graph.js          # SVG 节点与连线渲染
│   ├── render-rewards.js        # 奖励面板
│   ├── render-detail.js         # 详情抽屉
│   ├── render-table.js          # 表格降级视图
│   └── transitions.js           # 训练 ↔ 部署 补间
├── data/
│   ├── projects.json            # 项目注册表
│   ├── beyondmimic.json
│   ├── sonic.json
│   └── taxonomy.json            # A–E / O1–O5 / 奖励六类的定义与配色
├── schema/
│   └── project.schema.json
├── scripts/
│   └── validate.mjs             # 数据自洽性检查
└── PLAN.md
```

---

## 7. 分阶段实施

阶段之间以「可演示的完整切片」为界，每个阶段结束时页面都是能打开看的。

### M0 — 数据与骨架

- 定义 `taxonomy.json`（五类输入 / 五类输出 / 六类奖励的代号、中文名、配色、说明）。
- 写 `project.schema.json` 与 `scripts/validate.mjs`。
- 把附录 A（BeyondMimic）落成完整的 `beyondmimic.json`，两个模式都填齐。
- 交付：`validate.mjs` 通过，数据文件可被人类读懂。

### M1 — 单项目单模式可视化

- `layout.js` + `render-graph.js`：泳道布局、节点卡片、贝塞尔连线、缩放平移。
- 渲染 BeyondMimic 训练态一张图，含图例。
- 交付：一张能看的图，颜色与边框正确表达类别和可得性。

### M2 — 详情抽屉 + 奖励面板 + 模式切换

- 点击节点开抽屉，URL 状态同步。
- 奖励面板：六类分组、权重条、KaTeX 公式。
- 训练 ↔ 部署 补间动画，`train-only` 节点淡出。
- 交付：BeyondMimic 两个模式完整可用。这是**第一个值得分享的版本**。

### M3 — 接入 SONIC

- 落 `sonic.json`（附录 B），重点验证数据模型能否表达：多编码器并行、FSQ token 瓶颈、共享 decoder、10 帧历史与 10 帧未来窗口、辅助重建头。
- 若不能表达，回头改 schema——这是数据模型的真正压力测试。
- 项目 Tab 切换、筛选器、键盘导航。
- 交付：四张图全部可用。

### M4 — 对比模式与表格视图

- 并排对比，共有节点对齐，差异标注。
- 表格降级视图与打印样式。
- 交付：可以直接用来讲「SONIC 与 BeyondMimic 的奖励项其实几乎一样」这个结论。

### M5 — 打磨与扩展（可选）

- 移动端布局（画布改为纵向堆叠 + 折叠泳道）。
- 深链接分享卡片、导出 SVG/PNG。
- 加入第三个项目（候选：SD-AMP 或 Heracles，用于验证「参考层中间件」这类拓扑）。
- 拖拽微调节点位置并导出坐标，回写 JSON。

---

## 8. 数据准确性规范

这个页面的价值全在数字对不对，所以定几条硬规矩：

1. **每个 `dim` 和每个 `weight` 都要有 `source`**，指向仓库文件路径 + 配置项名，或论文的具体表/节。没有出处的条目不许进 `main`。
2. **总维度只能是 `derived`**，由逐项 `verified` 的维度求和得出，并在页面上标 `≈` 角标。求和逻辑写进 `validate.mjs`，防止手算漏项。
3. **区分「论文口径」与「开源实现口径」**。二者不一致时，以开源实现为图的主体，把论文口径放在节点的 `note` 里。已知的一处不一致：多份二手资料称 BeyondMimic 使用「历史本体感知堆叠」，但上游 `whole_body_tracking` 的策略观测组**没有设置 history_length**，是单帧观测 + 经验归一化。这类差异要在页面上明确写出来，而不是二选一悄悄采用。
4. **记录核对时间与 commit**。数据文件里带 `verified_at` 与 `verified_ref`（分支或 commit），因为上游仓库还在迭代（SONIC 已有 release / v1.1 / bones_seed / h2 多套配置）。
5. **同一项目的多套配置要显式选一套并标明**。SONIC 首版以 `sonic_release` 为主，把 `sonic_v1_1` 的差异（heading 归一化、额外 energy 项、更大的 decoder）作为节点批注。

---

## 9. 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| SONIC 的 critic 观测与部分维度无法从公开配置逐项确定（如 critic 侧 body 数量） | 总维度算不准 | 标 `inferred` 并在节点上写明「待核对」，不编造数字；后续从 `observation_config.md` 之外的部署示例或 ONNX 输入尺寸反推 |
| 节点数量偏多导致图拥挤（SONIC 训练态节点约 30+） | 可读性下降 | 泳道内支持「分组节点」（一个可展开的容器节点，如把三个编码器折叠成「编码器族」）；筛选器默认隐藏 `confidence=inferred` 之外的次要节点 |
| 上游仓库更新导致数据过期 | 内容失真 | `verified_at` + 定期核对；`validate.mjs` 可扩展为拉取上游文件做 diff 提醒 |
| 两个项目的奖励项高度重叠，对比视图可能显得「没差别」 | 页面结论平淡 | 这本身就是结论。对比视图要突出**差异集**（SONIC 多出的 anti_shake / vr_5point / feet_acc / energy）与**观测时序深度**的量级差（单帧 vs 10 帧 × 10 未来帧） |
| 中文长标签在窄节点里排版困难 | 视觉粗糙 | 节点标签两行截断 + `title`，完整说明放抽屉；维度用等宽数字单独一行 |

---

## 附录 A — BeyondMimic 内容基线

核对对象：`HybridRobotics/whole_body_tracking`（`main` 分支）与 arXiv:2508.08241。机器人为 Unitree G1，**29 DoF**（腿 8 + 踝 4 + 腰 3 + 臂 14），跟踪 **14 个关键连杆**，anchor 为 `torso_link`。控制频率 **50 Hz**（`decimation=4`，`sim_dt=0.005` → 物理 200 Hz）。

### A.1 策略观测（训练态，160 维，单帧）

| 观测项 | 维度 | 类别 | 训练噪声 | 真机如何获得 |
|---|---|---|---|---|
| `command`（参考关节位置 + 参考关节速度） | 29 + 29 = 58 | B | — | 重定向后的参考动作离线生成，按时间索引取帧 |
| `motion_anchor_pos_b` | 3 | B | U(−0.25, 0.25) | 需要全局位置估计，**部署难点** |
| `motion_anchor_ori_b`（旋转矩阵前两列） | 6 | B | U(−0.05, 0.05) | 参考姿态在机体系下的相对表达，天然规避 yaw 不可观测 |
| `base_lin_vel` | 3 | A | U(−0.5, 0.5) | **不可直测**，需 EKF 或学习估计，**部署难点** |
| `base_ang_vel` | 3 | A | U(−0.2, 0.2) | IMU 陀螺仪直读 |
| `joint_pos`（相对默认位姿） | 29 | A | U(−0.01, 0.01) | 编码器直读 |
| `joint_vel` | 29 | A | U(−0.5, 0.5) | 编码器差分 + 低通 |
| `last_action` | 29 | A | — | 策略输出回放 |

合计 **160**（derived）。`enable_corruption=True`，`empirical_normalization=True`。

注意：策略观测里**没有重力投影**，姿态信息由 `motion_anchor_ori_b` 这个「相对参考」的量承担。这与参考页推荐的「用重力投影替代欧拉角」是同一动机的不同实现，值得在页面上作为批注点出。

### A.2 特权 critic 观测（训练态，286 维）

在策略观测基础上：去掉 `base_lin_vel` 之外全部噪声，新增 `body_pos`（14 × 3 = 42）与 `body_ori`（14 × 6 = 84），合计 **286**（derived）。

### A.3 动作与执行链

| 环节 | 内容 |
|---|---|
| 动作类型 | `JointPositionActionCfg`，29 维关节位置目标，`use_default_offset=True`（O1 类） |
| 缩放 | 逐关节 `action_scale = 0.25 × effort_limit / stiffness` |
| PD | 按执行器型号分组（7520-14/22、5020、4010），含 armature 反射惯量补偿 |
| 力矩限幅 | 髋 roll / 膝 139 N·m，髋 yaw/pitch 与腰 yaw 88 N·m，踝与腰 roll/pitch 50 N·m，肩肘腕 roll 25 N·m，腕 pitch/yaw 5 N·m |

### A.4 奖励（训练态，9 项）

| 奖励项 | 权重 | σ | 六类 | 形式 |
|---|---|---|---|---|
| `motion_global_anchor_pos` | +0.5 | 0.3 | A | `exp(−‖Δp‖²/σ²)`，全局 anchor 位置 |
| `motion_global_anchor_ori` | +0.5 | 0.4 | A | `exp(−θ²/σ²)`，全局 anchor 姿态 |
| `motion_body_pos` | +1.0 | 0.3 | A/F | 14 连杆相对位置误差均值 |
| `motion_body_ori` | +1.0 | 0.4 | A/F | 14 连杆相对姿态误差均值 |
| `motion_body_lin_vel` | +1.0 | 1.0 | A/F | 全局连杆线速度误差 |
| `motion_body_ang_vel` | +1.0 | 3.14 | A/F | 全局连杆角速度误差 |
| `action_rate_l2` | −0.1 | — | D | `−‖aₜ−aₜ₋₁‖²` |
| `joint_pos_limits` | −10.0 | — | E | 越限二次惩罚 |
| `undesired_contacts` | −0.1 | — | C/E | 除双踝与双腕外的连杆接触，阈值 1.0 N |

页面要点：**没有速度指令跟踪、没有步态相位、没有存活奖励**——跟踪系策略里参考运动本身承担了任务奖励的角色，这正是参考页所说的「A 与 F 合流」。

### A.5 终止条件（训练态，4 项）

`time_out`（episode 10 s）；`bad_anchor_pos_z_only` 阈值 0.25 m；`bad_anchor_ori`（投影重力 z 分量之差）阈值 0.8；`bad_motion_body_pos_z_only` 对双踝双腕阈值 0.25 m。

### A.6 域随机化与扰动（训练态）

启动期：摩擦（静 0.3–1.6 / 动 0.3–1.2）、restitution 0–0.5、关节默认位姿 ±0.01 rad、`torso_link` 质心偏移（x ±0.025，y/z ±0.05 m）。
周期扰动：每 1–3 s 推一次，线速度 x/y ±0.5、z ±0.2 m/s，角速度 roll/pitch ±0.52、yaw ±0.78 rad/s。

### A.7 部署态（154 维）

上游提供 `G1FlatWoStateEstimationEnvCfg`，直接把 `motion_anchor_pos_b`（3）与 `base_lin_vel`（3）置空 → **154 维**。这是页面上「部署态」视图的权威依据：不是我们推测该去掉什么，而是作者自己给了一套「不依赖状态估计」的变体。

部署态图上保留：参考动作源、154 维观测、Actor MLP `[512, 256, 128]`（ELU）、29 维关节目标、动作后处理链、PD、电机。移除：全部奖励、全部终止、critic 与特权观测、域随机化与推力扰动。

### A.8 训练算法（训练态）

PPO（rsl_rl）：4096 并行环境，`num_steps_per_env=24`，最大 30000 迭代，lr 1e-3 自适应（`desired_kl=0.01`），`entropy_coef=0.005`，γ=0.99，λ=0.95，clip 0.2。Actor / Critic 均为 `[512, 256, 128]` MLP + ELU。

配套的**失败率驱动自适应采样**在图上画成从「失败统计」回到「参考片段采样器」的反馈边（虚线），强调它改变的是「哪些状态被反复见到」而非奖励公式本身。

---

## 附录 B — SONIC 内容基线

核对对象：`NVlabs/GR00T-WholeBodyControl`（`main` 分支，`gear_sonic` 训练栈 + `gear_sonic_deploy` 部署栈）与 arXiv:2511.07820。首版以 `exp/manager/universal_token/all_modes/sonic_release.yaml` 为准。机器人同为 Unitree G1 **29 DoF**，控制频率 **50 Hz**（`decimation=4`，`sim_dt=0.005`）。

### B.1 三编码器 → FSQ → 共享 decoder（训练态核心拓扑）

| 编码器 | 输入项 | 上游模态 |
|---|---|---|
| `g1` | `command_multi_future_nonflat`、`command_z_multi_future_nonflat`、`motion_anchor_ori_b_mf_nonflat` | 机器人关节参考轨迹 |
| `teleop` | `command_multi_future_lower_body`、`vr_3point_local_target`(9)、`vr_3point_local_orn_target`(12)、`motion_anchor_ori_b`(6)、`command_z` | VR 三点（头 + 双腕）上身 + 规划器下身 |
| `smpl` | `smpl_joints_multi_future_local_nonflat`、`smpl_root_ori_b_multi_future`、`joint_pos_multi_future_wrist_for_smpl` | 人体 SMPL 关节（视频 / 生成模型来源） |

各编码器为 MLP `[2048, 1024, 512, 512]` + SiLU，投影到共享的 **64 维 FSQ token**，再进共享 decoder。未来参考窗口：`num_future_frames=10`，`dt_future_ref_frames=0.1 s`，即 10 帧、帧间隔 0.1 s（官方文档把这个窗口记作 **0.9 s 前瞻**，因为首帧是当前帧）；SMPL 侧为 10 帧 × 0.02 s。

这个「多入口 → 单瓶颈 → 单出口」的拓扑是页面必须表达好的形状：换上游只换 encoder，decoder 与低层跟踪不变。

### B.2 策略本体观测（训练态，`local_dir_hist`）

| 观测项 | 单帧维度 | 历史 | 小计 | 类别 | 训练噪声 |
|---|---|---|---|---|---|
| `gravity_dir` | 3 | 10 | 30 | A | U(−0.05, 0.05) |
| `base_ang_vel` | 3 | 10 | 30 | A | U(−0.2, 0.2) |
| `joint_pos` | 29 | 10 | 290 | A | U(−0.01, 0.01) |
| `joint_vel` | 29 | 10 | 290 | A | U(−0.5, 0.5) |
| `actions` | 29 | 10 | 290 | A | — |

本体侧合计 **930**（derived），加 64 维 token → Actor 输入约 **994**（derived，未计可能的模式索引等附加项，标 `inferred`）。

与 BeyondMimic 的对照点：SONIC 的策略观测里**没有** `base_lin_vel`，也**没有** `motion_anchor_pos_b`，这两项只出现在 critic 侧——即 SONIC 从设计上就不依赖真机的线速度与全局位置估计，而 BeyondMimic 需要额外提供一个 wo-state-estimation 变体才做到。这是两条路线在「部署可得性」上最实质的差别。

### B.3 特权 critic 观测（训练态，`privileged_mf_hist`）

`command_multi_future`、`motion_anchor_pos_b`、`motion_anchor_ori_b`、`body_pos`、`body_ori`、`base_lin_vel`(×10)、`base_ang_vel`(×10)、`joint_pos`(×10)、`joint_vel`(×10)、`actions`(×10)。Critic MLP `[2048, 2048, 1024, 1024, 512, 512]` + SiLU。

其中 `body_pos` / `body_ori` 的连杆数量未在公开配置中直接给出，标 `inferred` 并注明「待核对」。

### B.4 动作与网络

29 维关节位置目标（O1），`action_clip_value=20.0`。Actor 主干 MLP `[2048, 2048, 1024, 1024, 512, 512]` + SiLU（`sonic_v1_1` 的 `g1_dyn` decoder 与 critic 加宽到 `[4096, 4096, 2048, 2048, 1024, 1024, 512, 512]`）。

辅助头（O5）：`aux_losses = universal_token/g1_recon_and_all_latent`，`g1_kin` decoder 重建 `command_multi_future_nonflat` 与 `motion_anchor_ori_b_mf_nonflat`。图上画成从 token 出发的一条虚线支路，标注「仅训练期，用于约束共享潜空间」。

### B.5 奖励（训练态，`sonic_release` 用 12 项）

前 9 项与 BeyondMimic **逐项同名、同权重、同 σ**（见 A.4），额外三项：

| 奖励项 | 权重 | 参数 | 六类 | 说明 |
|---|---|---|---|---|
| `anti_shake_ang_vel` | −5e-3 | threshold 1.5 | D | 抑制双腕与头部的高频抖动 |
| `tracking_vr_5point_local` | +2.0 | σ 0.1 | A/F | 头 + 双腕 + 双踝五点局部位置跟踪 |
| `feet_acc` | −2.5e-6 | 踝关节 | D | 踝关节加速度惩罚（基础值 −2.5e-7，`sonic_release` 覆盖为 −2.5e-6） |

`sonic_v1_1` 换成 `local_feet_acc_energy_5pt`，共 14 项，再加 `tracking_vr_2wrists_local_ori`（+0.4，σ 0.1）与 `energy_consumption`（−1e-4）。
`undesired_contacts` 的排除连杆比 BeyondMimic 多了双肘（允许肘部接触）。

### B.6 训练算法与数据（训练态）

PPO（`ppo_im_phc`）：4096 环境，`num_steps_per_env=24`，actor lr 2e-5 / critic lr 1e-3，自适应区间 [1e-5, 2e-4]，`desired_kl=0.01`，`entropy_coef=0.01`，`init_noise_std=0.05`，std clamp [0.001, 0.5]，`max_grad_norm=0.1`。
参考池：BONES-SEED（`data/motion_lib_bones_seed/robot_filtered`），自适应采样 `failure_rate_max_over_mean=200`，上半身姿态增广概率 0.5，teleop 采样概率 0.5，trimesh 地形。
论文口径规模：约 1 亿+ MoCap 帧 / 约 700 小时，参数 1.2M → 42M，约 2.1 万 GPU 小时（标 `inferred`，来自论文而非配置）。

### B.7 部署态

C++ + ONNX/TensorRT 栈（`gear_sonic_deploy/deploy.sh sim|real`），encoder 与 decoder 必须**成套**使用（各自带 `observation_config.yaml`）。观测按 YAML 清单**按序拼接**，总维度必须与 ONNX 输入尺寸严格一致。

官方给出的三套部署观测配置，正好可以作为部署态视图的三个可选预设：

| 预设 | 组成 | 总维 |
|---|---|---|
| 默认（无 encoder） | `motion_joint_positions` 29 + `motion_joint_velocities` 29 + `motion_anchor_orientation` 6 + `base_angular_velocity` 3 + `body_joint_positions` 29 + `body_joint_velocities` 29 + `last_actions` 29 | **154** |
| Token 版 | `token_state` 64 + `base_angular_velocity` 3 + `body_joint_positions` 29 + `body_joint_velocities` 29 + `last_actions` 29；encoder 侧吃 290 + 290 + 60 + 10 | **154**（策略侧）/ 650（encoder 侧） |
| VR 遥操作 | Token 版再加 `vr_3point_local_target` 9 + `vr_3point_local_orn_target` 12 + `vr_3point_compliance` 3 | **178** |

多帧命名约定 `{name}_{N}frame_step{S}`，step 以 50 Hz 控制 tick 计（`step5` = 帧间隔 0.1 s），`10frame_step5` 给出 0.9 s 前瞻窗口；超出动作长度时重复最后一帧。低延迟遥操作档为 4 帧 / 约 80 ms。

一个有意思的巧合值得放在页面上：SONIC 部署默认观测是 **154 维**，BeyondMimic 的 wo-state-estimation 变体也是 **154 维**，且两者的组成结构完全同构（参考关节位置 29 + 参考关节速度 29 + 参考姿态 6 + 基座角速度 3 + 关节位置 29 + 关节速度 29 + 上一动作 29）。这条「两条路线在部署接口上收敛到同一张观测清单」的观察，是整个页面最值得讲的一个结论。

---

## 附录 C — 参考资料

- 观测输入分类：<https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-observation-inputs>
- 奖励函数分类：<https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-reward-functions>
- BeyondMimic 论文 <https://arxiv.org/abs/2508.08241> · 代码 <https://github.com/HybridRobotics/whole_body_tracking> · 项目页 <https://beyondmimic.github.io/>
- SONIC 论文 <https://arxiv.org/abs/2511.07820> · 代码 <https://github.com/NVlabs/GR00T-WholeBodyControl> · 文档 <https://nvlabs.github.io/GR00T-WholeBodyControl/> · 项目页 <https://nvlabs.github.io/GEAR-SONIC/>
