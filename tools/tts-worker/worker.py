#!/usr/bin/env python3
"""Local Edge TTS worker for Creator Studio R5.

Runs on 127.0.0.1 only. The browser sends text/voice/rate/pitch, gets MP3 bytes
(base64) plus sentence timestamps back. It does not write media to disk.
"""
import argparse
import asyncio
import base64
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import edge_tts
except Exception as exc:  # pragma: no cover - runtime environment dependent
    edge_tts = None
    IMPORT_ERROR = str(exc)
else:
    IMPORT_ERROR = ""

VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunyangNeural",
]
MAX_TEXT_CHARS = 20000
DEFAULT_PORT = 3101
# edge-tts default output: audio-24khz-48kbitrate-mono-mp3 => 6000 bytes/sec.
MP3_BYTES_PER_SECOND = 6000


def synth(text, voice, rate, pitch):
    if edge_tts is None:
        raise RuntimeError("edge-tts 未安装：" + IMPORT_ERROR)

    async def run():
        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
        audio = bytearray()
        boundaries = []
        async for chunk in communicate.stream():
            kind = chunk.get("type")
            if kind == "audio":
                audio.extend(chunk.get("data", b""))
            elif kind in ("SentenceBoundary", "WordBoundary"):
                start_ms = round(int(chunk.get("offset", 0)) / 10000)
                end_ms = round((int(chunk.get("offset", 0)) + int(chunk.get("duration", 0))) / 10000)
                label = str(chunk.get("text", "")).strip()
                if label and end_ms > start_ms:
                    boundaries.append({
                        "startMs": start_ms,
                        "endMs": end_ms,
                        "text": label,
                        "kind": kind,
                    })
        return bytes(audio), boundaries

    return asyncio.run(run())


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    server_version = "CreatorStudioTTS/1.0"

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/health":
            json_response(self, 404, {"ok": False, "error": "not found"})
            return
        if edge_tts is None:
            json_response(self, 503, {
                "ok": False,
                "provider": "edge-tts",
                "error": "edge-tts 未安装：" + IMPORT_ERROR,
            })
            return
        json_response(self, 200, {
            "ok": True,
            "provider": "edge-tts",
            "voices": VOICES,
            "runtime": "local-python",
        })

    def do_POST(self):
        if self.path.split("?")[0] != "/synthesize":
            json_response(self, 404, {"ok": False, "error": "not found"})
            return
        if edge_tts is None:
            json_response(self, 503, {
                "ok": False,
                "provider": "edge-tts",
                "error": "edge-tts 未安装：" + IMPORT_ERROR,
            })
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("请求体为空或过大")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload.get("text", "")).strip()
            voice = str(payload.get("voice", VOICES[0]))
            rate = str(payload.get("rate", "0%"))
            pitch = str(payload.get("pitch", "0Hz"))
            if not text:
                raise ValueError("text 不能为空")
            if len(text) > MAX_TEXT_CHARS:
                raise ValueError(f"text 超过 {MAX_TEXT_CHARS} 字上限")
            if voice not in VOICES:
                raise ValueError("不支持的 voice")
            if not re.fullmatch(r"[-+]\d{1,3}%", rate):
                raise ValueError("rate 格式应为 +0% / -10%")
            if not re.fullmatch(r"[-+]\d{1,3}Hz", pitch):
                raise ValueError("pitch 格式应为 +0Hz / -2Hz")

            audio, boundaries = synth(text, voice, rate, pitch)
            if not audio:
                raise RuntimeError("TTS 返回空音频")
            if boundaries:
                duration_sec = round(boundaries[-1]["endMs"] / 1000, 2)
                timing_source = "tts-sentence"
            else:
                duration_sec = round(len(audio) / MP3_BYTES_PER_SECOND, 2)
                timing_source = "estimated"
            json_response(self, 200, {
                "ok": True,
                "provider": "edge-tts",
                "voice": voice,
                "rate": rate,
                "pitch": pitch,
                "mime": "audio/mpeg",
                "size": len(audio),
                "durationSec": duration_sec,
                "timingSource": timing_source,
                "boundaries": boundaries,
                "audioBase64": base64.b64encode(audio).decode("ascii"),
            })
        except ValueError as exc:
            json_response(self, 400, {"ok": False, "error": str(exc)})
        except Exception as exc:  # network / upstream / synthesis errors
            print(f"[tts-worker] synthesis failed: {exc}", file=sys.stderr, flush=True)
            json_response(self, 502, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        print(f"[tts-worker] {self.address_string()} {fmt % args}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    if edge_tts is None:
        print("[tts-worker] edge-tts missing: " + IMPORT_ERROR, file=sys.stderr)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[tts-worker] listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
