#include "core.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <sstream>
#include <cstdio>
#include <stdexcept>
#include <thread>
#include <unordered_map>

#include "animation/mouthAnimation.h"
#include "audio/AudioClip.h"
#include "audio/SampleRateConverter.h"
#include "audio/processing.h"
#include "lib/rhubarbLib.h"
#include "recognition/PhoneticRecognizer.h"
#include "recognition/pocketSphinxTools.h"
// Reaching past the public ABI, for exactly one thing: resetting the cepstral
// mean when a pooled decoder is handed to a new stream. ps_start_stream() rewinds
// the frame counter and the noise stats but not the mean — cmn_struct lives in
// feat_t and nothing in the public API touches it — so without this a stream
// silently inherits whatever voice the previous turn was in. That is a real
// effect and possibly a beneficial one, but it is not one to acquire by
// accident: see Stream::Impl::checkout().
extern "C" {
#include <pocketsphinx_internal.h>
#include <acmod.h>
#include <sphinxbase/cmn.h>
}
#include "recognition/g2p.h"
#include "recognition/tokenization.h"
#include "time/BoundedTimeline.h"
#include "tools/progress.h"

namespace avs {
namespace {

using std::string;
using std::vector;

double sinceMs(std::chrono::steady_clock::time_point t0) {
	return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

// ---------------------------------------------------------------------------
// Relative phone durations (fast leg).
//
// Only ratios matter: the whole track is rescaled to the duration the caller
// committed to, so an error in overall speech rate cancels out. What these have
// to get right is the *proportion* — that a diphthong holds roughly four times
// as long as a stop closure, so the mouth does not arrive at the next shape
// early and sit there.
//
// This is the literature prior, kept as the fallback. The fitted table
// (Config::weightsPath, data/phone_weights.json, from real Rhubarb alignments
// over a corpus of synthesised speech) is what ships: measured English is far
// flatter than the prior — stops are nowhere near as short relative to vowels as
// textbooks imply, because the aligner attributes the closure to the preceding
// segment. Worth ~3 points of frame agreement.
// ---------------------------------------------------------------------------
double priorDuration(Phone p) {
	switch (p) {
		// Diphthongs — two targets inside one segment, so the longest things
		// in the inventory.
		case Phone::EY: case Phone::AY: case Phone::OW:
		case Phone::AW: case Phone::OY:
			return 1.45;

		// Tense/long monophthongs and the r-colored vowel.
		case Phone::IY: case Phone::UW: case Phone::AO:
		case Phone::AA: case Phone::ER: case Phone::AE:
			return 1.15;

		// Lax monophthongs.
		case Phone::EH: case Phone::IH: case Phone::UH: case Phone::AH:
			return 0.85;

		// Schwa is the shortest vowel by a wide margin — it is what English
		// reduces *to*.
		case Phone::Schwa:
			return 0.50;

		// Stops: the visible event is the closure, which is brief.
		case Phone::P: case Phone::B: case Phone::T:
		case Phone::D: case Phone::K: case Phone::G:
			return 0.45;

		// Affricates — a stop plus a fricative release.
		case Phone::CH: case Phone::JH:
			return 0.80;

		// Sibilants hold noticeably longer than other fricatives.
		case Phone::S: case Phone::Z: case Phone::SH: case Phone::ZH:
			return 0.90;

		case Phone::F: case Phone::V: case Phone::TH: case Phone::DH:
			return 0.70;

		case Phone::HH:
			return 0.55;

		case Phone::M: case Phone::N: case Phone::NG:
			return 0.65;

		case Phone::L: case Phone::R:
			return 0.65;

		case Phone::Y: case Phone::W:
			return 0.55;

		default:
			return 0.70;
	}
}

// Phone has no end sentinel; Noise is its last member.
constexpr int kPhoneCount = static_cast<int>(Phone::Noise) + 1;

using WeightTable = std::array<double, kPhoneCount>;

WeightTable priorWeights() {
	WeightTable w{};
	for (int i = 0; i < kPhoneCount; ++i) w[i] = priorDuration(static_cast<Phone>(i));
	return w;
}

// Minimal reader for the flat {"PHONE": number} object fit.py writes. Rhubarb
// vendors no JSON parser and this is not worth a dependency.
void loadWeights(const string& path, WeightTable& weights) {
	std::ifstream in(path);
	if (!in) throw std::runtime_error("cannot open weights: " + path);
	std::ostringstream buf;
	buf << in.rdbuf();
	const string s = buf.str();
	size_t i = 0;
	while ((i = s.find('"', i)) != string::npos) {
		const size_t j = s.find('"', i + 1);
		if (j == string::npos) break;
		const string name = s.substr(i + 1, j - i - 1);
		const size_t colon = s.find(':', j);
		if (colon == string::npos) break;
		const double value = std::strtod(s.c_str() + colon + 1, nullptr);
		if (const auto p = PhoneConverter::get().tryParse(name)) {
			if (value > 0) weights[static_cast<int>(*p)] = value;
		}
		i = colon + 1;
	}
}

// ---------------------------------------------------------------------------
// An AudioClip over samples we already hold.
//
// The accurate leg is fed PCM straight off the TTS wire, so writing a temp wav
// just to hand Rhubarb a path would add two syscalls and a filesystem to the
// latency path for nothing. clone() shares the buffer: Rhubarb clones a clip per
// utterance and per effect in the recognition chain, and copying a few hundred
// kilobytes each time would show up in the 31 ms.
//
// int16 is stored rather than float because that is the wire encoding; the
// division happens once per read in the same cache line it would anyway.
// ---------------------------------------------------------------------------
class MemoryAudioClip : public AudioClip {
public:
	MemoryAudioClip(std::shared_ptr<const vector<int16_t>> samples, int sampleRate)
		: samples_(std::move(samples)), sampleRate_(sampleRate) {}

	std::unique_ptr<AudioClip> clone() const override {
		return std::make_unique<MemoryAudioClip>(samples_, sampleRate_);
	}
	int getSampleRate() const override { return sampleRate_; }
	size_type size() const override { return static_cast<size_type>(samples_->size()); }

private:
	SampleReader createUnsafeSampleReader() const override {
		auto samples = samples_;
		return [samples](size_type index) {
			return static_cast<float>((*samples)[static_cast<size_t>(index)]) / 32768.0f;
		};
	}

	std::shared_ptr<const vector<int16_t>> samples_;
	int sampleRate_;
};

// ---------------------------------------------------------------------------
// Bring the mouth to rest in the pauses.
//
// Rhubarb closes the mouth only for pauses longer than 350 ms; below that
// getPauseShape() holds the previous shape (<120 ms) or applies one relax()
// step (120-350 ms), and one step from an open vowel lands on another open
// vowel — E and D both relax to C. Correct for what Rhubarb animates: a cartoon
// over pre-recorded dialogue, where snapping shut on every comma reads as
// fidgeting. Wrong for a talking head that is on screen continuously at 130 px,
// where conversational commas are 150-300 ms and land squarely in the band that
// stays open. Measured on the ten review clips before this existed: 1100 ms of
// pause, mouth open for 900 ms of it. It does not read as a timing error —
// onsets are within one frame — it reads as a face that is still talking after
// the voice stopped, which is worse, because there is no offset to find.
//
// This runs on the shapes rather than the cues because animate() has already
// merged a pause into its neighbours wherever the relaxed shape happened to
// equal them: a 170 ms silence sitting inside a 470 ms run of B is invisible by
// the time you have only cues. Silences at least restMs long become X;
// everything shorter is left exactly as Rhubarb animated it, because a 200 ms
// pause under a 250 ms threshold *should* stay slightly open and relax() decides
// that better than a blanket hold would.
//
// What counts as silent differs by leg, which is why the intervals arrive as an
// argument rather than being derived here. See silentFromPhones() and
// silentFromAudio().
//
// The other half of the fix is upstream of animate(): dropNonSpeech().
// ---------------------------------------------------------------------------
using Interval = std::pair<centiseconds, centiseconds>;

bool isNonSpeech(Phone phone) {
	switch (phone) {
		case Phone::Breath:
		case Phone::Cough:
		case Phone::Smack:
		case Phone::Noise: return true;
		default: return false;
	}
}

// ---------------------------------------------------------------------------
// A breath is not an articulation.
//
// animationRules.cpp maps Breath/Cough/Smack to shape C and Noise to B, so the
// recogniser hearing a lip smack in the room tone puts an open mouth on screen
// for a syllable nobody said — plainly visible at the end of ev_22, 700 ms after
// the last word. Rhubarb is animating a cartoon and a breath there is a
// performance beat; this library renders a face that is on a call, where the
// standing rule is that the renderer never invents a mouth movement.
//
// Dropped before animate() rather than patched after it. Patching after does not
// work: the tween into the smack's C starts inside the preceding fricative, so
// overwriting the token's own span leaves the shape that led into it. Dropping
// it turns the span into an ordinary gap, and Rhubarb's own pause handling —
// which is good — takes it from there.
//
// It is also the right answer for the wire: with no segment there, zipCues emits
// no `p`, and "Smack" was never a phone a renderer could shape a mouth for.
// ---------------------------------------------------------------------------
BoundedTimeline<Phone> dropNonSpeech(const BoundedTimeline<Phone>& phones) {
	BoundedTimeline<Phone> kept(phones.getRange());
	for (const auto& timed : phones) {
		if (!isNonSpeech(timed.getValue())) kept.set(timed);
	}
	return kept;
}

// The fast leg's only evidence: where buildTimeline() left no phone. A
// non-speech token cannot appear in a predicted timeline, so the filter below is
// free, and it keeps the two derivations answering the same question.
vector<Interval> silentFromPhones(
	const BoundedTimeline<Phone>& phones, centiseconds first, centiseconds last)
{
	vector<Interval> silences;
	centiseconds cursor = first;
	for (const auto& timed : phones) {
		if (isNonSpeech(timed.getValue())) continue;
		if (timed.getStart() > cursor) silences.emplace_back(cursor, timed.getStart());
		cursor = std::max(cursor, timed.getEnd());
	}
	if (last > cursor) silences.emplace_back(cursor, last);
	return silences;
}

// The accurate leg has the samples, and they outrank the recogniser.
//
// `allphone_ci` is a free phone loop with no lexicon, so it labels every frame
// with *something*; a pause between two words routinely comes back as the
// preceding fricative held four times its real length rather than as a gap. On
// ev_22 the 170 ms pause at 5.96 s arrives inside a single 470 ms Z and is
// simply not visible in the phone timeline. Energy is not ambiguous about it.
//
// -35 dB below the clip's own peak, which on measured TTS output separates
// pauses from every in-word closure by a wide margin: the quietest in-speech
// frames of ev_22 sit at -37 dB but never for more than two frames running, and
// restMs discards those long before the threshold has to be exact. Relative to
// peak rather than absolute so a quietly-mastered clip is not read as one long
// pause.
vector<Interval> silentFromAudio(
	const int16_t* pcm, size_t sampleCount, int sampleRate, centiseconds last)
{
	const size_t perFrame = static_cast<size_t>(sampleRate) / 100;
	if (perFrame == 0) return {};
	const size_t frames = std::min(static_cast<size_t>(last.count()), sampleCount / perFrame);

	vector<double> rms(frames, 0.0);
	double peak = 0.0;
	for (size_t f = 0; f < frames; ++f) {
		double sum = 0.0;
		for (size_t i = f * perFrame; i < (f + 1) * perFrame; ++i) {
			const double s = static_cast<double>(pcm[i]);
			sum += s * s;
		}
		rms[f] = std::sqrt(sum / static_cast<double>(perFrame));
		peak = std::max(peak, rms[f]);
	}
	if (peak <= 0.0) return {{centiseconds(0), last}};

	const double floor = peak * 0.0178;  // -35 dB
	vector<Interval> silences;
	for (size_t f = 0; f < frames;) {
		if (rms[f] >= floor) {
			++f;
			continue;
		}
		const size_t start = f;
		while (f < frames && rms[f] < floor) ++f;
		silences.emplace_back(centiseconds(static_cast<int>(start)), centiseconds(static_cast<int>(f)));
	}
	// The recogniser's own timeline can end before the samples do; anything past
	// the last analysed frame is silence by construction.
	if (!silences.empty() && silences.back().second == centiseconds(static_cast<int>(frames))) {
		silences.back().second = last;
	}
	return silences;
}

JoiningContinuousTimeline<Shape> restPauses(
	JoiningContinuousTimeline<Shape> shapes,
	const vector<Interval>& silences,
	int restMs)
{
	if (restMs <= 0) return shapes;
	const centiseconds minRest(std::max(1, restMs / 10));
	const centiseconds first = shapes.getRange().getStart();
	const centiseconds last = shapes.getRange().getEnd();

	for (const auto& [rawFrom, rawTo] : silences) {
		// The audio-derived list is measured against the samples and the shape
		// track against the recogniser, and those two do not have to end on the
		// same centisecond. Setting outside the bounded range would be dropped
		// silently; clamping keeps the part that overlaps.
		const centiseconds from = std::max(rawFrom, first);
		const centiseconds to = std::min(rawTo, last);
		if (to <= from) continue;
		if (to - from < minRest) continue;  // Rhubarb's relax() keeps this one
		shapes.set(TimeRange(from, to), Shape::X);
	}

	return shapes;
}

// ---------------------------------------------------------------------------
// Zip a shape track against the phone timeline that produced it.
//
// A shape cue and a phone rarely share edges — animate() merges runs, inserts
// tweens and cleans up static segments — so point-sampling the phone timeline at
// the cue's start would attribute a cue to whatever happened to straddle its
// boundary. Maximum overlap answers the question actually being asked: which
// segment is this mouth position mostly showing.
//
// Both tracks are sorted and non-overlapping, so this is a merge, not a search:
// once a phone segment ends before the current cue starts, no later cue can want
// it either.
// ---------------------------------------------------------------------------
vector<Cue> zipCues(
	const JoiningContinuousTimeline<Shape>& shapes, const BoundedTimeline<Phone>& phones)
{
	struct Segment {
		int start;
		int end;
		Phone phone;
	};
	vector<Segment> segments;
	for (const auto& timed : phones) {
		segments.push_back({
			static_cast<int>(timed.getStart().count()),
			static_cast<int>(timed.getEnd().count()),
			timed.getValue()});
	}

	vector<Cue> cues;
	size_t first = 0;
	for (const auto& timed : shapes) {
		const int start = static_cast<int>(timed.getStart().count());
		const int end = static_cast<int>(timed.getEnd().count());

		while (first < segments.size() && segments[first].end <= start) ++first;

		int best = -1;
		int bestOverlap = 0;
		for (size_t j = first; j < segments.size() && segments[j].start < end; ++j) {
			const int overlap = std::min(end, segments[j].end) - std::max(start, segments[j].start);
			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				best = static_cast<int>(segments[j].phone);
			}
		}

		Cue cue;
		cue.tMs = start * 10;
		cue.shape = timed.getValue();
		// A rest carries no phone even when one overlaps it. restPauses() closes
		// the mouth on measured silence, and the recogniser will happily have
		// labelled that silence — a free phone loop labels every frame with
		// something, so a pause routinely arrives inside a stretched fricative.
		// The wire contract is that `p` is the segment being *articulated*, and
		// nothing is: attaching one here would tell a phone-aware renderer to
		// shape a mouth the shape track has just decided to shut.
		cue.phone = cue.shape == Shape::X ? -1 : static_cast<int8_t>(best);
		cues.push_back(cue);
	}
	return cues;
}

// ---------------------------------------------------------------------------
// Streaming decode
//
// The decoder configuration differs from the batch recognizer's in two ways, and
// both are forced rather than chosen. There is no WebRTC VAD segmentation: VAD
// finds utterance boundaries in audio it can see all of, and a stream by
// definition cannot. And there is no 3 cs padding, because there is nothing yet
// to pad into. Everything else — allphone_ci, the language weight, the beams,
// the schwa heuristic, getNoiseSounds() — is what utteranceToPhones() uses, so
// the two legs differ in what they can see and not in how they read it.
//
// `-cmn batch` is not a mistake here either. feat_cmn() flips fcb->cmn to
// CMN_LIVE permanently the moment it is handed a block that is not a whole
// utterance, so asking for batch and streaming into it lands on live CMN anyway.
// Naming "live" would differ from the batch config in a second way for no gain.
// ---------------------------------------------------------------------------
lambda_unique_ptr<cmd_ln_t> streamConfig() {
	lambda_unique_ptr<cmd_ln_t> config(
		cmd_ln_init(
			nullptr, ps_args(), true,
			"-hmm", (getSphinxModelDirectory() / "acoustic-model").u8string().c_str(),
			"-allphone", (getSphinxModelDirectory() / "en-us-phone.lm.bin").u8string().c_str(),
			"-allphone_ci", "yes",
			"-lw", "0.8",
			"-dither", "yes",
			"-remove_silence", "no",
			"-cmn", "batch",
			"-cmninit", "40,3,-1",
			"-beam", "1e-20", "-pbeam", "1e-20",
			nullptr),
		[](cmd_ln_t* c) { cmd_ln_free_r(c); });
	if (!config) throw std::runtime_error("stream: error creating configuration");
	return config;
}

// Rhubarb's float→int16 conversion, which is `inline` inside processing.cpp and
// so unreachable from here. Copied rather than approximated because the accurate
// leg's whole claim is that a streamed decode sees the same samples a batch
// decode would: a different rounding rule is a different acoustic input, and the
// difference would show up as a few frames of disagreement with no cause anyone
// could find.
int16_t toInt16Sample(float sample) {
	sample = std::max(sample, -1.0f);
	sample = std::min(sample, 1.0f);
	return static_cast<int16_t>(((sample + 1) / 2) * (INT16_MAX - INT16_MIN) + INT16_MIN);
}

// A decoder plus the cepstral mean it had when it was born. Pooled: ps_init() is
// ~150 ms and ~55 MB, and a call makes one of these per speaking turn.
struct PooledDecoder {
	lambda_unique_ptr<cmd_ln_t> config;
	lambda_unique_ptr<ps_decoder_t> decoder;
	vector<mfcc_t> pristineCmn;

	PooledDecoder() : config(streamConfig()), decoder(nullptr, [](ps_decoder_t*) {}) {
		decoder = lambda_unique_ptr<ps_decoder_t>(
			ps_init(config.get()), [](ps_decoder_t* d) { ps_free(d); });
		if (!decoder) throw std::runtime_error("stream: error creating speech decoder");
		cmn_t* cmn = decoder->acmod->fcb->cmn_struct;
		pristineCmn.assign(cmn->cmn_mean, cmn->cmn_mean + cmn->veclen);
	}

	// Put the mean back where ps_init() left it. Without this a pooled decoder
	// starts each stream from the previous turn's converged mean, which is a
	// different — and unmeasured — algorithm depending on how a pool happened to
	// hand out decoders. Carryover may well be worth having; the corpus says a
	// mean fitted from earlier audio scores better than the stock prior. It is
	// not worth having by accident, and a run whose result depends on pool order
	// cannot be A/B'd at all.
	void reset() {
		// Written out rather than cmn_live_set(), which is not the state ps_init()
		// leaves: it seeds sum with mean*CMN_WIN and nframe with CMN_WIN, i.e. a
		// prior worth 500 frames of the mean it was handed. acmod_init() sets the
		// mean from -cmninit and leaves the accumulators at zero, so that is what a
		// reset has to reproduce. (It also logs the whole vector at E_INFO twice.)
		cmn_t* cmn = decoder->acmod->fcb->cmn_struct;
		std::copy(pristineCmn.begin(), pristineCmn.end(), cmn->cmn_mean);
		std::fill(cmn->sum, cmn->sum + cmn->veclen, static_cast<mfcc_t>(0));
		cmn->nframe = 0;
	}
};

// Read the segmentation as it stands, bounded to [0, endCs).
//
// ps_seg_iter() works mid-utterance: allphone_search_seg_iter() backtraces from
// the decoder's current frame rather than from a finished lattice, so there is
// always a timeline to read. Whether the tail of it is *settled* is the caller's
// problem, and is what endCs is for.
BoundedTimeline<Phone> segmentsToPhones(ps_decoder_t* decoder, centiseconds endCs) {
	const TimeRange range(0_cs, endCs);
	BoundedTimeline<Phone> phones(range);
	for (ps_seg_t* it = ps_seg_iter(decoder); it; it = ps_seg_next(it)) {
		int firstFrame, lastFrame;
		ps_seg_frames(it, &firstFrame, &lastFrame);
		if (centiseconds(firstFrame) >= endCs) break;
		const TimeRange segment(
			centiseconds(firstFrame), std::min(centiseconds(lastFrame + 1), endCs));
		if (segment.getDuration() <= 0_cs) continue;
		Phone phone = PhoneConverter::get().parse(ps_seg_word(it));
		// PocketSphinx does not distinguish schwa from AH; length does.
		if (phone == Phone::AH && segment.getDuration() < 6_cs) phone = Phone::Schwa;
		phones.set(segment, phone);
	}
	for (const auto& noise : getNoiseSounds(range, phones)) {
		phones.set(noise.getTimeRange(), Phone::Noise);
	}
	return phones;
}

// ---------------------------------------------------------------------------
// Pronunciation dictionary
// ---------------------------------------------------------------------------
string toLower(string s) {
	for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
	return s;
}

}  // namespace

class Lexicon {
public:
	explicit Lexicon(const string& dictPath) {
		std::ifstream in(dictPath);
		if (!in) throw std::runtime_error("cannot open dictionary: " + dictPath);
		string line;
		while (std::getline(in, line)) {
			if (line.empty() || line[0] == ';') continue;
			std::istringstream ls(line);
			string word;
			ls >> word;
			if (word.empty()) continue;
			// Drop cmudict's "(2)" alternate-pronunciation marker; the first
			// pronunciation listed is the common one and that is the one we want.
			if (word.find('(') != string::npos) continue;
			vector<Phone> phones;
			string token;
			while (ls >> token) {
				if (const auto p = PhoneConverter::get().tryParse(token)) phones.push_back(*p);
			}
			if (!phones.empty()) entries_.emplace(toLower(word), std::move(phones));
		}
	}

	bool contains(const string& word) const { return entries_.count(toLower(word)) > 0; }

	// Dictionary first, rule-based G2P second. The rules are Rhubarb's own
	// fallback, so an out-of-vocabulary word degrades exactly the way it would
	// inside the real recognizer rather than in some new way.
	vector<Phone> lookup(const string& word) const {
		const auto it = entries_.find(toLower(word));
		if (it != entries_.end()) return it->second;
		return wordToPhones(toLower(word));
	}

	size_t size() const { return entries_.size(); }

private:
	std::unordered_map<string, vector<Phone>> entries_;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
struct Engine::Impl {
	Options options;
	WeightTable weights = priorWeights();
	std::unique_ptr<Lexicon> lexicon;
	ShapeSet shapeSet;
	int pauseRestMs = 0;
	PhoneticRecognizer recognizer;

	// The stream pool. Guards both the idle decoders and the live count, and is
	// held only around handout and return — never across a decode, and never
	// across ps_init(), which is 150 ms.
	int maxStreams = 4;
	mutable std::mutex streamMutex;
	mutable vector<std::unique_ptr<PooledDecoder>> idleDecoders;
	mutable int liveStreams = 0;

	double relativeDuration(Phone p) const { return weights[static_cast<int>(p)]; }

	// -----------------------------------------------------------------------
	// Phone timeline plus the audio it came from, to cues.
	//
	// Shared by the batch leg and every partial read of a stream, which is the
	// point: a streamed cue and a batch cue differ in what the recogniser could
	// see, and must not also differ in how the result is animated. Any drift here
	// would show up as a visible seam at exactly the moment the streamed timeline
	// overwrites the predicted one.
	// -----------------------------------------------------------------------
	std::vector<Cue> finishAudioCues(
		BoundedTimeline<Phone> phones,
		const int16_t* pcm,
		size_t sampleCount,
		int sampleRate) const
	{
		if (pauseRestMs > 0) phones = dropNonSpeech(phones);
		JoiningContinuousTimeline<Shape> shapes = animate(phones, shapeSet);
		// The samples, not the phone gaps. A free phone loop labels every frame
		// with something, so a pause routinely arrives as the preceding fricative
		// held four times its length rather than as a gap — and a gap with loud
		// audio in it means recognition failed there, which is not a reason to
		// close the mouth. Only the leg that has the audio gets to use it.
		const centiseconds end = shapes.getRange().getEnd();
		shapes = restPauses(
			std::move(shapes),
			silentFromAudio(pcm, sampleCount, sampleRate, end),
			pauseRestMs);
		return zipCues(shapes, phones);
	}

	// -----------------------------------------------------------------------
	// Build a phone timeline that spans exactly totalMs.
	//
	// The gap between words stays empty on purpose: animate() reads an absent
	// phone as silence and closes the mouth there, which is what makes word
	// boundaries visible at all.
	//
	// The caller's duration covers the whole clip, and a measured 22% of that is
	// not speech — a short lead and a surprisingly long tail (median 280 ms over
	// the phrase cache). Spending it on phones is the single biggest source of
	// drift: every phone lands early and the mouth finishes talking before the
	// audio does. trailFrac keeps the fixed tail from swallowing a short clip
	// whole.
	//
	// wordGapMs is 0 on purpose, and it was measured, not assumed: inserting
	// silence at word boundaries makes agreement *worse*. animate() already opens
	// the mouth between words via its own pause handling, so an explicit gap
	// double-counts and the mouth stutters shut mid-phrase.
	// -----------------------------------------------------------------------
	BoundedTimeline<Phone> buildTimeline(const vector<vector<Phone>>& words, int totalMs) const {
		const centiseconds total(std::max(1, totalMs / 10));
		BoundedTimeline<Phone> timeline(TimeRange(centiseconds(0), total));
		if (words.empty()) return timeline;

		const int gaps = static_cast<int>(words.size()) - 1;
		const int trail =
			std::min<int>(options.trailMs, static_cast<int>(totalMs * options.trailFrac));
		const int fixed = options.leadMs + trail + gaps * options.wordGapMs;
		const int speechMs = std::max(10, totalMs - fixed);

		double weight = 0;
		for (const auto& word : words) {
			for (const Phone p : word) weight += relativeDuration(p);
		}
		if (weight <= 0) return timeline;

		const double msPerUnit = speechMs / weight;

		// Accumulate in floating-point milliseconds and round only when writing,
		// so rounding error does not compound across a long sentence and leave the
		// tail of the track drifting against the audio.
		double cursor = options.leadMs;
		for (const auto& word : words) {
			for (const Phone p : word) {
				const double next = cursor + relativeDuration(p) * msPerUnit;
				const centiseconds start(static_cast<int>(cursor / 10 + 0.5));
				const centiseconds end(static_cast<int>(next / 10 + 0.5));
				if (end > start && end <= total) timeline.set(start, end, p);
				cursor = next;
			}
			cursor += options.wordGapMs;
		}
		return timeline;
	}
};

Engine::Engine(const Config& config) : impl_(std::make_unique<Impl>()) {
	impl_->options = config.options;
	impl_->pauseRestMs = config.pauseRestMs;

	// Resources are resolved relative to a tree we choose rather than to the
	// binary's own directory. Upstream insists on <bindir>/res/sphinx, which
	// would force one 52 MB copy of the acoustic model per platform binary; the
	// RHUBARB_RES_DIR patch lets every platform share one tree. Set before any
	// call into the recognizer, because the patched getSphinxModelDirectory()
	// caches its answer in a function-local static on first use.
	setenv("RHUBARB_RES_DIR", config.resDir.c_str(), 1);
	// The decoder pool is what makes the accurate leg 31 ms rather than 181 ms.
	// Opt-in upstream-side because the cache is unbounded; we only ever use one
	// recognizer with no dialog, so it holds exactly one entry.
	setenv("RHUBARB_WARM_POOL", "1", 0);

	const auto t0 = std::chrono::steady_clock::now();

	const string dictPath =
		config.dictPath.empty() ? config.resDir + "/sphinx/cmudict-en-us.dict" : config.dictPath;
	impl_->lexicon = std::make_unique<Lexicon>(dictPath);
	if (!config.weightsPath.empty()) loadWeights(config.weightsPath, impl_->weights);

	loadMs_ = sinceMs(t0);

	// getExtendedShapes() returns only G/H/X — the extended set is the union, and
	// animate() rejects any set missing a basic shape.
	impl_->shapeSet = ShapeConverter::getBasicShapes();
	if (config.extendedShapes) {
		for (const Shape s : ShapeConverter::getExtendedShapes()) impl_->shapeSet.insert(s);
	}

	// Pay ps_init() (52 MB acoustic model) here rather than on the first real
	// sentence, which would land on a live call. The clip is amplitude-modulated
	// broadband noise because the recognizer runs WebRTC VAD first and silence
	// would be skipped — no utterance, no decoder, no warm pool.
	//
	// The decoders are warmed *simultaneously* (after the first, see below), and
	// that is the whole reason this is a count. The pool hands out an idle
	// decoder when it has one, so N sequential warm-ups build exactly one; the
	// second concurrent sentence of the process then pays ~140 ms of ps_init
	// while a call is in progress — measured, and the only visible cost left in
	// the accurate leg. The latch below makes the warm-ups contend on purpose so
	// the pool builds all N here.
	const int decoders = config.warmupDecoders;
	if (decoders > 0) {
		const auto w0 = std::chrono::steady_clock::now();
		const int sampleRate = 16000;
		vector<int16_t> samples;
		samples.reserve(static_cast<size_t>(sampleRate));
		uint32_t rng = 12345;
		for (int n = 0; n < sampleRate; ++n) {
			rng = rng * 1664525u + 1013904223u;
			const float noise = static_cast<float>(static_cast<int32_t>(rng >> 8) % 2000) / 2000.0f;
			const float env =
				0.5f + 0.5f * static_cast<float>(std::sin(2 * M_PI * 4.0 * n / sampleRate));
			samples.push_back(static_cast<int16_t>(0.3f * noise * env * 32767.0f));
		}

		// Decoder zero, alone, before any concurrency starts. Rhubarb's own
		// first-use paths are not safe to enter from two threads at once —
		// redirectPocketSphinxOutput() in pocketSphinxTools.cpp guards a static
		// bool with a bare `if`, not a lock or a magic static, so two threads
		// racing through it on the process's first ever decode is a data race on
		// PocketSphinx's global error-callback state. Measured as a reliable
		// segfault in avs_open on a multi-core Linux CI runner with
		// warmupDecoders=2, never on the single-core-in-practice case that had
		// been exercised before. Not thrown away: it lands in the pool exactly
		// like the rest, so the concurrent warm-up below still ends with all N
		// idle — decoder zero is simply the one of the N that gets reused rather
		// than freshly built.
		try {
			audioCues(samples.data(), samples.size(), sampleRate);
		} catch (...) {
			// A failed warm-up costs latency on the first request, nothing more.
		}

		if (decoders > 1) {
			std::mutex latch;
			std::condition_variable ready;
			int arrived = 0;
			bool released = false;
			const auto warm = [&] {
				{
					std::unique_lock<std::mutex> lock(latch);
					if (++arrived == decoders) {
						released = true;
						ready.notify_all();
					} else {
						ready.wait(lock, [&] { return released; });
					}
				}
				try {
					audioCues(samples.data(), samples.size(), sampleRate);
				} catch (...) {
					// A failed warm-up costs latency on the first request, nothing more.
				}
			};

			vector<std::thread> others;
			others.reserve(static_cast<size_t>(decoders - 1));
			for (int i = 1; i < decoders; ++i) others.emplace_back(warm);
			warm();
			for (auto& thread : others) thread.join();
		}
		warmupMs_ = sinceMs(w0);
	}
}

Engine::~Engine() = default;

size_t Engine::dictEntryCount() const { return impl_->lexicon->size(); }

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------
struct Stream::Impl {
	const Engine::Impl* engine = nullptr;
	std::unique_ptr<PooledDecoder> pooled;
	int sourceRate = 0;
	// Every sample fed, at the source rate. Kept in full because silentFromAudio()
	// reads it — the mouth closes on quiet audio, not on gaps in the phone
	// timeline — and because it is what makes a partial read reproducible. A
	// minute of 24 kHz mono is 2.8 MB, against the 55 MB decoder it is attached
	// to, so trimming it would be optimising the wrong number.
	std::shared_ptr<vector<int16_t>> source = std::make_shared<vector<int16_t>>();
	// 16 kHz samples already handed to the decoder. Also the resampler's cursor:
	// output sample k is final once (k+1)*factor <= source->size(), and never
	// changes afterwards, so this only ever moves forward.
	size_t fedCount = 0;
	bool ended = false;

	~Impl() {
		if (!pooled) return;
		// Back to the pool even on an exception or a cancelled turn. A barge-in
		// under load is exactly when a leaked 55 MB slot hurts most, and it is
		// exactly when the tidy path does not run.
		if (!ended) ps_end_utt(pooled->decoder.get());
		std::lock_guard<std::mutex> lock(engine->streamMutex);
		engine->idleDecoders.push_back(std::move(pooled));
		--engine->liveStreams;
	}

	// New 16 kHz samples, exactly. Rhubarb's resampler is a weighted mean over
	// [k*f, min((k+1)*f, size)) with no filter tail, so stopping at the last
	// window that fits entirely inside what we have gives bit-identical output to
	// resampling the finished clip in one go — the clamp to `size` is the only
	// thing that could differ, and it never fires below the cursor.
	vector<int16_t> newSamples() const {
		const double factor = static_cast<double>(sourceRate) / sphinxSampleRate;
		const size_t valid = static_cast<size_t>(source->size() / factor);
		if (valid <= fedCount) return {};
		if (sourceRate == sphinxSampleRate) {
			return vector<int16_t>(source->begin() + fedCount, source->begin() + valid);
		}
		const MemoryAudioClip clip(source, sourceRate);
		const std::unique_ptr<AudioClip> resampled = clip.clone() | resample(sphinxSampleRate);
		const SampleReader read = resampled->createSampleReader();
		vector<int16_t> out;
		out.reserve(valid - fedCount);
		for (size_t k = fedCount; k < valid; ++k) {
			out.push_back(toInt16Sample(read(static_cast<AudioClip::size_type>(k))));
		}
		return out;
	}
};

Stream::Stream(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
Stream::~Stream() = default;

std::unique_ptr<Stream> Engine::openStream(int sampleRate) const {
	if (sampleRate < sphinxSampleRate) {
		throw std::runtime_error(
			"sample rate must be at least 16000 Hz; the resampler cannot upsample");
	}

	std::unique_ptr<PooledDecoder> pooled;
	{
		std::lock_guard<std::mutex> lock(impl_->streamMutex);
		if (impl_->liveStreams >= impl_->maxStreams) return nullptr;
		if (!impl_->idleDecoders.empty()) {
			pooled = std::move(impl_->idleDecoders.back());
			impl_->idleDecoders.pop_back();
		}
		// Counted before the decoder exists, so a concurrent open cannot also
		// decide there is room while this one is still in ps_init().
		++impl_->liveStreams;
	}

	try {
		if (!pooled) pooled = std::make_unique<PooledDecoder>();
		pooled->reset();
		ps_start_stream(pooled->decoder.get());
		if (ps_start_utt(pooled->decoder.get())) {
			throw std::runtime_error("stream: ps_start_utt failed");
		}
	} catch (...) {
		std::lock_guard<std::mutex> lock(impl_->streamMutex);
		if (pooled) impl_->idleDecoders.push_back(std::move(pooled));
		--impl_->liveStreams;
		throw;
	}

	auto state = std::make_unique<Stream::Impl>();
	state->engine = impl_.get();
	state->pooled = std::move(pooled);
	state->sourceRate = sampleRate;
	return std::unique_ptr<Stream>(new Stream(std::move(state)));
}

int Engine::liveStreams() const {
	std::lock_guard<std::mutex> lock(impl_->streamMutex);
	return impl_->liveStreams;
}

int Engine::maxStreams() const { return impl_->maxStreams; }

void Stream::feed(const int16_t* pcm, size_t sampleCount) {
	if (impl_->ended) throw std::runtime_error("stream: feed after finish");
	if (sampleCount == 0) return;
	impl_->source->insert(impl_->source->end(), pcm, pcm + sampleCount);

	const vector<int16_t> fresh = impl_->newSamples();
	if (fresh.empty()) return;
	if (ps_process_raw(impl_->pooled->decoder.get(), fresh.data(), fresh.size(), false, false) < 0) {
		throw std::runtime_error("stream: ps_process_raw failed");
	}
	impl_->fedCount += fresh.size();
}

int Stream::edgeMs() const {
	if (impl_->sourceRate <= 0) return 0;
	return static_cast<int>(1000ull * impl_->source->size() / impl_->sourceRate);
}

std::vector<Cue> Stream::cues(int fromMs, int holdBackMs) {
	// The decoder's own clock, not the source buffer's: samples that have not yet
	// completed a 16 kHz output sample have not been decoded, and claiming
	// timeline for them would put cues ahead of any evidence for them.
	const int decodedMs = static_cast<int>(1000ull * impl_->fedCount / sphinxSampleRate);
	const int endMs = decodedMs - std::max(0, holdBackMs);
	if (endMs <= fromMs) return {};

	const centiseconds endCs(endMs / 10);
	if (endCs <= 0_cs) return {};
	BoundedTimeline<Phone> phones = segmentsToPhones(impl_->pooled->decoder.get(), endCs);

	// The audio handed to restPauses() is trimmed to the same instant. Passing
	// the whole buffer would let it find silence past the end of the timeline and
	// close the mouth for audio the phone track does not cover yet.
	const size_t audioCount = std::min(
		impl_->source->size(),
		static_cast<size_t>(1ull * endMs * impl_->sourceRate / 1000));
	std::vector<Cue> cues = impl_->engine->finishAudioCues(
		std::move(phones), impl_->source->data(), audioCount, impl_->sourceRate);

	// Trim to fromMs, but keep the shape already in force there rather than only
	// the changes after it. The caller is about to discard everything from fromMs
	// on and append this, so a track starting at the first *change* past that
	// point leaves the mouth holding whatever preceded it until the next change
	// arrives — on a long vowel that is a few hundred ms of visibly wrong face.
	auto first = cues.begin();
	while (first != cues.end() && first->tMs <= fromMs) ++first;
	if (first != cues.begin()) {
		--first;
		first->tMs = fromMs;
	}
	cues.erase(cues.begin(), first);
	return cues;
}

std::vector<Cue> Stream::finish() {
	if (!impl_->ended) {
		if (ps_end_utt(impl_->pooled->decoder.get())) {
			throw std::runtime_error("stream: ps_end_utt failed");
		}
		impl_->ended = true;
	}
	if (impl_->source->empty()) return {};

	const centiseconds endCs(
		static_cast<int>(100ull * impl_->source->size() / impl_->sourceRate));
	if (endCs <= 0_cs) return {};
	BoundedTimeline<Phone> phones = segmentsToPhones(impl_->pooled->decoder.get(), endCs);
	return impl_->engine->finishAudioCues(
		std::move(phones), impl_->source->data(), impl_->source->size(), impl_->sourceRate);
}

std::vector<Cue> Engine::textCues(const string& text, int totalMs) const {
	const vector<string> tokens =
		tokenizeText(text, [&](const string& word) { return impl_->lexicon->contains(word); });
	vector<vector<Phone>> words;
	words.reserve(tokens.size());
	for (const auto& token : tokens) {
		auto phones = impl_->lexicon->lookup(token);
		if (!phones.empty()) words.push_back(std::move(phones));
	}

	const BoundedTimeline<Phone> phones = impl_->buildTimeline(words, totalMs);
	JoiningContinuousTimeline<Shape> shapes = animate(phones, impl_->shapeSet);
	const auto range = shapes.getRange();
	shapes = restPauses(
		std::move(shapes),
		silentFromPhones(phones, range.getStart(), range.getEnd()),
		impl_->pauseRestMs);
	return zipCues(shapes, phones);
}

std::vector<Cue> Engine::audioCues(const int16_t* pcm, size_t sampleCount, int sampleRate) const {
	if (sampleRate <= 0) throw std::runtime_error("sample rate must be positive");
	if (sampleCount == 0) throw std::runtime_error("empty pcm");

	auto samples = std::make_shared<vector<int16_t>>(pcm, pcm + sampleCount);
	const MemoryAudioClip clip(std::move(samples), sampleRate);
	ProgressForwarder noop([](double) {});

	// Inlined from animateAudioClip(), which does exactly these two calls and
	// then drops the phone timeline on the floor. We want it. The filter between
	// them is this library's, not Rhubarb's — see dropNonSpeech().
	//
	// Gated on the same setting as restPauses(), because the two are one decision
	// — what the mouth does while nobody is articulating — and because
	// pauseRestMs = 0 is documented as restoring Rhubarb exactly. It has to
	// actually do that: it is the control the review page A/Bs against, and a
	// baseline that is *nearly* stock is worse than no baseline, since every
	// difference then has two possible causes.
	BoundedTimeline<Phone> phones = impl_->recognizer.recognizePhones(clip, boost::none, 1, noop);
	return impl_->finishAudioCues(std::move(phones), pcm, sampleCount, sampleRate);
}

// ---------------------------------------------------------------------------
// Name tables
// ---------------------------------------------------------------------------
namespace {

const vector<string>& shapeNames() {
	static const vector<string> names = [] {
		vector<string> result;
		for (int i = 0; i < static_cast<int>(Shape::EndSentinel); ++i) {
			std::ostringstream out;
			out << static_cast<Shape>(i);
			result.push_back(out.str());
		}
		return result;
	}();
	return names;
}

const vector<string>& phoneNames() {
	static const vector<string> names = [] {
		vector<string> result;
		for (int i = 0; i < kPhoneCount; ++i) {
			std::ostringstream out;
			out << static_cast<Phone>(i);
			result.push_back(out.str());
		}
		return result;
	}();
	return names;
}

}  // namespace

const char* shapeName(Shape shape) {
	const int index = static_cast<int>(shape);
	const auto& names = shapeNames();
	if (index < 0 || index >= static_cast<int>(names.size())) return "";
	return names[index].c_str();
}

const char* phoneName(int8_t phone) {
	const auto& names = phoneNames();
	if (phone < 0 || phone >= static_cast<int8_t>(names.size())) return "";
	return names[phone].c_str();
}

int shapeCount() { return static_cast<int>(Shape::EndSentinel); }
int phoneCount() { return kPhoneCount; }

}  // namespace avs
