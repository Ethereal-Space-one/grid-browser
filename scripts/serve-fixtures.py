#!/usr/bin/env python3
"""Serve the local browser fixtures with media MIME types on loopback."""

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    fixture_dir = Path(__file__).resolve().parents[1] / "fixtures" / "web"
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(fixture_dir))
    SimpleHTTPRequestHandler.extensions_map.update({".vtt": "text/vtt"})
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Grid fixtures: http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
