#!/bin/sh
# Builds the probe next to this script. Needs Xcode command line tools only.
set -e
cd "$(dirname "$0")"
swiftc -O -o audio-probe AudioProbe.swift
echo "built ./tools/audio-probe/audio-probe"
