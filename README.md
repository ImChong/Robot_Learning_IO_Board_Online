# Robot_Learning_IO_Board

热门机器人强化学习项目输入/输出/奖励函数分析板

用「模块 + 连线」的节点图，把人形机器人强化学习项目的观测输入、动作输出与奖励函数画成可交互的网页。首批覆盖 **SONIC** 与 **BeyondMimic**，每个项目可在**训练态**（含奖励函数设置）与**部署态**之间切换。

分类语汇沿用 Robotics Notebooks 的[观测输入五类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-observation-inputs)与[奖励函数六类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-reward-functions)划分，并补上参考页目前缺失的输出侧五类。

第二批是 [MimicKit](https://github.com/xbpeng/MimicKit) 方法族的七个方法，按发布时间排：**DeepMimic**（2018-04）、**AWR**（2019-10）、**AMP**（2021-04）、**ASE**（2022-05）、**LCP**（2024-10）、**ADD**（2025-05）、**SMP**（2025-12）。它们共用同一套环境、角色与网络规模，差别被压缩到「奖励从哪来」和「策略额外吃什么」两件事上——正好是本站的两个坐标轴。

两批放在一起是因为它们互相照亮：真机路线解释「为什么要往观测里减信息、往训练里加噪声」，MimicKit 方法族解释「奖励怎么从手写公式一路走到对抗判别器和冻结的扩散先验」。几处可以直接在页面上点开看的对照：

- 同一台 29 自由度 Unitree G1，LCP 的策略观测是 849 维、BeyondMimic 是 160 维，方向还相反；
- ASE 的 64 维技能潜变量与 SONIC 的 64 维 FSQ token 维度相同、位置相同，但一个是采样出来的、一个是编码出来的；
- 「动作抖动伤硬件」这一个问题，BeyondMimic 与 SONIC 加奖励项、LCP 改损失函数，前者落在奖励面板、后者落在学习信号里。

## 本地运行

站点是零构建的静态文件，但数据用 `fetch` 加载，所以需要走 HTTP 而不能直接双击 `index.html`：

```bash
python3 -m http.server 8080
# 然后打开 http://localhost:8080/
```

改完数据后跑一遍校验：

```bash
node scripts/validate.mjs
```

## 页面怎么用

| 操作 | 说明 |
|---|---|
| 顶栏项目下拉 | 可搜索、按方法族分组。搜索命中项目名、副标题与关键词（机器人、仿真器、算法、机构、arXiv 号等）。快捷键 `P` 打开，`[` `]` 切上下一个 |
| 训练态 / 部署态 | 同 id 的模块做位置补间，仅训练可见的模块淡出（快捷键 `T` `D`） |
| 节点图 / 对比 / 表格 | 节点图是主视图；对比是两个项目的逐项对照；表格是同数据的无障碍与打印形态 |
| 讲解 | 按**代码运行顺序**逐个模块高亮并解说：数据源 → 取参考帧 → 本体观测 → 拼接 → 网络前向 → 动作链 → 环境步进 → 奖励与更新。可自动播放，也可自己翻步；点图上任意模块直接跳到讲它的那一步。快捷键 `G` 进出，空格播放/暂停，`←` `→` 前后一步 |
| hover 模块 | 高亮它的完整上下游链路 |
| 点击模块 | 右侧详情抽屉显示维度构成、真机如何获得、出处链接；URL 同步，可分享 |
| 只看…筛选 | 按观测类别、部署可得性、可信度过滤 |
| 对比 | 当前项目 vs 一个选定的对比对象，逐项对照 |
| 图例 | 展开全部视觉编码的含义 |
| 画布 | 滚轮缩放、拖拽平移，`适应窗口` 或 `F` 复位。触屏上单指平移、双指捏合缩放，画布右下角还有一组缩放按钮 |
| 手机 | 顶栏在任何手机尺寸下都只占一行（含横屏）。详情与讲解都从底部升起，同时把画布顶到顶栏底下，读者始终看得见自己点的是图上的哪一格；横屏时讲解改贴右侧，因为那种视口缺的是高度不是宽度。`适应窗口` 在窄屏保留可读比例而不是把整张图压到看不清——想看全景就捏合缩小 |
| 主题 | 顶栏右上角切换深浅色，选择记在 `localStorage`。色板、站点顶栏与页脚沿用 [imchong.github.io](https://github.com/ImChong/ImChong.github.io) 与 [Robot_Joint_Order_Check_Tool](https://github.com/ImChong/Robot_Joint_Order_Check_Tool)：Notion 风暖中性色 + 同一支蓝作强调色 |

## 目录结构

```
index.html            页面骨架
assets/               样式与主题初始化
src/                  原生 ES modules
  ├── data.js           注册表加载与项目按需加载（带缓存）
  ├── inherit.js        消融式项目的补丁合并（页面与校验脚本共用同一份）
  ├── project-picker.js 可搜索、分组的项目下拉
  ├── layout.js         泳道布局与连线路径几何
  ├── render-graph.js   SVG 连线 + HTML 节点卡片、缩放平移、链路高亮、模式补间
  ├── tour.js           讲解序列：从图本身推出代码运行顺序（纯数据，校验脚本也用它）
  ├── render-tour.js    讲解面板：当前步的解说、上下游、代码位置与播放控制
  ├── render-rewards.js 奖励面板（六类折叠、权重条、学习式奖励的来源卡、KaTeX 公式）
  ├── render-detail.js  详情抽屉
  ├── render-compare.js 当前项目 vs 选定对比对象的对照表
  └── render-table.js   表格降级视图
data/
  ├── taxonomy.json     观测五类 / 输出五类 / 奖励六类等全部枚举的权威定义
  ├── projects.json     项目注册表与分组
  ├── beyondmimic.json  节点、连线、奖励项、关键指标
  ├── sonic.json
  └── mimickit/         MimicKit 方法族七个方法
      ├── deepmimic.json    基线；awr.json 继承它
      ├── awr.json          只写与 DeepMimic 的差异（inherits + overrides）
      ├── amp.json  ase.json  lcp.json  add.json  smp.json
schema/               编辑器可用的 JSON Schema（项目文件 + 注册表）
scripts/validate.mjs  数据自洽性校验
vendor/katex/         本地自带的 KaTeX 0.16.11（MIT），不依赖 CDN
```

## 加一个项目

1. 在 `data/` 下新建 `<项目>.json`，结构见 `schema/project.schema.json`；
2. 在 `data/projects.json` 的 `projects` 里登记一行：

```json
{
  "id": "my-project",
  "file": "my-project.json",
  "name": "MyProject",
  "subtitle": "一句话定位",
  "group": "wbt",
  "published": "2026-01-15",
  "venue": "arXiv 预印本",
  "keywords": ["Unitree G1", "Isaac Lab", "AMP", "某某大学", "2601.01234"]
}
```

3. 跑 `node scripts/validate.mjs`。

`published` 是**首次公开发表的日期**（有预印本就以预印本首版为准，否则取会议/期刊日期），项目列表按「分组顺序 → 发布时间从早到晚」排。所以加项目不用管别人的序号，填对日期它就会落到自己在这条技术线上的位置；日期显示在下拉列表右侧与项目头，读者能核对这个顺序。`venue` 只用于展示。

页面本身不含任何项目专属逻辑，所有分类、配色与文案都来自数据文件。讲解也一样：顺序由 `src/tour.js` 从图的泳道与连线推出来，解说词直接取自节点已核对过的 `desc` / `note` / `source`，新项目不必再手写一份步骤表。校验脚本会确认推出来的序列覆盖每个模块且只讲一次。

关于规模：项目文件是**按需加载**的，首屏只下载 `taxonomy.json` + `projects.json` + 当前项目，所以项目数量不影响加载速度。注册表里冗余了 `name` / `subtitle` 就是为了让选择器不必先下载每个项目文件，校验脚本会保证这两处与项目文件一致。

`keywords` 只参与搜索、不显示，放读者可能拿来搜的词（机器人型号、仿真器、算法、机构、代码仓名、arXiv 号，中英文都行）。发布日期与 `venue` 也参与搜索，所以按年份搜（如 `2021`）能筛出那一年的方法。

`file` 是相对 `data/` 的路径，所以可以放进子目录（`"file": "mimickit/amp.json"`）。新增一个方法族时，在 `groups` 里加一条，然后让项目的 `group` 指向它——选择器会自动按组显示标题。

### 消融式项目：只写差异

如果新项目与已有项目共用同一份环境配置、只换了算法（MimicKit 里 AWR 对 DeepMimic 就是这样），可以只写差异：

```json
{
  "id": "my-ablation",
  "name": "MyAblation",
  "inherits": "my-project",
  "diffSummary": "必填，一句话说明差在哪，直接渲染在页面顶部",
  "overrides": {
    "modes.train": {
      "facts": { "Actor 更新规则": "换掉的值" },
      "nodes": { "l.ppo": { "label": "新标签", "desc": "……" } },
      "nodes+": [],
      "nodes-": []
    }
  }
}
```

被补丁命中的模块会在图上带一个「改动」角标，所以「只有这一个框变了」是看得见的。合并逻辑在 `src/inherit.js`，页面与校验脚本共用同一份，校验会检查补丁目标在父项目里真实存在（写错 id 不会静默失效）。**继承只允许一层**，而且只在环境配置真的相同时才划算——换机器人就别用它，维度全都不一样。

### 学习式奖励

判别器、编码器、扩散先验这类奖励没有可以逐条列出的分项权重，写法不同：`rewardKind` 填 `adversarial` / `encoder` / `generative`，`weight` 填配置里真实存在的混合系数，真正的信息放进 `model`（吃什么、正负样本怎么定、网络多大、有哪些正则、参数是否冻结）。奖励面板会把这类项渲染成「来源卡」而不是权重条。`model.inputs` 要指向同一张图里存在的节点 id，校验脚本会检查。

## 数据准确性

内容以**开源实现**为准，而不是论文或二手资料的口径：

- 每个维度与权重都带 `source`，指向仓库文件路径与配置项名，在详情抽屉里可点开；
- 总维度只能标 `derived`，由逐项核对过的维度求和得出，`scripts/validate.mjs` 会对维度算式求值、并按入边求和验证聚合节点，防止手算漏项；
- 论文口径与实现口径不一致时，图以实现为主体，差异写在模块的备注里；
- 每个项目记录 `verifiedAt` 与 `verifiedRef`（分支与所选配置），上游仍在迭代。

## 设计与实施计划

见 [PLAN.md](./PLAN.md)。附录 A（BeyondMimic）、附录 B（SONIC）、附录 C（MimicKit 七个方法）是逐项核对上游实现后的内容基线，与 `data/` 下的九份数据文件一一对应。

## 许可

代码与数据为 MIT（见 [LICENSE](./LICENSE)）。`vendor/katex/` 为 KaTeX 项目的分发文件，许可见 [vendor/katex/LICENSE](./vendor/katex/LICENSE)。
