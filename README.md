# Robot_Learning_IO_Board_Online

机器人学习输入输出分析板

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?logo=github)](https://imchong.github.io/Robot_Learning_IO_Board_Online/)
[![Deploy GitHub Pages](https://github.com/ImChong/Robot_Learning_IO_Board_Online/actions/workflows/pages.yml/badge.svg)](https://github.com/ImChong/Robot_Learning_IO_Board_Online/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![收录](https://img.shields.io/badge/收录-13_个项目_%7C_624_个模块_%7C_66_个奖励项-informational)](#重点)
[![数据口径](https://img.shields.io/badge/数据口径-以开源实现为准-blue?logo=github&logoColor=white)](#重点)
[![零构建](https://img.shields.io/badge/零构建-原生_ES_modules-lightgrey?logo=javascript&logoColor=white)](#本地运行)

**在线使用：** <https://imchong.github.io/Robot_Learning_IO_Board_Online/>

用「模块 + 连线」的节点图，把一条策略**吃什么、吐什么、被什么奖励塑形**画成可点开的网页。覆盖真机路线的 **BeyondMimic**、**SONIC**，与 [MimicKit](https://github.com/xbpeng/MimicKit) 方法族的 **DeepMimic → AWR → AMP → ASE → LCP → ADD → SMP**。除 AWR / ASE / SMP 三个上游只发了 humanoid 配置的方法外，其余全部以 **Unitree G1** 为准——九个项目里有六个画的是同一台 29 自由度的 G1。

另有一组 [Isaac Lab](https://github.com/isaac-sim/IsaacLab) 官方示例：**Cartpole** 与 **Ant** 各画两遍，一遍 manager-based、一遍 direct。同一个任务、同一台机器人、同一套 PPO 超参，只换工作流——于是「换写法到底换掉了什么」不必靠读文档，两张图逐格摆在一起就看得见。

## 重点

- **每个数字都能点到出处**：维度与权重都带仓库文件路径 + 配置项名，可信度分「已核对 / 推导 / 推断」三档；总维度由校验脚本求和验证，不是凭印象画的示意图。
- **维度不只标大小，还标分量顺序**：四元数写「4 维」等于没写——每个带维度的观测与动作都注明这几个数按什么排（`(w, x, y, z)` 还是 `(x, y, z, w)`、关节按哪套顺序、多帧是整块还是交错），校验脚本强制要求。
- **以开源实现为准**：论文口径与实现口径不一致时，图画实现，差异写在模块备注里。
- **训练态 / 部署态可切换**：同 id 的模块做位置补间，仅训练可见的模块淡出——「部署时什么消失了」是看得见的。
- **奖励来源是一等公民**：手写公式、对抗判别器、编码器互信息、冻结的扩散先验分开渲染，而不是画成同一种框。
- **按代码运行顺序讲解**：从数据源一格一格亮到奖励与参数更新，顺序由图本身推出，不另写一份步骤表。

五处能直接在页面上点开对照的结论：

- 同一台 29 自由度 Unitree G1，LCP 的策略观测 849 维、BeyondMimic 160 维，方向还相反——**动画路线往观测里加信息，真机路线从观测里减信息**。
- ASE 的 64 维技能潜变量与 SONIC 的 64 维 FSQ token 同维度、同位置，但一个是**采样**出来的、一个是**编码**出来的。
- 「动作抖动伤硬件」同一个问题：BeyondMimic 与 SONIC 加奖励项，LCP 改损失函数。
- 同一台 G1 的四元数，MimicKit（Isaac Gym）是 `(x, y, z, w)`、BeyondMimic 与 SONIC（Isaac Lab）是 `(w, x, y, z)`；29 个关节的排列顺序更有三套（Isaac Lab 广度优先 / MJCF 深度优先 / 真机 SDK）。维度对得上、顺序错了，是不会报错的那类 bug。
- 同一个 Isaac Lab 倒立摆，manager-based 版的 4 维观测是 `(x, θ, ẋ, θ̇)`、direct 版是 `(θ, θ̇, x, ẋ)`——同一个仓库里的两份官方实现，维度一样、顺序相反，接错了不会报错。同一批示例里的那对 Ant 反倒好办：36 维对 60 维，差的正好是四个足端的 24 维力旋量，接错当场就崩。

## 本地运行

零构建静态站，但数据用 `fetch` 加载，所以要走 HTTP 而不能直接双击 `index.html`：

```bash
python3 -m http.server 8080   # 打开 http://localhost:8080/
node scripts/validate.mjs     # 改完数据跑一遍校验
```

## 文档

- 页面怎么用、加一个项目怎么写数据：[docs/GUIDE.md](./docs/GUIDE.md)
- 设计取舍与九个项目逐项核对过的内容基线：[PLAN.md](./PLAN.md)

分类语汇沿用 Robotics Notebooks 的[观测输入五类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-observation-inputs)与[奖励函数六类](https://imchong.github.io/Robotics_Notebooks/detail.html?id=wiki-concepts-humanoid-policy-reward-functions)，并补上参考页缺失的输出侧五类。

## 许可

代码与数据为 MIT（见 [LICENSE](./LICENSE)）。`vendor/katex/` 为 KaTeX 项目的分发文件，许可见 [vendor/katex/LICENSE](./vendor/katex/LICENSE)。
