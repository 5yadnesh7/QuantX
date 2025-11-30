import json
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel


class InstrumentConfig(BaseModel):
  """
  Instrument configuration as defined in backend/config/instruments.json.

  This is the single source of truth for:
  - display label
  - trading symbol (code used across the app)
  - Upstox instrument key (pipe format)
  - expiry type / calendar
  """

  label: str
  symbol: str
  instrumentKey: str
  expireType: str
  weekly: bool
  exchange: str
  nextStep: int
  nextExpiries: List[str]


@lru_cache
def load_instruments_config() -> List[InstrumentConfig]:
  """
  Load instruments from backend/config/instruments.json.

  The JSON file is treated as the canonical source of truth for
  all instrument/expiry mappings. No hard-coded symbol maps
  should exist elsewhere in the codebase.
  """
  root = Path(__file__).resolve().parents[2]
  config_path = root / "config" / "instruments.json"
  with config_path.open() as f:
    data = json.load(f)
  raw_list = data.get("instruments", [])
  return [InstrumentConfig(**item) for item in raw_list]


def find_instrument_by_symbol(symbol: str) -> Optional[InstrumentConfig]:
  """
  Convenience lookup by trading symbol (e.g. 'NIFTY', 'BANKNIFTY').
  Falls back to label match so UI can pass either.
  """
  sym_up = (symbol or "").upper()
  for inst in load_instruments_config():
    if inst.symbol.upper() == sym_up or inst.label.upper() == sym_up:
      return inst
  return None


def build_mock_price_map(base: float = 20000.0, step: float = 5000.0) -> dict[str, float]:
  """
  Deterministic mock spot/base prices per instrument for synthetic data paths.

  This is only used in offline / mock scenarios, but still derived
  purely from the instruments config instead of ad-hoc dicts.
  """
  prices: dict[str, float] = {}
  for idx, inst in enumerate(load_instruments_config()):
    prices[inst.symbol] = base + idx * step
  return prices



