# Creator Studio · 本地 TTS Worker（R5）

只在 `127.0.0.1` 上运行的 Edge TTS worker。浏览器发送台词，worker 返回 MP3（base64）和句级时间戳；音频不会写到磁盘，也不会上传云端。

## 启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/tts-worker/start-tts-worker.ps1
```

首次启动会在 `logs/tts-venv` 创建 Python venv 并安装 `edge-tts`（logs 已被 gitignore）。也可以手动：

```bash
python -m venv logs/tts-venv
logs/tts-venv/Scripts/python.exe -m pip install -r tools/tts-worker/requirements.txt
logs/tts-venv/Scripts/python.exe tools/tts-worker/worker.py --port 3101
```

健康检查：

```bash
curl http://127.0.0.1:3101/health
```

## 端点

- `GET /health`：`{ok, provider, voices}`
- `POST /synthesize`：`{text, voice, rate, pitch}` → `{ok, audioBase64, mime, durationSec, boundaries, timingSource}`
  - `rate` 形如 `+0%` / `-10%`；`pitch` 形如 `+0Hz`
  - `boundaries` 是 Edge TTS 的 `SentenceBoundary`（句级时间戳），不是逐字对齐

## 边界

- worker 不可用时，应用会把配音阶段显示为阻塞/失败，不生成假音频。
- 音频 Blob 由浏览器存进本机 IndexedDB 的 `runMedia` 表；本地备份和云同步都不包含媒体。
- 没有安装 `edge-tts` 时 `/health` 返回 503，应用会提示先启动 worker。
