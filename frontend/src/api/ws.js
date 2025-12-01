const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws/signals';

export function createSignalSocket(onMessage, symbol = null) {
  const socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('✅ WebSocket connected to', WS_URL);
    // Subscribe to symbol if provided
    if (symbol) {
      subscribeToSymbol(socket, symbol);
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // Ignore subscription confirmation messages
      if (data.type === 'subscribed') {
        console.log('✅ Subscribed to symbol:', data.symbol);
        return;
      }
      onMessage?.(data);
    } catch (e) {
      console.error('WS parse error', e);
    }
  };

  socket.onerror = (err) => {
    console.error('❌ WebSocket error', err);
  };

  socket.onclose = (event) => {
    console.log('WebSocket closed', event.code, event.reason);
  };

  // Method to subscribe to a symbol
  socket.subscribe = (newSymbol) => {
    subscribeToSymbol(socket, newSymbol);
  };

  return socket;
}

function subscribeToSymbol(socket, symbol) {
  if (socket.readyState === WebSocket.OPEN && symbol) {
    socket.send(JSON.stringify({ type: 'subscribe', symbol }));
    console.log('📡 Subscribing to symbol:', symbol);
  }
}

