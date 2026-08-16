# Record Agent events without full Event Sourcing

The harness will append structured events for externally meaningful Agent activity and derive inspectable current state where replay is valuable. It will not require every cache, projection, or replaceable implementation detail to be event-sourced. This preserves recovery, explanation, auditing, and evaluation while avoiding the operational cost of making the entire application depend exclusively on event replay.
