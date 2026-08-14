/* avatarsync — viseme cues from text or from PCM, in process.
 *
 * The ABI is C so that ctypes and cffi can load it with no build step on the
 * caller's side and no Python-version matrix to publish. The implementation
 * behind it stays C++ (it is Rhubarb's, and rewriting animate() would throw away
 * the only part of this that is hard).
 *
 * The property that matters for the intended caller: ctypes and cffi release the
 * GIL for the duration of a foreign call, so
 *
 *     cues = await asyncio.to_thread(engine.audio_cues, pcm, 24000)
 *
 * genuinely runs the decoder off the event loop. avs_text_cues and
 * avs_audio_cues are both safe to call concurrently on one engine.
 *
 * Errors never propagate as exceptions. Every fallible call takes an error
 * buffer and returns 0 on success, non-zero on failure.
 */

#ifndef AVATARSYNC_H
#define AVATARSYNC_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* The library is compiled with hidden visibility so that the only symbols it
 * offers are the ones below. Everything else it links — pocketsphinx, boost,
 * Rhubarb itself — stays private, which matters because the process loading this
 * is a Python interpreter that may well have its own opinion about a symbol
 * named `ps_init`. */
#if defined(_WIN32)
#define AVS_API __declspec(dllexport)
#else
#define AVS_API __attribute__((visibility("default")))
#endif

/* One mouth-shape change.
 *
 * `shape` indexes the Rhubarb A-H+X set (avs_shape_name). It is what the SVG
 * faces render.
 *
 * `phone` indexes the ~41-value Arpabet subset the recogniser actually works in
 * (avs_phone_name), or -1 during silence. Rhubarb's nine shapes are a lossy
 * projection of those phones and the loss is concentrated: shape B alone absorbs
 * IY, IH, T, D, CH, JH, TH, DH, S, Z, SH, ZH, N and Y. A renderer with a mouth
 * for "tongue between the teeth" cannot ask for it from `shape` and can from
 * `phone`. Carrying it costs nothing — both legs hold a phone timeline and used
 * to discard it here.
 */
typedef struct {
	int32_t t_ms;
	int8_t shape;
	int8_t phone;
} avs_cue;

typedef struct {
	/* Directory holding sphinx/. Both legs need it: the fast leg for
	 * cmudict-en-us.dict, the accurate leg for the acoustic model. */
	const char* res_dir;
	/* NULL for <res_dir>/sphinx/cmudict-en-us.dict. */
	const char* dict_path;
	/* Fitted phone durations for the fast leg. NULL keeps the literature prior. */
	const char* weights_path;
	int32_t lead_ms;
	int32_t trail_ms;
	double trail_frac;
	int32_t word_gap_ms;
	/* Silence at least this long closes the mouth, and breaths stop being
	 * animated. Rhubarb's own threshold is 350 ms and it renders a lip smack as
	 * an open mouth — both tuned for a cartoon over pre-recorded dialogue. A
	 * conversational comma is 150-300 ms, so under those rules a talking head is
	 * left mid-vowel through every pause and opens its mouth for room tone.
	 * 0 restores Rhubarb exactly. */
	int32_t pause_rest_ms;
	/* Allow G ("F"/"V") and H ("L") on top of the six basic shapes. */
	int32_t extended_shapes;
	/* How many decoders to build at open() rather than on a live sentence. A
	 * count, not a flag: the decoder pool builds one per *concurrent* caller, so
	 * set this to the number of threads that will call avs_audio_cues() at once
	 * (0 disables warm-up entirely). Each decoder is ~58 MB resident and ~140 ms
	 * to build, and building one mid-call is the only stall left in the accurate
	 * leg. */
	int32_t warmup_decoders;
	/* The hard ceiling on live streams, and so on resident memory: each holds a
	 * decoder for the length of a speaking turn rather than the ~30 ms a batch
	 * decode takes, and a decoder is ~55 MB that cannot be shared. Past this
	 * avs_stream_open() returns NULL with no error, which is a refusal and not a
	 * failure — the caller falls back to avs_text_cues() for that turn. */
	int32_t max_streams;
} avs_config;

typedef struct avs_engine avs_engine;

/* Fill in the shipping defaults. Always call this before overriding fields: a
 * zero-initialised avs_config would silently mean lead_ms = 0, res_dir = NULL. */
AVS_API void avs_config_defaults(avs_config* config);

/* Returns NULL on failure, with a message in err. Opening is expensive — the
 * 125k-entry dictionary and, with warmup, the 52 MB acoustic model — and the
 * result is intended to live for the process. */
AVS_API avs_engine* avs_open(const avs_config* config, char* err, size_t err_len);
AVS_API void avs_close(avs_engine* engine);

/* The fast leg: a predicted phone timeline spanning exactly total_ms, animated.
 * No audio, no acoustic model, ~0.15 ms. `text` is UTF-8. */
AVS_API int32_t avs_text_cues(
	avs_engine* engine,
	const char* text,
	int32_t total_ms,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len);

/* The accurate leg: real phonetic recognition over mono int16 PCM. */
AVS_API int32_t avs_audio_cues(
	avs_engine* engine,
	const int16_t* pcm,
	int32_t sample_count,
	int32_t sample_rate,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len);

/* Frees a cue array returned by any of the cue calls. NULL is a no-op. */
AVS_API void avs_free_cues(avs_cue* cues);

/* --- the accurate leg, live -------------------------------------------------
 *
 * avs_audio_cues() decodes audio that has already finished, which is a shape a
 * voice call never has: the mouth has to move while the audio plays. A stream
 * feeds the decoder as TTS frames arrive and reads the partial timeline back out
 * mid-utterance.
 *
 * A stream is NOT thread-safe and is not meant to be: one stream belongs to one
 * speaking turn, and the natural place to drive it is a single executor thread
 * per turn. Different streams on one engine are independent and concurrent.
 *
 * Each call feeds audio, then asks for the timeline; the answer is always the
 * whole timeline from from_ms, never a delta. That is deliberate — the wire
 * primitive downstream is "discard queued cues at or after from_ms, then append
 * these", so a cue the decoder later changes its mind about costs nothing but
 * the frames already drawn. Trying to emit only what is new would mean deciding
 * here what has settled, which is the caller's tradeoff (see hold_back_ms). */
typedef struct avs_stream avs_stream;

/* Opens a live decode at sample_rate. Returns NULL and sets no error when the
 * engine is at max_streams — check err[0] to tell refusal from failure. Rates
 * below 16000 are an error: the resampler cannot upsample. */
AVS_API avs_stream* avs_stream_open(
	avs_engine* engine, int32_t sample_rate, char* err, size_t err_len);

/* Appends mono int16 PCM at the stream's rate. Resampling to 16 kHz is
 * incremental and exact, so feeding in 20 ms pieces gives the decoder the same
 * samples as feeding the finished clip in one go. */
AVS_API int32_t avs_stream_feed(
	avs_stream* stream,
	const int16_t* pcm,
	int32_t sample_count,
	char* err,
	size_t err_len);

/* The timeline from from_ms onward, ending hold_back_ms before the live edge.
 *
 * hold_back_ms trades churn against lag: measured on the corpus, a segment stops
 * moving within 100 ms of the edge 85% of the time and within 200 ms 98%. How
 * much churn is acceptable depends on how far ahead of the playhead the client
 * already is, which is why this is an argument and not a constant. */
AVS_API int32_t avs_stream_cues(
	avs_stream* stream,
	int32_t from_ms,
	int32_t hold_back_ms,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len);

/* Ends the utterance and returns the timeline to the true end, no hold-back.
 * The stream is unusable afterwards; avs_stream_close() still has to be called. */
AVS_API int32_t avs_stream_finish(
	avs_stream* stream,
	avs_cue** out_cues,
	int32_t* out_count,
	char* err,
	size_t err_len);

/* Milliseconds of audio fed so far. */
AVS_API int32_t avs_stream_edge_ms(avs_stream* stream);

/* Returns the decoder to the pool. NULL is a no-op. Safe — and required — after
 * an error or a barge-in, without avs_stream_finish(): a stream that is never
 * closed holds ~55 MB and one of max_streams slots for the life of the process. */
AVS_API void avs_stream_close(avs_stream* stream);

/* Live streams right now, and the configured ceiling. */
AVS_API int32_t avs_live_streams(avs_engine* engine);
AVS_API int32_t avs_max_streams(avs_engine* engine);

AVS_API int32_t avs_dict_entries(avs_engine* engine);
AVS_API double avs_load_ms(avs_engine* engine);
AVS_API double avs_warmup_ms(avs_engine* engine);

/* Enum names, so a binding builds its tables at import instead of hard-coding an
 * order that lives in another repository. Out-of-range returns "". */
AVS_API const char* avs_shape_name(int32_t shape);
AVS_API const char* avs_phone_name(int32_t phone);
AVS_API int32_t avs_shape_count(void);
AVS_API int32_t avs_phone_count(void);

/* ABI version. Bumped when this header changes incompatibly. */
AVS_API int32_t avs_abi_version(void);

#ifdef __cplusplus
}
#endif

#endif /* AVATARSYNC_H */
