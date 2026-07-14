#!/usr/bin/env python3
"""Serve the Line of Sight tool locally.

Plain static file server — nothing more. The tool talks to Commons directly
from the browser (the action API accepts authenticated CORS requests via the
`crossorigin=` parameter since MediaWiki 1.44), so no proxy is needed; any
static host, GitHub Pages included, gets the full feature set.

Usage:  python3 serve.py [port]        (default 8000)
Then open http://localhost:<port>/
"""
import http.server
import sys

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Line of Sight tool → http://localhost:{port}/")
    http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), http.server.SimpleHTTPRequestHandler
    ).serve_forever()
