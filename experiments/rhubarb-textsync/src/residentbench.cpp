// residentbench — run real Rhubarb recognition repeatedly inside one process.
//
// The shipped CLI does one file per process, which makes the per-call cost of a
// resident sidecar unmeasurable: every run pays ps_init() and there is no way to
// see what a second request would have cost. This drives animateAudioClip() in a
// loop so the warm-pool change (RHUBARB_WARM_POOL) can be scored against the
// same code path the CLI uses.
//
// Usage: residentbench <phonetic|pocketSphinx> <wav>...

#include <chrono>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include "core/Shape.h"
#include "lib/rhubarbLib.h"
#include "recognition/PhoneticRecognizer.h"
#include "recognition/PocketSphinxRecognizer.h"
#include "tools/progress.h"

int main(int argc, char** argv) {
	if (argc < 3) {
		std::cerr << "usage: residentbench <phonetic|pocketSphinx> <wav>...\n";
		return 2;
	}
	const std::string recognizerName = argv[1];
	std::unique_ptr<Recognizer> recognizer;
	if (recognizerName == "phonetic") {
		recognizer = std::make_unique<PhoneticRecognizer>();
	} else {
		recognizer = std::make_unique<PocketSphinxRecognizer>();
	}

	ShapeSet shapeSet = ShapeConverter::getBasicShapes();
	for (const Shape s : ShapeConverter::getExtendedShapes()) shapeSet.insert(s);

	for (int i = 2; i < argc; ++i) {
		const std::string file = argv[i];
		const auto t0 = std::chrono::steady_clock::now();
		try {
			ProgressForwarder noop([](double) {});
			const auto shapes = animateWaveFile(
				file, boost::none, *recognizer, shapeSet, 1, noop);
			const auto ms = std::chrono::duration<double, std::milli>(
				std::chrono::steady_clock::now() - t0).count();
			std::cout << i - 2 << "\t" << ms << "\t" << shapes.size() << "\t" << file << std::endl;
		} catch (const std::exception& e) {
			std::cout << i - 2 << "\tERR\t0\t" << e.what() << std::endl;
		}
	}
	return 0;
}
