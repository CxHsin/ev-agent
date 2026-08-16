# Personal Agent Harness

面向单个用户长期运行、通过能力组合形成不同个人 Agent 产品形态的领域。

## Language

**个人 Agent**:
服务于一个确定用户、能够跨时间延续对该用户了解的交互主体。
_Avoid_: 万能助手、聊天机器人

**个人 Agent Harness**:
装载、组合并运行多种个人 Agent 形态的长期宿主；自身不规定聊天、推送等具体产品行为。
_Avoid_: 个人 Agent、聊天后端

**能力契约**:
个人 Agent Harness 中某类可替换能力的稳定边界，一个契约可以由不同插件提供。
_Avoid_: 插件接口、服务实现

**插件**:
提供一个或多个能力、并声明自身依赖和生命周期的可装载单元。
_Avoid_: 功能、产品、Agent

**Agent Definition**:
对一种个人 Agent 的目标、能力、策略与权限边界所作的可版本化组合。
_Avoid_: Agent 插件、Prompt

**Product Assembly**:
把入口、Agent Definition、交付渠道及共享服务组合成可运行产品形态的定义。
_Avoid_: 插件、页面、Agent

**共享平台状态**:
由个人 Agent Harness 长期持有、能够被多个 Agent Definition 和 Product Assembly 连续使用的数据。
_Avoid_: 会话状态、插件缓存

**用户状态**:
属于用户本人、可被其授权的多个 Agent 长期使用的目标、偏好、信息源和授权记录。
_Avoid_: Agent 记忆、会话上下文

**Agent 状态**:
属于一个 Agent Definition、跨多次运行延续且不与其他 Agent 共享的状态。
_Avoid_: 用户状态、插件状态

**Session**:
用户或系统发起的一段有明确起止边界的 Agent 交互或执行过程。
_Avoid_: 对话、Agent 状态

**Run**:
一个 Agent Definition 为完成一次目标而进行的可暂停、恢复并产生结果的执行实例。
_Avoid_: Session、进程、模型调用

**ExecutionBudget**:
对一个 Run 可使用的时间、模型资源、重试和外部副作用所作的组合限制。
_Avoid_: 最大步数、费用上限

**Agent Event**:
一次 Agent 运行中已经发生、可用于解释和重建行为的结构化事实。
_Avoid_: 日志消息、当前状态

**Runtime Event**:
个人 Agent Harness 当前进程中用于协调插件的瞬时信号，不构成可恢复的历史事实。
_Avoid_: Agent Event、通知

**持久任务**:
需要跨插件重载或宿主重启继续履行的一次延后或周期性工作承诺。
_Avoid_: 定时器、后台线程

**权限授权**:
用户允许某个插件在限定资源范围内使用一项能力的明确决定。
_Avoid_: 插件权限、系统权限

**外部副作用**:
个人 Agent 对 Harness 之外的系统或他人造成的可观察状态变化。
_Avoid_: 工具调用、Agent Event

**SecretRef**:
指向一项受控凭据的非敏感引用，本身不包含凭据内容。
_Avoid_: API Key、环境变量

**数据擦除**:
在保留最小非敏感审计事实的同时，移除指定个人数据及其派生内容的操作。
_Avoid_: 删除事件、清空数据库

**信息源**:
用户明确提供或订阅、允许个人 Agent 持续读取的一组外部信息。
_Avoid_: 全网信息、上下文

**用户模型**:
个人 Agent 对用户目标、偏好、约束及当前关注事项的可更新表达。
_Avoid_: 用户画像、记忆库

**Claim**:
用户模型或长期状态中一项带有来源、有效时间、作用域和可信程度的陈述。
_Avoid_: 用户标签、事实字符串

**Explicit Claim**:
由用户明确表达或确认的 Claim。
_Avoid_: 用户偏好、系统推断

**Inferred Claim**:
个人 Agent 根据行为或其他证据推断、尚未被用户明确确认的 Claim。
_Avoid_: 用户事实、Explicit Claim

**Memory Candidate**:
等待 Memory Module 验证、去重、定域并决定是否接纳的一项长期状态建议。
_Avoid_: Memory、Claim

**Evidence Bundle**:
针对一次 Agent 任务检索出的结构化证据集合，保留每项证据的来源和适用信息。
_Avoid_: Prompt、搜索结果

**主动推送**:
由个人 Agent 在用户明确创建的推送订阅范围内发起的一次交互。
_Avoid_: 通知、内容推荐

**推送订阅**:
用户对内容范围、执行时机和交付方式作出的持续推送授权。
_Avoid_: 定时任务、关注主题

**Push Subscription Candidate**:
由用户输入或个人 Agent 建议形成、等待用户确认的推送订阅草案。
_Avoid_: 推送订阅、推送任务

**Interaction Signal**:
一次用户交互对其兴趣、目标或偏好可能提供的带来源证据。
_Avoid_: 用户偏好、反馈标签
