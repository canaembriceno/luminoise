import http.server
import os
import socketserver
import threading
import webbrowser

PORT = 8766
URL = "http://127.0.0.1:%d/" % PORT

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Cabeceras de seguridad. La CSP tambien va en el <meta> del index.html,
# pero aqui se aplica como cabecera real (mas fuerte, no se puede eludir con DOM).
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data: blob:; "
        "media-src 'self' blob:; "
        "connect-src 'self'; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "object-src 'none'; "
        "frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class SecureHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.TCPServer):
    allow_reuse_address = True


try:
    httpd = Server(("127.0.0.1", PORT), SecureHandler)
except OSError as exc:
    print("El puerto %d esta ocupado: %s" % (PORT, exc))
    print("Cierra la ventana del servidor que ya esta corriendo y reintenta.")
    try:
        input("Enter para salir...")
    except EOFError:
        pass
    raise SystemExit(1)

print("Sirviendo en %s" % URL, flush=True)
print("Cierra esta ventana para liberar el puerto %d." % PORT, flush=True)

threading.Timer(0.4, lambda: webbrowser.open(URL)).start()

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    httpd.server_close()
    print("Servidor detenido. Puerto %d liberado." % PORT, flush=True)
