# 本地浏览器夹具

在仓库根目录运行 `python3 scripts/serve-fixtures.py`，访问 `http://127.0.0.1:8765/`。服务只监听本机，并为字幕提供 `text/vtt` MIME 类型。`media.html` 使用原生 `<video>` 检查浏览器媒体能力，不加载 Video.js 或远端资源。

`grid-media-test.webm` 是本项目用 FFmpeg 的 `testsrc2` 和 `sine` 滤镜合成的 36 秒 VP9/Opus 样本，画面和提示音不来自第三方视频。生成命令：

```sh
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i testsrc2=size=320x180:rate=2 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 36 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 100k \
  -c:a libopus -b:a 24k -shortest \
  fixtures/web/grid-media-test.webm
```

这一个样本只能验证 VP9/Opus 的基础播放。H.264/AAC、HLS/DASH、DRM、硬件解码和真实视频网站仍需分别测试；`canPlayType` 的提示不能代替真实播放结果。
