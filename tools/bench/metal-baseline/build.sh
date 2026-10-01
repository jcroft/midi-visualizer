#!/bin/sh
# Builds and runs the native Metal comparison app. Needs Xcode Command Line Tools
# (install once with: xcode-select --install).
set -e
cd "$(dirname "$0")"
swiftc -O -swift-version 5 main.swift -o MetalBaseline \
  -framework AppKit -framework MetalKit -framework Metal -framework CoreMIDI
echo "Built ./MetalBaseline. Starting it (Ctrl+C or Cmd+Q to quit)..."
./MetalBaseline
