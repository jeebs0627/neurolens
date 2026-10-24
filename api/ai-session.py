from http.server import BaseHTTPRequestHandler
from ai_guard import GuardError,send,start_session

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try: start_session(self)
        except GuardError as error: send(self,error.status,{'error':error.code,'code':error.code})
