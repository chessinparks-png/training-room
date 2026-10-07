// Local server for the Training Room macOS app. Serves the bundled site on 127.0.0.1:8765 only,
// with correct MIME types (JavaScript modules, WebAssembly), and exits after a long idle spell.
// The app's service worker keeps it usable offline even when this server is not running.
package main

import (
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

func main() {
	root := "."
	if len(os.Args) > 1 {
		root = os.Args[1]
	}
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	for ext, t := range map[string]string{".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".wasm": "application/wasm",
		".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".css": "text/css; charset=utf-8"} {
		mime.AddExtensionType(ext, t)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:8765")
	if err != nil {
		os.Exit(0) // already running (or the port is taken): the launcher just opens the browser
	}
	var last atomic.Int64
	last.Store(time.Now().Unix())
	files := http.FileServer(http.Dir(root))
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		last.Store(time.Now().Unix())
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	go func() {
		for range time.Tick(time.Minute) {
			if time.Now().Unix()-last.Load() > 3*3600 {
				os.Exit(0)
			}
		}
	}()
	http.Serve(ln, h)
}
