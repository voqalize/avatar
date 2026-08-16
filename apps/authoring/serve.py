#!/usr/bin/env python3
"""Static server for the workshop pages.

    python3 apps/authoring/serve.py [port]   # default 8777
    open http://localhost:8777/apps/authoring/

It serves the **repository root**, not this directory, and does so from
wherever you run it. The pages import `../../packages/avatar/src/*.js` by
relative path — that is the point of them, since the widget has no build step
and what you screenshot is what ships — so a server rooted anywhere inside
`apps/` would 404 the entire library.

Not `python3 -m http.server`: that sends `Last-Modified` and no `Cache-Control`,
so browsers apply heuristic freshness and stop revalidating modules you have
edited. It has cost this project three separate debugging sessions — twice a
stale rig, once a module that reported a missing export it plainly had. This
sends `no-store`, so a reload always gets what is on disk.

Do not work around a stale module with `?v=` either. That puts two copies of
the same module in the graph, and it fails differently and worse.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
print(f'serving {ROOT} on http://localhost:{port}/apps/authoring/')
ThreadingHTTPServer(('', port), partial(NoCache, directory=str(ROOT))).serve_forever()
