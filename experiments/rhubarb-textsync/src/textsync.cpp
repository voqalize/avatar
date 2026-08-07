// textsync — produce a Rhubarb mouth-shape track from TEXT plus a predicted
// duration, with no audio and no acoustic model.
//
// The seam this exploits is in rhubarbLib.cpp:
//
//     phones  = recognizer.recognizePhones(audioClip, ...);   // needs audio
//     shapes  = animate(phones, targetShapeSet);              // does NOT
//
// Everything Rhubarb knows about *looking right* — co-articulation, the
// tweening pass, pause handling, static-segment cleanup — lives in animate(),
// which is a pure function of a phone timeline. Recognition exists only to
// discover that timeline from audio. When a TTS engine has already decided how
// long the sentence will take, we can predict the timeline instead, and pay
// nothing at all.
//
// Protocol: one request per stdin line, `<duration_ms>\t<text>`; one JSON
// object per stdout line. Resident by construction, so the per-request cost is
// the work and nothing else.

#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "animation/mouthAnimation.h"
#include "core/Phone.h"
#include "core/Shape.h"
#include "recognition/g2p.h"
#include "recognition/tokenization.h"
#include "time/BoundedTimeline.h"
#include "tools/stringTools.h"

namespace {

using std::string;
using std::vector;

// ---------------------------------------------------------------------------
// Relative phone durations.
//
// Only ratios matter: the whole track is rescaled to the duration the TTS
// engine already committed to, so an error in the overall speech rate cancels
// out. What these numbers have to get right is the *proportion* — that a
// diphthong holds roughly four times as long as a stop closure, so the mouth
// does not arrive at the next shape early and sit there.
//
// This is the literature prior. It is deliberately kept as the fallback, but
// the fitted table (--weights, from fit.py over real Rhubarb alignments) is
// what should actually ship: measured English is far flatter than the prior —
// stops are nowhere near as short relative to vowels as textbooks imply, because
// the aligner attributes the closure to the preceding segment.
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

// Live weight table: the prior, optionally overwritten from a fitted file.
// Phone has no end sentinel; Noise is its last member.
constexpr int kPhoneCount = static_cast<int>(Phone::Noise) + 1;
double g_weight[kPhoneCount];

void initWeights() {
	for (int i = 0; i < kPhoneCount; ++i) {
		g_weight[i] = priorDuration(static_cast<Phone>(i));
	}
}

// Minimal reader for the flat {"PHONE": number} object fit.py writes. Rhubarb
// has no JSON parser in its own sources and this is not worth a dependency.
void loadWeights(const string& path) {
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
			if (value > 0) g_weight[static_cast<int>(*p)] = value;
		}
		i = colon + 1;
	}
}

inline double relativeDuration(Phone p) { return g_weight[static_cast<int>(p)]; }

// ---------------------------------------------------------------------------
// Pronunciation dictionary
// ---------------------------------------------------------------------------
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
			const auto paren = word.find('(');
			if (paren != string::npos) continue;
			vector<Phone> phones;
			string tok;
			while (ls >> tok) {
				if (const auto p = PhoneConverter::get().tryParse(tok)) phones.push_back(*p);
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
	static string toLower(string s) {
		for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
		return s;
	}
	std::unordered_map<string, vector<Phone>> entries_;
};

// ---------------------------------------------------------------------------
// Build a phone timeline that spans exactly totalMs.
//
// leadMs/trailMs stay empty, and the gap between words stays empty. Those gaps
// are not padding — animate() reads an absent phone as silence and closes the
// mouth there, which is what makes word boundaries visible at all.
// ---------------------------------------------------------------------------
// The TTS's predicted duration covers the whole clip, and a measured 22% of
// that is not speech — a short lead and a surprisingly long tail (median 280ms
// over the phrase cache). Spending it on phones is the single biggest source of
// drift: every phone lands early and the mouth finishes talking before the audio
// does. trailFrac keeps the fixed tail from swallowing a short clip whole.
//
// wordGapMs is 0 on purpose, and it was measured, not assumed: inserting silence
// at word boundaries makes agreement *worse*. animate() already opens the mouth
// between words via its own pause handling, so an explicit gap double-counts and
// the mouth stutters shut mid-phrase.
struct Options {
	int leadMs = 30;
	int trailMs = 280;
	double trailFrac = 0.45;
	int wordGapMs = 0;
};

BoundedTimeline<Phone> buildTimeline(
	const vector<vector<Phone>>& words, int totalMs, const Options& opt)
{
	const centiseconds total(std::max(1, totalMs / 10));
	BoundedTimeline<Phone> timeline(TimeRange(centiseconds(0), total));
	if (words.empty()) return timeline;

	const int gaps = static_cast<int>(words.size()) - 1;
	const int trail = std::min<int>(opt.trailMs, static_cast<int>(totalMs * opt.trailFrac));
	const int fixed = opt.leadMs + trail + gaps * opt.wordGapMs;
	const int speechMs = std::max(10, totalMs - fixed);

	double weight = 0;
	for (const auto& w : words) for (const Phone p : w) weight += relativeDuration(p);
	if (weight <= 0) return timeline;

	const double msPerUnit = speechMs / weight;

	// Accumulate in floating-point milliseconds and round only when writing, so
	// rounding error does not compound across a long sentence and leave the
	// tail of the track drifting against the audio.
	double cursor = opt.leadMs;
	for (size_t wi = 0; wi < words.size(); ++wi) {
		for (const Phone p : words[wi]) {
			const double next = cursor + relativeDuration(p) * msPerUnit;
			const centiseconds start(static_cast<int>(cursor / 10 + 0.5));
			const centiseconds end(static_cast<int>(next / 10 + 0.5));
			if (end > start && end <= total) timeline.set(start, end, p);
			cursor = next;
		}
		cursor += opt.wordGapMs;
	}
	return timeline;
}

string toJson(const JoiningContinuousTimeline<Shape>& shapes, int totalMs, double buildMs) {
	std::ostringstream out;
	out << "{\"ms\":" << totalMs << ",\"compute_ms\":" << buildMs << ",\"cues\":[";
	bool first = true;
	for (const auto& timed : shapes) {
		if (!first) out << ",";
		first = false;
		std::ostringstream v;
		v << timed.getValue();
		out << "{\"t\":" << timed.getStart().count() * 10 << ",\"v\":\"" << v.str() << "\"}";
	}
	out << "]}";
	return out.str();
}

} // namespace

int main(int argc, char** argv) {
	string dictPath = "res/sphinx/cmudict-en-us.dict";
	string weightsPath;
	Options opt;
	bool extended = true;
	initWeights();
	for (int i = 1; i < argc; ++i) {
		const string a = argv[i];
		auto next = [&]() { return string(argv[++i]); };
		if (a == "--dict") dictPath = next();
		else if (a == "--weights") weightsPath = next();
		else if (a == "--lead") opt.leadMs = std::stoi(next());
		else if (a == "--trail") opt.trailMs = std::stoi(next());
		else if (a == "--trail-frac") opt.trailFrac = std::stod(next());
		else if (a == "--word-gap") opt.wordGapMs = std::stoi(next());
		else if (a == "--basic-shapes") extended = false;
	}
	if (!weightsPath.empty()) loadWeights(weightsPath);

	const auto t0 = std::chrono::steady_clock::now();
	Lexicon lexicon(dictPath);
	const auto loadMs =
		std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
	std::cerr << "{\"ready\":true,\"dict_entries\":" << lexicon.size()
	          << ",\"load_ms\":" << loadMs << "}" << std::endl;

	// getExtendedShapes() returns only G/H/X — the extended set is the union,
	// and animate() rejects any set missing a basic shape.
	ShapeSet shapeSet = ShapeConverter::getBasicShapes();
	if (extended) {
		for (const Shape s : ShapeConverter::getExtendedShapes()) shapeSet.insert(s);
	}

	string line;
	while (std::getline(std::cin, line)) {
		if (line.empty()) continue;
		const auto tab = line.find('\t');
		if (tab == string::npos) { std::cout << "{\"error\":\"want <ms>\\t<text>\"}" << std::endl; continue; }
		int totalMs = 0;
		try { totalMs = std::stoi(line.substr(0, tab)); } catch (...) { totalMs = 0; }
		const string text = line.substr(tab + 1);

		const auto r0 = std::chrono::steady_clock::now();
		try {
			const vector<string> tokens = tokenizeText(
				text, [&](const string& w) { return lexicon.contains(w); });

			vector<vector<Phone>> words;
			words.reserve(tokens.size());
			for (const auto& t : tokens) {
				auto phones = lexicon.lookup(t);
				if (!phones.empty()) words.push_back(std::move(phones));
			}

			const auto phones = buildTimeline(words, totalMs, opt);
			const auto shapes = animate(phones, shapeSet);
			const auto ms =
				std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - r0).count();
			std::cout << toJson(shapes, totalMs, ms) << std::endl;
		} catch (const std::exception& e) {
			std::cout << "{\"error\":\"" << e.what() << "\"}" << std::endl;
		}
	}
	return 0;
}
