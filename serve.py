#!/usr/bin/env python3
"""Dev server for the demo pages.

`python3 -m http.server` sends Last-Modified and no Cache-Control, so browsers
apply heuristic freshness and stop revalidating edited modules entirely. That has
cost this project three separate debugging sessions — twice a stale rig, once a
module that reported a missing export it plainly had. This sends no-store, so a
reload always gets what is on disk.

    python3 serve.py [port]        # default 8777
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
print(f'serving {__file__.rsplit("/", 1)[0]} on http://localhost:{port}')
ThreadingHTTPServer(('', port), NoCache).serve_forever()
