#!/usr/bin/env node
/**
 * 从 microduck_rl 任务注册表生成 IO Board 项目数据。
 * 用法：node scripts/generate-microduck.mjs
 */

import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data", "microduck");

const REPO = "pollen-robotics/microduck_rl";
const REPO_URL = "https://github.com/pollen-robotics/microduck_rl";

const JOINT_LAYOUT =
  "14 伺服关节按 MJCF 深度优先：左髋yaw · 左髋roll · 左髋pitch · 左膝 · 左踝 · 颈pitch · 头pitch · 头yaw · 头roll · 右髋yaw · 右髋roll · 右髋pitch · 右膝 · 右踝";

const CMD_LAYOUT = "[twist(3) | head_pose(4) | body_pose(6)]——速度指令 · 头姿增量 · 躯干位姿增量";

const COMMON_LINKS = {
  "microduck_rl 代码": REPO_URL,
  "Microduck 真机运行时": "https://github.com/pollen-robotics/microduck",
  "mjlab 框架": "https://github.com/mujocolab/mjlab",
  "BAM 执行器模型": "https://github.com/Rhoban/bam",
};

function obsNode(id, label, sub, dim, dimLayout, klass, acquisition, availability, extra = {}) {
  return {
    id,
    lane: klass === "B" ? "ref" : "proprio",
    kind: "obs",
    class: klass,
    label,
    sub,
    dim,
    dimLayout,
    acquisition,
    availability,
    freqHz: 50,
    confidence: "verified",
    ...extra,
  };
}

function buildTrainGraph({ summary, facts, rewards, extraNodes = [], extraEdges = [], callouts = [] }) {
  const nodes = [
    {
      id: "s.scene",
      lane: "source",
      kind: "proc",
      label: "MuJoCo 场景",
      sub: "robot_walk.xml · MJWarp GPU",
      desc: "Microduck 步行碰撞模型（躯干/头部接触已剥离以降低倒地代价），平面或粗糙地形，4096 并行环境。",
      source: { repo: REPO, path: "src/mjlab_microduck/robot/microduck/robot_walk.xml" },
      confidence: "verified",
    },
    {
      id: "s.dr",
      lane: "source",
      kind: "proc",
      label: "域随机化",
      sub: "BAM + 质量/摩擦/IMU/编码器偏置",
      availability: "train-only",
      desc: "每回合重采样：电池电压与压降、BAM 摩擦预算、躯干/头部 CoM、质量惯量、IMU 安装误差、关节编码器偏置、速度推击等。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py" },
      confidence: "verified",
    },
    {
      id: "s.cmd",
      lane: "source",
      kind: "proc",
      label: "指令采样器",
      sub: "twist · head_pose · body_pose",
      desc: "速度指令每步重采样；头姿与躯干位姿按任务配置周期性重采样。未使用的指令槽零填充以保持 61 维观测契约。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/mdp.py" },
      confidence: "verified",
    },
    obsNode("o.gravity", "投影重力", "projected_gravity", 3, "(g_x, g_y, g_z)——机体系，IMU 可观测", "A", "direct", "deploy-ok", {
      desc: "机体系重力方向。训练期可加 IMU 安装误差旋转与 ±0.01 噪声，并带 0–1 控制步延迟。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/mdp.py", symbol: "projected_gravity_imu_misaligned" },
    }),
    obsNode("o.ang_vel", "基座角速度", "base_ang_vel", 3, "(ω_x, ω_y, ω_z)——机体系", "A", "direct", "deploy-ok", {
      unit: "rad/s",
      desc: "IMU 陀螺仪读数，训练期带安装误差与噪声。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "base_ang_vel" },
    }),
    obsNode("o.joint_pos", "关节位置", "joint_pos_rel", 14, JOINT_LAYOUT, "A", "direct", "deploy-ok", {
      unit: "rad",
      desc: "14 个伺服关节相对 HOME 位姿。Actor 侧可读编码器偏置（biased=True）；排除 passive_* 关节。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "joint_pos" },
    }),
    obsNode("o.joint_vel", "关节速度", "joint_vel_rel", 14, JOINT_LAYOUT, "A", "filter", "deploy-ok", {
      unit: "rad/s",
      desc: "关节速度，固定延迟 1 控制步以匹配 Dynamixel 固件滑动平均。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "joint_vel" },
    }),
    obsNode("o.last_action", "上一动作", "last_action", 14, `与动作同序：${JOINT_LAYOUT}`, "A", "derived", "deploy-ok", {
      desc: "上一步策略输出的 14 维关节目标。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "last_action" },
    }),
    obsNode("o.cmd_twist", "速度指令", "twist", 3, "(v_x, v_y, ω_z)——机体系", "B", "given", "deploy-ok", {
      desc: "期望线速度与偏航角速度。运行时由手柄/上层模块给定。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "commands.twist" },
    }),
    obsNode("o.cmd_head", "头姿指令", "head_pose", 4, "(neck_pitch, head_pitch, head_yaw, head_roll)——相对 HOME 增量", "B", "given", "deploy-ok", {
      unit: "rad",
      desc: "颈部与头部四关节的目标增量。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "commands.head_pose" },
    }),
    obsNode("o.cmd_body", "躯干位姿指令", "body_pose", 6, "(x, y, z, roll, pitch, yaw)——相对站立名义位姿", "B", "given", "deploy-ok", {
      desc: "躯干 6D 位姿增量槽位；行走任务权重为 0 但观测维保持以便运行时热切换策略。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "commands.body_pose" },
    }),
    {
      id: "p.base_lin_vel",
      lane: "proprio",
      kind: "obs",
      class: "E",
      label: "基座线速度（特权）",
      sub: "base_lin_vel",
      dim: 3,
      dimLayout: "(v_x, v_y, v_z)——机体系",
      acquisition: "sim-only",
      availability: "train-only",
      freqHz: 50,
      desc: "仅 critic 可见的基座线速度真值。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "critic.base_lin_vel" },
      confidence: "verified",
    },
    {
      id: "n.concat",
      lane: "policy",
      kind: "net",
      label: "Actor 观测拼接",
      sub: "61 维 · 经验归一化",
      dim: 61,
      dimExpr: "3 + 3 + 14 + 14 + 14 + 3 + 4 + 6",
      dimLayout: `本体 48 维 + 指令 13 维：投影重力 3 · 角速度 3 · 关节位置 14 · 关节速度 14 · 上一动作 14 · ${CMD_LAYOUT}`,
      checkSum: true,
      desc: "所有策略共享的 61 维观测契约，使运行时可在 walk/recover/trick 策略间热切换。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "observations.actor" },
      confidence: "verified",
    },
    {
      id: "n.actor",
      lane: "policy",
      kind: "net",
      label: "Actor MLP",
      sub: "[512, 256, 128] · ELU",
      desc: "高斯策略，obs_normalization=True，初始 std=1.0。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "MicroduckRlCfg.actor" },
      confidence: "verified",
    },
    {
      id: "n.critic",
      lane: "policy",
      kind: "net",
      label: "Critic MLP",
      sub: "[512, 256, 128] · 特权观测",
      availability: "train-only",
      desc: "非对称 critic：在 actor 观测基础上附加足端接触/高度等特权项与 base_lin_vel。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "MicroduckRlCfg.critic" },
      confidence: "verified",
    },
    {
      id: "a.raw",
      lane: "action",
      kind: "act",
      class: "O1",
      label: "关节位置目标",
      dim: 14,
      dimLayout: JOINT_LAYOUT,
      unit: "rad",
      desc: "策略输出的 14 维关节位置增量目标（scale=1.0）。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "joint_pos action" },
      confidence: "verified",
    },
    {
      id: "a.bam",
      lane: "action",
      kind: "act",
      label: "BAM M6 执行器",
      sub: "XL330 · 电压控制律",
      freqHz: 50,
      desc: "Rhoban BAM 模型：反电势、库仑/Stribeck/负载摩擦、电池压降与指令延迟。导出 ONNX 时归一化统计烘焙进图。",
      source: { repo: REPO, path: "src/mjlab_microduck/actuator/friction_dr_bam.py", symbol: "FrictionDRBamActuator" },
      confidence: "verified",
    },
    {
      id: "e.sim",
      lane: "plant",
      kind: "plant",
      label: "mjlab 环境步进",
      sub: "ManagerBasedRlEnv · 50 Hz",
      freqHz: 200,
      desc: "sim_dt=0.005 s，decimation=4，每策略步 24 帧 rollout。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/__init__.py" },
      confidence: "verified",
    },
    {
      id: "l.reward",
      lane: "learn",
      kind: "signal",
      label: "奖励求和",
      sub: "RewardManager",
      availability: "train-only",
      desc: "手写 RewTerm 加权求和；NaN 奖励在 mdp.py 中被清零以防污染 PPO buffer。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/mdp.py", symbol: "RewardManager.compute patch" },
      confidence: "verified",
    },
    {
      id: "l.ppo",
      lane: "learn",
      kind: "signal",
      label: "PPO 更新",
      sub: "rsl_rl · 50k iter",
      availability: "train-only",
      desc: "num_steps_per_env=24，5 epoch × 4 minibatch，lr 1e-3 自适应，clip 0.2，entropy 0.01，γ=0.99，λ=0.95。",
      source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "MicroduckRlCfg" },
      confidence: "verified",
    },
    ...extraNodes,
  ];

  const obsToConcat = [
    "o.gravity",
    "o.ang_vel",
    "o.joint_pos",
    "o.joint_vel",
    "o.last_action",
    "o.cmd_twist",
    "o.cmd_head",
    "o.cmd_body",
  ];

  const edges = [
    { from: "s.scene", to: "e.sim", kind: "flow" },
    { from: "s.dr", to: "e.sim", kind: "init", style: "dashed" },
    { from: "s.cmd", to: "o.cmd_twist", kind: "ref" },
    { from: "s.cmd", to: "o.cmd_head", kind: "ref" },
    { from: "s.cmd", to: "o.cmd_body", kind: "ref" },
    { from: "e.sim", to: "o.gravity", kind: "obs" },
    { from: "e.sim", to: "o.ang_vel", kind: "obs" },
    { from: "e.sim", to: "o.joint_pos", kind: "obs" },
    { from: "e.sim", to: "o.joint_vel", kind: "obs" },
    { from: "e.sim", to: "p.base_lin_vel", kind: "obs", style: "dashed" },
    { from: "a.bam", to: "o.last_action", kind: "feedback", style: "dashed" },
    ...obsToConcat.map((id) => ({ from: id, to: "n.concat", kind: "obs" })),
    { from: "n.concat", to: "n.actor", kind: "obs", label: "61" },
    { from: "n.concat", to: "n.critic", kind: "obs", style: "dashed" },
    { from: "p.base_lin_vel", to: "n.critic", kind: "obs", style: "dashed" },
    { from: "n.actor", to: "a.raw", kind: "action", label: "14" },
    { from: "a.raw", to: "a.bam", kind: "action" },
    { from: "a.bam", to: "e.sim", kind: "action" },
    { from: "e.sim", to: "l.reward", kind: "reward" },
    { from: "l.reward", to: "l.ppo", kind: "reward" },
    { from: "n.critic", to: "l.ppo", kind: "grad", style: "dashed" },
    { from: "l.ppo", to: "n.actor", kind: "grad", style: "dashed", label: "策略更新" },
    ...extraEdges,
  ];

  return {
    label: "训练态",
    summary,
    facts,
    lanes: ["source", "ref", "proprio", "policy", "action", "plant", "learn"],
    nodes,
    edges,
    rewards,
    callouts,
  };
}

function buildDeployGraph() {
  return {
    label: "部署态",
    summary:
      "ONNX 策略在真机/CPU MuJoCo 上以相同 61 维观测契约运行。归一化统计已烘焙进导出图；奖励、critic 与域随机化均不在部署链路上。",
    facts: [
      { label: "策略观测", value: "61 维（与训练 Actor 完全一致）" },
      { label: "动作输出", value: "14 维关节位置目标" },
      { label: "控制频率", value: "50 Hz" },
      { label: "相比训练态去掉", value: "Critic · 奖励 · 域随机化 · 特权观测" },
      { label: "运行时", value: "microduck 仓 ONNX 推理 + 策略热切换" },
      { label: "导出", value: "scripts/export.py（必须带观测归一化）" },
    ],
    lanes: ["ref", "proprio", "policy", "action", "plant"],
    nodes: [
      obsNode("o.gravity", "投影重力", "projected_gravity", 3, "(g_x, g_y, g_z)", "A", "direct", "deploy-ok", { freqHz: 50 }),
      obsNode("o.ang_vel", "基座角速度", "base_ang_vel", 3, "(ω_x, ω_y, ω_z)", "A", "direct", "deploy-ok", { freqHz: 50 }),
      obsNode("o.joint_pos", "关节位置", "joint_pos_rel", 14, JOINT_LAYOUT, "A", "direct", "deploy-ok", { freqHz: 50 }),
      obsNode("o.joint_vel", "关节速度", "joint_vel_rel", 14, JOINT_LAYOUT, "A", "filter", "deploy-ok", { freqHz: 50 }),
      obsNode("o.last_action", "上一动作", "last_action", 14, JOINT_LAYOUT, "A", "derived", "deploy-ok", { freqHz: 50 }),
      obsNode("o.cmd_twist", "速度指令", "twist", 3, "(v_x, v_y, ω_z)", "B", "given", "deploy-ok", { freqHz: 50 }),
      obsNode("o.cmd_head", "头姿指令", "head_pose", 4, "(neck_pitch, head_pitch, head_yaw, head_roll)", "B", "given", "deploy-ok", { freqHz: 50 }),
      obsNode("o.cmd_body", "躯干位姿指令", "body_pose", 6, "(x, y, z, roll, pitch, yaw)", "B", "given", "deploy-ok", { freqHz: 50 }),
      {
        id: "n.concat",
        lane: "policy",
        kind: "net",
        label: "观测拼接",
        dim: 61,
        dimExpr: "48 + 13",
        dimLayout: `48 维本体 + 13 维指令：${CMD_LAYOUT}`,
        checkSum: true,
        confidence: "verified",
      },
      {
        id: "n.actor",
        lane: "policy",
        kind: "net",
        label: "ONNX 策略",
        sub: "归一化已烘焙",
        confidence: "verified",
      },
      {
        id: "a.raw",
        lane: "action",
        kind: "act",
        class: "O1",
        label: "关节位置目标",
        dim: 14,
        dimLayout: JOINT_LAYOUT,
        confidence: "verified",
      },
      {
        id: "a.bam",
        lane: "action",
        kind: "act",
        label: "固件 PD + BAM",
        confidence: "verified",
      },
      {
        id: "e.robot",
        lane: "plant",
        kind: "plant",
        label: "Microduck 真机",
        sub: "Dynamixel XL330 × 14",
        confidence: "verified",
      },
    ],
    edges: [
      { from: "e.robot", to: "o.gravity", kind: "obs" },
      { from: "e.robot", to: "o.ang_vel", kind: "obs" },
      { from: "e.robot", to: "o.joint_pos", kind: "obs" },
      { from: "e.robot", to: "o.joint_vel", kind: "obs" },
      { from: "o.gravity", to: "n.concat", kind: "obs" },
      { from: "o.ang_vel", to: "n.concat", kind: "obs" },
      { from: "o.joint_pos", to: "n.concat", kind: "obs" },
      { from: "o.joint_vel", to: "n.concat", kind: "obs" },
      { from: "o.last_action", to: "n.concat", kind: "obs" },
      { from: "o.cmd_twist", to: "n.concat", kind: "obs" },
      { from: "o.cmd_head", to: "n.concat", kind: "obs" },
      { from: "o.cmd_body", to: "n.concat", kind: "obs" },
      { from: "n.concat", to: "n.actor", kind: "obs", label: "61" },
      { from: "n.actor", to: "a.raw", kind: "action", label: "14" },
      { from: "a.raw", to: "a.bam", kind: "action" },
      { from: "a.bam", to: "e.robot", kind: "action" },
      { from: "a.bam", to: "o.last_action", kind: "feedback", style: "dashed" },
    ],
    callouts: [
      {
        title: "61 维观测契约",
        body: "所有 microduck_rl 策略共享同一观测布局，真机运行时可热切换 walk / recover / trick 策略而无需改接口。未使用的指令槽零填充而非删除。",
      },
    ],
  };
}

const VELOCITY_REWARDS = [
  { id: "track_lin", canonical: "track_lin_vel", group: "A", label: "线速度跟踪", weight: 2.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "track_linear_velocity" } },
  { id: "track_ang", canonical: "track_ang_vel", group: "A", label: "角速度跟踪", weight: 2.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "track_angular_velocity" } },
  { id: "head_pose", canonical: "head_pose", group: "A", label: "头姿跟踪", weight: 2.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "head_pose_tracking" } },
  { id: "air_time", canonical: "feet_air_time", group: "C", label: "腾空时间", weight: 3.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "air_time" } },
  { id: "pose", canonical: "pose", group: "B", label: "腿部姿态", weight: 1.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "pose" } },
  { id: "upright", canonical: "upright", group: "B", label: "躯干直立", weight: 2.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "upright" } },
  { id: "foot_clear", canonical: "foot_clearance", group: "C", label: "摆动足离地", weight: 1.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "foot_clearance" } },
  { id: "foot_swing", canonical: "foot_swing_height", group: "C", label: "摆腿高度", weight: 1.0, direction: "positive", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "foot_swing_height" } },
  { id: "foot_slip", canonical: "foot_slip", group: "C", label: "足端滑移", weight: -0.1, direction: "negative", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "foot_slip" } },
  { id: "self_col", canonical: "self_collision", group: "E", label: "自碰撞", weight: -1.0, direction: "negative", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "self_collisions" } },
  { id: "body_ang", canonical: "body_ang_vel", group: "B", label: "躯干角速度", weight: -0.05, direction: "negative", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "body_ang_vel" } },
  { id: "ang_mom", canonical: "angular_momentum", group: "D", label: "角动量", weight: -0.02, direction: "negative", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "angular_momentum" } },
  { id: "action_rate", canonical: "action_rate", group: "D", label: "动作变化率", weight: -0.1, direction: "negative", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "action_rate_l2" } },
  { id: "head_bias", canonical: "head_pose_bias", group: "B", label: "头姿直流偏置", weight: 0.0, direction: "negative", confidence: "verified", source: { repo: REPO, path: "src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py", symbol: "head_pose_bias" } },
];

const VELOCITY_FACTS = [
  { label: "任务 ID", value: "Mjlab-Velocity-Flat-MicroDuck" },
  { label: "机器人", value: "Microduck · 14 伺服 · ~800 g" },
  { label: "策略观测", value: "61 维" },
  { label: "动作输出", value: "14 维关节位置目标" },
  { label: "Actor 网络", value: "MLP [512, 256, 128] · ELU" },
  { label: "奖励项", value: "14 项手写奖励" },
  { label: "地形", value: "平面" },
  { label: "并行环境", value: "4096（推荐）" },
  { label: "控制频率", value: "50 Hz（物理 200 Hz）" },
  { label: "训练规模", value: "50k iter × 24 步/环境" },
];

function baseProject(id, name, subtitle, tagline, train, extra = {}) {
  return {
    id,
    name,
    subtitle,
    tagline,
    robot: { name: "Microduck", dof: 14 },
    rates: { policyHz: 50, physicsHz: 200, note: "sim_dt=0.005 s，decimation=4" },
    verifiedAt: "2026-09-01",
    verifiedRef: `${REPO}@main · ${id}`,
    links: { ...COMMON_LINKS },
    modes: { train, deploy: buildDeployGraph() },
    ...extra,
  };
}

/** @type {Array<{registry: object, file: string, project: object}>} */
const OUTPUTS = [];

// --- Velocity Flat (base) ---
OUTPUTS.push({
  file: "velocity-flat.json",
  registry: {
    id: "microduck-velocity-flat",
    name: "Velocity · Flat",
    subtitle: "主任务：速度跟踪 + 头姿指令",
    group: "microduck",
    published: "2026-01-01",
    venue: "pollen-robotics/microduck_rl",
    keywords: ["Microduck", "mjlab", "MuJoCo", "PPO", "velocity", "walking", "BAM", "sim2real", "pollen-robotics", "Mjlab-Velocity-Flat-MicroDuck"],
  },
  project: baseProject(
    "microduck-velocity-flat",
    "Velocity · Flat",
    "主任务：速度跟踪 + 头姿指令",
    "约 800 g 双足的主行走策略：BAM 执行器物理 + 61 维共享观测契约。",
    buildTrainGraph({
      summary: "mjlab 4096 并行环境，61 维策略观测（48 维本体 + 13 维指令），14 维关节目标，14 项手写奖励 + 多项课程学习。",
      facts: VELOCITY_FACTS,
      rewards: VELOCITY_REWARDS,
      callouts: [
        { title: "61 维观测契约", body: "所有策略共享 [twist(3), head_pose(4), body_pose(6)] 指令布局，真机运行时可热切换策略。" },
        { title: "BAM 执行器", body: "在 XL330 尺度上，执行器物理（电压控制、摩擦、压降）是 sim2real 的主要差距来源。" },
      ],
    })
  ),
});

// Task families: inherit from velocity-flat with overrides
const FAMILIES = [
  {
    id: "microduck-velocity-rough",
    parent: "microduck-velocity-flat",
    file: "velocity-rough.json",
    taskId: "Mjlab-Velocity-Rough-MicroDuck",
    name: "Velocity · Rough",
    subtitle: "粗糙地形行走",
    diff: "与平地版共享奖励与观测，地形换成微台阶/鹅卵石/缓坡生成器，并加大接触求解迭代。",
    facts: { "地形": "generator：台阶 ≤1.5 cm、鹅卵石 ≤1 cm、缓坡 1.7°–5.7°" },
    nodes: { "s.scene": { sub: "robot_walk.xml · 粗糙地形", label: "MuJoCo 粗糙场景" } },
  },
  {
    id: "microduck-velstand-flat",
    parent: "microduck-velocity-flat",
    file: "velstand-flat.json",
    taskId: "Mjlab-VelStand-Flat-MicroDuck",
    name: "VelStand · Flat",
    subtitle: "行走 + 跌倒恢复合一",
    diff: "单策略同时学速度跟踪与从倒地恢复；使用 robot_allcollisions 模型允许躯干触地。",
    facts: { "碰撞模型": "robot_allcollisions.xml", "任务目标": "行走 + 跌倒恢复" },
    nodes: { "s.scene": { sub: "robot_allcollisions.xml", label: "全碰撞模型场景" } },
  },
  {
    id: "microduck-velstand-rough",
    parent: "microduck-velocity-flat",
    file: "velstand-rough.json",
    taskId: "Mjlab-VelStand-Rough-MicroDuck",
    name: "VelStand · Rough",
    subtitle: "粗糙地形行走 + 恢复",
    diff: "VelStand 在粗糙地形上的变体：单策略同时学速度跟踪与从倒地恢复。",
    facts: { "地形": "粗糙地形生成器", "碰撞模型": "robot_allcollisions.xml", "任务目标": "行走 + 跌倒恢复" },
    nodes: { "s.scene": { sub: "robot_allcollisions · 粗糙地形" } },
  },
  {
    id: "microduck-standup-flat",
    parent: "microduck-velocity-flat",
    file: "standup-flat.json",
    taskId: "Mjlab-StandUp-Flat-MicroDuck",
    name: "StandUp · Flat",
    subtitle: "仰卧/俯卧/坐姿站起",
    diff: "从倒置或坐姿站起并维持站立 + 躯干位姿控制；twist 指令范围收窄。",
    facts: { "初始姿态": "仰卧/俯卧/坐姿随机", "任务目标": "站起 + 姿态保持" },
    nodes: { "s.scene": { sub: "robot_allcollisions.xml", label: "站起场景" } },
  },
  {
    id: "microduck-standup-rough",
    parent: "microduck-velocity-flat",
    file: "standup-rough.json",
    taskId: "Mjlab-StandUp-Rough-MicroDuck",
    name: "StandUp · Rough",
    subtitle: "粗糙地面站起",
    diff: "StandUp 在粗糙地形上的变体：从倒置或坐姿站起并维持站立。",
    facts: { "地形": "粗糙地形生成器", "初始姿态": "仰卧/俯卧/坐姿随机", "任务目标": "站起 + 姿态保持" },
  },
  {
    id: "microduck-sitstand-flat",
    parent: "microduck-velocity-flat",
    file: "sitstand-flat.json",
    taskId: "Mjlab-SitStand-Flat-MicroDuck",
    name: "SitStand · Flat",
    subtitle: "指令化坐↔站",
    diff: "单策略学柔和坐站切换，头姿仍可指令化；奖励换成姿态/高度/速度专用项。",
    facts: { "任务目标": "坐站切换 + 头姿", "奖励": "posture_pose · rise/descent_speed 等" },
    nodes: { "s.scene": { sub: "robot_allcollisions.xml" } },
  },
  {
    id: "microduck-sitstand-rough",
    parent: "microduck-velocity-flat",
    file: "sitstand-rough.json",
    taskId: "Mjlab-SitStand-Rough-MicroDuck",
    name: "SitStand · Rough",
    subtitle: "粗糙地面坐站",
    diff: "SitStand 在粗糙地形上的变体：单策略学柔和坐站切换。",
    facts: { "地形": "粗糙地形生成器", "任务目标": "坐站切换 + 头姿", "奖励": "posture_pose · rise/descent_speed 等" },
  },
  {
    id: "microduck-groundpick-flat",
    parent: "microduck-velocity-flat",
    file: "groundpick-flat.json",
    taskId: "Mjlab-GroundPick-Flat-MicroDuck",
    name: "GroundPick · Flat",
    subtitle: "下蹲触地再站起",
    diff: "下蹲让嘴尖触地后回到站立；复用 ground-pick 指令槽。",
    facts: { "任务目标": "触地拾取姿态" },
    nodes: { "s.scene": { sub: "robot_allcollisions.xml" } },
  },
  {
    id: "microduck-groundpick-rough",
    parent: "microduck-velocity-flat",
    file: "groundpick-rough.json",
    taskId: "Mjlab-GroundPick-Rough-MicroDuck",
    name: "GroundPick · Rough",
    subtitle: "粗糙地面触地",
    diff: "GroundPick 在粗糙地形上的变体：下蹲让嘴尖触地后回到站立。",
    facts: { "地形": "粗糙地形生成器", "任务目标": "触地拾取姿态" },
  },
  {
    id: "microduck-ballkick-flat",
    parent: "microduck-velocity-flat",
    file: "ballkick-flat.json",
    taskId: "Mjlab-BallKick-Flat-MicroDuck",
    name: "BallKick · Flat",
    subtitle: "右脚踢球（策略不见球）",
    diff: "从站立起步用右脚将 70 mm/15 g 球向前踢出；Actor 观测不含球状态。",
    facts: { "任务目标": "踢球", "观测": "球盲（ball-blind）" },
    nodes: { "s.scene": { sub: "robot_allcollisions.xml + 球" } },
  },
  {
    id: "microduck-rollers-flat",
    parent: "microduck-velocity-flat",
    file: "rollers-flat.json",
    taskId: "Mjlab-Velocity-Flat-MicroDuck-Rollers",
    name: "Rollers · Velocity",
    subtitle: "轮滑速度跟踪",
    diff: "脚底被动轮模型；奖励换成滑行/单支撑/对称步态等轮滑专用项。",
    facts: { "碰撞模型": "robot_allcollisions_rollers.xml", "任务目标": "轮滑速度跟踪" },
    nodes: { "s.scene": { sub: "robot_allcollisions_rollers.xml" } },
  },
  {
    id: "microduck-swizzle",
    parent: "microduck-velocity-flat",
    file: "swizzle.json",
    taskId: "Mjlab-Velocity-Swizzle-MicroDuck",
    name: "Swizzle",
    subtitle: "经典对称 Swizzle 滑法",
    diff: "轮滑对称 Swizzle 步态；双脚保持接地。使用 robot_allcollisions_rollers 模型。",
    facts: { "碰撞模型": "robot_allcollisions_rollers.xml", "任务目标": "Swizzle 滑法" },
    nodes: { "s.scene": { sub: "robot_allcollisions_rollers.xml" } },
  },
  {
    id: "microduck-roller-crouch",
    parent: "microduck-velocity-flat",
    file: "roller-crouch.json",
    taskId: "Mjlab-RollerCrouch-Flat-MicroDuck",
    name: "RollerCrouch",
    subtitle: "轮滑下蹲滑行",
    diff: "在轮滑状态下下蹲滑行。",
    facts: { "碰撞模型": "robot_allcollisions_rollers.xml", "任务目标": "轮滑下蹲" },
    nodes: { "s.scene": { sub: "robot_allcollisions_rollers.xml" } },
  },
  {
    id: "microduck-roller-slope",
    parent: "microduck-velocity-flat",
    file: "roller-slope.json",
    taskId: "Mjlab-RollerSlope-Flat-MicroDuck",
    name: "RollerSlope",
    subtitle: "斜坡轮滑下滑",
    diff: "在斜坡地形上轮滑下滑；奖励以 wheel_glide 为主。",
    facts: { "地形": "斜坡", "碰撞模型": "robot_allcollisions_rollers.xml", "任务目标": "坡面滑行" },
    nodes: { "s.scene": { sub: "robot_allcollisions_rollers.xml · 斜坡" } },
  },
  {
    id: "microduck-roller-standup",
    parent: "microduck-velocity-flat",
    file: "roller-standup.json",
    taskId: "Mjlab-RollerStandUp-Flat-MicroDuck",
    name: "RollerStandUp",
    subtitle: "地上站起到轮滑姿态",
    diff: "从地面在轮滑鞋上站起；专用站起策略。",
    facts: { "碰撞模型": "robot_allcollisions_rollers.xml", "任务目标": "轮滑站起" },
    nodes: { "s.scene": { sub: "robot_allcollisions_rollers.xml" } },
  },
  {
    id: "microduck-spin",
    parent: "microduck-velocity-flat",
    file: "spin.json",
    taskId: "Mjlab-Spin-Flat-MicroDuck",
    name: "Spin",
    subtitle: "原地快速旋转",
    diff: "轮滑上原地高速旋转；奖励以 spin_rate_track 等为主。",
    facts: { "碰撞模型": "robot_allcollisions_rollers.xml", "任务目标": "原地旋转" },
    nodes: { "s.scene": { sub: "robot_allcollisions_rollers.xml" } },
  },
  {
    id: "microduck-roulade",
    parent: "microduck-velocity-flat",
    file: "roulade.json",
    taskId: "Mjlab-Roulade-Flat-MicroDuck",
    name: "Roulade",
    subtitle: "前滚翻落地",
    diff: "用头顶前滚翻越过并落回双脚；使用全碰撞模型。",
    facts: { "任务目标": "前滚翻（Roulade）" },
    nodes: { "s.scene": { sub: "robot_allcollisions.xml" } },
  },
];

for (const fam of FAMILIES) {
  OUTPUTS.push({
    file: fam.file,
    registry: {
      id: fam.id,
      name: fam.name,
      subtitle: fam.subtitle,
      group: "microduck",
      published: "2026-01-01",
      venue: "pollen-robotics/microduck_rl",
      keywords: ["Microduck", "mjlab", "MuJoCo", "PPO", "BAM", fam.taskId, fam.name],
    },
    project: {
      id: fam.id,
      name: fam.name,
      subtitle: fam.subtitle,
      inherits: fam.parent,
      diffSummary: fam.diff,
      verifiedAt: "2026-09-01",
      verifiedRef: `${REPO}@main · ${fam.taskId}`,
      links: { ...COMMON_LINKS, "任务注册": `${REPO_URL}/blob/main/src/mjlab_microduck/tasks/__init__.py` },
      overrides: {
        "modes.train": {
          summary: fam.diff,
          facts: { "任务 ID": fam.taskId, ...(fam.facts ?? {}) },
          ...(fam.nodes ? { nodes: fam.nodes } : {}),
        },
      },
    },
  });
}

// Backlash variants
const BACKLASH = [
  { id: "microduck-velocity-flat-backlash", parent: "microduck-velocity-flat", file: "velocity-flat-backlash.json", taskId: "Mjlab-Velocity-Flat-Backlash-MicroDuck", name: "Velocity · Flat · Backlash", subtitle: "平地行走 + ±1° 齿隙" },
  { id: "microduck-velocity-rough-backlash", parent: "microduck-velocity-flat", file: "velocity-rough-backlash.json", taskId: "Mjlab-Velocity-Rough-Backlash-MicroDuck", name: "Velocity · Rough · Backlash", subtitle: "粗糙地形 + 齿隙", extraFacts: { "地形": "粗糙地形生成器" } },
  { id: "microduck-velstand-flat-backlash", parent: "microduck-velocity-flat", file: "velstand-flat-backlash.json", taskId: "Mjlab-VelStand-Flat-Backlash-MicroDuck", name: "VelStand · Flat · Backlash", subtitle: "行走恢复 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_backlash.xml", "任务目标": "行走 + 跌倒恢复" } },
  { id: "microduck-velstand-rough-backlash", parent: "microduck-velocity-flat", file: "velstand-rough-backlash.json", taskId: "Mjlab-VelStand-Rough-Backlash-MicroDuck", name: "VelStand · Rough · Backlash", subtitle: "粗糙 + 恢复 + 齿隙", extraFacts: { "地形": "粗糙地形生成器", "碰撞模型": "robot_allcollisions_backlash.xml" } },
  { id: "microduck-standup-flat-backlash", parent: "microduck-velocity-flat", file: "standup-flat-backlash.json", taskId: "Mjlab-StandUp-Flat-Backlash-MicroDuck", name: "StandUp · Flat · Backlash", subtitle: "站起 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_backlash.xml", "任务目标": "站起 + 姿态保持" } },
  { id: "microduck-standup-rough-backlash", parent: "microduck-velocity-flat", file: "standup-rough-backlash.json", taskId: "Mjlab-StandUp-Rough-Backlash-MicroDuck", name: "StandUp · Rough · Backlash", subtitle: "粗糙站起 + 齿隙", extraFacts: { "地形": "粗糙地形生成器", "碰撞模型": "robot_allcollisions_backlash.xml" } },
  { id: "microduck-sitstand-flat-backlash", parent: "microduck-velocity-flat", file: "sitstand-flat-backlash.json", taskId: "Mjlab-SitStand-Flat-Backlash-MicroDuck", name: "SitStand · Flat · Backlash", subtitle: "坐站 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_backlash.xml", "任务目标": "坐站切换" } },
  { id: "microduck-sitstand-rough-backlash", parent: "microduck-velocity-flat", file: "sitstand-rough-backlash.json", taskId: "Mjlab-SitStand-Rough-Backlash-MicroDuck", name: "SitStand · Rough · Backlash", subtitle: "粗糙坐站 + 齿隙", extraFacts: { "地形": "粗糙地形生成器", "碰撞模型": "robot_allcollisions_backlash.xml" } },
  { id: "microduck-groundpick-flat-backlash", parent: "microduck-velocity-flat", file: "groundpick-flat-backlash.json", taskId: "Mjlab-GroundPick-Flat-Backlash-MicroDuck", name: "GroundPick · Flat · Backlash", subtitle: "触地 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_backlash.xml", "任务目标": "触地拾取" } },
  { id: "microduck-groundpick-rough-backlash", parent: "microduck-velocity-flat", file: "groundpick-rough-backlash.json", taskId: "Mjlab-GroundPick-Rough-Backlash-MicroDuck", name: "GroundPick · Rough · Backlash", subtitle: "粗糙触地 + 齿隙", extraFacts: { "地形": "粗糙地形生成器", "碰撞模型": "robot_allcollisions_backlash.xml" } },
  { id: "microduck-ballkick-flat-backlash", parent: "microduck-velocity-flat", file: "ballkick-flat-backlash.json", taskId: "Mjlab-BallKick-Flat-Backlash-MicroDuck", name: "BallKick · Flat · Backlash", subtitle: "踢球 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_backlash.xml", "任务目标": "踢球" } },
  { id: "microduck-rollers-flat-backlash", parent: "microduck-velocity-flat", file: "rollers-flat-backlash.json", taskId: "Mjlab-Velocity-Flat-Backlash-MicroDuck-Rollers", name: "Rollers · Backlash", subtitle: "轮滑 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_rollers_backlash.xml", "任务目标": "轮滑速度跟踪" } },
  { id: "microduck-swizzle-backlash", parent: "microduck-velocity-flat", file: "swizzle-backlash.json", taskId: "Mjlab-Velocity-Swizzle-Backlash-MicroDuck", name: "Swizzle · Backlash", subtitle: "Swizzle + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_rollers_backlash.xml", "任务目标": "Swizzle 滑法" } },
  { id: "microduck-roller-crouch-backlash", parent: "microduck-velocity-flat", file: "roller-crouch-backlash.json", taskId: "Mjlab-RollerCrouch-Flat-Backlash-MicroDuck", name: "RollerCrouch · Backlash", subtitle: "轮滑下蹲 + 齿隙", extraFacts: { "碰撞模型": "robot_allcollisions_rollers_backlash.xml" } },
  { id: "microduck-roller-slope-backlash", parent: "microduck-velocity-flat", file: "roller-slope-backlash.json", taskId: "Mjlab-RollerSlope-Flat-Backlash-MicroDuck", name: "RollerSlope · Backlash", subtitle: "坡面滑行 + 齿隙", extraFacts: { "地形": "斜坡", "碰撞模型": "robot_allcollisions_rollers_backlash.xml" } },
];

for (const bl of BACKLASH) {
  OUTPUTS.push({
    file: bl.file,
    registry: {
      id: bl.id,
      name: bl.name,
      subtitle: bl.subtitle,
      group: "microduck",
      published: "2026-01-01",
      venue: "pollen-robotics/microduck_rl · Backlash",
      keywords: ["Microduck", "backlash", "齿隙", "sim2real", bl.taskId],
    },
    project: {
      id: bl.id,
      name: bl.name,
      subtitle: bl.subtitle,
      inherits: bl.parent,
      diffSummary: `每个伺服关节串联 ±1° 齿隙（共 2°）的被动铰链；编码器与关节观测读穿齿隙（BacklashEncoderBamActuator）。观测/动作维度不变，ONNX 与真机运行时无需改动。`,
      verifiedAt: "2026-09-01",
      verifiedRef: `${REPO}@main · ${bl.taskId}`,
      links: {
        ...COMMON_LINKS,
        "齿隙实现": `${REPO_URL}/blob/main/src/mjlab_microduck/tasks/backlash.py`,
      },
      overrides: {
        "modes.train": {
          facts: { "任务 ID": bl.taskId, "齿隙": "±1°/关节 · 观测读穿齿隙", ...(bl.extraFacts ?? {}) },
          nodes: {
            "a.bam": {
              label: "BAM + 齿隙编码器反馈",
              sub: "BacklashEncoderBamActuator",
              desc: "执行器与 joint_pos/joint_vel 观测均读 qpos[servo]+qpos[backlash]，匹配真机编码器在齿隙输出侧的位置。",
            },
          },
        },
      },
    },
  });
}

// Write files
await import("node:fs/promises").then(({ mkdir }) => mkdir(DATA, { recursive: true }));

for (const { file, project } of OUTPUTS) {
  const path = join(DATA, file);
  await writeFile(path, `${JSON.stringify(project, null, 2)}\n`);
  console.log("wrote", path);
}

// Patch projects.json — replace microduck entries each run
const projectsPath = join(ROOT, "data", "projects.json");
const registry = JSON.parse(await readFile(projectsPath, "utf8"));

registry.groups = registry.groups.filter((g) => g.id !== "microduck");
registry.groups.push({
  id: "microduck",
  name: "Microduck RL（mjlab · 真机路线）",
  desc: "Pollen Robotics ~800 g 双足 Microduck 的完整 sim2real 训练环境：BAM 执行器物理、域随机化、齿隙仿真与 61 维共享观测契约，策略导出 ONNX 后在真机热切换。",
});

const microduckIds = new Set(OUTPUTS.map((o) => o.registry.id));
registry.projects = registry.projects.filter((p) => !microduckIds.has(p.id));
for (const { registry: entry, file } of OUTPUTS) {
  registry.projects.push({
    ...entry,
    file: `microduck/${file}`,
  });
}

await writeFile(projectsPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log("updated projects.json with", OUTPUTS.length, "microduck projects");
