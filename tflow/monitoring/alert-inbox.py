"""Local durable Alertmanager receiver for demos; production should use a team webhook."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
from datetime import datetime, timezone

DEST = Path(__file__).resolve().parent / 'secrets/inbox/alerts.jsonl'
class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if self.path != '/alerts' or not 0 < length <= 1048576:
            self.send_error(400)
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            self.send_error(400)
            return
        with DEST.open('a') as stream:
            stream.write(json.dumps({'received_at': datetime.now(timezone.utc).isoformat(), 'notification': body}) + '\n')
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args):
        pass
if __name__ == '__main__':
    DEST.parent.mkdir(parents=True, exist_ok=True)
    HTTPServer(('127.0.0.1', 9094), Receiver).serve_forever()
