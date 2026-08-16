# Allow erasure of sensitive event payloads

Append-only Agent history will not make personal data immortal. Durable event envelopes and sensitive payloads will be separable so data erasure can remove payloads, artifacts, and derived state while retaining a non-sensitive deletion fact and rebuilding affected projections. This trades perfect historical replay after erasure for user ownership, privacy, and an auditable account of what was removed.
