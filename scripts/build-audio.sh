#!/usr/bin/env bash
# BGM・効果音を「かなでる」（https://github.com/cadmium2525/mp4mp3 の daw/）で音にして public/audio/ に書き出す。
#   使い方: scripts/build-audio.sh <mp4mp3 リポジトリのパス>
# 必要: Node.js 20+, ffmpeg
set -euo pipefail
DAW="${1:?mp4mp3 リポジトリのパスを指定してください}/daw/tools/render.mjs"
SRC="$(cd "$(dirname "$0")/.." && pwd)/audio-src"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/audio"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# BGM：曲の長さ（24小節 @ 88BPM）で切り、はみ出た残響を頭に重ねて継ぎ目なくループさせる
LOOP=$(node -e 'const s=require(process.argv[1]);console.log((s.bars*s.sig[0]*60/s.bpm).toFixed(6))' "$SRC/bgm.json")
node "$DAW" "$SRC/bgm.json" "$TMP/bgm.wav" >/dev/null 2>&1
ffmpeg -loglevel error -y -i "$TMP/bgm.wav" -filter_complex \
  "[0]atrim=0:$LOOP,asetpts=N/SR/TB[a];[0]atrim=start=$LOOP,asetpts=N/SR/TB[b];[a][b]amix=inputs=2:duration=first:normalize=0" \
  -ar 44100 -c:a libmp3lame -b:a 128k "$OUT/bgm.mp3"
echo "bgm.mp3  loop=${LOOP}s"

for f in "$SRC"/gameover.json "$SRC"/se_*.json; do
  name=$(basename "$f" .json)
  node "$DAW" "$f" "$TMP/$name.wav" >/dev/null 2>&1
  ffmpeg -loglevel error -y -i "$TMP/$name.wav" -ar 44100 -c:a libmp3lame -b:a 128k "$OUT/$name.mp3"
  echo "$name.mp3"
done
