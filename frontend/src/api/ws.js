const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws/signals';

export function createSignalSocket(onMessage) {
  const socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    // no-op: backend doesn't require subscription message yet
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage?.(data);
    } catch (e) {
      console.error('WS parse error', e);
    }
  };

  socket.onerror = (err) => {
    console.error('WebSocket error', err);
  };

  return socket;
}

