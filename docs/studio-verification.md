# Studio verification layers

Avatar Studio validates one contract at a time. A control at a higher layer
must not be mistaken for a requirement of a lower layer.

| Route | User | Validates |
|---|---|---|
| `#/rig` | avatar author | [rig contract](contract-rig.md): rest and channel extremes, composites, every viseme at full-frame and close scale, curated transitions, hand gestures, numeric conformance |
| `#/behavior` | behavior-library developer | [behavior contract](contract-behavior.md): states, actions, state programs, and how they read across rigs |
| `#/runtime` | client/backend integrator | [wire](contract-wire.md) + [lifecycle](pipecat-lifecycle-protocol.md): a deterministic trace replayed from time zero, plus the checked-in audio fixtures |
| `#/connection` | product developer | a real, host-created `PipecatClient` end to end |

Legacy rig pages under `demo/rig/` remain reference tools until the
corresponding Studio route has parity. Studio always drives the production
behavior and wire adapters; it never maintains a demo-only state machine.
