# Studio verification layers

Avatar Studio validates one contract at a time. A control at a higher layer
must not be mistaken for a requirement of a lower layer.

| Route | User | Validates |
|---|---|---|
| `#/rig/review` | avatar author | static parameters, extremes, composites, per-rig conformance |
| `#/rig/visemes` | avatar author | individual visemes and chosen transitions |
| `#/behavior` | behavior-library developer | states, actions, state programs, and transitions across rigs |
| `#/wire` | client/backend integrator | only promoted wire commands and Pipecat factual events |
| `#/fixtures` | avatar author / integrator | checked-in audio paired with production cue/lifecycle playback |
| `#/connection` | product developer | a real Pipecat client/service end to end |

Legacy rig pages remain reference tools until the corresponding Studio route
has parity. Studio always drives production behavior and wire adapters; it
never maintains a demo-only state machine.
