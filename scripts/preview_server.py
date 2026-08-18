from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        raw_path = self.path.split('?', 1)[0].split('#', 1)[0]
        if raw_path == '/api/public-config':
            body = json.dumps({
                'appUrl': 'http://localhost:5600',
                'desktopDownloadUrl': 'https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe',
                'supabaseUrl': '',
                'supabaseAnonKey': '',
                'stripeConfigured': False,
                'contactEmail': 'zevqora.ai@gmail.com',
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return

        if raw_path != '/' and '.' not in Path(raw_path).name:
            candidate = ROOT / (raw_path.lstrip('/') + '.html')
            if candidate.is_file():
                self.path = raw_path + '.html' + (('?' + self.path.split('?',1)[1]) if '?' in self.path else '')
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    address = ('127.0.0.1', 5600)
    print('ZEVQORA preview: http://localhost:5600')
    print('Press Ctrl+C to stop.')
    ThreadingHTTPServer(address, Handler).serve_forever()
