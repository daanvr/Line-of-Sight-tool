#!/usr/bin/env python3
"""Serve the Line of Sight tool locally, with a MediaWiki API proxy.

Static files come from this directory. Any request whose path starts with /w/
is forwarded to https://commons.wikimedia.org with the browser's Authorization
header passed through. Browsers cannot call the authenticated Commons action
API cross-origin (its CORS mode anonymizes requests), and structured-data
(SDC) edits need that API — hence this little same-origin proxy.

Usage:  python3 serve.py [port]        (default 8000)
Then open http://localhost:<port>/
"""
import http.server
import sys
import urllib.error
import urllib.request

UPSTREAM = "https://commons.wikimedia.org"
USER_AGENT = "LineOfSightTool/0.1 (local testing; serve.py proxy)"


class Handler(http.server.SimpleHTTPRequestHandler):
    def _proxy(self):
        url = UPSTREAM + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(url, data=body, method=self.command)
        for h in ("Authorization", "Content-Type", "Accept"):
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        req.add_header("User-Agent", USER_AGENT)
        req.add_header("Api-User-Agent", USER_AGENT)
        try:
            with urllib.request.urlopen(req) as r:
                data = r.read()
                status = r.status
                ctype = r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            data = e.read()
            status = e.code
            ctype = e.headers.get("Content-Type", "application/json")
        except Exception as e:  # DNS failure, timeout, …
            self.send_error(502, str(e))
            return
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/w/"):
            return self._proxy()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/w/"):
            return self._proxy()
        self.send_error(404)

    def do_PUT(self):
        if self.path.startswith("/w/"):
            return self._proxy()
        self.send_error(404)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Line of Sight tool → http://localhost:{port}/  (proxying /w/ → {UPSTREAM})")
    # Local-only on purpose: the proxy forwards Authorization headers.
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
