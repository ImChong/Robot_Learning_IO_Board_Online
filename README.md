# Robot_Learning_IO_Board

热门机器人强化学习项目输入/输出/奖励函数分析板

用「模块 + 连线」的节点图，把人形机器人强化学习项目的观测输入、动作输出与奖励函数画成可交互的网页。每个项目可在训练态（含奖励函数设置）与部署/推理态之间切换。

覆盖两条路线共 9 个项目：

- **真机路线**（sim-to-real 取向）：[BeyondMimic](https://github.com/HybridRobotics/whole_body_tracking)、[SONIC](https://github.com/NVlabs/GR00T-WholeBodyControl)
- **动画路线**（[MimicKit](https://github.com/xbpeng/MimicKit) 方法族，按年份）：DeepMimic、AWR、AMP、ASE、LCP、ADD、SMP

选这两组的理由是它们互相照亮：真机路线解释「为什么要往观测里减信息、往训练里加噪声」，MimicKit 方法族解释「奖励怎么从手写公式一路走到对抗判别器和冻结的扩散先验」。

设计与实施计划见 [PLAN.md](./PLAN.md)，其中附录 A/B/C 是逐项核对过上游实现的内容基线。
