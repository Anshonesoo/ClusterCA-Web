# ClusterCA Web V2

> 版本：v0.2.0 · 作者：Anshonesoo

ClusterCA 是一套自研的**确定性人工生命（Artificial Life）仿真引擎**，面向**开放进化（Open-Ended Evolution）**与**自复制系统（Self-Replication）**研究。引擎基于 TypeScript / Preact / WebGL2 / Web Worker 构建，约 **48 个模块、7.5K+ 行源码**，在 **4.19M-cell 的双向连通环面状态空间（toroidal state space，1024 个 64×64 chunk，团簇 / 物质 / 光三层耦合）**上驱动 **10K+ 自主生命体接近实时演化**。其物理内核包含 **swept-AABB broad phase、contact graph、chain propagation、transactional commit 与全局 non-overlap assertion**，并自研 **spatial hashing** 将碰撞检测由 **O(n²) 压缩至近线性**，单步仿真耗时从 **22s 优化到 0.19s（>115× 加速）**。繁殖子系统实现了**冯诺依曼式自复制闭环**（gene compilation → processor validation → reproduction port → developmental ant），并带资源成本与冷却约束。平台进一步提供器官系统、刚性群组、趋光分裂等**涌现行为机制**，声明式规则与可信脚本沙箱的**可插拔扩展体系**，WebGL2 三层可视化与**数据驱动教学模式**，并以**零后端静态部署**交付（**83 tests / 12 suites，tsc & vite clean**），可作为**可复现强化学习环境**与**可编程物质（Programmable Matter）建模的数字孪生底座**。

在线预览：https://anshonesoo.github.io/ClusterCA-Web/

## 主要能力

- **确定性核心**：2048×2048 环面世界，64×64 区块（32×32 个），整数化、可复现的 Tick，异常回滚。
- **三层世界**：团簇层 / 物质层 / 光层，可独立显示。
- **防重叠碰撞**：扫掠候选、接触图、链式推动、事务式提交、最终无重叠断言、边/角装甲与碰撞伤害。
- **资源与生命**：统一团簇仓库（物质/能量）、维护与过载自损、移动阈值与成功轴扣减。
- **器官系统**：壳、基因核心、能量转换器、储存访问端口、物质交换器、数字/编译信号端口、控制器、传感器、编译存储器/处理器、外部收发器、编组器、推进器、喷射器、生殖端口；藻类为结构识别型特殊生命。
- **繁殖**：编译信号 → 编译处理器（拼接/清空/END）→ 生殖端口 → 边界外休眠种子 → 受控发育；生殖端口支持产种资源成本与冷却。
- **编辑器**：选择/平移/胞团/器官/物质/基因工具、器官背包调色板、图层开关、网格开关、侧栏折叠、属性与器官检查器。
- **教学模式**：独立展示小地图布置 16 个器官演示点，教学面板点击聚焦；内容由 `src/templates/teachingMap.ts` 单一数据源驱动，可追加/修改实时生效。
- **设置**：背景颜色、亮度、字体大小、中英切换、自动保存间隔、导出路径；关于弹窗。
- **动效**：相机聚焦/回原点回弹缓动，按钮/卡片/弹窗弹性过渡。
- **扩展**：声明式 JSON 自定义器官、可信脚本规则（需授权）、遗传模板导入/导出与放置。

## 开发运行

```powershell
pnpm install
pnpm dev
```

也可以双击 `start.cmd` 快速启动：脚本会自动定位 Node.js（PATH 或 runtime 路径），启动开发服务器并打开浏览器。

## 本地生产运行

仓库附带已构建的 `dist` 时，可双击 `serve.cmd`，然后访问 `http://127.0.0.1:4173/`。这条路径不启动开发服务器，适合下载项目后的本地使用。

## 验证

```powershell
pnpm test
pnpm build
```

当前基线：`vitest` 12 个测试文件、83 项测试通过；`tsc -b` 与 `vite build` 通过。

## 目录说明

- `src/engine`：确定性世界与器官规则（`World.ts`）、数学与性能探针契约。
- `src/model`：类型、常量、器官注册表。
- `src/geometry`、`src/collision`、`src/material`、`src/light`、`src/signals`、`src/genome`：环面几何、碰撞、物质层、光层、信号总线、基因编解码与虚拟机。
- `src/templates`：标准生态模板、开发者模板、教学地图。
- `src/ui`：设置、引导、教学、关于等界面组件。
- `src/worker`：权威模拟 Worker 与协议。

## 文档

- 模型规则与实现基线：上级目录 `ClusterCA_Web_V2_总体方案.md`
- 器官功能与用法：`元胞种类说明.md`
- 长线开发计划：`开发计划.md`
- 部署方式：`DEPLOY.md`
- 验收证据：`验收清单.md`
