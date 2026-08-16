# Use three-level composition

The harness will distinguish Plugins, Agent Definitions, and Product Assemblies instead of representing every feature as a flat plugin. These levels have different lifetimes, state scopes, and reasons to change: plugins provide replaceable capabilities, Agent Definitions combine behavior and permissions, and Product Assemblies form runnable user experiences. This preserves extensibility without confusing a capability provider with an Agent or a complete product.
