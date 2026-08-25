"""Named timing policy for server-side lipsync.

The browser samples the cue timeline from an epoch supplied by its adapter. The
Pipecat adapter uses ``botStartedSpeaking`` — an output-lifecycle signal, not a
browser device-playout clock. These values govern only prediction, recognition
stability, and wire-track cleanup; none is a network-latency budget.
"""

# Fast text cues are intentionally early to favour a small visual lead over a
# visibly late predicted mouth. The browser adds no independent cue-clock lead.
PREDICTED_CUE_LEAD_MS = 60

# Accurate cues stop this far before the decoder's fed edge, where future audio
# can still revise their recognition without a visible correction twitch.
ACCURATE_CUE_HOLD_BACK_MS = 100

# A cue held for less than this is visual flutter, not speech information.
MIN_VISIBLE_CUE_MS = 30

# Stop spending CPU on a decoder that cannot catch up. Both the duration floor
# and realtime ratio are necessary to avoid latching on a turn's first frame.
ACCURATE_CUE_LATCH_MIN_MS = 1500
ACCURATE_CUE_LATCH_RTF = 0.8
