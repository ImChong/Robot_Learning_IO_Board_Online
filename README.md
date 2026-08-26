# Robot_Learning_IO_Board

热门机器人强化学习项目输入/输出/奖励函数分析板

用「模块 + 连线」的节点图，把人形机器人强化学习项目的观测输入、动作输出与奖励函数画成可交互的网页。首批覆盖 **SONIC** 与 **BeyondMimic**，每个项目可在**训练态**（含奖励函数设置）与**部署态**之间切换。

分类语汇沿用 Robotics Notebooks 的[观测输入五类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-observation-inputs)与[奖励函数六类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-reward-functions)划分，并补上参考页目前缺失的输出侧五类。

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
| hover 模块 | 高亮它的完整上下游链路 |
| 点击模块 | 右侧详情抽屉显示维度构成、真机如何获得、出处链接；URL 同步，可分享 |
| 只看…筛选 | 按观测类别、部署可得性、可信度过滤 |
| 对比 | 当前项目 vs 一个选定的对比对象，逐项对照 |
| 图例 | 展开全部视觉编码的含义 |
| 画布 | 滚轮缩放、拖拽平移，`适应窗口` 或 `F` 复位 |

## 目录结构

```
index.html            页面骨架
assets/               样式与主题初始化
src/                  原生 ES modules
  ├── data.js           注册表加载与项目按需加载（带缓存）
  ├── project-picker.js 可搜索、分组的项目下拉
  ├── layout.js         泳道布局与连线路径几何
  ├── render-graph.js   SVG 连线 + HTML 节点卡片、缩放平移、链路高亮、模式补间
  ├── render-rewards.js 奖励面板（六类折叠、对数刻度权重条、KaTeX 公式）
  ├── render-detail.js  详情抽屉
  ├── render-compare.js 当前项目 vs 选定对比对象的对照表
  └── render-table.js   表格降级视图
data/
  ├── taxonomy.json     观测五类 / 输出五类 / 奖励六类等全部枚举的权威定义
  ├── projects.json     项目注册表与分组
  ├── beyondmimic.json  节点、连线、奖励项、关键指标
  └── sonic.json
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
  "order": 3,
  "keywords": ["Unitree G1", "Isaac Lab", "AMP", "某某大学", "2601.01234"]
}
```

3. 跑 `node scripts/validate.mjs`。

页面本身不含任何项目专属逻辑，所有分类、配色与文案都来自数据文件。

关于规模：项目文件是**按需加载**的，首屏只下载 `taxonomy.json` + `projects.json` + 当前项目，所以项目数量不影响加载速度。注册表里冗余了 `name` / `subtitle` 就是为了让选择器不必先下载每个项目文件，校验脚本会保证这两处与项目文件一致。

`keywords` 只参与搜索、不显示，放读者可能拿来搜的词（机器人型号、仿真器、算法、机构、代码仓名、arXiv 号，中英文都行）。

新增一个方法族时，在 `groups` 里加一条，然后让项目的 `group` 指向它——选择器会自动按组显示标题。

## 数据准确性

内容以**开源实现**为准，而不是论文或二手资料的口径：

- 每个维度与权重都带 `source`，指向仓库文件路径与配置项名，在详情抽屉里可点开；
- 总维度只能标 `derived`，由逐项核对过的维度求和得出，`scripts/validate.mjs` 会对维度算式求值、并按入边求和验证聚合节点，防止手算漏项；
- 论文口径与实现口径不一致时，图以实现为主体，差异写在模块的备注里；
- 每个项目记录 `verifiedAt` 与 `verifiedRef`（分支与所选配置），上游仍在迭代。

## 设计与实施计划

见 [PLAN.md](./PLAN.md)，其中附录 A/B 是逐项核对上游实现后的内容基线。

## 许可

代码与数据为 MIT（见 [LICENSE](./LICENSE)）。`vendor/katex/` 为 KaTeX 项目的分发文件，许可见 [vendor/katex/LICENSE](./vendor/katex/LICENSE)。
