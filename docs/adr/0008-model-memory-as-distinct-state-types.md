# Model memory as distinct state types

The personal Agent will distinguish episodic, semantic, procedural, and working state instead of exposing one undifferentiated memory store. These types have different ownership, write validation, conflict, retrieval, retention, and evaluation rules; vector search may implement part of retrieval but does not define the memory model. Memory retrieval returns structured evidence with provenance rather than a preassembled prompt string.
