import asyncio
from datetime import datetime
from typing import Callable, Awaitable

import numpy as np


async def mock_upstox_tick_stream(
  symbol: str,
  on_tick: Callable[[dict], Awaitable[None]],
  interval_ms: int = 1000,
) -> None:
  price = 100.0
  while True:
    change = float(np.random.normal(scale=0.2))
    price = max(1.0, price + change)
    tick = {
      "symbol": symbol,
      "ltp": price,
      "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    await on_tick(tick)
    await asyncio.sleep(interval_ms / 1000.0)


async def start_live_engine(symbols: list[str]) -> None:
  # Lazy import to avoid circular dependency
  from app.main import signal_manager
  
  async def on_tick(tick: dict):
    await signal_manager.broadcast({"type": "tick", "data": tick})

  tasks = [asyncio.create_task(mock_upstox_tick_stream(sym, on_tick)) for sym in symbols]
  await asyncio.gather(*tasks)

