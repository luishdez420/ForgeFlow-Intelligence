# Initial Data Model

| Entity                           | Purpose                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `company`                        | Canonical company/ticker identity and normalized metadata.                                  |
| `workflow_run`                   | One durable analysis request and its terminal outcome.                                      |
| `workflow_task` / `task_attempt` | A DAG node, lease state, retries, and immutable execution history.                          |
| `worker`                         | Worker identity, capability metadata, and heartbeat.                                        |
| `source` / `document`            | Origin, provider, URL, retrieval time, content hash, and content context.                   |
| `fact`                           | A normalized retrieved assertion linked to its source; contradictions remain separate rows. |
| `financial_metric`               | Deterministic result, formula version, inputs, and source provenance.                       |
| `report` / `report_item`         | Published output with explicit item kind and source references.                             |
| `agent_run` / `tool_call`        | Bounded AI execution audit trail, not authoritative financial data.                         |

All mutable lifecycle entities include stable identifiers, creation/update
timestamps, and state-transition audit fields. Lease tokens and secrets are
operational data and are never part of public report or workflow responses.
