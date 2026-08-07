# textsync — mouth shapes from text, without audio

Server-side experiment. the avatar client takes a stream of Rhubarb A–H+X letters
(see the root `README.md` for the protocol); this is about where those letters
come from when the audio is being synthesised in real time and does not exist
yet.

Nothing here ships in the widget. It belongs beside a TTS service, as a sidecar
to its synthesis stream.

## The problem

Rhubarb needs the whole clip before it emits anything, so the naive sidecar adds
its full runtime to TTFA. Measured natively on arm64 (the shipped macOS release
is x86 and runs under Rosetta at ~2.6x the cost):

| | fixed floor | short clip |
|---|---|---|
| `phonetic` | 159 ms | 172 ms |
| `pocketSphinx` | 323 ms | 496 ms |

Process spawn is only 32 ms of that. The rest is `ps_init()` against the 82 MB
acoustic model.

## The seam

`rhubarbLib.cpp` is two steps, and only the first one needs audio:

```cpp
phones = recognizer.recognizePhones(audioClip, ...);   // needs audio
shapes = animate(phones, targetShapeSet);              // does NOT
```

Everything Rhubarb knows about *looking right* — co-articulation, tweening,
pause handling, static-segment cleanup — lives in `animate()`, a pure function of
a phone timeline. Recognition exists only to *discover* that timeline.

Some neural TTS engines size a duration canvas before generating and then fill
it, so the sentence's duration is known up front — before a single sample of
audio exists. That is enough to **predict** the phone timeline
instead of recognising it:

```
text -> tokenizeText() -> cmudict / wordToPhones() -> weighted timeline
     -> Rhubarb's own animate() -> A-H+X cues
```

No acoustic model. No audio. No recognition.

## Results

300 clips stratified by duration from a phrase cache holding real synthesised
audio *and* the text that produced it — so both paths run on identical input.
Point `PHRASE_CACHE` at your own corpus; the numbers below are from ours. Scored per 10 ms frame against `pocketSphinx -d <text>`,
Rhubarb's best mode.

The yardstick is not "is it perfect" but "how does it compare to the disagreement
between two shipping Rhubarb recognizers on the same audio":

| | exact | aperture err | open/closed |
|---|---|---|---|
| **yardstick:** `phonetic` vs `pocketSphinx` | 59.8% | 0.36 | 87.8% |
| textsync, literature-prior weights | 62.8% | 0.36 | 91.4% |
| **textsync, fitted weights + tuned gaps** | **71.3%** | **0.28** | **93.6%** |

Per-sentence compute in the resident process: **median 0.15 ms, p95 0.28 ms, max
0.40 ms.** Against 159/323 ms, TTFA impact is nil — the whole cue track can be
emitted before the first audio sample.

Cue rate (7.7/s vs pocketSphinx's 7.2/s) and shape distribution track the real
thing closely, so it is not winning by flattening the track.

### It is strongest where the brief says it matters

| clip duration | textsync | `phonetic` |
|---|---|---|
| <700 ms | **86.7%** | 64.4% |
| 700–1200 ms | **78.3%** | 61.9% |
| 1200–2000 ms | **69.5%** | 58.9% |
| 2000–3500 ms | 59.4% | 59.3% |

Interjections and short first sentences are where it is best; error accumulates
over long utterances until it reaches parity. That is the opposite of the latency
problem's shape, which is the fortunate part — long sentences are exactly the
ones with time to run real recognition during earlier playout.

### Duration accuracy is the whole ballgame

Feeding textsync a wrong duration, scored against the true timeline:

| duration error | exact | aperture err |
|---|---|---|
| −20% | 48.0% | 0.56 |
| −10% | 57.5% | 0.45 |
| −5% | 66.4% | 0.34 |
| **0** | **71.3%** | **0.28** |
| +5% | 61.6% | 0.40 |
| +10% | 50.5% | 0.52 |
| +20% | 35.8% | 0.68 |

This is survivable only because the canvas *is* the duration rather than a guess
about it. Anything that decouples them — the `SpokenDurationCorrector` speed
path, inserted trailing pauses — has to be reflected in the number handed to
textsync, or the track drifts.

### Warm decoder pool

Upstream builds the decoder `ObjectPool` per call, which is right for a CLI that
runs once and exits and wrong for a resident service. `RHUBARB_WARM_POOL=1`
caches it, keyed on (recognizer, dialog). Measured with `residentbench`:

| | cold | warm steady-state |
|---|---|---|
| `phonetic` | 181 ms | **31 ms** (5.8x) |
| `pocketSphinx`, no dialog | 789 ms | 532 ms (1.5x) |

Caveat that follows from the design rather than the measurement: with `-d`, the
dialog is compiled into the language model, so a distinct sentence is a cache
miss *by construction* and the warm pool buys nothing in the mode you would
actually want. Fixing that means swapping only the LM on a live decoder — real
surgery inside `PocketSphinxRecognizer`, and not worth it at 0.15 ms vs 31 ms.

## Two findings worth not re-deriving

**Measured phone durations are much flatter than the literature prior.** Fitted
over 5297 aligned phones: 0.53–1.90, against the prior's 0.45–1.45. Stops are
nowhere near as short relative to vowels as textbooks imply, because the aligner
attributes the closure to the preceding segment. Worth ~3 points.

**Inserting silence at word boundaries makes agreement worse.** `animate()`
already opens the mouth between words via its own pause handling, so an explicit
gap double-counts and the mouth stutters shut mid-phrase. `wordGapMs` defaults to
0, and that was measured, not assumed.

## Known limits

These are the reasons this is `experiments/` and not a shipped component:

- **Drift.** Error accumulates across a sentence; parity with `phonetic` by 2 s.
- **Per-voice tuning.** The fitted weights come from a single voice. A voice
  with a different speaking rate or rhythm needs its own table, and the fit is
  currently global rather than per-voice.
- **Emotion.** Injected emotion changes timing in ways a static per-phone weight
  table cannot represent at all.

## Building

The patch applies to a pristine `rhubarb-lip-sync` 1.14.0 source tree.

```sh
tar xzf rhubarb-lip-sync-1.14.0-source.tar.gz
cd rhubarb-lip-sync-1.14.0
patch -p1 < .../upstream-1.14.0.patch
mkdir -p rhubarb/src/textsync && cp .../src/*.cpp rhubarb/src/textsync/
cmake -B build -DCMAKE_POLICY_VERSION_MINIMUM=3.5 .   # 1.14.0 predates CMake 4
cmake --build build --target textsync residentbench -j8
cp -R rhubarb/res build/          # cmudict lives here
```

Build natively. The published macOS binary is x86_64 and costs ~2.6x under
Rosetta.

## Running

Resident by construction — one request per stdin line, one JSON object out:

```sh
$ ./textsync --weights phone_weights.json
{"ready":true,"dict_entries":125945,"load_ms":83}
2400	Hello, thanks for joining. Can you tell me about yourself?
{"ms":2400,"compute_ms":0.79,"cues":[{"t":0,"v":"X"},{"t":40,"v":"C"},...]}
```

Knobs: `--weights`, `--lead`, `--trail`, `--trail-frac`, `--word-gap`,
`--basic-shapes`, `--dict`.

## Reproducing

```sh
export PHRASE_CACHE=/path/to/your/corpus   # {text, audio} pairs; see tools/groundtruth.py
python3 tools/groundtruth.py 300   # real Rhubarb over the phrase cache -> groundtruth.json
python3 tools/fit.py               # phone timelines -> phone_weights.json
python3 tools/eval.py --sweep      # score, and sweep the gap knobs
```

`groundtruth.json` is not committed — it is a derivative of whatever corpus you
point `PHRASE_CACHE` at, so regenerating it is the first step, not an optional
one. It takes a few minutes.

## Related reading: sl-web-speech

The 2026-08 motion review pointed at `lipzGenerationUtil.ts` in
**sl-web-speech** (github.com/erikh2000, MIT), which solves this same
text-to-viseme problem in ~50 lines with no acoustic model. Four techniques in
it that this experiment does not have, worth weighing before the design lands
beside a TTS service:

1. **Consonant-cluster consolidation** — a run of consonants collapses to its
   single most expressive member, and the cluster may span a word boundary if
   the gap is under 10 ms ("str" is one shape in fast speech, not three).
2. **A punctuation→pause table** — `.` 500 ms, `,` 200, `;` 300, `:` 400,
   `?` 500, `!` 600. Our `--word-gap` knob is flat; punctuation isn't consulted.
3. **Word duration from the phonetic dictionary** — `phonemeCount × 90 ms`,
   with a length-based fallback for out-of-vocabulary words.
4. **A "squished" rule** — when a word is too short for timing refinement to
   help, abandon refinement and space its phonemes evenly. A degradation path
   for fast speech that is easy to forget.

It also scores visemes for *salience* (its F/V and L shapes rank highest —
the shapes a lip-reader cannot mistake) and keeps the most salient letter on a
collision, where we keep arrival order plus an A/G special case
(`src/visemes.js normalizeCues`). Measured against our shipped cue tracks the
collision rate is 8 in 1,213 gaps, so client-side this is minor — but a
generator emitting denser cues than Rhubarb's would raise the stakes.
