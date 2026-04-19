#!/bin/bash
# Run GoPay Auto-Buy Bot with virtual display (xvfb)
# Usage: ./run.sh [bot.js args]
cd "$(dirname "$0")"

# Check if DISPLAY is set, if not use xvfb
if [ -z "$DISPLAY" ]; then
  exec xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" node bot.js "$@"
else
  exec node bot.js "$@"
fi
