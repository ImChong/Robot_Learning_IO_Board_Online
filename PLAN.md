# Robot Learning IO Board — 建设计划

> 用「模块 + 连线」的节点图，把热门人形机器人强化学习项目的**输入、输出、奖励函数**画成可交互的网页。
> 首批覆盖**真机路线**的 **SONIC** 与 **BeyondMimic**，以及**动画路线**的 **MimicKit** 方法族（DeepMimic、AWR、AMP、ASE、LCP、ADD、SMP 共 7 个方法）。每个项目可在**训练态**（含奖励函数设置）与**推理/部署态**之间切换。

本文是实施前的设计文档，确定「做什么、做成什么样、怎么分阶段做」。文末附录 A/B/C 是已经逐项核对过一手实现的内容基线，可直接作为首版数据文件的输入。

---

## 1. 目标与非目标

### 目标

1. **一眼看清一条策略吃什么、吐什么**。观测项、参考项、特权项、动作项、奖励项各自是一个模块，模块之间用连线表达数据流，每个模块标注维度、频率、来源、真机可得性。
2. **训练态 / 部署（推理）态可切换**。同一个项目切换视图后，能直接看到「训练时有、之后没有」的模块被摘掉（特权观测、奖励、判别器、终止条件），以及部署时新增的模块（状态估计器、ONNX 运行时、多速率命令环）。
3. **横向可比**。所有项目用同一套模块语汇和同一套配色描述，使「规模化预训练」与「精确物理 + 失败采样」两条真机路线的差异、以及「手写奖励 → 对抗奖励 → 生成式奖励」这条方法演进线，都落在图上而不是文字里。
4. **说清奖励是谁算出来的**。同样落在「风格与模仿」类里，闭式公式、判别器输出、扩散先验的 score matching 是三种完全不同的东西。页面要把这个区分做成一等公民（见 §3.2 的 `reward_kind`），而不是把它们画成同一种框。
5. **数字可追溯**。每个模块的维度和权重都能点开看到出处（论文章节、仓库文件路径、配置项名），避免变成一张凭印象画的示意图。

### 非目标

- 不做训练/推理的实际运行或可视化回放，页面是**静态数据驱动**的说明性图表。
- 不做通用节点图编辑器。布局由数据决定，用户只做浏览、切换、展开，不做拖拽建模（M6 可选加「拖拽微调 + 导出坐标」）。
- 不覆盖全部人形 RL 项目。第一批做 SONIC 与 BeyondMimic，把数据结构打磨到「加下一个项目只写一个 JSON」的程度；第二批做 MimicKit 方法族，用它反过来压测数据模型（见 §2.2）。
- 不做算法教程。页面解释的是「一条策略吃什么、吐什么、被什么奖励塑形」，不解释 PPO / 扩散模型本身怎么推导。

---

## 2. 内容范围

内容分两批。第一批（§2.1）是**真机路线**的两个项目，用来把页面立起来；第二批（§2.2）是**动画路线**的 MimicKit 方法族，用来压测数据模型并补上「奖励可以不是手写的」这条主线。

### 2.1 第一批：真机路线的两个极端（四张图）

| | 训练态（Training） | 部署态（Deployment） |
|---|---|---|
| **BeyondMimic** | Isaac Lab 跟踪环境：160 维策略观测 + 286 维特权 critic 观测 + 9 项奖励 + 4 项终止 | 导出策略：154 维观测（去掉两项依赖状态估计的量）→ 29 维关节目标 → PD |
| **SONIC** | 三编码器 → FSQ → 共享 decoder；10 帧本体历史 + 10 帧未来参考；12–14 项奖励 + 辅助重建损失 | ONNX encoder/decoder 成套，50 Hz；观测按 YAML 清单拼接（默认 154 维，token 版 64 + 90 维） |

选这两个项目的理由：它们是同一范式（whole-body motion tracking）的两个极端——BeyondMimic 是小数据单平台的最小可交付基线，SONIC 是亿级帧规模化预训练 + 统一 token 接口。**它们的奖励项集合高度重叠**（SONIC 的 9 项基础奖励与 BeyondMimic 逐项同名同权重），差异集中在观测的时序深度、上游接口和额外的正则项上。这个「同源但分叉」的关系本身就是页面最有信息量的一条结论。

### 2.2 第二批：MimicKit 方法族（DeepMimic → SMP，7 个方法）

核对对象：[`xbpeng/MimicKit`](https://github.com/xbpeng/MimicKit)（`main` 分支，commit `2ed1e6c`）。这是同一作者把自己十年来七篇工作收进同一套代码的「方法博物馆」：环境、角色、控制频率、网络规模全部共用，**方法之间的差别被压缩到「奖励从哪来」和「策略额外吃什么」两件事上**。这正好是本页面的两个坐标轴，所以它是数据模型最好的压力测试对象。

| 方法 | 年份 | 与前一方法的增量 | 策略观测（humanoid） | 奖励来源 |
|---|---|---|---|---|
| **DeepMimic** | 2018 | 基线：单段参考动作 + 手写 5 项跟踪奖励 | 140 + 3 帧未来参考 324 = **464** | 手写（5 项加权 exp） |
| **AWR** | 2019 | 只换优化器：PPO → 优势加权回归 | **464**（与 DeepMimic 完全相同） | 手写（同上） |
| **AMP** | 2021 | 去掉相位/参考观测，奖励改判别器 | **140** | 对抗（判别器，10 帧 × 142 维窗口） |
| **ASE** | 2022 | 加 64 维技能潜变量 + 编码器互信息奖励 | 140 + z 64 = **204** | 对抗 0.5 + 编码器 0.5 |
| **LCP** | 2025 | 只加一项 actor 损失：Lipschitz 梯度罚 | G1 上 **849** | 手写（同 DeepMimic） |
| **ADD** | 2025 | 判别器改吃「参考 − 实测」的差分 | **464** | 对抗（差分判别器，1 帧 × 172 维） |
| **SMP** | 2026 | 判别器换成冻结的扩散先验，奖励用 SDS 损失 | **140**（+ 任务观测 2/5/6） | 生成式（SDS）：单段 1.0；任务版 SDS 0.5 + 任务 0.5 |

选它的四条理由：

1. **奖励来源的完整光谱**。第一批两个项目的奖励全是手写的加权 exp 项，六类奖励面板足够用。MimicKit 一次给出四种奖励来源：手写（DeepMimic / AWR / LCP）、对抗（AMP / ASE / ADD）、编码器互信息（ASE）、扩散先验的 score matching（SMP）。这迫使数据模型在「奖励项」之上再加一个正交维度 `reward_kind`（见 §4.5），也让奖励面板从「一张权重表」升级成「一张来源图」。
2. **消融对照的天然样本**。DeepMimic 与 AWR 共用同一份环境配置，唯一差别在 agent；LCP 也只是在 PPO 的 actor 损失上加一项。页面上把它们并排画出来，读者能直接看到「哪些框是环境的、哪些框是算法的」——这是节点图相比论文表格的独有优势，也顺带验证了数据模型的复用能力（§4.6 的 `inherits`）。
3. **补上一直空着的 D 类（外部感知）**。SONIC 与 BeyondMimic 都是盲式跟踪，输入五类里的 D 类只能标「本项目不使用」。MimicKit 的 dodgeball 任务把飞来物体的相对位置与速度（1 个投射物 × 6 维）直接喂进策略，D 类第一次有了真实内容。
4. **反向照出真机路线的取舍**。MimicKit 全程**没有域随机化、没有观测噪声、没有状态估计器**，观测里大方地用全局根位置、全身连杆位置这类仿真直读量，控制频率 30 Hz。把它和 SONIC / BeyondMimic 并排放，「哪些设计是为了真机」这件事不用文字论证就成立了。

MimicKit 系列的第二个视图**不是部署态**，因为这套代码没有真机部署目标：没有 ONNX 导出、没有通信层（LCP 是例外，它的论文本身是真机工作，但仓库里提供的仍只是仿真配置）。改为**推理态（Test）**：去掉奖励、判别器、编码器、扩散先验、critic、参考角色可视化，动作从采样改成取分布众数（`mode`），保留策略主干与动作后处理链。这条差异要求 `modes` 从固定的 `train`/`deploy` 两个键改成一个可声明的数组（见 §4.1），否则 `availability: "deploy-ok"` 这类标注在 MimicKit 上会变成假信息。

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
| C | 历史与时序上下文 | 帧堆叠深度（SONIC = 10 帧）、未来参考窗口、判别器的 10 帧观测窗口 |
| D | 外部感知 | SONIC / BeyondMimic / MimicKit 多数环境为盲式，标「本项目不使用」；MimicKit 的 dodgeball 任务是唯一有内容的一例（投射物相对位置 + 速度 6 维） |
| E | 特权信息（仅训练） | critic 侧的 body_pos/body_ori/base_lin_vel 等 |

MimicKit 引入一类现有五类装不下的输入：ASE 的 64 维技能潜变量 `z`。它既不是传感器读数（A），也不是外部给的运动指令（B）——它是**采样出来的、由算法自己定义语义的条件量**。处理办法是把它归到 B 类但加一个 `role: "latent-command"` 标记，节点上注明「训练时按 U(0, 5) s 周期重采样，推理时由上层任务策略给出」，避免读者误以为它是可观测的物理量。

### 3.2 奖励六类 → 奖励面板分组（沿用，并加一条正交轴）

六类沿用：任务与跟踪 / 姿态与稳定 / 步态与接触 / 能效与平滑 / 安全与硬件 / 风格与模仿。
跟踪系策略的特点是 A 类与 F 类合流（参考跟踪本身就是任务奖励），页面要显式说明这一点，否则读者会疑惑为什么没有独立的「步态相位」项。

六类回答的是「这一项替谁说话」，但 MimicKit 逼出了另一个必须回答的问题：**这一项的数值是谁算出来的**。同样落在 F 类（风格与模仿）里，DeepMimic 的 `pose` 项是一条闭式公式，AMP 的判别器奖励是一个每轮都在变的神经网络输出，SMP 的奖励要跑三步扩散去噪才能得到。把它们画成同一种框会丢掉最关键的信息。因此新增正交字段 `reward_kind`（枚举，见 §4.5）：

| `reward_kind` | 含义 | 出现在 | 页面表现 |
|---|---|---|---|
| `handcrafted` | 闭式公式 + 人工权重 | BeyondMimic / SONIC 全部；DeepMimic / AWR / LCP 全部 | 实心框，展开显示 KaTeX 公式与参数 |
| `adversarial` | 判别器输出，与策略同步训练 | AMP、ASE、ADD | 双线框，展开显示判别器输入清单、正/负样本定义、正则项 |
| `encoder` | 编码器与条件量的互信息代理 | ASE | 双线框，画一条从判别器观测回到潜变量的边 |
| `generative` | 冻结生成模型的似然代理 | SMP（扩散先验的 SDS 损失） | 双线框 + 「冻结」角标，展开显示扩散步与归一化方式 |
| `task` | 与模仿无关的任务项 | AMP / SMP 的 location / steering / dodgeball | 实心框，与 `handcrafted` 同形但配色区分 |

`adversarial` / `encoder` / `generative` 三种的共同点是**它们没有固定权重可以列表**——权重只有一个总的混合系数（`disc_reward_weight`、`enc_reward_weight`、`smp_reward_weight`、`task_reward_weight`），奖励的「形状」藏在网络参数里。奖励面板对这三类要换一种渲染：不列权重条，而是列「输入了什么 + 正样本是什么 + 怎么变成标量」。这是 M3.5 的主要前端工作量。

### 3.3 输出五类 → 本项目新增

参考页目前没有输出侧的对偶分类，这是本项目可以补上的一块。提议按「这个输出流向哪里」切五类：

| 代号 | 类别 | 典型内容 | 是否下发硬件 |
|---|---|---|---|
| O1 | 关节目标 | 关节位置 setpoint（PD 参考），维度 = 可控 DoF | 是 |
| O2 | 直接力矩 | 关节力矩 / 前馈项 | 是 |
| O3 | 残差动作 | 叠加在基线控制器（WBC / 运动学规划器）之上的增量 | 是（合成后） |
| O4 | 分层接口输出 | 统一 token / latent，供下游 decoder 或上游 VLA 对接 | 否（策略内部或跨模块） |
| O5 | 辅助头 | 价值函数、重建头、估计器输出、判别器分数、ASE 编码器预测的 z | 否（仅训练或仅监控） |

配套的**动作后处理链**在图上单独画成一串串联模块，因为这段是真机翻车的高频位置：

```
策略原始输出 → 裁剪（action_clip） → 逐关节缩放（action_scale） → 加默认站姿偏移
→ PD 控制器（stiffness / damping / armature） → 力矩限幅（effort_limit） → 电机
```

SONIC 与 BeyondMimic 在这条链上是同构的（都是 O1 类关节位置目标 + PD），差别只在 action_scale 的计算方式和 clip 阈值——正好可以用同一组模块 + 不同参数值来渲染，验证数据模型的表达力。

MimicKit 的这条链形状相同但每一环的来源不同，是同一组模块的第三组参数值：

```
策略输出（归一化到 [-1, 1]） → 按关节动作上下界反归一化（a_norm）
→ 按动作空间上下界裁剪 → PD 位置目标（stiffness / damping 取自 MJCF）
→ 力矩限幅（取自 MJCF actuator gear） → 电机
```

三个差别值得在图上标出来：其一，MimicKit 的 `action_scale` 不是人工设的系数，而是由**关节限位算出来的半量程**（1D 关节取 `1.4 ×` 半量程，3D 球关节按指数映射取 `1.2 × max|limit|`），G1 与 pi_plus 还额外用 `zero_center_action` 把中心从「关节量程中点」挪到 0；其二，越界不是靠 clip 兜底，而是靠 actor 损失里的 `action_bound_weight = 10.0` 惩罚项主动压回来，clip 只是最后一道保险；其三，PD 增益与力矩上限完全来自角色 MJCF 文件而非环境配置，所以「换角色」在 MimicKit 里等于「换执行器参数」，这一点与真机路线按执行器型号分组设增益是同一件事的两种表达。

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
  "family": "realworld",              // realworld | mimickit，用于项目选择器分组
  "modes": [
    { "id": "train",  "label": "训练态", "graph": { /* Graph */ } },
    { "id": "deploy", "label": "部署态", "graph": { /* Graph */ } }
  ]
}
```

`modes` 用**数组**而不是固定键的对象，因为第二批项目的第二个视图是「推理态（Test）」而不是「部署态」（§2.2）：MimicKit 没有真机导出目标，硬套 `deploy` 会让 `availability: "deploy-ok"` 这类标注变成假信息。数组形式让每个项目自己声明有哪几个模式、各叫什么，页面的模式切换器按数组渲染按钮；模式切换动画（§5.2）改成「按 `id` 匹配前后两个 Graph 的节点」，与模式叫什么无关。

约定：**每个项目的第一个模式必须是训练态**，对比视图（§5.2）按数组下标对齐，找不到对应下标时只画左侧并标「本项目无此模式」。

### 4.2 图（Graph）

```jsonc
{
  "lanes": ["source", "reference", "proprio", "history", "privileged",
            "latent", "task", "network", "action", "actuation",
            "critic", "discriminator", "prior", "learning"],
  "nodes": [ /* Node */ ],
  "edges": [ /* Edge */ ],
  "rewards": [ /* RewardTerm，仅训练态 */ ],
  "terminations": [ /* TerminationTerm，仅训练态 */ ],
  "callouts": [ /* 图上的批注气泡 */ ]
}
```

第二批新增四条泳道，全部由 MimicKit 逼出来：

- `latent` —— ASE 的 64 维技能潜变量及其采样器（周期重采样）。
- `task` —— location / steering / dodgeball 的任务观测与任务目标发生器。
- `discriminator` —— 判别器/编码器的观测窗口、网络、回放缓冲、梯度罚。AMP、ASE、ADD 三家结构不同但都落这条泳道。
- `prior` —— SMP 的冻结扩散先验（TinyMDM）及其 SDS 打分路径与 GSI 初始状态生成路径。

`critic` 从原来的 `learning` 泳道里拆出来单列，因为 ASE 的 critic 与 actor 吃的输入不同（多一个 z），画在一起会让边穿过整张图。`lanes` 是每个 Graph 自己声明的数组，项目只声明自己用得到的泳道，渲染时按声明顺序分列——所以新增泳道不影响第一批两个项目的布局。

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
  "acquisition": "estimate",          // direct | filter | estimate | given | sim-only | derived | sampled
  "availability": "deploy-hard",      // deploy-ok | deploy-hard | train-only | sim-only
  "noise": "U(-0.25, 0.25)",          // 训练时注入的观测噪声，null = 不注入
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

- **`acquisition`（怎么拿到）** —— 直读 / 滤波 / 学习估计 / 上层给定 / 仿真直读 / 推导 / 采样得到。这是参考页反复强调的「工程关键问题」。第二批新增 `sampled`，专给 ASE 的技能潜变量和 SMP 由扩散先验生成的初始状态用：它们既不是测量也不是推导，而是从一个分布里抽出来的。
- **`availability`（部署可得性）** —— 决定该节点在第二个模式里是否出现、以及是否要画成虚线降级形态。第二批新增 `sim-only`：这一项在仿真里随手可得、真机上根本没有对应量（全局根位置、全身连杆位置、参考角色状态），且**项目本身不打算上真机**。它和 `train-only` 的区别是后者意味着「作者刻意只在训练用」，前者意味着「作者没有这个问题」——混为一谈会让 MimicKit 看起来像是在特权观测上偷懒。
- **`confidence`（可信度）** —— `verified` = 从一手仓库配置逐项核对；`derived` = 由核对过的项算出（如总维度求和）；`inferred` = 论文/文档口径推断，未在代码中定位。页面用角标区分，不让推断值伪装成事实。

### 4.4 连线（Edge）

```jsonc
{
  "from": "obs.motion_anchor_pos_b",
  "to": "net.actor",
  "kind": "obs",        // obs | ref | action | reward | grad | distill | privileged
                        // | feedback | latent | disc | prior | init
  "style": "solid",     // solid | dashed（dashed = 仅训练期存在 / 信息搬运）
  "label": "3"          // 可选，边上标维度
}
```

第二批新增四种 `kind`：`latent`（潜变量条件流，ASE 的 z → actor/critic）、`disc`（判别器/编码器的取样与打分流）、`prior`（冻结生成模型的打分流，SMP 的 SDS）、`init`（初始状态注入流，SMP 的 GSI 与各方法的参考状态初始化 RSI）。`init` 这条边在第一批里其实也存在（BeyondMimic 的失败率驱动采样器就是往环境里塞初始状态），原先被塞进 `feedback` 里，现在单列，正好让「初始状态从哪来」在四个项目上可横向对比——这条线是模仿学习里被论文反复强调、却几乎不会画进示意图的一环。

### 4.5 奖励项（RewardTerm）

```jsonc
{
  "id": "motion_body_pos",
  "group": "A",                         // 奖励六类代号
  "reward_kind": "handcrafted",         // handcrafted | task | adversarial | encoder | generative
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

`reward_kind` 不是 `handcrafted` 时，`weight` 的语义变成「该来源在总奖励里的混合系数」，`form` 描述从网络输出到标量奖励的映射，并新增一个 `model` 子对象说明这个网络本身：

```jsonc
{
  "id": "disc_reward",
  "group": "F",
  "reward_kind": "adversarial",
  "label": "判别器风格奖励",
  "weight": 1.0,                        // disc_reward_weight
  "form": "-\\lambda \\log\\bigl(1 - D(s)\\bigr)",
  "params": { "disc_reward_scale": 2.0 },
  "model": {
    "inputs": ["disc.obs_window"],      // 指向 Node id，页面据此高亮输入模块
    "positive": "参考动作库按同一时间窗采样的片段",
    "negative": "策略采样 + 200k 容量回放缓冲",
    "net": "[1024, 512] ReLU",
    "regularizers": { "logit_reg": 0.01, "grad_penalty": 5 },
    "frozen": false
  },
  "source": { /* 同 Node */ },
  "confidence": "verified"
}
```

奖励面板按 `group` 折叠成六个分区，分区内按 `reward_kind` 二次分组（手写项在上、学习式项在下），每项显示权重、公式、参数、方向。多个项目共有的项要能横向对齐显示（阶段 4 的对比视图依赖这个）。

### 4.6 项目继承（`inherits`）

MimicKit 里 DeepMimic 与 AWR 共用一份 `deepmimic_humanoid_env.yaml`，LCP 共用 `deepmimic_g1_env.yaml`。逐字复制三份 JSON 会让「改一处漏两处」成为必然，所以项目顶层支持一个可选的 `inherits`：

```jsonc
{
  "id": "mimickit-awr",
  "inherits": "mimickit-deepmimic",
  "name": "AWR",
  "subtitle": "只换优化器：PPO → 优势加权回归",
  "overrides": {
    "modes[train].graph.nodes": { "learn.optimizer": { /* 覆盖该节点 */ } },
    "modes[train].graph.nodes -": ["learn.ppo_clip"],   // 删除节点
    "modes[train].graph.nodes +": [ /* 新增节点 */ ]
  },
  "diff_summary": "环境、观测、动作、奖励、终止条件与 DeepMimic 完全一致，只有 actor 的更新规则不同。"
}
```

规则：合并在加载时完成（`data.js`），`validate.mjs` 对合并后的结果做全套校验；`diff_summary` 是必填的一句话，直接渲染在页面顶部，让读者立刻知道「这个项目和它的父项目差在哪」。继承只允许一层，禁止链式继承——两层以上就该老老实实写全量 JSON，否则数据文件会变成没人能读懂的补丁堆。

### 4.7 布局策略

**不引入图布局库**。节点的 `lane` 决定它落在第几列，列内按数组顺序纵向排布，列宽和行距由 CSS 变量控制。连线用三次贝塞尔从源节点右锚点连到目标节点左锚点，同一目标的多条入边在目标侧做扇形收拢。

理由：这类「输入 → 网络 → 输出」的图天然是分层 DAG，泳道布局比力导向布局稳定得多（每次打开位置一致，方便截图和讨论），而且实现成本低、无依赖。代价是节点顺序需要人工调，但内容是手写 JSON，本来就要人工调。

---

## 5. 页面与交互

### 5.1 布局

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏：站点名 · 项目选择器（两组：真机路线 / MimicKit） · 主题   │
├──────────────────────────────────────────────────────────────┤
│ 模式切换：[ 训练态 ] [ 部署/推理态 ] [ 对比 ]  图例 · 筛选器   │
├────────────────────────────────────────────┬─────────────────┤
│                                            │  详情抽屉        │
│              节点图画布（SVG）              │  ─ 模块说明      │
│         泳道分列 · 贝塞尔连线 · 缩放平移     │  ─ 维度构成      │
│                                            │  ─ 真机如何获得  │
│                                            │  ─ 出处链接      │
├────────────────────────────────────────────┴─────────────────┤
│ 奖励函数面板（仅训练态）：六类折叠 · 手写项权重条 + 学习式来源卡 │
└──────────────────────────────────────────────────────────────┘
```

项目数量从 2 涨到 9，顶栏的横向 Tab 放不下了。改成**按 `family` 分组的下拉选择器**：第一组「真机路线」两项，第二组「MimicKit 方法族」七项，按年份升序排列，父项目下的继承项（AWR、LCP）缩进一级显示并在名字后跟一句 `diff_summary`。模式切换按钮的文字来自 `modes[i].label`，不写死「部署态」。

### 5.2 关键交互

| 交互 | 行为 |
|---|---|
| 切换项目 | 换数据源，画布做淡入淡出重绘；保持当前模式与滚动位置。切到继承项目（AWR / LCP）时，父项目共有的节点保持原位不动，只有被 `overrides` 改动的节点做高亮闪烁——**这是继承机制在视觉上的兑现**，读者一眼看到「只有这两个框变了」 |
| 切换模式 | **同一批节点做位置补间动画**：共有节点平移到新位置，`train-only` / `sim-only` 节点淡出并收缩，第二个模式新增的节点淡入。这个动画是页面的核心表达——「奖励和特权观测消失了，策略权重留下了」 |
| hover 节点 | 高亮该节点的完整上下游链路，其余节点降透明度 |
| click 节点 | 右侧抽屉展开详情；URL 同步 `?p=sonic&mode=train&n=obs.gravity_dir`，可分享可回退 |
| click 奖励项 | 在画布上高亮该奖励项作用的目标模块（如 `joint_limit` 高亮关节限位与执行器节点）。学习式奖励项高亮的是它 `model.inputs` 指向的观测窗口节点与判别器/先验节点，把「这个奖励看着什么打分」画出来 |
| 筛选器 | 按输入五类 A–E、按 `availability`、按 `confidence`、按 `reward_kind` 过滤显示 |
| 对比模式 | 左右并排两个项目的同一模式下标，共有节点用连接线对齐，差异节点标 `+ / −` |
| 键盘 | `[` `]` 在项目列表里前后移动，`T/D` 切模式，`Esc` 关抽屉，方向键在节点间移动 |

### 5.3 图例与视觉编码

| 编码维度 | 视觉手段 |
|---|---|
| 输入/输出类别（A–E / O1–O5） | 节点主色（六色板，与参考页分类语义一致） |
| 部署可得性 | 边框：实线 = 可得；点线 = 需估计；灰底斜纹 = 仅训练；灰底无纹 = 仅仿真 |
| 获取方式 | 节点左上角小图标（传感器 / 滤波器 / 网络 / 上层 / 仿真 / 采样） |
| 维度大小 | 节点宽度按 `log(dim)` 轻微缩放，让 580 维的未来参考在视觉上重于 3 维的角速度 |
| 连线类型 | 颜色 + 虚实：观测流（蓝实）、参考流（青实）、动作流（橙实）、奖励/梯度（紫虚）、潜变量（紫实）、判别器/先验打分（红虚）、初始状态注入（绿虚）、蒸馏/信息搬运（灰虚） |
| 奖励来源 | 奖励卡边框：单线 = 手写/任务；双线 = 学习式；双线 + 锁形角标 = 冻结的生成先验 |
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
| 框架 | 无框架，原生 ES modules | 内容量级（9 个项目 × 2 个模式 × 数十节点，且同一时刻只渲染一张图）远不到需要虚拟 DOM 的规模；无构建步骤意味着改 JSON 就能预览，也和参考站（vanilla JS + d3）的工程习惯一致 |
| 渲染 | 内联 SVG，手写布局 | 连线是核心视觉，SVG 的路径与动画能力足够；避免 Canvas 带来的可访问性与文本渲染问题 |
| 公式 | KaTeX（CDN，与参考站同版本 0.16.x） | 奖励公式必须排版正确；KaTeX 体积小、无需构建 |
| 动画 | Web Animations API + CSS transition | 模式切换的位置补间用 `element.animate()`，无需动画库 |
| 数据 | 静态 JSON，运行时 `fetch` | 便于外部校验脚本读取；也让「加一个项目 = 加一个 JSON + 一行注册」成立 |
| 校验 | JSON Schema + 一个 Node 脚本 | 在 CI 里检查节点 id 唯一、边两端存在、维度求和自洽、`source` 必填、`inherits` 只有一层、学习式奖励的 `model.inputs` 指向存在的节点 |

```
Robot_Learning_IO_Board/
├── index.html
├── assets/
│   ├── style.css
│   └── theme-init.js            # 主题偏好，避免首帧闪白
├── src/
│   ├── main.js                  # 入口：路由、状态、事件
│   ├── data.js                  # 加载、inherits 合并与校验
│   ├── layout.js                # 泳道布局：节点 → 坐标
│   ├── render-graph.js          # SVG 节点与连线渲染
│   ├── render-rewards.js        # 奖励面板（手写项权重条 + 学习式来源卡）
│   ├── render-detail.js         # 详情抽屉
│   ├── render-table.js          # 表格降级视图
│   └── transitions.js           # 模式切换补间
├── data/
│   ├── projects.json            # 项目注册表（含 family 分组与排序）
│   ├── taxonomy.json            # A–E / O1–O5 / 奖励六类 / reward_kind 的定义与配色
│   ├── realworld/
│   │   ├── beyondmimic.json
│   │   └── sonic.json
│   └── mimickit/
│       ├── deepmimic.json       # 基准项目，AWR / LCP 继承它
│       ├── awr.json             # inherits: mimickit-deepmimic
│       ├── amp.json
│       ├── ase.json
│       ├── lcp.json             # inherits: mimickit-deepmimic（G1 变体）
│       ├── add.json
│       └── smp.json
├── schema/
│   └── project.schema.json
├── scripts/
│   └── validate.mjs             # 数据自洽性检查
└── PLAN.md
```

`data/` 按 `family` 分子目录：九个 JSON 平铺在一个目录里，改 SONIC 时会翻半屏才找到文件。`projects.json` 是唯一的注册表，页面只 fetch 它 + 当前选中项目（以及被继承的父项目），不预加载全部。

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
- 项目选择器、筛选器、键盘导航。
- 交付：真机路线的四张图全部可用。

### M4 — 对比模式与表格视图

- 并排对比，共有节点对齐，差异标注。
- 表格降级视图与打印样式。
- 交付：可以直接用来讲「SONIC 与 BeyondMimic 的奖励项其实几乎一样」这个结论。

### M5 — 接入 MimicKit 方法族（DeepMimic → SMP）

七个方法一次性接完，但内部按「数据模型改动量」分三小步，每小步都能单独验收。

**M5.1 手写奖励的三个方法（DeepMimic / AWR / LCP）**

- 落 `mimickit/deepmimic.json`（附录 C.2），验证 `modes` 数组化与 `sim-only` 可得性两项 schema 改动。
- 落 `awr.json` 与 `lcp.json`，验证 `inherits` + `overrides` 机制。这两个文件应当**短到能一屏看完**——如果不是，说明继承粒度设计错了，回头改 §4.6。
- 前端：项目选择器改分组下拉；继承项目切换时的「只有这两个框变了」高亮。
- 交付：三张训练态图 + 三张推理态图。数据模型的复用能力得到验证。

**M5.2 对抗系三个方法（AMP / ASE / ADD）**

- 新增 `discriminator` 与 `latent` 两条泳道，落 `amp.json`、`ase.json`、`add.json`（附录 C.3–C.5）。
- 奖励面板改造：`reward_kind != "handcrafted"` 时渲染「来源卡」而不是权重条。这是本阶段主要前端工作量。
- 重点验证三件事能否画清楚：AMP 的「10 帧窗口 + 回放缓冲 + 梯度罚」、ASE 的「潜变量采样器 → actor，判别器观测 → 编码器 → 互信息奖励」这条回路、ADD 的「判别器吃的是差分而不是状态本身，正样本是零向量」。
- 交付：六张图。**第二个值得分享的版本**——此时页面已经能讲「模仿学习的奖励是怎么从手写走到对抗的」这条完整线索。

**M5.3 生成式方法（SMP）与任务环境**

- 新增 `prior` 与 `task` 泳道，落 `smp.json`（附录 C.6），含 location / steering / dodgeball 三个任务预设。
- dodgeball 预设让输入五类的 D 类第一次有内容，图例里「本项目不使用」的灰条要能变成实框。
- 画两条此前没有的链路：SDS 打分路径（冻结先验 → 奖励）与 GSI 路径（冻结先验 → 初始状态，`kind: "init"`）。后者要显式标注「策略训练期间不使用任何动作数据」，这是 SMP 相对 AMP 最反直觉的一点。
- 交付：九个项目全部可用。

### M6 — 跨族对比与打磨（可选）

- 跨族对比视图：MimicKit 的 DeepMimic 与 BeyondMimic 并排（同为「参考跟踪 + 手写奖励」，差在部署取向）、SONIC 与 ASE 并排（同为「潜空间接口」，差在潜空间是学出来的 token 还是采样出来的 z）。这两组对比是把两批内容真正缝在一起的地方，不做的话页面只是两个独立的展。
- 移动端布局（画布改为纵向堆叠 + 折叠泳道）。
- 深链接分享卡片、导出 SVG/PNG。
- 拖拽微调节点位置并导出坐标，回写 JSON。

---

## 8. 数据准确性规范

这个页面的价值全在数字对不对，所以定几条硬规矩：

1. **每个 `dim` 和每个 `weight` 都要有 `source`**，指向仓库文件路径 + 配置项名，或论文的具体表/节。没有出处的条目不许进 `main`。
2. **总维度只能是 `derived`**，由逐项 `verified` 的维度求和得出，并在页面上标 `≈` 角标。求和逻辑写进 `validate.mjs`，防止手算漏项。
3. **区分「论文口径」与「开源实现口径」**。二者不一致时，以开源实现为图的主体，把论文口径放在节点的 `note` 里。已知的一处不一致：多份二手资料称 BeyondMimic 使用「历史本体感知堆叠」，但上游 `whole_body_tracking` 的策略观测组**没有设置 history_length**，是单帧观测 + 经验归一化。这类差异要在页面上明确写出来，而不是二选一悄悄采用。
4. **记录核对时间与 commit**。数据文件里带 `verified_at` 与 `verified_ref`（分支或 commit），因为上游仓库还在迭代（SONIC 已有 release / v1.1 / bones_seed / h2 多套配置）。
5. **同一项目的多套配置要显式选一套并标明**。SONIC 首版以 `sonic_release` 为主，把 `sonic_v1_1` 的差异（heading 归一化、额外 energy 项、更大的 decoder）作为节点批注。MimicKit 每个方法都有 5–6 个角色的配置（humanoid / G1 / SMPL / Go2 / pi_plus），首版**统一以 humanoid 为准**（它是唯一随仓库分发 MJCF 的角色，可逐项核对），其余角色列成一张对照表放在项目详情里（附录 C.1）。LCP 例外：它只提供 G1 配置，就以 G1 为准并注明。
6. **只在源文件里能读到的数字才算 `verified`**。MimicKit 的资产（除 humanoid 外）与动作数据需要另行下载，`data/assets/` 里只有 `humanoid.xml`。所以 G1 / SMPL / Go2 / pi_plus 的关节数与 DoF 数是从 `joint_err_w` 数组长度和 `init_pose` 数组长度反推的，必须标 `derived` 并在 `note` 里写清反推依据；连杆分组、关节限位、PD 增益这些只存在于未分发 XML 里的量，一律不写进数据文件，宁可留空。
7. **学习式奖励不许伪造权重**。`reward_kind` 为 `adversarial` / `encoder` / `generative` 的项，`weight` 只能填配置里真实存在的混合系数（`disc_reward_weight` 等），不得为了让权重条好看而编造分项权重。这类项的信息量在 `model` 子对象里，不在权重里。

---

## 9. 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| SONIC 的 critic 观测与部分维度无法从公开配置逐项确定（如 critic 侧 body 数量） | 总维度算不准 | 标 `inferred` 并在节点上写明「待核对」，不编造数字；后续从 `observation_config.md` 之外的部署示例或 ONNX 输入尺寸反推 |
| 节点数量偏多导致图拥挤（SONIC 训练态节点约 30+） | 可读性下降 | 泳道内支持「分组节点」（一个可展开的容器节点，如把三个编码器折叠成「编码器族」）；筛选器默认隐藏 `confidence=inferred` 之外的次要节点 |
| 上游仓库更新导致数据过期 | 内容失真 | `verified_at` + 定期核对；`validate.mjs` 可扩展为拉取上游文件做 diff 提醒 |
| 第一批两个项目的奖励项高度重叠，对比视图可能显得「没差别」 | 页面结论平淡 | 这本身就是结论。对比视图要突出**差异集**（SONIC 多出的 anti_shake / vr_5point / feet_acc / energy）与**观测时序深度**的量级差（单帧 vs 10 帧 × 10 未来帧） |
| 中文长标签在窄节点里排版困难 | 视觉粗糙 | 节点标签两行截断 + `title`，完整说明放抽屉；维度用等宽数字单独一行 |
| 学习式奖励「没有公式可看」，读者可能觉得这几张图信息量不如手写奖励的项目 | MimicKit 后三个方法的页面显得空 | 奖励来源卡必须回答四个具体问题：吃什么（指向具体观测节点与维度）、正样本是什么、怎么变成标量（写出 `-2\log(1-D)` 这类真实映射）、有哪些正则项（梯度罚系数、logit 罚系数）。这些都是配置里的真实数字，信息量并不比权重表少 |
| MimicKit 除 humanoid 外的角色资产不随仓库分发 | 五个角色的关节/DoF 数只能反推，PD 增益无从核对 | 见 §8.6：反推值标 `derived` 并写明依据，不可核对的量留空不写。首版只把 humanoid 画全 |
| 项目数量涨到 9，同一套泳道布局未必都合适（Go2 四足、SMPL 69 DoF） | 部分图过高或过宽 | 首版统一用 humanoid，把角色差异降级为详情里的对照表；泳道内的「分组节点」（可展开容器）是主要的高度控制手段 |
| DeepMimic 的实现口径与 2018 年论文口径不一致（相位观测被关掉、改用 3 帧未来参考；奖励从 4 项拆成 5 项） | 读者按论文预期看图会困惑 | 按 §8.3 处理：图以实现为主体，节点 `note` 写明论文口径与差异原因。这一条要写成显式批注气泡，因为 DeepMimic 是这七个方法里名气最大、读者预期最强的一个 |

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

## 附录 C — MimicKit 方法族内容基线（DeepMimic → SMP）

核对对象：`xbpeng/MimicKit`，`main` 分支，commit `2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69`（2026-06-23）。方法与文档入口见 `docs/README_{DeepMimic,AMP,AWR,ASE,LCP,ADD,SMP}.md`。

除特别说明外，所有维度都以 **humanoid 角色**（`data/assets/humanoid/humanoid.xml`，随仓库分发，可逐项核对）+ **Isaac Gym 引擎配置**为准。

### C.1 框架共性（七个方法共用的底座）

这一节的内容在七张图上是**同一批节点**，只有参数值不同。它决定了 MimicKit 系列各图之间的可比性。

#### C.1.1 角色

| 角色 | 资产文件 | 连杆 | 关节（除根） | DoF | 核对依据 |
|---|---|---|---|---|---|
| **humanoid** | `data/assets/humanoid/humanoid.xml` | 15 | 14 | **28** | XML 随仓库分发，`verified` |
| G1 | `data/assets/g1/g1.xml` | 31 | 30 | 29 | `joint_err_w` 长 30、`init_pose` 长 35 = 6 + 29，`derived` |
| SMPL | `data/assets/smpl/smpl.xml` | 24 | 23 | 69 | `joint_err_w` 长 23、`init_pose` 长 75 = 6 + 69（23 × 3 球关节），`derived` |
| Go2（四足） | `data/assets/go2/go2.xml` | 17 | 16 | 12 | `joint_err_w` 长 16、`init_pose` 长 18 = 6 + 12，`derived` |
| pi_plus | `data/assets/hightorque_pi_plus/pi_22dof.xml` | 24 | 23 | 22 | `joint_err_w` 长 23、`init_pose` 长 28 = 6 + 22，`derived` |
| humanoid + 剑盾 | `data/assets/sword_shield/humanoid_sword_shield.xml` | 17 | 16 | 31 | `joint_err_w` 长 16、`init_pose` 长 37 = 6 + 31，`derived` |

humanoid 的 14 个关节按运动树深度优先排列：腹（3D）、颈（3D）、右肩（3D）、右肘（1D）、右手（0D）、左肩（3D）、左肘（1D）、左手（0D）、右髋（3D）、右膝（1D）、右踝（3D）、左髋（3D）、左膝（1D）、左踝（3D）。**注意「关节数」与「DoF 数」不等**：右手、左手是 0 自由度的连杆，但在观测里仍然占一份关节旋转（恒等四元数）——这是 MimicKit 观测维度算不对的最常见原因，页面上要显式标出来。

G1 的 30 关节 / 29 DoF 与附录 A、B 里 BeyondMimic 和 SONIC 用的 Unitree G1 是**同一台机器人的同一组自由度**（29 DoF）。这让「同一台 G1 在动画路线与真机路线上被怎么建模」成为一组可以直接并排的对照，是 M6 跨族对比的第一个素材。

#### C.1.2 引擎与频率

| 引擎 | `control_mode` | 控制频率 | 物理频率 | decimation |
|---|---|---|---|---|
| Isaac Gym（默认） | `pos` | **30 Hz** | 120 Hz | 4 |
| Isaac Lab | `pos` | 30 Hz | 120 Hz | 4 |
| Newton | `pos` | 30 Hz | 240 Hz | 8 |

出处：`data/engines/*.yaml`。控制周期 `timestep = 1 / control_freq ≈ 33.3 ms`，这个值同时决定了未来参考的前瞻步长与判别器历史窗口的跨度，所以在图上要画成一个独立的「时钟」节点，被多条边引用。

与真机路线的对比很直接：BeyondMimic 与 SONIC 都是 **50 Hz 控制 / 200 Hz 物理**，MimicKit 是 **30 Hz / 120 Hz**。30 Hz 是动画领域的习惯（对齐 30 fps 动作素材），50 Hz 是真机伺服环的习惯。

#### C.1.3 观测积木（humanoid）

MimicKit 的观测由三个可组合的函数拼出来，七个方法只是开关组合不同。把它们做成三个「积木节点」，是 MimicKit 系列七张图能共用一套布局的关键。

**积木 1：本体观测 `compute_char_obs`**（`mimickit/envs/char_env.py`）—— 所有方法都有，**140 维**

| 分项 | 维度 | 类别 | 说明 |
|---|---|---|---|
| 根高度 `root_h` | 1 | A | `root_height_obs=True` 时置于最前；为 False 时整项去掉 |
| 根旋转（tan-norm 6 维表示） | 6 | A | `global_obs=True` 用世界系；为 False 时先左乘 heading 逆旋转，得到去偏航的局部姿态 |
| 根线速度 | 3 | A | `global_obs=False` 时旋转到局部系。真机不可直测（需 EKF 或学习估计），MimicKit 从仿真直读并直接给策略——真机语境下这一项属于 E 类特权量，是本族与第一批最实质的一处分歧 |
| 根角速度 | 3 | A | 同上 |
| 关节旋转 14 × 6 | 84 | A | 每个关节的四元数转 tan-norm；**含 2 个 0 自由度的手** |
| 关节速度 `dof_vel` | 28 | A | 与 DoF 数一致，不含 0 自由度关节 |
| 关键连杆位置 5 × 3 | 15 | A | 相对根位置；`key_bodies = [head, right_hand, left_hand, right_foot, left_foot]` |

合计 **140**（`derived`）。`global_obs` 只改变坐标系，不改变维度。

**积木 2：未来参考观测 `compute_tar_obs`**（`mimickit/envs/deepmimic_env.py`）—— DeepMimic / AWR / LCP / ADD 有，AMP / ASE / SMP 无

单帧 **108 维**：目标根位置差 3（`root_height_obs=True` 时第三维换成目标的绝对高度）+ 目标根旋转 6 + 目标关节旋转 84 + 目标关键连杆位置 15（相对目标根）。

`tar_obs_steps = [1, 2, 3]` × 33.3 ms → **前瞻 33 / 67 / 100 ms**，三帧共 **324 维**。

拿它和 SONIC 对照很有意思：SONIC 的未来窗口是 **10 帧 × 100 ms = 0.9 s**，MimicKit 是 **3 帧 × 33 ms = 0.1 s**，差了一个数量级。原因也清楚——SONIC 要用前瞻吸收真机的通信与执行延迟，MimicKit 在仿真里不需要。

**积木 3：相位观测 `compute_phase_obs`**（同上）—— **七个方法的随仓库配置全部关闭**

`enable_phase_obs: False` 出现在全部 24 个训练环境配置里，无一例外（`view_motion_*` 与 `dof_test_*` 是纯可视化工具环境，不含这些键）。`num_phase_encoding: 4` 仍留在 DeepMimic 与 ADD 系列配置里但不生效。若打开，维度是 1 + 2 × 4 = 9（相位标量 + 4 组倍频 sin/cos 位置编码）。

**这是 DeepMimic 实现口径与 2018 年论文口径最显眼的一处差异**：论文用相位变量告诉策略「现在该做动作的第几阶段」，而这份实现改用「三帧未来参考」承担同一职责。按 §8.3，图上以实现为主体，节点画成灰色停用态并标注论文口径。这也是 §9 风险表里专门留了一条的原因——DeepMimic 名气最大，读者预期最强。

#### C.1.4 动作与执行链（所有方法相同）

| 环节 | 内容 |
|---|---|
| 动作类型 | 关节位置目标（O1 类），维度 = DoF（humanoid 28 / G1 29） |
| 动作空间上下界 | 1D 关节：以中心点为轴，半宽取「中心点到关节上下限的较大距离」的 **1.4 倍**；3D 球关节按指数映射表示，上下界取「该关节各自由度限位绝对值的最大者」的 **1.2 倍**，正负对称 |
| `zero_center_action` | 决定 1D 关节的中心点：默认 `False` 取关节量程中点，G1 与 pi_plus 设 `True` 把中心点强制为 0 |
| 归一化 | 策略在 `[-1, 1]` 上输出，按动作空间的中点/半量程反归一化（`_build_action_normalizer`） |
| 越界处理 | 主要靠 actor 损失里的 `action_bound_weight = 10.0` 惩罚 `mode` 越界；`_apply_action` 里的 clip 是最后一道保险 |
| 探索噪声 | 固定标准差 `action_std = 0.05`（`actor_std_type: FIXED`），不做退火 |
| PD | Isaac Gym `DOF_MODE_POS`，`stiffness` / `damping` **来自角色 MJCF**（humanoid：腹 1000/100、颈 100/10、肩 400/40、肘 300/30、髋 500/50、膝 500/50、踝 400/40） |
| 力矩上限 | 来自 MJCF `<actuator>` 的 `gear`（腹 200、颈 50、肩 100、肘 70、髋 200、膝 150、踝 90 N·m） |
| armature | MJCF 每关节 0.01–0.02 |

出处：`mimickit/envs/char_env.py` 的 `_build_action_bounds_pos` / `_apply_action`、`mimickit/engines/isaac_gym_engine.py` 的 `create_obj`、`data/assets/humanoid/humanoid.xml`。

#### C.1.5 没有的东西（这是本节最有信息量的部分）

在整个 MimicKit 代码库里检索不到以下任何一项：

- **域随机化**：摩擦、质量、质心、PD 增益全部固定（地面摩擦硬编码为 1.0）。
- **观测噪声**：`compute_char_obs` 与各判别器观测都不注入噪声。唯一的随机扰动是 dodgeball 任务里投射物的瞄准噪声（0.1），那是任务难度而不是鲁棒化。
- **推力扰动**：没有周期性 push。
- **状态估计器**：观测直接读全局根位置、根线速度、全身连杆位置——这些量在真机上要么不可测，要么需要 EKF。
- **部署栈**：没有 ONNX / TensorRT 导出，没有真机通信层。

把这五条空缺画进图里（用灰色虚框 + 「本项目不使用」标注），SONIC 和 BeyondMimic 那一堆域随机化与状态估计节点的意义才会真正显出来。这是第二批内容对第一批最大的反哺。

#### C.1.6 通用训练设置

`num_envs = 4096`，`steps_per_iter = 32`（每轮 131 072 个样本），`discount = 0.99`，`td_lambda = 0.95`，`normalizer_samples = 1e8`（观测经验归一化几乎全程开启，clip = 10）。
actor / critic 主干默认 `fc_2layers_1024units` = **[1024, 512] + ReLU**；ASE 用 `fc_3layers_1024units` = **[1024, 1024, 512] + ReLU**。
`actor_batch_size` / `critic_batch_size` 是**环境数的倍数**（`batch = ceil(k × num_envs)`），所以 DeepMimic 的 `actor_batch_size: 4` 实际是 16 384。这个反直觉的语义要写进节点 `note`，否则读者会以为 batch 是 4。

---

### C.2 DeepMimic — 基线：参考跟踪 + 手写奖励

出处：`mimickit/envs/deepmimic_env.py`、`data/envs/deepmimic_humanoid_env.yaml`、`data/agents/deepmimic_humanoid_ppo_agent.yaml`、`args/deepmimic_humanoid_ppo_args.txt`。论文 <https://xbpeng.github.io/projects/DeepMimic/index.html>。

#### C.2.1 策略观测（464 维）

| 组成 | 维度 |
|---|---|
| 本体观测（积木 1） | 140 |
| 未来参考观测 3 帧（积木 2） | 3 × 108 = 324 |
| 相位观测 | 0（`enable_phase_obs: False`） |
| **合计** | **464**（`derived`） |

`global_obs: True` 且 `enable_tar_obs: True` → `_track_global_root()` 为真，即**全局根跟踪**：策略要把角色送到参考轨迹的绝对位置上，不只是模仿相对姿态。这个开关同时改写奖励与终止条件的定义（见下），在图上应画成一个影响三处的「配置节点」。

#### C.2.2 奖励（5 项手写，权重和为 1.0）

`r = Σ wᵢ · exp(−sᵢ · eᵢ)`，全部 `reward_kind: handcrafted`：

| 奖励项 | 权重 w | 尺度 s | 六类 | 误差 e 的定义 |
|---|---|---|---|---|
| `pose` | **0.5** | 0.25 | A/F | Σ 逐关节权重 × 关节旋转夹角² |
| `vel` | 0.1 | 0.01 | A/F | Σ 逐关节权重 × 关节速度差² |
| `root_pose` | 0.15 | 5.0 | A/B | 根位置差² + 0.1 × 根旋转夹角² |
| `root_vel` | 0.1 | 1.0 | A/F | 根线速度差² + 0.1 × 根角速度差² |
| `key_pos` | 0.15 | 10.0 | A/F | 5 个关键连杆相对根位置的差² 之和 |

逐关节误差权重 `joint_err_w`（humanoid，14 项，按 C.1.1 的关节顺序）：`[1.0, 0.6, 0.6, 0.4, 0.0, 0.6, 0.4, 0.0, 1.0, 0.6, 0.4, 1.0, 0.6, 0.4]` —— 躯干与髋 1.0，膝 0.6，踝/肘 0.4，两只手 0.0。这张权重表是页面上很值得展开的一格：它把「哪些关节值得较真」这件工程直觉量化了，而 BeyondMimic / SONIC 的对应做法是对全部连杆一视同仁再靠 σ 调形状。

`root_pose` 项里根位置差的处理由 `track_root` / `track_root_h` 决定：`track_root=False` 时把 xy 分量清零（只跟相对姿态），`track_root_h=False` 时把 z 清零。humanoid 配置下两者都为真，即全 3D 跟踪。

**成功/失败的终局值都是 0**（`get_reward_succ()` / `get_reward_fail()` 返回 0.0）。源码注释点明了原因：如果动作播完给正奖励，策略会学出「站着不动等时间到」的局部最优。这个细节值得做成批注气泡——它是「奖励设计里最容易踩的坑」的教科书级例子。

#### C.2.3 终止条件（3 类）

| 条件 | 标记 | 阈值 |
|---|---|---|
| 超时 | `TIME` | `episode_length = 10.0 s` |
| 参考动作播放完毕 | `SUCC` | 仅当动作的 `loop_mode != WRAP` |
| 姿态偏离 | `FAIL` | `pose_termination_dist = 1.0 m`（逐连杆位置差的**最大值**；全局根跟踪时另比根位置） |
| 非法接触 | `FAIL` | 除 `contact_bodies = [right_foot, left_foot]` 外任一连杆的地面接触力 > 0.1 N |

`FAIL` 只在 `time > 0` 之后判定（避开初始化瞬间的穿模）。

#### C.2.4 参考状态初始化（RSI）

`_ref_state_init` 每次 reset 都把角色的根位姿、根速度、关节位姿、关节速度**整套设成参考动作某一帧的值**；`rand_reset: True` 时该帧的时刻从整段动作里均匀采样。这条「参考库 → 初始状态」的边用 `kind: "init"` 画（§4.4），它是 DeepMimic 论文的两大贡献之一（另一个是早停），但几乎从不出现在示意图里。

参考角色（`ref_char`）只在开启可视化时创建，`disable_motors=True`、纯视觉、按 `ref_char_offset = [2, 0, 0]` 平移显示。这是 `availability: "sim-only"` 的典型例子。

#### C.2.5 算法与网络

PPO（`mimickit/learning/ppo_agent.py`）：actor / critic 均 `[1024, 512] + ReLU`，输出层初始化尺度 0.01，固定 std 0.05；**SGD** lr 1e-4（actor 与 critic 同）；`ppo_clip_ratio = 0.2`，`norm_adv_clip = 4.0`，`action_bound_weight = 10.0`，熵与动作正则权重均为 0；actor 5 轮 × batch 4×`num_envs`，critic 2 轮 × batch 2×`num_envs`。

用 SGD 而不是 Adam 是这一族的统一选择（只有 ASE 用 Adam），值得在图上标一句——在 2026 年的 RL 代码里这已经不常见了。

#### C.2.6 参考动作

单段：`data/motions/humanoid/humanoid_spinkick.pkl`。多段：把 `motion_file` 指向 `data/datasets/dataset_humanoid_locomotion.yaml`（约 38 条，`humanoid_run` 权重 3.0，其余 SIE 动作各 1.0）。动作帧格式 `[根位置 3, 根旋转 3（指数映射）, 各关节旋转]`，关节顺序 = XML 深度优先。

---

### C.3 AWR — 只换优化器

出处：`mimickit/learning/awr_agent.py`、`data/agents/deepmimic_humanoid_awr_agent.yaml`。论文 <https://arxiv.org/abs/1910.00177>。

**环境与 DeepMimic 完全同一份文件**（`data/envs/deepmimic_humanoid_env.yaml`）：观测 464 维、5 项手写奖励、终止条件、RSI 全部一致。这是 `inherits` 机制最干净的一个用例——`awr.json` 应当只包含 `learning` 泳道的差异。

唯一差别在 actor 的更新规则：不做 PPO 的比率裁剪，而是把优势指数化成回归权重。

| 参数 | 值 | 作用 |
|---|---|---|
| `awr_temp` | 1.0 | 权重温度，`w = exp(norm_adv / temp)` |
| `a_weight_clip` | 20.0 | 权重上限，防止个别高优势样本主导更新 |
| `ppo_clip_ratio` | 不存在 | AWR 不需要 |

其余超参（SGD 1e-4、discount 0.99、td_lambda 0.95、epochs / batch、`action_bound_weight` 10.0）与 DeepMimic 逐项相同。

`diff_summary`（§4.6 要求的一句话）：**「环境、观测、动作、奖励、终止条件与 DeepMimic 完全一致，只有 actor 的更新规则从 PPO 的比率裁剪换成了优势指数加权回归。」**

---

### C.4 AMP — 奖励从手写变成判别器

出处：`mimickit/envs/amp_env.py`、`mimickit/learning/amp_agent.py`、`data/envs/amp_humanoid_env.yaml`、`data/agents/amp_humanoid_agent.yaml`。论文 <https://xbpeng.github.io/projects/AMP/index.html>。

#### C.4.1 策略观测（140 维）—— 比 DeepMimic 少 324 维

`enable_tar_obs: False`、`enable_phase_obs: False` → **策略完全看不到参考动作**，只剩本体观测 140 维。参考动作的信息全部通过奖励进入策略。这个「减法」是 AMP 最重要的一步，图上要用 M5.2 的模式切换动画直接演示：从 DeepMimic 切到 AMP，324 维的未来参考模块整块消失，同时右下角长出一个判别器模块。

#### C.4.2 判别器观测（10 帧 × 142 = 1420 维）

`num_disc_obs_steps: 10`，窗口覆盖 t−9/30 s … t，跨度 **0.3 s**。单帧 142 维：

| 分项 | 维度 | 说明 |
|---|---|---|
| 根位置（相对窗口末帧的根位置） | 3 | 第三维为绝对高度（`root_height_obs=True`） |
| 根旋转 tan-norm | 6 | `global_obs=True` 时保留世界朝向 |
| 关节旋转 14 × 6 | 84 | |
| 关键连杆位置 5 × 3 | 15 | 相对各帧自身的根 |
| 根线速度 + 根角速度 | 6 | |
| 关节速度 | 28 | `disc_dof_vel_obs` 默认 `True` |

窗口以**末帧的根位姿**为参考做平移归一化（`ref_root_pos = root_pos[..., -1, :]`），所以判别器看的是「这 0.3 s 里身体怎么动」，与角色走到哪里无关。`amp_humanoid_env.yaml` 用 `global_obs: True`，即**不做朝向归一化**；而 ASE 与三个任务环境用 `global_obs: False`，会额外左乘 heading 逆旋转。这一处开关差异要在两张图上都标出来，否则读者会以为判别器观测是同一个东西。

正样本 `disc_obs_demo` 从参考动作库按同样的 10 帧窗口采样（`fetch_disc_obs_demo`），负样本是策略自己的窗口 + 一个 **200 000 容量的回放缓冲**（每轮存入 1 000 条），后者防止判别器只针对最新策略过拟合。

#### C.4.3 奖励（1 项，`reward_kind: adversarial`）

环境的 `_update_reward` 是**空实现**——AMP 环境不产生任何任务奖励。总奖励：

```
r = task_reward_weight × 0  +  disc_reward_weight × disc_r
  = 1.0 × 2.0 × ( −log( max(1 − σ(D(s)), 1e-4) ) )
```

| 参数 | 值 |
|---|---|
| `disc_reward_scale` | 2.0 |
| `disc_reward_weight` / `task_reward_weight` | 1.0 / 0.0 |
| 判别器网络 | `[1024, 512] + ReLU` → 1 维 logit |
| 判别器优化器 | SGD lr 2.5e-4，weight_decay 1e-4，2 轮 × batch 2×`num_envs` |
| 损失 | `0.5 × (BCE(agent, 0) + BCE(demo, 1))` |
| `disc_logit_reg` | 0.01（输出层权重的 L2） |
| `disc_grad_penalty` | 5（对**两侧**输入梯度的平方均值各罚一半） |

奖励面板对这一项渲染「来源卡」而非权重条：吃 `disc.obs_window`（1420 维，指向具体节点）、正样本是参考动作库的同窗口片段、映射是 `−2 log(1 − D)`、正则是 logit L2 0.01 + 双侧梯度罚 5。

#### C.4.4 终止条件（2 类，比 DeepMimic 少两条）

`pose_termination: False`，且 `_update_done` 里把 `motion_len_term` 全部置 `False`（动作播完不算成功）。只剩：超时 10 s、非法接触（除双脚外任一连杆地面接触力 > 0.1 N）。

理由是 AMP 不跟踪具体某一帧，「偏离参考 1 m」这个判据失去意义。这条差异在图上用两个消失的终止节点表达。

#### C.4.5 任务变体（AMP + 任务奖励）

`data/agents/amp_task_humanoid_agent.yaml`：`task_reward_weight: 0.5` / `disc_reward_weight: 0.5`，actor lr 降到 5e-5。配套三个任务环境，观测在 140 维之后**追加**任务观测：

| 任务 | 环境文件 | 任务观测 | 总观测 | 任务奖励 |
|---|---|---|---|---|
| `location` | `amp_location_humanoid_env.yaml` | 目标点在朝向局部系的 xy，**2** | 142 | 位置项（见 C.8.4） |
| `steering` | `amp_steering_humanoid_env.yaml` | 局部目标方向 2 + 目标速度 1 + 局部朝向方向 2，**5** | 145 | 速度 0.7 + 朝向 0.3 |

两个任务环境都用 `global_obs: False`（任务是相对自身的，绝对朝向没有意义），参考动作池换成 `dataset_humanoid_locomotion.yaml`。剑盾角色另有两套对应配置。

---

### C.5 ASE — 加一个技能潜空间

出处：`mimickit/envs/ase_env.py`、`mimickit/learning/ase_agent.py`、`mimickit/learning/ase_model.py`、`data/envs/ase_humanoid_env.yaml`、`data/agents/ase_humanoid_agent.yaml`。论文 <https://xbpeng.github.io/projects/ASE/index.html>。

#### C.5.1 技能潜变量 z（64 维）

| 属性 | 值 |
|---|---|
| 维度 | `latent_dim: 64` |
| 分布 | 标准正态采样后 **L2 归一化到单位球面** |
| 重采样周期 | 每个环境独立，`U(latent_time_min=0.0, latent_time_max=5.0)` 秒 |
| 进入方式 | 与观测**直接拼接**后送入 actor 与 critic（`torch.cat([obs, z])`） |

所以 actor 的真实输入是 **140 + 64 = 204 维**，critic 同。这是数据模型里 `role: "latent-command"`（§3.1）与 `acquisition: "sampled"`（§4.3）两个新值的唯一用例：z 不是测量、不是推导，是抽出来的；训练时由采样器给，下游任务训练时由上层任务策略给。

图上要画一个独立的「潜变量采样器」节点，用 `kind: "latent"` 的实线连到 actor 和 critic，节点上标注重采样周期——「策略每隔 0–5 秒就换一个技能指令」这件事不画出来，读者无法理解 ASE 为什么能学出多样行为。

#### C.5.2 编码器与互信息奖励

编码器吃**与判别器完全相同的 1420 维观测窗口**，输出 64 维并归一化：

```
ẑ = normalize( Enc(disc_obs) )
enc_r = clamp_min( z · ẑ , 0 )          # 奖励
enc_loss = mean( −z · ẑ )               # 编码器损失
```

即「让编码器能从动作里认出当初给的是哪个技能」。这构成一条 **z → actor → 环境 → 判别器观测 → 编码器 → 回到 z** 的闭环，是 ASE 图上唯一的环形结构，也是泳道布局需要特殊照顾的地方（`latent` 泳道要放在最左，编码器放在最右，回边从右到左跨整张图）。

#### C.5.3 奖励（3 项来源混合）

| 来源 | 权重 | `reward_kind` |
|---|---|---|
| 判别器（同 AMP，`−2 log(1−D)`） | `disc_reward_weight: 0.5` | `adversarial` |
| 编码器互信息 | `enc_reward_weight: 0.5` | `encoder` |
| 任务 | `task_reward_weight: 0.0` | — |

另有一项**只进损失不进奖励**的多样性正则，画在 `learning` 泳道：

```
diversity_loss = ( diversity_tar − mean‖μ(s,z′) − μ(s,z)‖² / (0.5 − 0.5·z′·z) )²
```

`diversity_weight: 0.01`，`diversity_tar: 1.0`，`z′` 是重新采样的潜变量。它要求「潜变量差多少，动作就该差多少」，防止 decoder 忽略 z。数据模型上它不是 RewardTerm 而是一个 `learning` 泳道的节点 + 一条 `kind: "grad"` 的虚线边。

#### C.5.4 初始状态：一半参考、一半默认站姿

`default_reset_prob: 0.5` —— 每次 reset 有 50% 概率**覆盖掉 RSI**，改用默认站姿（`char_env.CharEnv._reset_char`）。因为 ASE 不跟踪具体帧，从站姿起步是合理的起点，也让策略见到「非动作库分布」的状态。图上画成 RSI 边上并联一条概率 0.5 的分支。

#### C.5.5 网络与优化器（这一族里唯一用 Adam 的）

| 模块 | 网络 | 优化器 |
|---|---|---|
| actor | `[1024, 1024, 512] + ReLU`，固定 std 0.05 | Adam **2e-5** |
| critic | `[1024, 1024, 512]` | Adam 5e-5 |
| 判别器 | `[1024, 1024, 512]` | Adam 5e-5，wd 1e-4 |
| 编码器 | `[1024, 512]` + Linear→64 | Adam 5e-5 |

`normalizer_samples: 5e8`（是其他方法的 5 倍），`iters_per_output: 200`。判别器正则与 AMP 相同（logit 0.01 / 梯度罚 5）。

参考动作池：`dataset_humanoid_locomotion.yaml`；文档推荐的入口是剑盾版 `ase_humanoid_sword_shield_env.yaml` + `dataset_humanoid_sword_shield.yaml`（`global_obs: False`，关键连杆多一个 `sword`，共 6 个 → 判别器观测与本体观测各多 3 维）。

---

### C.6 LCP — 一行损失换来真机可用的平滑度

出处：`mimickit/learning/lcp_agent.py`、`data/agents/lcp_g1_agent.yaml`、`args/lcp_g1_ppo_args.txt`。论文 <https://xbpeng.github.io/projects/LCP/index.html>（IROS 2025）。

**环境是 `data/envs/deepmimic_g1_env.yaml`**，即 DeepMimic 的 G1 变体，不是新环境。所以 LCP 也走 `inherits`，父项目是 DeepMimic（G1 配置）。

#### C.6.1 观测（G1，849 维）

| 组成 | 维度 |
|---|---|
| 本体观测：1 + 6 + 3 + 3 + 30×6 + 29 + 5×3 | 237 |
| 未来参考 3 帧 × (3 + 6 + 30×6 + 5×3) | 3 × 204 = 612 |
| **合计** | **849**（`derived`） |

关键连杆：`[left_ankle_roll_link, right_ankle_roll_link, head_link, left_wrist_yaw_link, right_wrist_yaw_link]`。允许接触的连杆是双膝 + 双踝共 6 个（比 humanoid 的双脚宽松）。`zero_center_action: True`。`pose_termination_dist` 仍为 1.0 m，`joint_err_w` 30 项（髋/肩 1.0、肘/膝 0.6、腕/踝 0.5、一个 0 自由度连杆 0.0）。

#### C.6.2 唯一的算法改动

在 PPO 的 actor 损失上加一项对**观测**的梯度罚：

```
lcp_loss = mean ‖ ∂ log π(a|s) / ∂s ‖²
actor_loss += lcp_weight × lcp_loss        # lcp_weight = 0.002
```

`LCPAgent` 被写成一个可以套在任意 agent 上的包装类（默认继承 `PPOAgent`），文档明确说 `lcp_weight` 是这个方法唯一需要调的关键参数。

这一项在数据模型里的位置值得注意：它**既不是奖励也不是观测**，而是 `learning` 泳道里一个作用于 actor 的约束节点，用 `kind: "grad"` 的虚线连回 actor。它和 SONIC 的 `anti_shake_ang_vel`、BeyondMimic 的 `action_rate_l2` 想解决的是同一个问题（动作抖动伤硬件），但一个是改损失、两个是加奖励项。**把这三者并排放在对比视图里，是页面能给出的最好一组「同一工程问题的三种技术路径」**。

`diff_summary`：**「环境（G1）、观测、动作、奖励、终止条件与 DeepMimic 的 G1 配置完全一致，只在 actor 损失上加了一项对观测的梯度平方罚（权重 0.002），用于把策略约束成 Lipschitz 连续以获得平滑动作。」**

---

### C.7 ADD — 判别器改看「差多少」而不是「像不像」

出处：`mimickit/envs/add_env.py`、`mimickit/learning/add_agent.py`、`data/envs/add_humanoid_env.yaml`、`data/agents/add_humanoid_agent.yaml`。论文 <https://xbpeng.github.io/projects/ADD/index.html>（SIGGRAPH Asia 2025）。

#### C.7.1 策略观测（464 维，与 DeepMimic 相同）

`enable_tar_obs: True`、`tar_obs_steps: [1, 2, 3]`、`pose_termination: True` —— ADD 是**跟踪型**方法，策略照样看得到未来参考。它替换掉的不是观测，而是 C.2.2 那张手写奖励表。这是 ADD 与 AMP 的根本区别，也是页面上最容易被读者混淆的一点，必须用批注写清楚：AMP 用判别器**取代参考观测**，ADD 用判别器**取代手写奖励**。

#### C.7.2 判别器观测（1 帧 × 172 维）

`num_disc_obs_steps: 1` —— 只看当前帧，不要时间窗口。单帧组成与 AMP 不同（`add_env.compute_disc_obs`，不复用 `compute_tar_obs`）：

| 分项 | 维度 | 与 AMP 的差别 |
|---|---|---|
| 根位置 | 3 | 直接用绝对根位置（`global_obs=False` 时把 xy 清零） |
| 根旋转 tan-norm | 6 | 同 |
| 关节旋转 14 × 6 | 84 | 同 |
| **全部连杆位置 15 × 3** | **45** | AMP 只给 5 个关键连杆（15 维），ADD 给全部 15 个连杆 |
| 根线速度 + 根角速度 | 6 | 同 |
| 关节速度 | 28 | 同 |
| **合计** | **172** | |

#### C.7.3 差分判别器（本方法的全部内容）

环境在每一步同时算出**两份**观测：策略自己的 `disc_obs` 与参考动作在**同一时刻**的 `disc_obs_demo`。判别器吃的是两者之差：

| 角色 | 判别器输入 |
|---|---|
| 正样本 | **零向量**（`self._pos_diff`，形状同判别器观测的全零张量）——「完美匹配」 |
| 负样本 | `disc_obs_demo − disc_obs`，加回放缓冲里的历史差分 |

归一化用 `DiffNormalizer`（`mimickit/learning/diff_normalizer.py`）而不是普通的均值方差归一化：它只按各维**绝对值的滑动均值**做缩放，不减均值——因为「零」在这里有确定的语义（完美匹配），减均值会把它挪走。这个设计细节值得单独做一个节点。

奖励与 AMP 形式相同（`−2 log(1 − D(Δs))`，`disc_reward_scale: 2`，`disc_reward_weight: 1.0`，`task_reward_weight: 0.0`），但 `disc_grad_penalty` 从 **5 降到 2**。环境的 `_update_reward` 同样是空实现，**手写奖励一项都不剩**。

#### C.7.4 终止条件（回到 DeepMimic 的 4 条）

`_update_done` 直接调 `DeepMimicEnv._update_done`：超时 10 s、动作播完（`SUCC`）、姿态偏离 1.0 m、非法接触。这是 ADD 与 AMP 的另一处结构差异（AMP 去掉了前两条中的一条与姿态判据）。

`log_tracking_error: True` —— ADD 是唯一默认打开跟踪误差诊断的配置，测试期记录 7 项误差（根位置、根旋转、连杆位置、连杆旋转、关节速度、根线速度、根角速度）。这一组量在数据模型里是 O5 类辅助头节点，标 `availability: "sim-only"`。

---

### C.8 SMP — 判别器换成冻结的扩散先验

出处：`mimickit/envs/smp_env.py`、`mimickit/learning/smp_agent.py`、`mimickit/learning/tinymdm/`、`tools/diffusion_model/`、`data/envs/smp_*_env.yaml`、`data/agents/smp_*_agent.yaml`。论文 <https://xbpeng.github.io/projects/SMP/index.html>（TOG / SIGGRAPH 2026）。

`SMPEnv` 继承 `AMPEnv`，所以观测积木、终止逻辑、判别器观测窗口机制全部复用；差别在于那个 1140 维的窗口不再喂判别器，而是喂一个**训练前就冻结**的扩散模型。

#### C.8.1 观测

| 配置 | 策略观测 | 说明 |
|---|---|---|
| 单段（`smp_humanoid_env.yaml`） | **140** | `global_obs: True`，无参考观测、无任务观测 |
| `location`（`smp_location_humanoid_env.yaml`） | 140 + 2 = **142** | `global_obs: False` |
| `steering`（`smp_steering_humanoid_env.yaml`） | 140 + 5 = **145** | `global_obs: False` |
| `dodgeball`（`smp_dodgeball_humanoid_env.yaml`） | 140 + 6 = **146** | `global_obs: False`，**D 类外部感知的唯一实例** |

先验输入窗口：`num_disc_obs_steps: 10`，`disc_dof_vel_obs: **False**` → 单帧 **114 维**（108 + 根线速度 3 + 根角速度 3，**不含关节速度**），窗口共 **1140 维**。去掉关节速度是 SMP 与 AMP/ASE 判别器观测的唯一维度差异，而且是硬约束——`SMPAgent._check_prior_env_config` 会逐项断言环境配置与先验训练时的配置一致（`global_obs`、`root_height_obs`、`enable_tar_obs`、`num_disc_obs_steps`、`disc_dof_vel_obs`、关键连杆数量、控制频率），不一致直接崩。

这组断言本身就是页面上一个很好的批注：**「先验和环境必须成套」**，和 SONIC 部署时「encoder 与 decoder 必须成套」（B.7）是同一个工程约束的两种形态。

#### C.8.2 冻结的扩散先验（TinyMDM）

| 属性 | 值 |
|---|---|
| 架构 | DiT，`num_layers: 2`，`num_attention_heads: 4`（内部宽度 4 × 64 = 256） |
| 扩散步数 T | 50 |
| 预测目标 | `epsilon` |
| 噪声调度 | `squaredcos_cap_v2` |
| 损失 | L1 |
| EMA | decay 0.995，每 10 步，5 000 步后启用 |
| 输入维度 | 运行时设为判别器观测维度（humanoid = **1140**） |
| 归一化 | 自带 normalizer，`normalizer_std_clip: 0.2` |
| 预训练（多段） | batch 512，lr 2e-4，200 000 iters（`tinymdm_multi_clip.yaml`） |
| 预训练（单段） | batch 512，lr 1e-4，50 000 iters（`tinymdm_single_clip.yaml`，`humanoid_spinkick.pkl`） |
| 策略训练期间 | `requires_grad = False`，`eval()`，全程冻结 |

多段先验有一处口径不一致要标注：`tinymdm_multi_clip.yaml` 的 `motion_file` 指向 `data/datasets/dataset_humanoid_locomotion.yaml`，但 `smp_task_humanoid_agent.yaml` 引用的预训练权重是 `data/models/smp_priors/smp_prior_lafan.pt`，文档称其为「LaFAN1 先验」。也就是说**随仓库分发的权重与随仓库分发的训练配置不是同一份数据**（前者是 LaFAN1，后者是 humanoid locomotion 数据集）。按 §8.3，节点上写明两者并注明「复现训练需自行确认数据来源」，不擅自认定其中一个。

两个先验的窗口坐标系也不同：单段先验对应 `smp_humanoid_env.yaml`（`global_obs: True`，世界朝向），多段先验对应 `smp_location_humanoid_env.yaml`（`global_obs: False`，去偏航的局部系）。这是 `_check_prior_env_config` 那组断言真正在防的东西——把两个先验混用会静默地喂进坐标系不同的观测，所以它选择直接崩。

在图上它是一个带「锁」角标的节点，两条出边：一条去奖励（C.8.3），一条去初始状态（C.8.5）。

#### C.8.3 SDS 奖励（`reward_kind: generative`）

```
sds_losses = prior.ESM_SDS_loss(norm_window, t_lst=[22, 15, 8])   # 三个噪声水平各一个标量
smp_r = exp( − sds_loss_scale × mean( DiffNormalizer(sds_losses) ) )
r = task_reward_weight × task_r + smp_reward_weight × smp_r
```

| 参数 | 单段配置 | 任务配置 |
|---|---|---|
| `sds_loss_scale` | 6 | 6 |
| `diffusion_steps` | `[22, 15, 8]` | `[22, 15, 8]` |
| `smp_eval_batch_size` | 4096 | 4096 |
| `task_reward_weight` / `smp_reward_weight` | 0.0 / 1.0 | 0.5 / 0.5 |
| `sds_normalizer_samples` | 不设（全程更新） | 1e8 |

文档给出的调参优先级是 `smp_reward_weight > sds_loss_scale >= diffusion_steps`，这句话值得原样放进奖励来源卡——它是「这三个数字哪个重要」的作者原话。

与 AMP 的对照是整个第二批最值得讲的一条：判别器是**边训边变**的（每轮都在更新，奖励函数是移动靶），扩散先验是**训练前就固定**的（奖励函数是静止靶，而且可以跨任务复用）。这正好对应论文标题里的 "Reusable"。

#### C.8.4 任务观测与任务奖励

| 任务 | 任务观测 | 任务奖励 | 关键参数 |
|---|---|---|---|
| `location` | 目标点在朝向局部系的 xy（**2**，B 类） | `1.0 × exp(−0.5 × ‖Δxy‖²)`（`vel_reward_w` 与 `face_reward_w` 均为 0） | 目标距离 1–10 m，`tar_speed` 1.0，每 5–10 s 换点，`dist_threshold` 0.5，episode 20 s |
| `steering` | 局部目标方向 2 + 目标速度 1 + 局部朝向方向 2（**5**，B 类） | `0.7 × exp(−0.5 × ‖v_tar − v‖²)`（速度投影为负时置 0）`+ 0.3 × clamp_min(cos θ_face, 0)` | 目标速度 0.5–5 m/s，每 4–7 s 换向，`rand_face_dir: False`（朝向 = 移动方向），episode 20 s |
| `dodgeball` | 1 个投射物的局部位置 3 + 局部速度 3（**6**，**D 类**） | 躲避奖励；被击中判 `FAIL` | 投射距离 8–10 m，速度 12–15 m/s，瞄准 `torso`，瞄准噪声 0.1，触发时刻 1–4 s，episode 20 s |

`steering` 的任务观测里「目标方向」与「朝向方向」是两个独立量，而 `rand_face_dir: False` 让二者恒相等——图上要把这个「配置把两个输入绑成一个」的事实标出来，否则 5 维观测里有 2 维看起来是冗余的。

`dodgeball` 是整个页面里 D 类（外部感知）唯一有内容的节点。它的 `acquisition` 是 `sim-only`（仿真直读投射物状态），真机上要靠视觉——这一点正好用来说明「为什么真机路线的两个项目都是盲式的」。

#### C.8.5 生成式状态初始化（GSI）—— 训练期完全不用动作数据

`smp_task_humanoid_agent.yaml` 里 `enable_gsi: True`。流程：

1. 训练开始时用冻结先验采样 `gsi_buffer_size = 4096` 条 1140 维窗口（`gsi_batch_size = 256`；采样器与推理步数取代码默认值 `ddpm` / 10 步，配置里未显式设置）。
2. 反归一化后**解码回动作帧**：`tan_norm → 四元数 → DoF`，取窗口最后一帧作为初始位姿，用相邻帧差分算出根速度、根角速度、关节速度（`_motion_frames_to_init_states`）。
3. reset 时从这个缓冲里采样初始状态，**替代 RSI**（`_reset_ref_motion_gsi`），同时用它填充判别器历史缓冲。
4. 每 `gsi_iters = 50` 轮再生成 `gsi_regen_num_motions = 1024` 条补进缓冲。

于是出现文档明确强调的性质：**策略训练期间不使用任何动作数据**（`No motion data is used during policy training`）。参考动作库在图上从「训练期数据源」降级成「先验的离线训练数据」——这条边应该画在图外或用极浅的灰色，标注「仅用于先验预训练，策略训练时不接入」。

前置约束（`_check_gsi_env_compatibility` 断言）：`enable_tar_obs` 必须为 `False`，`pose_termination` 必须为 `False`。单段实验（`smp_humanoid_agent.yaml`）`enable_gsi: False`，此时退回普通 RSI，初始状态由 `motion_file` 提供。

这条 `kind: "init"` 的边是第二批里信息量最高的一条，因为它把「初始状态从哪来」这个通常被论文一句话带过的环节，画成了和奖励并列的一等公民。

#### C.8.6 算法与网络

PPO，actor / critic `[1024, 512] + ReLU`，SGD lr 1e-4，固定 std 0.05，`critic_loss_weight: 1.0`，其余同 C.1.6。**没有判别器、没有编码器**——`SMPModel` 直接继承 `PPOModel`，没有添加任何网络。SMP 的全部复杂度都在那个冻结的先验里，这一点在图上会表现为「`learning` 泳道很简单，`prior` 泳道很重」，与 ASE 恰好相反。

---

### C.9 七方法横向对照表（humanoid，30 Hz）

| | DeepMimic | AWR | AMP | ASE | LCP | ADD | SMP |
|---|---|---|---|---|---|---|---|
| 环境文件 | `deepmimic_humanoid` | **同左** | `amp_humanoid` | `ase_humanoid` | `deepmimic_g1` | `add_humanoid` | `smp_humanoid` |
| 策略观测 | 464 | 464 | 140 | 140 + z 64 = 204 | 849（G1） | 464 | 140（+ 任务 2/5/6） |
| 看得到参考动作 | 是（3 帧前瞻） | 是 | **否** | 否 | 是 | 是 | 否 |
| 判别器/先验观测 | — | — | 10 帧 × 142 = 1420 | 1420 | — | 1 帧 × 172 | 10 帧 × 114 = 1140 |
| 手写奖励项数 | 5 | 5 | **0** | 0 | 5 | **0** | 0（任务项另计） |
| 奖励来源 | 手写 | 手写 | 对抗 | 对抗 0.5 + 编码器 0.5 | 手写 | 对抗（差分） | 生成式（SDS） |
| 判别器正样本 | — | — | 参考动作同窗口片段 | 同左 | — | **零向量** | — |
| 姿态偏离终止 | 1.0 m | 1.0 m | 关闭 | 关闭 | 1.0 m | 1.0 m | 关闭 |
| 初始状态 | RSI | RSI | RSI | RSI 50% / 站姿 50% | RSI | RSI | **GSI（先验生成）** |
| 额外损失项 | — | — | — | 多样性 0.01 | **Lipschitz 0.002** | — | — |
| 主干宽度 | [1024, 512] | [1024, 512] | [1024, 512] | **[1024, 1024, 512]** | [1024, 512] | [1024, 512] | [1024, 512] |
| 优化器 | SGD 1e-4 | SGD 1e-4 | SGD 1e-4 | **Adam 2e-5** | SGD 1e-4 | SGD 1e-4 | SGD 1e-4 |
| 梯度罚系数 | — | — | 5 | 5 | — | **2** | — |

这张表本身就是对比视图要生成的东西。M5 结束时应当能用页面点出表里每一格，反过来说，如果页面点不出某一格，说明数据模型漏了字段。

### C.10 与第一批的三条跨族观察（M6 的素材）

1. **同一台 G1，两种建模。** MimicKit 的 `deepmimic_g1_env` 与 BeyondMimic 的跟踪环境控制的是同一台 29 DoF Unitree G1：前者观测 849 维（含全局根位置、根线速度、3 帧未来参考）、无噪声无随机化、30 Hz；后者观测 160 维（刻意去掉全局位置，另提供 154 维的无状态估计变体）、逐项注入噪声、50 Hz。同一台机器人的观测维度差 5 倍，方向还相反——**动画路线往观测里加信息，真机路线从观测里减信息**。这一条比任何文字都更能说明「sim-to-real 到底约束了什么」。

2. **潜空间接口的两种来源。** ASE 的 64 维技能潜变量与 SONIC 的 64 维 FSQ token 维度相同、位置相同（都拼在本体观测后进 actor），但来源相反：ASE 的 z 是**采样出来的**，语义由编码器的互信息目标事后赋予；SONIC 的 token 是**编码出来的**，语义由三个上游编码器事先约定。一个是「给策略一个随机指令，逼它自己划分技能」，一个是「给策略一个统一接口，让不同上游都能接」。两者在图上是同一个位置的同一个框，`acquisition` 一个是 `sampled` 一个是 `derived`——`acquisition` 字段的价值在这里体现得最充分。

3. **抖动问题的三条技术路径。** 同一个「动作抖动伤硬件」的问题：BeyondMimic 加奖励项（`action_rate_l2`，−0.1）、SONIC 加奖励项（`anti_shake_ang_vel` −5e-3 与 `feet_acc` −2.5e-6）、LCP 改损失函数（Lipschitz 梯度罚 0.002）。前两者在奖励面板里，后者在 `learning` 泳道里，如果没有 §3.2 的 `reward_kind` 与 §4.4 的 `kind: "grad"` 区分，这三者会被画成看起来无关的东西。把它们并排放在对比视图里，是页面能提供的最实用的一条工程结论。

---

## 附录 D — 参考资料

- 观测输入分类：<https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-observation-inputs>
- 奖励函数分类：<https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-reward-functions>
- BeyondMimic 论文 <https://arxiv.org/abs/2508.08241> · 代码 <https://github.com/HybridRobotics/whole_body_tracking> · 项目页 <https://beyondmimic.github.io/>
- SONIC 论文 <https://arxiv.org/abs/2511.07820> · 代码 <https://github.com/NVlabs/GR00T-WholeBodyControl> · 文档 <https://nvlabs.github.io/GR00T-WholeBodyControl/> · 项目页 <https://nvlabs.github.io/GEAR-SONIC/>
- MimicKit 代码 <https://github.com/xbpeng/MimicKit> · 上手指南 <https://arxiv.org/abs/2510.13794>
  - DeepMimic（TOG 2018）<https://xbpeng.github.io/projects/DeepMimic/index.html>
  - AWR（arXiv 2019）<https://xbpeng.github.io/projects/AWR/index.html>
  - AMP（TOG 2021）<https://xbpeng.github.io/projects/AMP/index.html>
  - ASE（TOG 2022）<https://xbpeng.github.io/projects/ASE/index.html>
  - LCP（IROS 2025）<https://xbpeng.github.io/projects/LCP/index.html>
  - ADD（SIGGRAPH Asia 2025）<https://xbpeng.github.io/projects/ADD/index.html>
  - SMP（TOG / SIGGRAPH 2026）<https://xbpeng.github.io/projects/SMP/index.html>
