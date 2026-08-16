// The extern "C" layer. No logic lives here — every function is a translation
// between C storage and avs::Engine, plus the one rule that makes a C ABI
// usable: nothing throws across it.

#include "avatarsync.h"

#include <cstring>
#include <exception>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "core.h"

namespace {

void setError(char* err, size_t errLen, const char* message) {
	if (!err || errLen == 0) return;
	std::strncpy(err, message, errLen - 1);
	err[errLen - 1] = '\0';
}

// Every entry point funnels through this. A C++ exception crossing into C is
// undefined behaviour, and the caller here is a Python interpreter that would
// take the whole process with it.
template <typename Fn>
int32_t guard(char* err, size_t errLen, Fn&& fn) {
	try {
		fn();
		return 0;
	} catch (const std::exception& e) {
		setError(err, errLen, e.what());
		return 1;
	} catch (...) {
		setError(err, errLen, "unknown error");
		return 1;
	}
}

// The cue array is malloc'd rather than new[]'d so that avs_free_cues stays a
// plain free() for any future binding that would rather not call back in.
int32_t emit(const std::vector<avs::Cue>& cues, avs_cue** outCues, int32_t* outCount) {
	*outCues = nullptr;
	*outCount = 0;
	if (cues.empty()) return 0;

	auto* buffer = static_cast<avs_cue*>(std::malloc(cues.size() * sizeof(avs_cue)));
	if (!buffer) throw std::bad_alloc();
	for (size_t i = 0; i < cues.size(); ++i) {
		buffer[i].t_ms = cues[i].tMs;
		buffer[i].shape = static_cast<int8_t>(cues[i].shape);
		buffer[i].phone = cues[i].phone;
	}
	*outCues = buffer;
	*outCount = static_cast<int32_t>(cues.size());
	return 0;
}

}  // namespace

extern "C" {

void avs_config_defaults(avs_config* config) {
	if (!config) return;
	const avs::Config defaults;
	config->res_dir = "res";
	config->dict_path = nullptr;
	config->weights_path = nullptr;
	config->lead_ms = defaults.options.leadMs;
	config->trail_ms = defaults.options.trailMs;
	config->trail_frac = defaults.options.trailFrac;
	config->word_gap_ms = defaults.options.wordGapMs;
	config->pause_rest_ms = defaults.pauseRestMs;
	config->extended_shapes = defaults.extendedShapes ? 1 : 0;
	config->warmup_decoders = defaults.warmupDecoders;
	config->max_streams = defaults.maxStreams;
}

avs_engine* avs_open(const avs_config* config, char* err, size_t err_len) {
	avs::Engine* engine = nullptr;
	const int32_t failed = guard(err, err_len, [&] {
		if (!config) throw std::runtime_error("config must not be null");
		avs::Config cfg;
		if (config->res_dir) cfg.resDir = config->res_dir;
		if (config->dict_path) cfg.dictPath = config->dict_path;
		if (config->weights_path) cfg.weightsPath = config->weights_path;
		cfg.options.leadMs = config->lead_ms;
		cfg.options.trailMs = config->trail_ms;
		cfg.options.trailFrac = config->trail_frac;
		cfg.options.wordGapMs = config->word_gap_ms;
		cfg.pauseRestMs = config->pause_rest_ms;
		cfg.extendedShapes = config->extended_shapes != 0;
		cfg.warmupDecoders = config->warmup_decoders;
		cfg.maxStreams = config->max_streams;
		engine = new avs::Engine(cfg);
	});
	if (failed) {
		delete engine;
		return nullptr;
	}
	return reinterpret_cast<avs_engine*>(engine);
}

void avs_close(avs_engine* engine) { delete reinterpret_cast<avs::Engine*>(engine); }

int32_t avs_text_cues(
	avs_engine* engine,
	const char* text,
	int32_t total_ms,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len)
{
	return guard(err, err_len, [&] {
		if (!engine) throw std::runtime_error("engine must not be null");
		if (!out_cues || !out_count) throw std::runtime_error("output pointers must not be null");
		const auto cues = reinterpret_cast<avs::Engine*>(engine)
			->textCues(text ? text : "", total_ms);
		emit(cues, out_cues, out_count);
	});
}

int32_t avs_audio_cues(
	avs_engine* engine,
	const int16_t* pcm,
	int32_t sample_count,
	int32_t sample_rate,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len)
{
	return guard(err, err_len, [&] {
		if (!engine) throw std::runtime_error("engine must not be null");
		if (!out_cues || !out_count) throw std::runtime_error("output pointers must not be null");
		if (!pcm) throw std::runtime_error("pcm must not be null");
		if (sample_count < 0) throw std::runtime_error("sample count must not be negative");
		const auto cues = reinterpret_cast<avs::Engine*>(engine)
			->audioCues(pcm, static_cast<size_t>(sample_count), sample_rate);
		emit(cues, out_cues, out_count);
	});
}

void avs_free_cues(avs_cue* cues) { std::free(cues); }

avs_stream* avs_stream_open(avs_engine* engine, int32_t sample_rate, char* err, size_t err_len) {
	// Cleared so the caller can tell a refusal (NULL, err empty) from a failure
	// (NULL, err set). Every other entry point signals that through the return
	// code; this one has to return a pointer.
	if (err && err_len > 0) err[0] = '\0';
	std::unique_ptr<avs::Stream> stream;
	const int32_t failed = guard(err, err_len, [&] {
		if (!engine) throw std::runtime_error("engine must not be null");
		stream = reinterpret_cast<avs::Engine*>(engine)->openStream(sample_rate);
	});
	if (failed) return nullptr;
	return reinterpret_cast<avs_stream*>(stream.release());
}

int32_t avs_stream_feed(
	avs_stream* stream, const int16_t* pcm, int32_t sample_count, char* err, size_t err_len)
{
	return guard(err, err_len, [&] {
		if (!stream) throw std::runtime_error("stream must not be null");
		if (!pcm && sample_count != 0) throw std::runtime_error("pcm must not be null");
		if (sample_count < 0) throw std::runtime_error("sample count must not be negative");
		reinterpret_cast<avs::Stream*>(stream)->feed(pcm, static_cast<size_t>(sample_count));
	});
}

int32_t avs_stream_cues(
	avs_stream* stream,
	int32_t from_ms,
	int32_t hold_back_ms,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len)
{
	return guard(err, err_len, [&] {
		if (!stream) throw std::runtime_error("stream must not be null");
		if (!out_cues || !out_count) throw std::runtime_error("output pointers must not be null");
		emit(reinterpret_cast<avs::Stream*>(stream)->cues(from_ms, hold_back_ms),
			out_cues, out_count);
	});
}

int32_t avs_stream_finish(
	avs_stream* stream, avs_cue** out_cues, int32_t* out_count, char* err, size_t err_len)
{
	return guard(err, err_len, [&] {
		if (!stream) throw std::runtime_error("stream must not be null");
		if (!out_cues || !out_count) throw std::runtime_error("output pointers must not be null");
		emit(reinterpret_cast<avs::Stream*>(stream)->finish(), out_cues, out_count);
	});
}

int32_t avs_stream_edge_ms(avs_stream* stream) {
	if (!stream) return 0;
	return reinterpret_cast<avs::Stream*>(stream)->edgeMs();
}

void avs_stream_close(avs_stream* stream) { delete reinterpret_cast<avs::Stream*>(stream); }

int32_t avs_live_streams(avs_engine* engine) {
	if (!engine) return 0;
	return reinterpret_cast<avs::Engine*>(engine)->liveStreams();
}

int32_t avs_max_streams(avs_engine* engine) {
	if (!engine) return 0;
	return reinterpret_cast<avs::Engine*>(engine)->maxStreams();
}

int32_t avs_dict_entries(avs_engine* engine) {
	if (!engine) return 0;
	return static_cast<int32_t>(reinterpret_cast<avs::Engine*>(engine)->dictEntryCount());
}

double avs_load_ms(avs_engine* engine) {
	if (!engine) return 0;
	return reinterpret_cast<avs::Engine*>(engine)->loadMs();
}

double avs_warmup_ms(avs_engine* engine) {
	if (!engine) return 0;
	return reinterpret_cast<avs::Engine*>(engine)->warmupMs();
}

const char* avs_shape_name(int32_t shape) {
	if (shape < 0 || shape >= avs::shapeCount()) return "";
	return avs::shapeName(static_cast<Shape>(shape));
}

const char* avs_phone_name(int32_t phone) {
	if (phone < 0 || phone >= avs::phoneCount()) return "";
	return avs::phoneName(static_cast<int8_t>(phone));
}

int32_t avs_shape_count() { return avs::shapeCount(); }
int32_t avs_phone_count() { return avs::phoneCount(); }

int32_t avs_abi_version() { return 3; }

}  // extern "C"
