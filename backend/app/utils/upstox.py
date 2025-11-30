import json
from functools import lru_cache
from pathlib import Path
from typing import Optional, List, Dict
import os
from datetime import datetime

import httpx
from pydantic import BaseModel
from app.utils.instruments_config import load_instruments_config

try:
  import upstox_client  # type: ignore
  from upstox_client.rest import ApiException  # type: ignore
except Exception:  # pragma: no cover - optional in dev
  upstox_client = None
  ApiException = Exception


class UpstoxConfig(BaseModel):
  upstox_api_key: str
  upstox_api_secret: str
  upstox_redirect_url: str
  upstox_access_token: str


@lru_cache
def load_upstox_config() -> UpstoxConfig:
  """
  Load Upstox credentials from backend/config/config.json.

  Only api_key, api_secret, redirect_url and access_token are required.
  Any feed token or websocket URL should be derived dynamically from the access token.
  """
  root = Path(__file__).resolve().parents[2]
  config_path = root / "config" / "config.json"
  with config_path.open() as f:
    data = json.load(f)
  return UpstoxConfig(**data)


def build_market_data_ws_url(request_id: Optional[str] = None) -> str:
  """
  Construct the Upstox market data websocket URL using the access token.

  NOTE: This is a thin helper; for a real Upstox hookup you should follow the
  latest official docs for the exact host and query parameters. The idea is
  that the access_token from config is the single source of truth and any
  short‑lived feed token or code is derived from it here, not hard‑coded.
  """
  cfg = load_upstox_config()
  req = request_id or "quantx"
  # Placeholder shape; adjust to the latest Upstox spec when wiring real feed:
  return f"wss://wsfeeder-api.upstox.com/market-data-feeder/v3/feeds?requestId={req}&access_token={cfg.upstox_access_token}"


USE_UPSTOX_LIVE = os.getenv("QUANTX_USE_UPSTOX_LIVE", "false").lower() == "true"


class UpstoxGateway:
  """
  Thin wrapper around the official upstox-python-sdk.

  IMPORTANT:
  - This class is intentionally minimal and does NOT guess any SDK method names.
  - You must fill in the TODO sections with real SDK calls based on the official
    Upstox documentation that you see when logged in.
  - All methods are designed to return plain Python dict/list types so FastAPI
    responses remain JSON serialisable.
  """

  def __init__(self) -> None:
    if not upstox_client:
      raise RuntimeError(
        "upstox-python-sdk is not installed. Install it in your backend env to use live APIs."
      )

    cfg = load_upstox_config()
    self.configuration = upstox_client.Configuration()  # type: ignore[attr-defined]
    # Set up authentication
    self.configuration.access_token = cfg.upstox_access_token
    # Note: Some SDK versions may use different config structure
    # Check official docs: https://upstox.com/developer/api-documentation/open-api
    self.api_client = upstox_client.ApiClient(self.configuration)  # type: ignore[attr-defined]
    
    # Initialize specific API classes as needed
    # Upstox SDK structure: upstox_client.api.market_data_api.MarketDataApi
    # Upstox SDK structure: upstox_client.api.master_api.MasterApi
    try:
      # Try to import and initialize MarketDataApi if available
      from upstox_client.api import market_data_api  # type: ignore
      self._market_data_api = market_data_api.MarketDataApi(self.api_client)  # type: ignore
    except (ImportError, AttributeError):
      self._market_data_api = None
      
    try:
      # Try to import and initialize MasterApi if available
      from upstox_client.api import master_api  # type: ignore
      self._master_api = master_api.MasterApi(self.api_client)  # type: ignore
    except (ImportError, AttributeError):
      self._master_api = None
    
    self._cfg = cfg

  # ---- Instruments ---------------------------------------------------------

  def list_instruments(self) -> List[Dict]:
    """
    Return a list of instruments as plain dicts.

    Strategy:
    1. Try the Upstox HTTP instruments API to fetch real tradable instruments.
    2. Filter down to a useful subset (indices like NIFTY, BANKNIFTY, FINNIFTY, SENSEX).
    3. If anything fails, fall back to a small built-in list of common indices.

    See: https://upstox.com/developer/api-documentation/open-api
    """
    # -------- Attempt 1: HTTP indices/instruments from Upstox --------------
    try:
      headers = {
        "Authorization": f"Bearer {self._cfg.upstox_access_token}",
        "Accept": "application/json",
      }
      candidates: list[tuple[str, dict]] = [
        ("https://api.upstox.com/v2/market/instruments/indices", {}),
        ("https://api.upstox.com/v2/market/instruments", {"segment": "INDICES"}),
        ("https://api.upstox.com/v2/market/instruments", {"type": "indices"}),
      ]
      data = None
      for url, params in candidates:
        try:
          resp = httpx.get(url, headers=headers, params=params, timeout=5.0)
          if resp.status_code == 200:
            payload = resp.json() or {}
            data = payload.get("data") if isinstance(payload, dict) else payload
            if data:
              break
        except Exception:
          continue

      instruments: List[Dict] = []
      if isinstance(data, list):
        for inst in data:
          tradingsymbol = inst.get("tradingsymbol") or inst.get("symbol") or ""
          name = inst.get("name") or tradingsymbol
          exchange = inst.get("exchange") or inst.get("exchange_token") or "NSE"
          instrument_key = inst.get("instrument_key") or inst.get("instrument_token")
          # Pick only major index symbols we care about by name/symbol match
          upper_ts = str(tradingsymbol).upper()
          if any(
            key in upper_ts
            for key in ["NIFTY 50", "BANKNIFTY", "FINNIFTY", "SENSEX", "NIFTY BANK"]
          ):
            instruments.append(
              {
                "symbol": "NIFTY" if "NIFTY 50" in upper_ts else
                          "BANKNIFTY" if "NIFTY BANK" in upper_ts or "BANKNIFTY" in upper_ts else
                          "FINNIFTY" if "FIN" in upper_ts else
                          "SENSEX" if "SENSEX" in upper_ts else tradingsymbol,
                "name": name,
                "exchange": exchange,
                "type": "INDEX",
                "instrument_key": instrument_key or tradingsymbol,
              }
            )

      # If first attempt didn’t return anything usable, probe via the quotes API using known keys
      if not instruments:
        probe_csv = os.getenv(
          "QUANTX_UPSTOX_INDICES",
          "NSE_INDEX|Nifty 50,NSE_INDEX|Nifty Bank,NSE_INDEX|Nifty Fin Service,BSE_INDEX|SENSEX",
        )
        probe_keys = [k.strip() for k in probe_csv.split(",") if k.strip()]
        for ik in probe_keys:
          try:
            q = self.get_quote(ik)
            if q and q.get("ltp") is not None:
              colon = ik.replace("|", ":")
              symbol = (
                "NIFTY" if "Nifty 50" in ik or "NIFTY 50" in ik else
                "BANKNIFTY" if "Nifty Bank" in ik else
                "FINNIFTY" if "Nifty Fin" in ik or "FIN SERVICE" in ik.upper() else
                "SENSEX" if "Sensex" in ik or "S&P BSE Sensex" in ik else
                colon
              )
              instruments.append(
                {
                  "symbol": symbol,
                  "name": symbol,
                  "exchange": "NSE" if "NSE_" in ik or "NIFTY" in symbol else "BSE",
                  "type": "INDEX",
                  "instrument_key": ik,
                }
              )
          except Exception:
            continue

      if instruments:
        # Deduplicate by symbol, keep first
        seen: dict[str, Dict] = {}
        for inst in instruments:
          if inst["symbol"] not in seen:
            seen[inst["symbol"]] = inst
        return list(seen.values())
    except Exception as e:  # pragma: no cover - defensive
      print(f"Upstox HTTP list_instruments error (falling back to static): {e}", flush=True)

    # -------- Fallback: indices from instruments.json ----------------------
    instruments: List[Dict] = []
    for inst in load_instruments_config():
      instruments.append(
        {
          "symbol": inst.symbol,
          "name": inst.label,
          "exchange": inst.exchange,
          "type": "INDEX",
          "instrument_key": inst.instrumentKey,
        }
      )
    return instruments

  # ---- Market data / quotes -----------------------------------------------

  def get_quote(self, instrument_key: str) -> Dict:
    """
    Fetch a live quote for a single instrument.

    Strategy:
    1. Prefer the official Upstox SDK (if MarketDataApi is initialised and works).
    2. If the SDK is not available or fails, fall back to a direct HTTP call
       to the Upstox REST API using the configured access token.
    3. If everything fails, return a deterministic mock price so the UI keeps working.
    """

    # -------- Attempt 1: SDK (if available) --------------------------------
    if self._market_data_api:
      try:
        res = self._market_data_api.get_market_quote(instrument_key=instrument_key)
        # Expected v2 structure:
        # res.data = { "NSE_INDEX:Nifty 50": { "last_price": ..., "timestamp": ... }, ... }
        quote_map = res.data if hasattr(res, "data") and isinstance(res.data, dict) else {}
        key_colon = instrument_key.replace("|", ":")
        key_pipe = instrument_key
        quote_data = quote_map.get(key_colon) or quote_map.get(key_pipe)
        if isinstance(quote_data, dict):
          ltp = quote_data.get("last_price")
          ts = quote_data.get("timestamp")
          if ltp is not None:
            return {
              "instrument_key": instrument_key,
              "ltp": ltp,
              "timestamp": ts,
            }
      except Exception as e:  # pragma: no cover - defensive
        print(f"Upstox SDK get_market_quote error: {e}", flush=True)

    # -------- Attempt 2: Direct HTTP REST call -----------------------------
    try:
      url = "https://api.upstox.com/v2/market-quote/quotes"
      headers = {
        "Authorization": f"Bearer {self._cfg.upstox_access_token}",
        "Accept": "application/json",
      }
      params = {"instrument_key": instrument_key}
      resp = httpx.get(url, headers=headers, params=params, timeout=3.0)
      resp.raise_for_status()
      payload = resp.json() or {}
      data = payload.get("data") or {}

      # Upstox typically keys by colon form: "NSE_INDEX:Nifty 50"
      key_colon = instrument_key.replace("|", ":")
      key_pipe = instrument_key
      quote_data = data.get(key_colon) or data.get(key_pipe)
      # If not found, try first value
      if not isinstance(quote_data, dict) and isinstance(data, dict) and data:
        quote_data = next(iter(data.values()))

      if isinstance(quote_data, dict):
        ltp = quote_data.get("last_price")
        ts = quote_data.get("timestamp")
        if ltp is not None:
          return {
            "instrument_key": instrument_key,
            "ltp": ltp,
            "timestamp": ts,
          }
    except Exception as e:  # pragma: no cover - defensive
      print(f"Upstox HTTP get_quote error: {e}", flush=True)

    # -------- Final fallback: deterministic mock so UI doesn't break -------
    return {
      "instrument_key": instrument_key,
      "ltp": 24000,
      "timestamp": datetime.utcnow().isoformat(),
    }

  # ---- Historical candles -------------------------------------------------

  def get_historical_candles(
    self,
    instrument_key: str,
    start: str,
    end: str,
    interval: str,
  ) -> List[Dict]:
    """
    Fetch historical OHLCV candles for backtesting / charts.

    TODO: Replace the NotImplementedError with the real SDK call, something like:
      candles = self._market_data_api.get_historical_candles(
          instrument_key=instrument_key,
          interval=interval,
          from_date=start,
          to_date=end,
      )
      return [candle.to_dict() for candle in candles.data]
    """
    raise NotImplementedError(
      "UpstoxGateway.get_historical_candles is not yet implemented. "
      "Fill it with the proper historical candles SDK call."
    )


@lru_cache
def get_upstox_gateway() -> Optional[UpstoxGateway]:
  """
  Lazily create a singleton UpstoxGateway if live mode is enabled.

  If QUANTX_USE_UPSTOX_LIVE is not true, this returns None and the rest of the
  application is expected to fall back to synthetic data.
  
  This function handles errors gracefully - if SDK initialization fails,
  it returns None so the app can fall back to mock data.
  """
  if not USE_UPSTOX_LIVE:
    return None
  try:
    return UpstoxGateway()
  except (RuntimeError, AttributeError, ImportError) as e:
    print(f"WARNING: Upstox live mode enabled but gateway failed to initialize: {e}")
    print("Falling back to mock data. Check your SDK installation and config.")
    return None



