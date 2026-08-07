// avatarsync — one resident process serving both viseme legs.
//
// The avatar widget consumes a stream of Rhubarb A–H+X mouth-shape letters (see
// avatar's docs/contract-protocol.md § Speech). Those letters have to come from
// somewhere while TTS audio is still being synthesised, and then be corrected
// once the audio actually exists. That is two jobs, and they share almost all of
// their code:
//
//   text  — the fast leg. The seam is in rhubarbLib.cpp:
//               phones = recognizer.recognizePhones(clip, ...);  // needs audio
//               shapes = animate(phones, targetShapeSet);        // does NOT
//           Everything Rhubarb knows about *looking right* — co-articulation,
//           tweening, pause handling, static-segment cleanup — lives in
//           animate(), a pure function of a phone timeline. Recognition only
//           discovers that timeline. When the duration is known up front we can
//           predict the timeline instead and pay ~0.15 ms.
//
//   audio — the accurate leg. Real `phonetic` recognition over the PCM we just
//           generated, ~31 ms warm (the RHUBARB_WARM_POOL patch caches the
//           decoder pool across requests; upstream rebuilds it per call, right
//           for a CLI, ruinous for a service).
//
// One binary rather than two because the legs share the resident cost that
// matters — the process, the 125k-entry cmudict, and the 82 MB acoustic model
// behind the phonetic decoder — and because the caller then has one liveness
// story, one restart policy and one pipe to correlate on.
//
// Protocol: one JSON object per stdin line, one per stdout line, correlated by
// `id`. Requests are served sequentially; the caller multiplexes.
//
//   {"id":1,"op":"text","ms":2400,"text":"Hello, thanks for joining."}
//   {"id":2,"op":"audio","sr":24000,"pcm":"<base64 s16le mono>"}
//   {"id":3,"op":"ping"}
//
//   {"ready":true,"dict_entries":125945,"load_ms":83.1,"warmup_ms":181.4}
//   {"id":1,"ms":2400,"compute_ms":0.15,"cues":[{"t":0,"v":"X"},...]}
//   {"id":2,"error":"..."}
//
// The ready line goes to stdout, not stderr, so a caller that owns one pipe can
// await readiness and responses on it without a second reader.

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "animation/mouthAnimation.h"
#include "audio/AudioClip.h"
#include "core/Phone.h"
#include "core/Shape.h"
#include "lib/rhubarbLib.h"
#include "recognition/PhoneticRecognizer.h"
#include "recognition/g2p.h"
#include "recognition/tokenization.h"
#include "time/BoundedTimeline.h"
#include "tools/progress.h"
#include "tools/stringTools.h"

namespace {

using std::string;
using std::vector;

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
// (--weights, data/phone_weights.json, from real Rhubarb alignments over a
// corpus of synthesised speech) is what ships: measured English is far flatter than
// the prior — stops are nowhere near as short relative to vowels as textbooks
// imply, because the aligner attributes the closure to the preceding segment.
// Worth ~3 points of frame agreement.
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
// The gap between words stays empty on purpose: animate() reads an absent phone
// as silence and closes the mouth there, which is what makes word boundaries
// visible at all.
//
// The caller's duration covers the whole clip, and a measured 22% of that is not
// speech — a short lead and a surprisingly long tail (median 280 ms over the
// phrase cache). Spending it on phones is the single biggest source of drift:
// every phone lands early and the mouth finishes talking before the audio does.
// trailFrac keeps the fixed tail from swallowing a short clip whole.
//
// wordGapMs is 0 on purpose, and it was measured, not assumed: inserting silence
// at word boundaries makes agreement *worse*. animate() already opens the mouth
// between words via its own pause handling, so an explicit gap double-counts and
// the mouth stutters shut mid-phrase.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// An AudioClip over samples we already hold.
//
// The accurate leg is fed PCM straight off the TTS wire, so writing a temp wav
// just to hand Rhubarb a path would add two syscalls and a filesystem to the
// latency path for nothing. clone() shares the buffer: Rhubarb clones a clip per
// utterance and per effect in the recognition chain, and copying a few hundred
// kilobytes each time would show up in the 31 ms.
// ---------------------------------------------------------------------------
class MemoryAudioClip : public AudioClip {
public:
	MemoryAudioClip(std::shared_ptr<const vector<float>> samples, int sampleRate)
		: samples_(std::move(samples)), sampleRate_(sampleRate) {}

	std::unique_ptr<AudioClip> clone() const override {
		return std::make_unique<MemoryAudioClip>(samples_, sampleRate_);
	}
	int getSampleRate() const override { return sampleRate_; }
	size_type size() const override { return static_cast<size_type>(samples_->size()); }

private:
	SampleReader createUnsafeSampleReader() const override {
		auto samples = samples_;
		return [samples](size_type index) { return (*samples)[static_cast<size_t>(index)]; };
	}

	std::shared_ptr<const vector<float>> samples_;
	int sampleRate_;
};

// ---------------------------------------------------------------------------
// Just enough JSON for a flat request object.
//
// Rhubarb vendors no JSON parser and the request schema is four scalar fields,
// so a dependency would cost more than it saves. Strings are fully unescaped
// (including \uXXXX and surrogate pairs) because Python's json.dumps escapes
// non-ASCII by default and the text field is the whole point of the fast leg.
// ---------------------------------------------------------------------------
void appendUtf8(string& out, unsigned int cp) {
	if (cp < 0x80) {
		out += static_cast<char>(cp);
	} else if (cp < 0x800) {
		out += static_cast<char>(0xC0 | (cp >> 6));
		out += static_cast<char>(0x80 | (cp & 0x3F));
	} else if (cp < 0x10000) {
		out += static_cast<char>(0xE0 | (cp >> 12));
		out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
		out += static_cast<char>(0x80 | (cp & 0x3F));
	} else {
		out += static_cast<char>(0xF0 | (cp >> 18));
		out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
		out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
		out += static_cast<char>(0x80 | (cp & 0x3F));
	}
}

int hexVal(char c) {
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

// Reads a JSON string starting at s[i] == '"'. Leaves i past the closing quote.
string readJsonString(const string& s, size_t& i) {
	string out;
	if (i >= s.size() || s[i] != '"') throw std::runtime_error("expected string");
	++i;
	while (i < s.size()) {
		const char c = s[i++];
		if (c == '"') return out;
		if (c != '\\') { out += c; continue; }
		if (i >= s.size()) break;
		const char e = s[i++];
		switch (e) {
			case '"': out += '"'; break;
			case '\\': out += '\\'; break;
			case '/': out += '/'; break;
			case 'b': out += '\b'; break;
			case 'f': out += '\f'; break;
			case 'n': out += '\n'; break;
			case 'r': out += '\r'; break;
			case 't': out += '\t'; break;
			case 'u': {
				if (i + 4 > s.size()) throw std::runtime_error("bad \\u escape");
				unsigned int cp = 0;
				for (int k = 0; k < 4; ++k) {
					const int h = hexVal(s[i + k]);
					if (h < 0) throw std::runtime_error("bad \\u escape");
					cp = cp * 16 + static_cast<unsigned int>(h);
				}
				i += 4;
				// Surrogate pair: 😀 is one code point, not two.
				if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= s.size()
					&& s[i] == '\\' && s[i + 1] == 'u') {
					unsigned int lo = 0;
					bool ok = true;
					for (int k = 0; k < 4; ++k) {
						const int h = hexVal(s[i + 2 + k]);
						if (h < 0) { ok = false; break; }
						lo = lo * 16 + static_cast<unsigned int>(h);
					}
					if (ok && lo >= 0xDC00 && lo <= 0xDFFF) {
						cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
						i += 6;
					}
				}
				appendUtf8(out, cp);
				break;
			}
			default: out += e; break;
		}
	}
	throw std::runtime_error("unterminated string");
}

struct Request {
	std::unordered_map<string, string> strings;
	std::unordered_map<string, double> numbers;

	string str(const string& key, const string& fallback = "") const {
		const auto it = strings.find(key);
		return it == strings.end() ? fallback : it->second;
	}
	double num(const string& key, double fallback = 0) const {
		const auto it = numbers.find(key);
		return it == numbers.end() ? fallback : it->second;
	}
	bool has(const string& key) const {
		return strings.count(key) > 0 || numbers.count(key) > 0;
	}
};

// Parses a flat object. Nested values are skipped rather than rejected, so an
// unknown field a future caller adds cannot break an older binary.
Request parseRequest(const string& line) {
	Request req;
	size_t i = line.find('{');
	if (i == string::npos) throw std::runtime_error("not a JSON object");
	++i;
	while (i < line.size()) {
		while (i < line.size() && (isspace(static_cast<unsigned char>(line[i])) || line[i] == ',')) ++i;
		if (i >= line.size() || line[i] == '}') break;
		const string key = readJsonString(line, i);
		while (i < line.size() && isspace(static_cast<unsigned char>(line[i]))) ++i;
		if (i >= line.size() || line[i] != ':') throw std::runtime_error("expected ':'");
		++i;
		while (i < line.size() && isspace(static_cast<unsigned char>(line[i]))) ++i;
		if (i >= line.size()) break;
		if (line[i] == '"') {
			req.strings[key] = readJsonString(line, i);
		} else if (line[i] == '{' || line[i] == '[') {
			const char open = line[i];
			const char close = open == '{' ? '}' : ']';
			int depth = 0;
			for (; i < line.size(); ++i) {
				if (line[i] == '"') { readJsonString(line, i); --i; continue; }
				if (line[i] == open) ++depth;
				else if (line[i] == close && --depth == 0) { ++i; break; }
			}
		} else {
			const size_t start = i;
			while (i < line.size() && line[i] != ',' && line[i] != '}') ++i;
			req.numbers[key] = std::strtod(line.c_str() + start, nullptr);
		}
	}
	return req;
}

string jsonEscape(const string& s) {
	string out;
	for (const char c : s) {
		switch (c) {
			case '"': out += "\\\""; break;
			case '\\': out += "\\\\"; break;
			case '\n': out += "\\n"; break;
			case '\r': out += "\\r"; break;
			case '\t': out += "\\t"; break;
			default:
				if (static_cast<unsigned char>(c) < 0x20) {
					char buf[8];
					snprintf(buf, sizeof(buf), "\\u%04x", c);
					out += buf;
				} else {
					out += c;
				}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// base64 → s16le samples, in one pass. The accurate leg carries ~150 KB of PCM
// per sentence, so this runs on the latency path and does no allocation beyond
// the output vector.
// ---------------------------------------------------------------------------
vector<float> decodePcmBase64(const string& b64) {
	static int8_t table[256];
	static bool init = false;
	if (!init) {
		std::memset(table, -1, sizeof(table));
		const char* alphabet =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
		for (int k = 0; k < 64; ++k) table[static_cast<unsigned char>(alphabet[k])] = static_cast<int8_t>(k);
		init = true;
	}

	vector<uint8_t> bytes;
	bytes.reserve(b64.size() * 3 / 4 + 4);
	uint32_t acc = 0;
	int bits = 0;
	for (const char c : b64) {
		const int8_t v = table[static_cast<unsigned char>(c)];
		if (v < 0) continue;  // '=' padding and any whitespace
		acc = (acc << 6) | static_cast<uint32_t>(v);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push_back(static_cast<uint8_t>((acc >> bits) & 0xFF));
		}
	}

	vector<float> samples;
	samples.reserve(bytes.size() / 2);
	for (size_t k = 0; k + 1 < bytes.size(); k += 2) {
		const int16_t s = static_cast<int16_t>(
			static_cast<uint16_t>(bytes[k]) | (static_cast<uint16_t>(bytes[k + 1]) << 8));
		samples.push_back(static_cast<float>(s) / 32768.0f);
	}
	return samples;
}

string cuesJson(const JoiningContinuousTimeline<Shape>& shapes) {
	std::ostringstream out;
	out << "[";
	bool first = true;
	for (const auto& timed : shapes) {
		if (!first) out << ",";
		first = false;
		std::ostringstream v;
		v << timed.getValue();
		out << "{\"t\":" << timed.getStart().count() * 10 << ",\"v\":\"" << v.str() << "\"}";
	}
	out << "]";
	return out.str();
}

double sinceMs(std::chrono::steady_clock::time_point t0) {
	return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

}  // namespace

int main(int argc, char** argv) {
	// Resolve resources relative to the vendor tree rather than to the binary.
	// Upstream insists on <bindir>/res/sphinx; we keep one 56 MB model tree
	// shared by every platform's binary, so the patched getSphinxModelDirectory()
	// honours RHUBARB_RES_DIR and this default just makes the CLI usable by hand.
	string resDir = std::getenv("RHUBARB_RES_DIR") ? std::getenv("RHUBARB_RES_DIR") : "res";
	string dictPath;
	string weightsPath;
	Options opt;
	bool extended = true;
	bool warmup = true;
	initWeights();
	for (int i = 1; i < argc; ++i) {
		const string a = argv[i];
		auto next = [&]() { return string(argv[++i]); };
		if (a == "--res") resDir = next();
		else if (a == "--dict") dictPath = next();
		else if (a == "--weights") weightsPath = next();
		else if (a == "--lead") opt.leadMs = std::stoi(next());
		else if (a == "--trail") opt.trailMs = std::stoi(next());
		else if (a == "--trail-frac") opt.trailFrac = std::stod(next());
		else if (a == "--word-gap") opt.wordGapMs = std::stoi(next());
		else if (a == "--basic-shapes") extended = false;
		else if (a == "--no-warmup") warmup = false;
	}
	if (dictPath.empty()) dictPath = resDir + "/sphinx/cmudict-en-us.dict";
	setenv("RHUBARB_RES_DIR", resDir.c_str(), 1);
	// The decoder pool is what makes the accurate leg 31 ms instead of 181 ms.
	// Opt-in upstream-side because the cache is unbounded; we only ever use one
	// recognizer with no dialog, so it holds exactly one entry.
	setenv("RHUBARB_WARM_POOL", "1", 0);

	const auto t0 = std::chrono::steady_clock::now();
	std::unique_ptr<Lexicon> lexicon;
	try {
		lexicon = std::make_unique<Lexicon>(dictPath);
	} catch (const std::exception& e) {
		std::cout << "{\"ready\":false,\"error\":\"" << jsonEscape(e.what()) << "\"}" << std::endl;
		return 1;
	}
	if (!weightsPath.empty()) {
		try {
			loadWeights(weightsPath);
		} catch (const std::exception& e) {
			std::cout << "{\"ready\":false,\"error\":\"" << jsonEscape(e.what()) << "\"}" << std::endl;
			return 1;
		}
	}
	const double loadMs = sinceMs(t0);

	// getExtendedShapes() returns only G/H/X — the extended set is the union,
	// and animate() rejects any set missing a basic shape.
	ShapeSet shapeSet = ShapeConverter::getBasicShapes();
	if (extended) {
		for (const Shape s : ShapeConverter::getExtendedShapes()) shapeSet.insert(s);
	}

	const PhoneticRecognizer recognizer;

	// Pay ps_init() (82 MB acoustic model) at startup rather than on the first
	// real sentence, which would land on a live call. The clip is amplitude-
	// modulated broadband noise because the recognizer runs WebRTC VAD first and
	// silence would be skipped — no utterance, no decoder, no warm pool.
	double warmupMs = 0;
	if (warmup) {
		const auto w0 = std::chrono::steady_clock::now();
		auto samples = std::make_shared<vector<float>>();
		const int sr = 16000;
		samples->reserve(static_cast<size_t>(sr));
		uint32_t rng = 12345;
		for (int n = 0; n < sr; ++n) {
			rng = rng * 1664525u + 1013904223u;
			const float noise = static_cast<float>(static_cast<int32_t>(rng >> 8) % 2000) / 2000.0f;
			const float env = 0.5f + 0.5f * static_cast<float>(std::sin(2 * M_PI * 4.0 * n / sr));
			samples->push_back(0.3f * noise * env);
		}
		try {
			const MemoryAudioClip clip(samples, sr);
			ProgressForwarder noop([](double) {});
			animateAudioClip(clip, boost::none, recognizer, shapeSet, 1, noop);
		} catch (...) {
			// A failed warm-up costs latency on the first request, nothing more.
		}
		warmupMs = sinceMs(w0);
	}

	std::cout << "{\"ready\":true,\"dict_entries\":" << lexicon->size()
	          << ",\"load_ms\":" << loadMs
	          << ",\"warmup_ms\":" << warmupMs << "}" << std::endl;

	string line;
	while (std::getline(std::cin, line)) {
		if (line.empty()) continue;
		double id = 0;
		try {
			const Request req = parseRequest(line);
			id = req.num("id", 0);
			const string op = req.str("op", "text");
			const auto r0 = std::chrono::steady_clock::now();

			if (op == "ping") {
				std::cout << "{\"id\":" << static_cast<long long>(id) << ",\"pong\":true}" << std::endl;
				continue;
			}

			if (op == "text") {
				const int totalMs = static_cast<int>(req.num("ms", 0));
				const string text = req.str("text");
				const vector<string> tokens = tokenizeText(
					text, [&](const string& w) { return lexicon->contains(w); });
				vector<vector<Phone>> words;
				words.reserve(tokens.size());
				for (const auto& t : tokens) {
					auto phones = lexicon->lookup(t);
					if (!phones.empty()) words.push_back(std::move(phones));
				}
				const auto phones = buildTimeline(words, totalMs, opt);
				const auto shapes = animate(phones, shapeSet);
				std::cout << "{\"id\":" << static_cast<long long>(id)
				          << ",\"ms\":" << totalMs
				          << ",\"compute_ms\":" << sinceMs(r0)
				          << ",\"cues\":" << cuesJson(shapes) << "}" << std::endl;
				continue;
			}

			if (op == "audio") {
				const int sr = static_cast<int>(req.num("sr", 24000));
				if (sr <= 0) throw std::runtime_error("sr must be positive");
				auto samples = std::make_shared<vector<float>>(decodePcmBase64(req.str("pcm")));
				if (samples->empty()) throw std::runtime_error("empty pcm");
				const MemoryAudioClip clip(samples, sr);
				ProgressForwarder noop([](double) {});
				const auto shapes = animateAudioClip(clip, boost::none, recognizer, shapeSet, 1, noop);
				const int totalMs = static_cast<int>(samples->size() * 1000 / sr);
				std::cout << "{\"id\":" << static_cast<long long>(id)
				          << ",\"ms\":" << totalMs
				          << ",\"compute_ms\":" << sinceMs(r0)
				          << ",\"cues\":" << cuesJson(shapes) << "}" << std::endl;
				continue;
			}

			throw std::runtime_error("unknown op: " + op);
		} catch (const std::exception& e) {
			std::cout << "{\"id\":" << static_cast<long long>(id)
			          << ",\"error\":\"" << jsonEscape(e.what()) << "\"}" << std::endl;
		}
	}
	return 0;
}
