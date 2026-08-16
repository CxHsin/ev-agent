# Use SQLite for the single-node runtime

The first runtime will use SQLite in WAL mode for durable state and a content-addressed file area for large artifacts. Local desktop and private-server deployments share this single-node model; tests use real temporary SQLite databases. PostgreSQL and distributed scheduling are deliberately deferred until concurrent writers or multiple execution nodes become a measured requirement.
