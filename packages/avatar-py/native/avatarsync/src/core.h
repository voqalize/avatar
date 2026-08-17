// avatarsync core — both viseme legs as a library, with no I/O of any kind.
//
// This is the whole of what avatarsync knows, deliberately separated from how it
// is reached. Exactly one front end sits on top and holds no logic of its own:
//
//   capi.cpp   the extern "C" ABI that ctypes/cffi loads in-process. The reason
//              this file exists at all — the pipe, the base64 and the restart
//              policy behind it were all cost paid to cross a process boundary
//              that did not need crossing.
//
// There is no command-line front end here. The tool you run by hand is Python
// (`voqalize-avatar`, packages/avatar-py/src/voqalize_avatar/cli.py) and it loads this same
// library, so the thing measured on the bench is the thing that runs in the
// pipeline rather than its close relative.
//
// The seam this exploits is in rhubarbLib.cpp:
//
//     phones = recognizer.recognizePhones(clip, ...);  // needs audio
//     shapes = animate(phones, targetShapeSet);        // does NOT
//
// Everything Rhubarb knows about *looking right* — co-articulation, tweening,
// pause handling, static-segment cleanup — lives in animate(), a pure function
// of a phone timeline. Recognition only discovers that timeline. So the fast leg
// predicts one from text and a committed duration for ~0.15 ms, and the accurate
// leg recovers the real one from PCM. Same animate(), same shapes, one code path
// for everything that decides what the mouth looks like.

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "core/Phone.h"
#include "core/Shape.h"

namespace avs {

// ---------------------------------------------------------------------------
// A mouth-shape change, and the phone that caused it.
//
// `shape` is the Rhubarb A–H+X letter and is the only field the SVG faces read
// today. `phone` is the Arpabet segment that dominates this cue's interval, or
// none during silence.
//
// Carrying the phone costs nothing to produce — both legs hold a phone timeline
// and threw it away here — and it is the entire extended vocabulary. Rhubarb's
// nine shapes are a lossy projection of ~41 phones, and the loss is not spread
// evenly: shape B alone absorbs IY, IH, T, D, CH, JH, TH, DH, S, Z, SH, ZH, N
// and Y (animationRules.cpp, getShapeSets). A renderer with a mouth for "tongue
// between the teeth" cannot ask for it from `shape` and can from `phone`.
//
// This is additive on purpose. Extending the Shape enum instead would mean
// re-deriving the tween table, the pause rules and the static-segment cleanup —
// the perceptually load-bearing code — to add distinctions we cannot yet see,
// on faces whose ink moves in whole units. Ship the data, look at it, then
// decide whether TH earns its own drawing.
// ---------------------------------------------------------------------------
struct Cue {
	int32_t tMs = 0;
	Shape shape = Shape::X;
	// Index into Phone, or -1 for silence. Not boost::optional: this struct is
	// memcpy'd across the C ABI.
	int8_t phone = -1;
};

// ---------------------------------------------------------------------------
// Fast-leg timeline shaping. See buildTimeline() in core.cpp for why each of
// these exists; all four were measured, not assumed.
// ---------------------------------------------------------------------------
struct Options {
	int leadMs = 30;
	int trailMs = 280;
	double trailFrac = 0.45;
	int wordGapMs = 0;
};

struct Config {
	// Directory holding sphinx/. Both legs need it: the fast leg for
	// cmudict-en-us.dict, the accurate leg for the acoustic model.
	std::string resDir = "res";
	// Defaults to <resDir>/sphinx/cmudict-en-us.dict.
	std::string dictPath;
	// Fitted phone durations. Empty keeps the literature prior.
	std::string weightsPath;
	Options options;
	// What the mouth does while nobody is articulating. Silence this long or
	// longer closes it, overriding Rhubarb's own 350 ms threshold, and a breath
	// or lip smack stops being animated as a syllable. See restPauses() and
	// dropNonSpeech() in core.cpp for why Rhubarb's answers are wrong here — both
	// are right for a cartoon over pre-recorded dialogue and wrong for a face
	// that is on screen for the whole call.
	//
	// One setting for both because they are one perceptual decision, and because
	// 0 has to mean Rhubarb *exactly*: it is the control the A/B on
	// demo/rig/lipsync-review.html compares against, and a baseline that is only
	// nearly stock gives every difference two possible causes.
	int pauseRestMs = 150;
	// G/H on top of A–F. Off gives the six basic shapes only.
	bool extendedShapes = true;
	// How many decoders to build at open(), rather than on a live sentence. This
	// is a count and not a flag because the pool builds one decoder per
	// *concurrent* caller: set it to the number of threads that will call
	// audioCues() at once, or the second of them pays ps_init() mid-call.
	int warmupDecoders = 1;
	// The hard ceiling on live streams, and therefore on memory. A decoder is
	// ~55 MB of acoustic model — means and variances are ckd_calloc'd per decoder
	// and gauden_dist_precompute() mutates the variances at init, so there is
	// nothing to share and no mmap trick to recover — and a stream holds one for
	// the length of a *turn*, seconds rather than the ~30 ms an utterance decode
	// takes. Left uncapped that is unbounded resident memory in the shape of a
	// bounded-looking pool.
	//
	// Sizing: concurrent speaking turns is Binomial(calls, duty), so
	// ceil(N*d + 2.33*sqrt(N*d*(1-d))) covers ~99% of moments. The remaining 1%
	// is not an error — openStream() returns nothing and the caller falls back to
	// the fast leg, which is at its best on exactly the short turns most likely
	// to be refused.
	int maxStreams = 4;
};

class Lexicon;
class Engine;

// ---------------------------------------------------------------------------
// One live decode, fed as the audio arrives.
//
// This is the whole accurate leg now. The batch entry point decodes an utterance
// that has already finished, which is a shape a voice call never has: the avatar
// has to move its mouth while the audio is playing, not after. A Stream feeds
// pocketsphinx incrementally and reads the partial segmentation back out
// mid-utterance, which allphone_search_seg_iter() supports because it backtraces
// from the current frame rather than from a completed lattice.
//
// The cost of that is the cepstral mean. Batch CMN computes the mean from the
// whole utterance; a stream has to start from a guessed one and converge. That
// is worth about 25 points of frame agreement against a batch decode of the same
// audio, and it never converges all the way. It is also, measured on the
// production voice and reviewed by eye, not visible: the residual is B/C/F
// confusions between adjacent mouth openings, which is precisely what a line
// face cannot draw.
//
// What a Stream does NOT do is decide when its cues are good enough to show.
// cues() takes the hold-back and the caller's last published position, because
// the tradeoff between churn and lag belongs to whoever knows how far ahead of
// the playhead the client already is.
// ---------------------------------------------------------------------------
class Stream {
public:
	~Stream();

	Stream(const Stream&) = delete;
	Stream& operator=(const Stream&) = delete;

	// Append audio at the rate this stream was opened with. Cheap and
	// incremental: resampling to 16 kHz reads only the samples that became
	// complete, which is exact rather than approximate because Rhubarb's
	// resampler is a box-filter mean over a half-open window with no filter tail
	// (SampleRateConverter.cpp) — so a growing buffer read incrementally is
	// bit-identical to the whole clip resampled at once.
	void feed(const int16_t* pcm, size_t sampleCount);

	// The timeline as it stands, from fromMs onward, ending holdBackMs before the
	// live edge. Safe to call after any feed().
	//
	// holdBackMs trades churn for lag. Measured on the corpus at 10 ms
	// granularity, a segment stops moving within 100 ms of the edge 85.2% of the
	// time, 200 ms 98.2%, 300 ms 99.6%. The churn that remains is not a defect to
	// be avoided so much as one to be overwritten: the wire primitive is "discard
	// from fromMs, then append", so a corrected cue costs nothing but the frames
	// already drawn.
	std::vector<Cue> cues(int fromMs, int holdBackMs);

	// Everything to the true end, no hold-back. Ends the utterance, so feed() and
	// cues() must not be called afterwards.
	std::vector<Cue> finish();

	// Milliseconds of audio fed so far, at the source rate.
	int edgeMs() const;

private:
	friend class Engine;
	struct Impl;
	explicit Stream(std::unique_ptr<Impl> impl);
	std::unique_ptr<Impl> impl_;
};

// ---------------------------------------------------------------------------
// One engine per process is the intended shape: it owns the 125k-entry cmudict
// and sits in front of a decoder pool holding the 52 MB acoustic model, so a
// second instance doubles the resident cost for nothing.
//
// Both cue methods are const and safe to call concurrently from several threads.
// That is the point of the whole exercise — ctypes and cffi release the GIL for
// the duration of a foreign call, so `await asyncio.to_thread(engine.audio_cues,
// ...)` genuinely runs the decoder off the event loop with no bookkeeping.
// textCues() touches only immutable state; audioCues() takes a decoder from the
// pool, which is per-caller, so two decodes genuinely overlap — measured at 2x
// the CPU for 1.02x the wall clock. The pool's mutex is held only around the
// handout, never across a decode.
// ---------------------------------------------------------------------------
class Engine {
public:
	// Throws std::runtime_error if the dictionary or weights cannot be read.
	explicit Engine(const Config& config);
	~Engine();

	Engine(const Engine&) = delete;
	Engine& operator=(const Engine&) = delete;

	// The fast leg. Predicts a phone timeline spanning exactly totalMs from the
	// text and the duration the caller has committed to, then animates it. No
	// audio, no acoustic model, ~0.15 ms.
	std::vector<Cue> textCues(const std::string& text, int totalMs) const;

	// The accurate leg. Real `phonetic` recognition over interleaved-free mono
	// PCM. Takes int16 because that is what comes off the TTS wire — converting
	// to float in the caller only to convert back is the kind of cost that
	// justified a subprocess in the first place.
	std::vector<Cue> audioCues(const int16_t* pcm, size_t sampleCount, int sampleRate) const;

	// Open a live decode at the given source rate. Returns nullptr when the pool
	// is at maxStreams — a refusal, not an error, and the caller is expected to
	// fall back to textCues() for that turn rather than wait. Nothing else in
	// this API can fail for a reason the caller should handle differently.
	//
	// Rejects rates below 16 kHz: the resampler cannot upsample and says so by
	// throwing, which is a worse way to find out.
	std::unique_ptr<Stream> openStream(int sampleRate) const;

	// Live streams right now, and the ceiling from Config::maxStreams.
	int liveStreams() const;
	int maxStreams() const;

	size_t dictEntryCount() const;
	double loadMs() const { return loadMs_; }
	double warmupMs() const { return warmupMs_; }

private:
	// A Stream holds a decoder borrowed from the engine's pool and hands it back
	// in its destructor, so it needs to reach the pool without the pool becoming
	// part of anyone else's vocabulary.
	friend class Stream;
	struct Impl;
	std::unique_ptr<Impl> impl_;
	double loadMs_ = 0;
	double warmupMs_ = 0;
};

// Stable names for the ABI, so a binding can build its lookup tables once at
// import rather than hard-coding an enum order that lives in another repo.
const char* shapeName(Shape shape);
const char* phoneName(int8_t phone);
int shapeCount();
int phoneCount();

}  // namespace avs
