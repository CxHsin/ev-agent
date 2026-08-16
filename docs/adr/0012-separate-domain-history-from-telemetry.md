# Separate domain history from telemetry

Agent Events, OpenTelemetry traces, metrics, and debug logs will remain distinct records linked by Run, event, and trace identifiers. Agent Events explain durable domain history; traces explain call flow; metrics aggregate operational behavior; logs diagnose implementations. They have different schemas, retention, and redaction rules, so none will be used as a lossy substitute for another.
