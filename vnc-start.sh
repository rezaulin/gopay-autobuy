#!/bin/bash
# Start VNC server for remote browser viewing
# Access via: http://YOUR_IP:6080/vnc.html

cd "$(dirname "$0")"

# Start Xvfb
echo "Starting virtual display..."
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99
sleep 1

# Start x11vnc
echo "Starting VNC server on port 5900..."
x11vnc -display :99 -forever -nopw -rfbport 5900 -bg -o /tmp/x11vnc.log

# Start noVNC (web browser access)
echo "Starting noVNC web interface on port 6080..."
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
sleep 2

echo ""
echo "============================================"
echo "🖥️  VNC Ready!"
echo "============================================"
echo "Web access: http://$(hostname -I | awk '{print $1}'):6080/vnc.html"
echo "Direct VNC: $(hostname -I | awk '{print $1}'):5900"
echo "============================================"
echo ""
echo "Now run: node bot.js"
echo "Or press Ctrl+C to stop VNC"
echo ""

# Keep alive
wait
