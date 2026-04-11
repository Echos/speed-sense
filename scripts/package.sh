#!/usr/bin/env bash
# SpeedSense パッケージ作成スクリプト
# Chrome Web Store 提出用の zip を store/ ディレクトリに生成する。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# manifest.json からバージョンを取得
VERSION="$(node -e "console.log(require('./manifest.json').version)")"
OUTPUT="store/speedsense-v${VERSION}.zip"

# パッケージに含めるファイル・ディレクトリ
INCLUDE=(
  manifest.json
  content.js
  popup.js
  popup.html
  i18n.js
  icons/
  LICENSE
)

echo "SpeedSense v${VERSION} をパッケージ化します..."

# 既存ファイルを上書き
if [[ -f "$OUTPUT" ]]; then
  echo "  既存ファイルを上書き: $OUTPUT"
  rm "$OUTPUT"
fi

zip -r "$OUTPUT" "${INCLUDE[@]}" \
  --exclude "*.DS_Store" \
  --exclude "*Thumbs.db" \
  > /dev/null

SIZE="$(du -sh "$OUTPUT" | cut -f1)"
echo "  完了: $OUTPUT ($SIZE)"
