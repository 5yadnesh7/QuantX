import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.websocket.live_engine import start_live_engine
from app.utils.instruments_config import load_instruments_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start the live engine with all instruments
    try:
        instruments = load_instruments_config()
        symbols = [inst.symbol for inst in instruments]
        if symbols:
            # Start the live engine in the background
            asyncio.create_task(start_live_engine(symbols))
            print(f"✅ Live engine started with symbols: {', '.join(symbols)}")
        else:
            print("⚠️  No instruments found, live engine not started")
    except Exception as e:
        print(f"❌ Error starting live engine: {e}")
    yield
    # Shutdown: cleanup if needed
    pass


app = FastAPI(
    title="QuantX – Real-Time Options Analytics Terminal",
    lifespan=lifespan
)

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
  return {"status": "ok"}


class SignalManager:
  def __init__(self):
    self.active_connections: dict[WebSocket, str] = {}  # websocket -> subscribed_symbol

  async def connect(self, websocket: WebSocket):
    await websocket.accept()
    self.active_connections[websocket] = None  # No symbol subscribed initially

  def disconnect(self, websocket: WebSocket):
    if websocket in self.active_connections:
      del self.active_connections[websocket]

  def subscribe(self, websocket: WebSocket, symbol: str):
    """Subscribe a websocket connection to a specific symbol"""
    if websocket in self.active_connections:
      self.active_connections[websocket] = symbol

  async def broadcast(self, message: dict):
    """Broadcast message only to connections subscribed to the symbol in the message"""
    tick_data = message.get("data", {})
    tick_symbol = tick_data.get("symbol")
    
    for connection, subscribed_symbol in list(self.active_connections.items()):
      # Only send if connection is subscribed to this symbol (or None for all)
      if subscribed_symbol is None or subscribed_symbol == tick_symbol:
        try:
          await connection.send_json(message)
        except Exception:
          self.disconnect(connection)


signal_manager = SignalManager()


@app.websocket("/ws/signals")
async def websocket_signals(websocket: WebSocket):
  await signal_manager.connect(websocket)
  try:
    while True:
      data = await websocket.receive_text()
      try:
        import json
        message = json.loads(data)
        if message.get("type") == "subscribe" and "symbol" in message:
          symbol = message["symbol"]
          signal_manager.subscribe(websocket, symbol)
          await websocket.send_json({"type": "subscribed", "symbol": symbol})
      except (json.JSONDecodeError, KeyError):
        # Ignore invalid messages, just keep connection alive
        pass
  except WebSocketDisconnect:
    signal_manager.disconnect(websocket)
