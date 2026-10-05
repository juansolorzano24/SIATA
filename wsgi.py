"""Entrada de producción compartida con el servidor local."""
from server import response_for_url, SECURITY_HEADERS


def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    if method not in {"GET", "HEAD"}:
        body = b"Metodo no permitido"
        start_response("405 Method Not Allowed", [
            ("Content-Type", "text/plain; charset=utf-8"), ("Allow", "GET, HEAD"),
            ("Content-Length", str(len(body))), *SECURITY_HEADERS.items(),
        ])
        return [body]
    url = environ.get("PATH_INFO", "/")
    if environ.get("QUERY_STRING"):
        url += "?" + environ["QUERY_STRING"]
    status, headers, body = response_for_url(url, environ.get("HTTP_ACCEPT_ENCODING", ""))
    messages = {200: "OK", 400: "Bad Request", 404: "Not Found", 502: "Bad Gateway"}
    start_response(f"{status} {messages.get(status, 'Error')}", list(headers.items()))
    return [] if method == "HEAD" else [body]
