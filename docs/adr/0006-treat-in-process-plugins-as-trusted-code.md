# Treat in-process plugins as trusted code

The first runtime will execute explicitly installed TypeScript plugins in process for composability and low operational cost. Capability grants constrain cooperative plugins through platform interfaces and provide policy and audit evidence, but they are not a sandbox against malicious Node.js code. Untrusted plugins will require a future process or container isolation model and will not be claimed as supported by the initial release.
