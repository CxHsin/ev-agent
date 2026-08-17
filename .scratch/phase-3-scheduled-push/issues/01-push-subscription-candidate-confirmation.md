# 01 — Push Subscription Candidate 与显式确认

**What to build:** 用户可以提交自然语言的主动推送需求，查看解析后的内容范围、信息源、时间、时区、渠道、条数上限、过滤条件和有效期，并通过版本绑定的显式确认将 Candidate 激活为 Push Subscription；拒绝、编辑、暂停、恢复和撤销都保留可解释的 durable 状态。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Candidate 与 active Push Subscription 是分离的 durable state，pending Candidate 不产生 delivery authority
- [ ] confirmation 只接受当前 Candidate revision 和 scope fingerprint，成功后原子创建 active subscription
- [ ] natural-language parser 在无网络测试中生成可审阅的结构化字段，并拒绝无效 scope、schedule、channel 或 validity
- [ ] API 和 React surface 覆盖 review、confirm、reject、pause、resume、revoke，并显示 active/pending 状态
- [ ] 不论模型输出、Chat 行为或 Interaction Signal 如何变化，均不能自动激活或扩大 subscription
