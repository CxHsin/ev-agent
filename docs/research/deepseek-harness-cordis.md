# DeepSeek Harness / Cordis 架构查证

> 查证时间：2026-08-16（Asia/Shanghai）  
> 范围：DeepSeek 官方网站、`deepseek-ai/deepseek-harness` 官方仓库、Cordis 官方仓库与论文。社区文章和第三方解读未作为事实来源。

## 结论先行

用户指的是 **DeepSeek Harness（命令名 `dsh`）**，名称和 **Cordis** 拼写都正确。它不是一个“插件市场式的聊天机器人”，而是一个可组装的 Agent Harness：Cordis 提供插件生命周期、依赖解析、服务容器、事件与可逆副作用；DeepSeek Harness 再把模型、工具、会话日志、Agent Loop、存储、沙箱、调度和 UI 等能力实现成插件，并用配置树组装成可运行产品。[官方首页](https://www.deepseek.com/harness/)把它概括为“一切皆插件”，[官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.zh.md#L9-L13)给出了源码层面的定义。

最接近“通过插件组装出不同 Agents”的机制叫 **Agent Preset**，不是 `AGENTS.md`：每个 preset 是一个含 `agent.cordis.yml` 的目录，定义该类 Agent 的工具、提示词片段及其他作用域化能力；会话加入某个 preset 后看到相应能力集合，不同 preset 彼此隔离。[Agent Preset 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/agent-presets/README.zh.md#L1-L7)

因此，对本项目更准确的产品描述应是：**一个面向个人长期运行、可用插件组合出多种 Agent 形态的 Harness；聊天和主动推送是两种 surface / product assembly，而不是内核本身。**

这不只是从整体架构推导出的结论。DeepSeek 官方扩展手册直接把 Memory 定义为 section provider + tool，把定时任务定义为注册调度工具并在触发时 `followup()` / `inject()` 的插件，把 UI 定义为监听 `session/event` 并把用户输入送入 `followup()` 的插件模式。[官方 Extension Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cookbook/extension-cookbook.zh.md#L123-L131)

## 项目与发布时间

- 官方项目名：**DeepSeek Harness**，仓库为 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)，CLI 为 `dsh`。官方 README 明确称其为 DeepSeek AI 开发的开源 agent harness，并标为 developer preview，且提示未来会有破坏兼容性变更。[README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/README.zh.md#L1-L11)
- GitHub 官方 API 记录仓库创建时间为 `2026-08-13T11:56:32Z`，即北京时间 **2026-08-13 19:56:32**；首个公开分支提交时间也是 8 月 13 日。官方产品页返回的数据时间为 8 月 14 日，并展示“开发者预览版”发布内容，但页面本身没有独立的发布日期字段。因此可以确认它是 **8 月 13 日开放仓库、8 月 14 日前后对外发布**，但不应把“8 月 14 日”写成有明确发布日期字段支持的精确结论。[GitHub repository API](https://api.github.com/repos/deepseek-ai/deepseek-harness) · [官方产品页](https://www.deepseek.com/harness/)
- 截至查证时，官方仓库没有 GitHub Release 或 tag，且仍明确处于 developer preview。这一点意味着其思想可参考，但 API 不适合作为当前项目必须兼容的稳定标准。[官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/README.zh.md#L9-L11)

## Cordis 到底负责什么

准确拼写是 **Cordis**。上游仓库为 [`cordiverse/cordis`](https://github.com/cordiverse/cordis)，自述为 “Meta-Framework of Spatiotemporal Composability”。其配套论文把核心概念定义为：

- **temporal composability**：组件移除时能完整撤销副作用；
- **spatial composability**：组件声明依赖，并在上下文变化时响应式地管理这些依赖；
- Cordis 用 effect tracking、coeffect resolution、声明式 loader、配置 reconciliation 和 HMR 实现上述能力。[Cordis 官方论文 README](https://github.com/cordiverse/paper/blob/948a07b369c62adb3b12e102458be5c18dfb69b9/README.md)

在 DeepSeek Harness 中，Cordis 的职责可以压缩为五项：

1. `Context`：共享服务容器，插件通过稳定的 `ctx.<key>` 找服务，而不依赖具体实现。
2. `inject`：声明服务依赖；依赖未满足的插件保持 pending，依赖出现后再启动。
3. typed events：插件之间通过类型化事件通信。
4. reversible effects：注册、监听器等副作用带 disposer，插件卸载时自动撤销。
5. loader / composition：从 `cordis.yml` 装载插件树，支持按稳定 `id` 更新、启停、分组、隔离及 HMR。

这些定义来自 [Cordis 入门](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.zh.md#L5-L13) 与 [组合和 HMR 教程](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/06-composition-and-hmr.zh.md#L5-L25)。Cordis **不承载 Agent 领域能力**；模型、记忆、聊天、推送都应是它装载的能力，而不是 Cordis 自身的一部分。官方产品页也明确写明 Cordis 内核只负责插件加载、卸载和依赖关系。[官方产品页](https://www.deepseek.com/harness/)

一个实现细节需要注意：DeepSeek Harness 没有直接把 Cordis 当普通 npm 依赖，而是 vendor 进仓库、固定版本、重命名为 `@deepseek-ai/cordis`，并维护了本地生命周期和配置事务补丁。因此“采用 Cordis”不等于零成本引入一个稳定黑盒。[vendor 说明](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/README.md#L1-L17)

## 插件如何组装成产品与 Agents

DeepSeek Harness 实际有三个不同粒度的组合层，不应混为一谈：

| 层级 | 作用 | 示例 |
|---|---|---|
| Cordis 插件树 | 最底层运行时组合；服务、事件、生命周期和依赖 | LLM adapter、tools registry、session log、agent loop |
| Profile + Bundle | 组装一个可启动的产品形态；bundle patch 按序叠加，用户 overlay 最后覆盖 | `web`、`headless` |
| Agent Preset | 在同一宿主产品内，为某类会话选择提示词、工具和作用域化能力 | `standard`、`code`、`minimal`、`cordis` |

官方架构文档说明，运行中的 `dsh` 是启动时分层叠加得到的一棵插件树；`profile` 是具名组装，`bundle` 是配置项和挂载代码的分发格式，内置 `web` 与 `headless` 只是在基础 bundle 上增加不同入口。[架构：Profile 与 Bundle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.zh.md#L15-L35)

Agent Preset 则是会话级能力组合：其插件常驻挂载一次，通过作用域父链让多个会话共享插件实例但分离 Session/Agent 状态；解析优先级为 `agent → preset → global`。[Preset 作用域模型](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/agent-presets/README.zh.md#L5-L7) 官方随附四种 preset；产品页称它们为标准模式、PTC 模式、极简模式和创造模式。[官方产品页](https://www.deepseek.com/harness/)

插件并不是随便放进列表就结束。官方架构要求可替换能力形成一条完整 seam：**Service Definition（接口）+ Service Provider（实现）+ Consumer（通常是模型工具）**；事件用于拦截和观察运行过程。[能力 seam](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.zh.md#L103-L108) 这比“所有模块都有一个 `Plugin` 接口”更值得借鉴。

## 对个人长期 Agent 的可借鉴点

### 1. 把“产品入口”和“Agent 能力”分开

聊天 UI、定时/事件触发、通知推送应是不同入口或组装层；它们调用同一个 Agent Runtime，而不是各自实现一套 Agent。可以对应 DeepSeek Harness 的 profile/bundle 思路：

```text
Personal Agent Runtime
  ├─ chat surface bundle
  ├─ proactive trigger + notification bundle
  ├─ headless evaluation bundle
  └─ future integrations (CLI / mobile / IM / browser)
```

这样主动推送不是“聊天的附属按钮”，聊天也不是整个项目本体。

### 2. 用能力契约组织插件，而非按页面或功能名拆插件

建议优先定义稳定契约：`ModelProvider`、`MemoryStore`、`UserModel`、`SourceConnector`、`Retriever`、`Planner/AgentLoop`、`ToolRegistry`、`Scheduler`、`NotificationChannel`、`Policy`、`EventLog`、`Surface`。每项能力允许多个 provider，业务插件依赖接口而不是具体实现。这对应 Cordis 的 Context + inject，以及 DSH 的 definition/provider/consumer seam。

### 3. 配置组装应是一等对象

需要有可版本化、可审计的 `AgentDefinition` / `Preset`，描述 persona、模型策略、工具、记忆策略、触发器和权限，而不是在代码中硬编码一个万能 Agent。组装变更必须有稳定 id、schema validation、依赖检查、dry-run 和可回滚更新；Cordis 的稳定 entry id、pending 依赖与可逆 effect 正好说明这些机制为什么重要。[组合与 HMR](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/06-composition-and-hmr.zh.md#L9-L25)

### 4. 长期使用首先需要可重放的事件事实

DeepSeek Harness 把模型可见内容建立在 append-only session event log 上，恢复、fork、回放、遥测和持久化都从同一事件流派生，并要求“模型可见即已记录”。[会话日志](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.zh.md#L96-L101) 对个人长期 Agent，可借鉴为：用户输入、来源抓取、记忆写入、推送候选、排序理由、实际通知、用户反馈和工具副作用都产生结构化事件，以支持解释、纠错、离线评测和数据迁移。

### 5. 插件生命周期与隔离必须可测试

主动推送会引入长期运行的定时器、订阅、网络连接和后台任务。插件卸载后必须撤销监听、取消任务并释放资源；同名 provider 在不同 Agent 组合中还需要 scope/realm 隔离。Cordis 的 reversible effects 与 `isolate` 机制可以借鉴，哪怕最终不直接采用 Cordis。[effect/disposer](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.zh.md#L9-L13) · [group/isolate](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/06-composition-and-hmr.zh.md#L19-L25)

## 不可直接类比或照抄的部分

1. **DeepSeek Harness 当前是编码 Agent 产品，不是个人长期智能体。** 它的随附 preset、工具、安全边界和会话模型主要围绕 coding agent；个人 Agent 还需要跨会话用户身份、长期偏好与目标、信息源同步、候选排序、打扰预算、通知送达和反馈学习。这些不是换一个聊天插件就自然得到的。
2. **主动推送不只是另一个 UI 插件。** UI/通知渠道可以是插件，但“何时主动、为什么值得打扰、如何去重、如何遵守安静时段、失败如何补偿”是一条持久化工作流，需要调度、幂等、状态机、策略和事件日志共同支撑。
3. **“一切皆插件”不是目标本身。** 如果核心契约不稳定，把所有代码套上统一 `Plugin` 接口只会增加间接层。真正的价值是可替换能力、显式依赖、作用域隔离、可逆生命周期、可观察运行轨迹和可验证组合。
4. **不要把 Cordis 当成熟稳定标准照搬。** DSH 仍在 developer preview，官方明确预告破坏兼容；而且 DSH vendor 了 Cordis 并维护大量本地修补。第一版更合理的是先定义本项目最小插件协议和关键契约，再通过原型验证是否真的需要 Cordis 级的响应式依赖与 HMR。
5. **插件不能绕过权限模型。** DSH 的 preset 文档明确说明 user preset 的权限等于其引用插件的权限，`trust` 主要用于展示差异，并不自动形成安全隔离。[Preset 信任边界](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/agent-presets/README.zh.md#L133-L135) 本项目若允许第三方插件，必须另设进程/容器隔离、能力授权、secret scope 和网络/文件访问政策。

## 建议转化为本项目的架构判断

可以采纳 DeepSeek Harness 的“组装式产品”方向，但不应先复制它的包数量。一个合理的第一阶段边界是：

```text
Kernel（极小）
  Plugin lifecycle + capability registry + typed events + composition loader

Durable platform services（可替换，但首版必须有）
  Event log + identity/user model + scheduler + policy/permissions + secrets

Agent capabilities（插件）
  Model + loop + tools + memory + source connectors + ranking + notification

Assemblies
  conversational-agent + proactive-agent + evaluation-runner
```

这里“聊天”和“主动推送”确实是上层分支，但它们会共享同一个长期用户模型、事件日志、权限与评测基础设施。下一步设计时最需要先回答的，不是选哪一个 UI，而是：**插件组合的单位究竟是整套产品、一个 Agent preset，还是单项 provider；哪些状态必须跨组合长期存在；第三方插件拥有哪些权限。**

## 一级来源索引

- [DeepSeek Harness 官方产品页](https://www.deepseek.com/harness/)
- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness 官方架构文档（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.zh.md)
- [DeepSeek Harness Cordis 入门（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.zh.md)
- [DeepSeek Harness Agent Preset 文档（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/agent-presets/README.zh.md)
- [Cordis 官方仓库](https://github.com/cordiverse/cordis)
- [Cordis 官方论文仓库（固定提交）](https://github.com/cordiverse/paper/tree/948a07b369c62adb3b12e102458be5c18dfb69b9)
