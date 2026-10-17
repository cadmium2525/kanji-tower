# PV（X 投稿用・縦 1080×1920・19秒）

「かなでる」で音楽、「つなぐ」で編集（どちらも https://github.com/cadmium2525/mp4mp3 ）。

| ファイル | 内容 |
| --- | --- |
| `capture.mjs` | 実際のゲームをコマ送りで撮影（ゲームの時計を差し替えて1/30秒ずつ進める）。崩れ方が派手になる積み方を自動で探す |
| `music.json` | BGM（かなでる形式。120BPM・Dマイナー、0秒で一撃、3秒からグルーヴ、15秒で決め） |
| `project.json` | 編集（つなぐ形式。カットはすべて拍に合わせてある） |
| `pw-chromium.cjs` | つなぐの書き出しを、この環境の Chromium で動かすための前読み込み |

## 作り直し方

```sh
# 1) ランキング撮影用にエミュレーター接続でビルドし、エミュレーターとプレビューを起動
VITE_FIREBASE_API_KEY=demo-key VITE_FIREBASE_PROJECT_ID=demo-kanji VITE_FIREBASE_EMULATOR=127.0.0.1 npx vite build --outDir /tmp/pvdist
npx -y firebase-tools@15.34.0 emulators:start --project demo-kanji &
npx vite preview --outDir /tmp/pvdist --port 4180 &
# 2) 撮影（VARIANT を省くと崩れ方の探索から）
VARIANT='{"calm":4,"amp":28}' node pv/capture.mjs pv/footage http://localhost:4180/
# 3) 素材を VP9 に（Chromium で読めるように）、音楽を書き出し
for n in main input title; do ffmpeg -framerate 30 -i pv/footage/$n/%05d.jpg -c:v libvpx-vp9 -crf 16 -b:v 0 media/$n.webm; done
node ../mp4mp3/daw/tools/render.mjs pv/music.json media/music.wav
# 4) 書き出し
node --require ./pv/pw-chromium.cjs ../mp4mp3/editor/tools/render.mjs pv/project.json media pv/out/kanji-tower-pv.mp4
```
