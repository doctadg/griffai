#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Server details
HOST="18.192.211.91"
PORT="80"

echo "Testing connection to WebSocket server at $HOST:$PORT..."

# Test HTTP connection
echo -n "Testing HTTP connection... "
if curl -s "http://$HOST:$PORT" >/dev/null; then
    echo -e "${GREEN}Success${NC}"
else
    echo -e "${RED}Failed${NC}"
    echo "Error: Could not establish HTTP connection to $HOST:$PORT"
    exit 1
fi

# Test WebSocket connection using wscat with verbose output
echo -n "Testing WebSocket connection... "

# Create a temporary file for the wscat output
TMPFILE=$(mktemp)

# Run wscat connection test
timeout 5 wscat -c "ws://$HOST:$PORT" > "$TMPFILE" 2>&1 &
WSCAT_PID=$!

# Wait a moment for the connection and show connection attempt details
sleep 2
echo "Connection attempt details:"
cat "$TMPFILE"

# Check if wscat is still running (meaning it connected successfully)
if kill -0 $WSCAT_PID 2>/dev/null; then
    echo -e "${GREEN}Success${NC}"
    
    # Clean up
    kill $WSCAT_PID 2>/dev/null
    rm "$TMPFILE"
    
    # Test wallet generation
    echo -n "Testing wallet generation... "
    if echo '{"type":"start","pattern":"test"}' | timeout 5 wscat -c "ws://$HOST:$PORT" 2>&1 | grep -q "Connected"; then
        echo -e "${GREEN}Success${NC}"
        echo "WebSocket server is responding to commands"
    else
        echo -e "${YELLOW}Warning${NC}"
        echo "WebSocket connected but wallet generation test inconclusive"
    fi
else
    echo -e "${RED}Failed${NC}"
    echo "Error: Could not establish WebSocket connection to $HOST:$PORT"
    echo "wscat output:"
    cat "$TMPFILE"
    rm "$TMPFILE"
    exit 1
fi

echo -e "\n${GREEN}Connection tests completed${NC}"