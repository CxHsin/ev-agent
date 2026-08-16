# Validate Memory Candidates before commit

Models may propose Memory Candidates but cannot directly persist arbitrary text as long-term truth. The Memory module validates schema, provenance, duplication, conflict, scope, and policy before committing a Claim or other durable state, and records rejected candidates as well as accepted ones. This adds write-path complexity in exchange for preventing untraceable model guesses from silently becoming the user's identity or history.
