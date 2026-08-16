# Separate Runtime Events from Agent Events

Cordis-style Runtime Events will coordinate plugins within a running process, while durable Agent Events will record externally meaningful facts through the Durability module. Callers will not dual-write storage and the runtime event bus themselves; persistence, projection, and follow-up scheduling must be coordinated behind the durable interface. This avoids treating an in-memory event bus as a recovery mechanism and removes crash windows from every caller.
