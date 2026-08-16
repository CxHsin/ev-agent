# Separate state ownership from plugin lifetime

User, Agent, and Session state will be owned by their domain scopes rather than by plugin instances. Plugins may provide storage and behavior for that state, but unloading or replacing a plugin must not implicitly erase or transfer ownership of long-lived personal data. This allows capabilities and product assemblies to change without breaking the continuity expected from a personal Agent.
