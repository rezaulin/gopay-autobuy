#!/bin/bash
# All-in-one: Start VNC + GoPay Bot
# Usage: ./start.sh [--phone 08123456789]

cd "$(dirname "$0")"

# Kill existing Xvfb/VNC
pkill -f "Xvfb :99" 2>/dev/null
pkill -f "x11vnc" 2>/dev/null
pkill -f "websockify.*6080" 2>/dev/null
sleep 1

# Start virtual display
Xvfb :99 -screen 0 1280x800x24 -ac &
XVFB_PID=$!
sleep 1
export DISPLAY=:99

# Start VNC (no password for local use)
x11vnc -display :99 -forever -nopw -rfbport 5900 -bg -o /tmp/x11vnc.log 2>/dev/null

# Start noVNC web interface
websockify --web=/usr/share/novnc/ 6080 localhost:5900 > /dev/null 2>&1 &
NOVNC_PID=$!
sleep 2

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   💰 GoPay Auto-Buy Bot                 ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║  🖥️  Browser: http://$IP:6080/vnc.html  ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Run bot
node bot.js "$@"

# Cleanup
kill $XVFB_PID 2>/dev/null
kill $NOVNC_PID 2>/dev/null
pkill -f "x11vnc" 2>/dev/null
