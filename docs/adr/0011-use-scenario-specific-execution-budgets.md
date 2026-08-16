# Use scenario-specific Execution Budgets

The runtime will not require a global maximum Agent-loop step count. Interactive Chat runs may continue until the model stops or the user cancels, while unattended Push, scheduled, and Evaluation runs must have finite wall-clock, token or cost, retry, and external-side-effect budgets; a model-turn limit is an optional additional fuse. Budget exhaustion checkpoints the Run as resumable `budget_exhausted`, and controlled comparisons apply equivalent budgets to every Agent Loop.
