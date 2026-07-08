#!/bin/bash

EXT_NAME="SalesforceQuickLogin"
EXT_VERSION="1.0.0"
OUTPUT_DIR="../dist"

mkdir -p "$OUTPUT_DIR"

ZIP_FILE="${OUTPUT_DIR}/${EXT_NAME}_v${EXT_VERSION}.zip"

cd "$(dirname "$0")"

zip -r "$ZIP_FILE" \
  manifest.json \
  background.js \
  content.js \
  sidepanel.html \
  script.js \
  styles.css \
  icons/ \
  js/ \
  lib/ \
  docs/

echo "Packaging completed: $ZIP_FILE"
echo "File size: $(du -h "$ZIP_FILE" | cut -f1)"