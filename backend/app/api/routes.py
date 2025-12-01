from datetime import datetime, timedelta
from typing import List, Optional
import random

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models.schemas import (
  OptionChainResponse,
  ProbabilityRequest,
  ProbabilityResult,
  IVRequest,
  IVResponse,
  OIRequest,
  OIResponse,
  MarketRequest,
  MarketResponse,
  ConsensusRequest,
  ConsensusResponse,
  GreeksRequest,
  GreeksResponse,
  StrategyRunRequest,
  StrategyBacktestRequest,
  StrategySaveRequest,
  BacktestResult,
  BacktestStats,
  FiiDiiResponse,
  FiiDiiDay,
  ModelsInsightsResponse,
)
from app.services import probability as prob_svc
from app.services import volatility as vol_svc
from app.services import oi as oi_svc
from app.services import market as mkt_svc
from app.services import greeks as greeks_svc
from app.consensus.engine import compute_consensus
from app.strategies.engine import run_live_strategy
from app.backtest.engine import run_backtest
from app.utils.db import get_db
from app.utils.upstox import get_upstox_gateway, load_upstox_config, USE_UPSTOX_LIVE
from app.utils.instruments_config import (
  InstrumentConfig,
  load_instruments_config,
  find_instrument_by_symbol,
  build_mock_price_map,
)

router = APIRouter()


@router.get("/instruments", response_model=List[InstrumentConfig])
async def get_instruments():
  """
  Return instruments exactly as defined in backend/config/instruments.json.

  This file is the single source of truth for all instrument / expiry metadata
  used by the frontend and the rest of the backend.
  """
  # Fast, cached load from backend/config/instruments.json
  return load_instruments_config()


# ---- Dashboard live prediction ----------------------------------------------


class DashboardStrikeSnapshot(BaseModel):
  strike: float
  call_oi: float = 0.0
  put_oi: float = 0.0
  call_volume: float = 0.0
  put_volume: float = 0.0
  call_iv: Optional[float] = None
  put_iv: Optional[float] = None
  call_delta: Optional[float] = None
  put_delta: Optional[float] = None


class DashboardPredictionResponse(BaseModel):
  symbol: str
  expiry: datetime
  spot: float
  atm_strike: float
  window_strikes: List[DashboardStrikeSnapshot]
  pcr_oi: Optional[float] = None
  pcr_volume: Optional[float] = None
  window_pcr_oi: Optional[float] = None
  window_pcr_volume: Optional[float] = None
  net_delta: Optional[float] = None
  prediction: Optional[str] = None
  confidence: Optional[float] = None


@router.get("/analytics/dashboard", response_model=DashboardPredictionResponse)
async def get_dashboard_prediction(symbol: str, expiry: Optional[str] = None):
  """
  Live dashboard prediction based on the nearest 5 strikes above/below ATM:
  - Use instruments.json (instrumentKey, nextStep, expiries) as single source of truth
  - Fetch option chain from Upstox via /chain/live
  - Focus on 11-strike window around ATM (±5 * nextStep)
  - Aggregate OI, volume, and Greeks to produce a directional prediction.
  """
  inst_cfg = find_instrument_by_symbol(symbol)
  now = datetime.utcnow()

  # Resolve expiry string (YYYY-MM-DD) and datetime
  expiry_str: Optional[str] = None
  if expiry:
    expiry_str = expiry
  elif inst_cfg and inst_cfg.nextExpiries:
    expiry_str = inst_cfg.nextExpiries[0]
  else:
    expiry_str = (now + timedelta(days=7)).date().isoformat()

  try:
    expiry_dt = datetime.fromisoformat(expiry_str)
  except Exception:
    expiry_dt = now + timedelta(days=7)
    expiry_str = expiry_dt.date().isoformat()

  # Get live option chain scoped to this expiry
  chain: Optional[OptionChainResponse] = None
  try:
    chain = await get_live_chain(symbol, expiry_str)  # type: ignore
  except Exception:
    chain = None
  if not chain or not getattr(chain, "entries", None):
    # Minimal empty response so UI can handle gracefully
    quote = await get_quote(symbol)  # type: ignore
    spot = float(quote.get("price") or 0.0)
    return DashboardPredictionResponse(
      symbol=symbol,
      expiry=expiry_dt,
      spot=spot,
      atm_strike=0.0,
      window_strikes=[],
      pcr_oi=None,
      pcr_volume=None,
      window_pcr_oi=None,
      window_pcr_volume=None,
      net_delta=None,
      prediction=None,
      confidence=None,
    )

  entries = chain.entries  # type: ignore

  # -------- Full-chain aggregates for PCR (use entire option chain) ----------
  full_call_oi = 0.0
  full_put_oi = 0.0
  full_call_vol = 0.0
  full_put_vol = 0.0

  def _to_num_chain(x) -> Optional[float]:
    try:
      if isinstance(x, (int, float)):
        return float(x)
      if isinstance(x, str):
        s = x.strip().replace(",", "")
        if s == "":
          return None
        return float(s)
    except Exception:
      return None
    return None

  for e in entries:
    t = getattr(e, "option_type", None)
    vol = _to_num_chain(getattr(e, "volume", None))
    oi = _to_num_chain(getattr(e, "open_interest", None))
    if vol is not None:
      if str(t).upper().startswith("P"):
        full_put_vol += vol
      else:
        full_call_vol += vol
    if oi is not None:
      if str(t).upper().startswith("P"):
        full_put_oi += oi
      else:
        full_call_oi += oi

  pcr_oi_full = (full_put_oi / full_call_oi) if full_call_oi else None
  pcr_vol_full = (full_put_vol / full_call_vol) if full_call_vol else None

  # Resolve live spot price
  spot_val: Optional[float] = None
  try:
    quote = await get_quote(symbol)  # type: ignore
    if quote and quote.get("price"):
      spot_val = float(quote["price"])
  except Exception:
    spot_val = None
  if not spot_val or spot_val <= 0:
    # Fallback: use mid-strike as synthetic spot
    all_strikes = sorted({float(e.strike) for e in entries if getattr(e, "strike", 0) > 0})
    spot_val = all_strikes[len(all_strikes) // 2] if all_strikes else 0.0

  # Determine ATM strike from chain
  all_strikes = sorted({float(e.strike) for e in entries if getattr(e, "strike", 0) > 0})
  if not all_strikes:
    return DashboardPredictionResponse(
      symbol=symbol,
      expiry=expiry_dt,
      spot=float(spot_val),
      atm_strike=0.0,
      window_strikes=[],
      pcr_oi=None,
      pcr_volume=None,
      window_pcr_oi=None,
      window_pcr_volume=None,
      net_delta=None,
      prediction=None,
      confidence=None,
    )

  atm_strike = min(all_strikes, key=lambda k: abs(k - float(spot_val)))

  # Determine step size from config or infer from strikes
  next_step = inst_cfg.nextStep if inst_cfg and getattr(inst_cfg, "nextStep", None) else None
  if not next_step:
    # Infer typical step as median diff
    diffs = [b - a for a, b in zip(all_strikes, all_strikes[1:]) if b - a > 0]
    if diffs:
      sorted_d = sorted(diffs)
      next_step = sorted_d[len(sorted_d) // 2]
    else:
      next_step = max(atm_strike * 0.01, 50.0)

  # Build theoretical window strikes around ATM using nextStep from config
  target_levels = [atm_strike + i * next_step for i in range(-5, 6)]

  def nearest_available_strike(target: float) -> Optional[float]:
    if not all_strikes:
      return None
    best = min(all_strikes, key=lambda k: abs(k - target))
    # Ensure we don't snap to a far-away strike accidentally
    if abs(best - target) > next_step * 1.1:
      return None
    return best

  window_strike_vals_set = set()
  for t in target_levels:
    k = nearest_available_strike(t)
    if k is not None:
      window_strike_vals_set.add(float(k))
  window_strike_vals = sorted(window_strike_vals_set)

  # Aggregate per-strike metrics for a local window around ATM
  window_strikes: List[DashboardStrikeSnapshot] = []
  total_call_oi = 0.0
  total_put_oi = 0.0
  total_call_vol = 0.0
  total_put_vol = 0.0
  weighted_call_delta = 0.0
  weighted_put_delta = 0.0

  # Days to expiry for Greeks
  dte = max(1, (expiry_dt - now).days)

  for k in window_strike_vals:
    call_entries = [e for e in entries if e.option_type == "CALL" and float(e.strike) == float(k)]
    put_entries = [e for e in entries if e.option_type == "PUT" and float(e.strike) == float(k)]

    call_oi = float(sum(e.open_interest or 0 for e in call_entries))
    put_oi = float(sum(e.open_interest or 0 for e in put_entries))
    call_vol = float(sum(e.volume or 0 for e in call_entries))
    put_vol = float(sum(e.volume or 0 for e in put_entries))

    def avg_iv(rows) -> Optional[float]:
      vals = [float(e.iv) for e in rows if getattr(e, "iv", None) is not None]
      if not vals:
        return None
      return float(sum(vals) / len(vals))

    call_iv = avg_iv(call_entries)
    put_iv = avg_iv(put_entries)

    call_delta = None
    put_delta = None
    try:
      if call_iv and call_iv > 0:
        g_call = greeks_svc.compute_greeks(
          spot=float(spot_val),
          strike=float(k),
          days_to_expiry=int(dte),
          iv=float(call_iv),
          option_type="CALL",
          rate=0.0,
        )
        call_delta = float(g_call.get("delta"))
      if put_iv and put_iv > 0:
        g_put = greeks_svc.compute_greeks(
          spot=float(spot_val),
          strike=float(k),
          days_to_expiry=int(dte),
          iv=float(put_iv),
          option_type="PUT",
          rate=0.0,
        )
        put_delta = float(g_put.get("delta"))
    except Exception:
      call_delta = call_delta if call_delta is not None else None
      put_delta = put_delta if put_delta is not None else None

    # Accumulate for overall prediction
    if call_delta is not None and call_oi > 0:
      weighted_call_delta += call_delta * call_oi
      total_call_oi += call_oi
    if put_delta is not None and put_oi > 0:
      weighted_put_delta += put_delta * put_oi
      total_put_oi += put_oi

    total_call_vol += call_vol
    total_put_vol += put_vol

    window_strikes.append(
      DashboardStrikeSnapshot(
        strike=float(k),
        call_oi=call_oi,
        put_oi=put_oi,
        call_volume=call_vol,
        put_volume=put_vol,
        call_iv=call_iv,
        put_iv=put_iv,
        call_delta=call_delta,
        put_delta=put_delta,
      )
    )

  # Window-level PCR (for internal scoring only)
  window_pcr_oi = (total_put_oi / total_call_oi) if total_call_oi else None
  window_pcr_volume = (total_put_vol / total_call_vol) if total_call_vol else None

  net_delta = None
  if (total_call_oi + total_put_oi) > 0 and (weighted_call_delta or weighted_put_delta):
    net_delta = (weighted_call_delta + weighted_put_delta) / (total_call_oi + total_put_oi)

  # Simple prediction logic combining net delta and window-level PCR
  score = 0.0
  if net_delta is not None:
    score += float(net_delta)
  if window_pcr_oi is not None:
    # PCR < 1 bullish; >1 bearish – use the local window PCR for scoring
    score += float(1.0 - window_pcr_oi) * 0.5

  if score > 0.1:
    prediction = "BULLISH"
  elif score < -0.1:
    prediction = "BEARISH"
  else:
    prediction = "NEUTRAL"

  confidence = min(0.99, abs(score) * 3.0) if score != 0 else 0.0

  return DashboardPredictionResponse(
    symbol=symbol,
    expiry=expiry_dt,
    spot=float(spot_val),
    atm_strike=float(atm_strike),
    window_strikes=window_strikes,
    pcr_oi=pcr_oi_full,
    pcr_volume=pcr_vol_full,
    window_pcr_oi=window_pcr_oi,
    window_pcr_volume=window_pcr_volume,
    net_delta=net_delta,
    prediction=prediction,
    confidence=confidence,
  )


@router.get("/chain/live", response_model=OptionChainResponse)
async def get_live_chain(symbol: str, expiry: Optional[str] = None):
  """
  Return live option chain for the given symbol.
  
  Strategy:
  1. Try the Upstox HTTP option-chain API directly using the configured access token.
  2. If that fails, fall back to a synthetic but stable mock chain so the UI keeps working.
  """
  now = datetime.utcnow()
  
  # -------- Attempt 1: Direct HTTP option-chain from Upstox (only in live mode) ---
  if USE_UPSTOX_LIVE:
    try:
      cfg = load_upstox_config()
      headers = {
        "Authorization": f"Bearer {cfg.upstox_access_token}",
        "Accept": "application/json",
      }

      # Resolve instrument_key (pipe format) and preferred expiry from config
      inst_cfg = find_instrument_by_symbol(symbol)
      inst_key_pipe = inst_cfg.instrumentKey if inst_cfg else None

      # Try to provide a near expiry date (YYYY-MM-DD) – optional but improves results
      if expiry:
        expiry_hint = expiry
      elif inst_cfg and inst_cfg.nextExpiries:
        expiry_hint = inst_cfg.nextExpiries[0]
      else:
        # Fallback: one week ahead
        expiry_hint = (now + timedelta(days=7)).date().isoformat()

      # Simple single-call Upstox HTTP option-chain using instrument_key + expiry_date
      if not inst_key_pipe:
        raise ValueError(f"No instrument_key found for symbol={symbol}")

      url = "https://api.upstox.com/v2/option/chain"
      params = {
        "instrument_key": inst_key_pipe,
        "expiry_date": expiry_hint,
      }
      resp = httpx.get(url, headers=headers, params=params, timeout=3.0)
      resp.raise_for_status()
      payload = resp.json() or {}
      raw = payload.get("data") or payload.get("chains") or []
      chains = raw if isinstance(raw, list) else (raw.get("chains") or [])

      entries: list[dict] = []

      # Robust numeric parsing for chain fields that sometimes arrive as strings
      def _to_num(x):
        try:
          if isinstance(x, (int, float)):
            return float(x)
          if isinstance(x, str):
            xs = x.strip().replace(",", "")
            if xs == "":
              return None
            return float(xs)
        except Exception:
          return None
        return None

      for entry in chains:
        strike = entry.get("strike_price") or entry.get("strikePrice")
        expiry_val = entry.get("expiry") or entry.get("expiry_date") or entry.get("expiryDate")
        strike_num = _to_num(strike)
        if strike_num is None:
          continue

        # Case 1: Nested CE/PE objects (common format)
        nested_sides = []
        for key in ["CE", "PE", "Call", "Put", "CALL", "PUT"]:
          side_obj = entry.get(key)
          if isinstance(side_obj, dict):
            nested_sides.append((key.upper(), side_obj))

        # Upstox variant: call_options / put_options with market_data + option_greeks
        for key in ["call_options", "put_options"]:
          side_obj = entry.get(key)
          if isinstance(side_obj, dict):
            mapped_key = "CALL" if key == "call_options" else "PUT"
            md = side_obj.get("market_data") or {}
            og = side_obj.get("option_greeks") or {}
            nested_sides.append(
              (
                mapped_key,
                {
                  "best_bid_price": md.get("bid_price"),
                  "best_ask_price": md.get("ask_price"),
                  "last_price": md.get("ltp"),
                  "volume": md.get("volume"),
                  "open_interest": md.get("oi"),
                  "implied_volatility": og.get("iv"),
                  "delta": og.get("delta"),
                  "theta": og.get("theta"),
                  "gamma": og.get("gamma"),
                  "vega": og.get("vega"),
                  "instrument_key": side_obj.get("instrument_key"),
                },
              )
            )

        if nested_sides:
          for side_key, side_obj in nested_sides:
            bid_raw = _to_num(
              side_obj.get("best_bid_price")
              or side_obj.get("bid")
              or side_obj.get("bestBidPrice")
            )
            ask_raw = _to_num(
              side_obj.get("best_ask_price")
              or side_obj.get("ask")
              or side_obj.get("bestAskPrice")
            )
            last_raw = _to_num(
              side_obj.get("last_price")
              or side_obj.get("ltp")
              or side_obj.get("lastTradedPrice")
            )
            vol_raw = _to_num(
              side_obj.get("volume")
              or side_obj.get("total_traded_volume")
              or side_obj.get("totalTradedVolume")
            )
            oi_raw = _to_num(
              side_obj.get("open_interest")
              or side_obj.get("openInterest")
              or side_obj.get("oi")
            )
            # Pydantic requires real floats, not None – default missing values to 0.0
            bid = bid_raw if bid_raw is not None else 0.0
            ask = ask_raw if ask_raw is not None else 0.0
            last = last_raw if last_raw is not None else 0.0
            volume = vol_raw if vol_raw is not None else 0.0
            oi = oi_raw if oi_raw is not None else 0.0
            iv_val = _to_num(
              side_obj.get("implied_volatility")
              or side_obj.get("impliedVolatility")
              or side_obj.get("iv")
            )
            iv_out = None
            if iv_val is not None and iv_val > 0:
              iv_out = iv_val / 100.0 if iv_val > 1.0 else iv_val
              
            # Parse Greeks
            delta_val = _to_num(side_obj.get("delta"))
            theta_val = _to_num(side_obj.get("theta"))
            gamma_val = _to_num(side_obj.get("gamma"))
            vega_val = _to_num(side_obj.get("vega"))
            
            entries.append(
              {
                "symbol": entry.get("symbol")
                or entry.get("tradingsymbol")
                or f"{symbol}-{strike_num}-{side_key}",
                "expiry": expiry_val,
                "strike": strike_num,
                "option_type": "CALL" if side_key in ("CE", "CALL") else "PUT",
                "bid": bid,
                "ask": ask,
                "last": last,
                "volume": volume,
                "open_interest": oi,
                "iv": iv_out,
                "delta": delta_val if delta_val is not None else 0.0,
                "theta": theta_val if theta_val is not None else 0.0,
                "gamma": gamma_val if gamma_val is not None else 0.0,
                "vega": vega_val if vega_val is not None else 0.0,
              }
            )
          continue

        # Case 2: Flat records (fallback)
        option_type = entry.get("option_type") or entry.get("optionType")
        if option_type is None:
          continue
        bid_raw = _to_num(entry.get("best_bid_price") or entry.get("bid") or entry.get("bestBidPrice"))
        ask_raw = _to_num(entry.get("best_ask_price") or entry.get("ask") or entry.get("bestAskPrice"))
        last_raw = _to_num(entry.get("last_price") or entry.get("lastTradedPrice"))
        vol_raw = _to_num(entry.get("volume") or entry.get("volumeTraded"))
        oi_raw = _to_num(entry.get("open_interest") or entry.get("openInterest"))
        bid = bid_raw if bid_raw is not None else 0.0
        ask = ask_raw if ask_raw is not None else 0.0
        last = last_raw if last_raw is not None else 0.0
        volume = vol_raw if vol_raw is not None else 0.0
        oi = oi_raw if oi_raw is not None else 0.0
        iv_val = _to_num(entry.get("implied_volatility") or entry.get("impliedVolatility"))
        iv_out = None
        if iv_val is not None and iv_val > 0:
          iv_out = iv_val / 100.0 if iv_val > 1.0 else iv_val
        entries.append(
          {
            "symbol": entry.get("symbol")
            or entry.get("tradingsymbol")
            or f"{symbol}-{strike_num}-{str(option_type).upper()}",
            "expiry": expiry_val,
            "strike": strike_num,
            "option_type": str(option_type).upper(),
            "bid": bid,
            "ask": ask,
            "last": last,
            "volume": volume,
            "open_interest": oi,
            "iv": iv_out,
          }
        )

      if not entries:
        raise RuntimeError("Upstox option chain returned no usable entries")

      underlying_sym = symbol
      return OptionChainResponse(
        underlying=underlying_sym,
        timestamp=now,
        entries=entries,
      )
    except Exception as e:
      # In live mode, do NOT silently fall back to mock; surface the real problem.
      raise HTTPException(
        status_code=502,
        detail=f"Upstox option chain failed for {symbol} {expiry}: {e}",
      )

  # -------- Fallback: synthetic chain (for offline/dev) ----------
  gw = get_upstox_gateway()
  mock_prices = build_mock_price_map()
  base_price = mock_prices.get(symbol, 20000.0)
  
  # Try to centre synthetic chain around live spot if gateway/quote works
  if gw:
    instrument_key = None
    inst_cfg = find_instrument_by_symbol(symbol)
    if inst_cfg:
      instrument_key = inst_cfg.instrumentKey
    if instrument_key:
      try:
        q = gw.get_quote(instrument_key)
        spot = q.get("ltp")
        if spot and float(spot) > 0:
          base_price = float(spot)
      except Exception as e:
        print(f"Upstox get_quote for chain base error: {e}")

  symbol_hash = hash(symbol) % 10000
  entries = []
  atm_strike = round(base_price / 50) * 50  # Round to nearest 50
  # Helper to compute a realistic fallback expiry (if config not available)
  def _last_weekday_of_month(year: int, month: int, target_weekday: int) -> datetime:
    # Start at the first day of the next month, then step back to target weekday
    if month == 12:
      next_month = datetime(year + 1, 1, 1)
    else:
      next_month = datetime(year, month + 1, 1)
    d = next_month - timedelta(days=1)
    while d.weekday() != target_weekday:
      d -= timedelta(days=1)
    return d

  def _next_expiry(sym: str, ref: datetime) -> datetime:
    """
    Synthetic expiry policy (fallback only) when config dates are missing.
    """
    # Default: one week ahead
    return ref + timedelta(days=7)

  # Resolve expiry for synthetic data: prefer explicit param, then config, then fallback rule
  selected_expiry_dt: Optional[datetime] = None
  if expiry:
    try:
      selected_expiry_dt = datetime.fromisoformat(expiry)
    except Exception:
      selected_expiry_dt = None
  if selected_expiry_dt is None:
    inst_cfg = find_instrument_by_symbol(symbol)
    if inst_cfg and inst_cfg.nextExpiries:
      try:
        selected_expiry_dt = datetime.fromisoformat(inst_cfg.nextExpiries[0])
      except Exception:
        selected_expiry_dt = None
  if selected_expiry_dt is None:
    selected_expiry_dt = _next_expiry(symbol, now)

  for i in range(-5, 6):
    strike = atm_strike + (i * 50)
    if strike <= 0:
      continue
    moneyness = base_price / strike
    time_to_expiry = 7 / 365.0
    iv = 0.20  # 20% IV
    if moneyness > 1.0:
      call_price = max(0.1, (base_price - strike) * 0.8 + strike * iv * (time_to_expiry ** 0.5) * 0.1)
      put_price = max(0.1, strike * iv * (time_to_expiry ** 0.5) * 0.1)
    else:
      call_price = max(0.1, strike * iv * (time_to_expiry ** 0.5) * 0.1)
      put_price = max(0.1, (strike - base_price) * 0.8 + strike * iv * (time_to_expiry ** 0.5) * 0.1)
    strike_seed = (symbol_hash + int(strike)) % 100
    call_multiplier = 0.95 + (strike_seed % 10) * 0.01
    put_multiplier = 0.95 + ((strike_seed + 7) % 10) * 0.01
    call_price *= call_multiplier
    put_price *= put_multiplier
    volume_base = 50000 + abs(i) * 5000
    oi_base = 500000 + abs(i) * 50000
    entries.append(
      {
        "symbol": f"{symbol}-{strike}-CE",
        "expiry": selected_expiry_dt,
        "strike": strike,
        "option_type": "CALL",
        "bid": round(call_price * 0.99, 2),
        "ask": round(call_price * 1.01, 2),
        "last": round(call_price, 2),
        "volume": volume_base + (strike_seed % 10000),
        "open_interest": oi_base + (strike_seed * 100) % 50000,
        "iv": round(iv + ((strike_seed % 10) - 5) * 0.005, 3),
      }
    )
    put_seed = (symbol_hash + int(strike) + 13) % 100
    entries.append(
      {
        "symbol": f"{symbol}-{strike}-PE",
        "expiry": selected_expiry_dt,
        "strike": strike,
        "option_type": "PUT",
        "bid": round(put_price * 0.99, 2),
        "ask": round(put_price * 1.01, 2),
        "last": round(put_price, 2),
        "volume": volume_base + (put_seed % 10000),
        "open_interest": oi_base + (put_seed * 100) % 50000,
        "iv": round(iv + ((put_seed % 10) - 5) * 0.005, 3),
      }
    )
  return OptionChainResponse(underlying=symbol, timestamp=now, entries=entries)





@router.get("/chain/history", response_model=List[OptionChainResponse])
async def get_chain_history(symbol: str, days: int = 5):
  now = datetime.utcnow()
  history = []
  for d in range(days):
    ts = now - timedelta(days=d)
    history.append(await get_live_chain(symbol))  # type: ignore
    history[-1].timestamp = ts
  return history


@router.post("/probability", response_model=ProbabilityResult)
async def post_probability(req: ProbabilityRequest):
  d2_prob = prob_svc.black_scholes_d2_probability(
    spot=req.spot,
    strike=req.strike,
    days_to_expiry=req.days_to_expiry,
    iv=req.iv,
    option_type=req.option_type,
  )
  log_prob = prob_svc.lognormal_itm_probability(
    spot=req.spot,
    strike=req.strike,
    days_to_expiry=req.days_to_expiry,
    iv=req.iv,
  )
  bin_prob = prob_svc.binomial_itm_probability(
    spot=req.spot,
    strike=req.strike,
    days_to_expiry=req.days_to_expiry,
    iv=req.iv,
  )
  mc_prob = prob_svc.monte_carlo_itm_probability(
    spot=req.spot,
    strike=req.strike,
    days_to_expiry=req.days_to_expiry,
    iv=req.iv,
  )
  exp_move = prob_svc.expected_move(req.spot, req.days_to_expiry, req.iv)
  return ProbabilityResult(
    d2_probability=d2_prob,
    lognormal_itm_probability=log_prob,
    binomial_itm_probability=bin_prob,
    monte_carlo_itm_probability=mc_prob,
    expected_move=exp_move,
  )


@router.post("/iv", response_model=IVResponse)
async def post_iv(req: IVRequest):
  iv = vol_svc.implied_volatility(
    spot=req.spot,
    strike=req.strike,
    option_price=req.option_price,
    days_to_expiry=req.days_to_expiry,
    option_type=req.option_type,
    rate=req.rate,
  )
  hv = vol_svc.historical_volatility(req.historical_iv_series or [])
  rank = vol_svc.iv_rank(iv, req.historical_iv_series or [])
  pct = vol_svc.iv_percentile(iv, req.historical_iv_series or [])
  return IVResponse(iv=iv, iv_rank=rank, iv_percentile=pct, hv=hv)


@router.post("/greeks", response_model=GreeksResponse)
async def post_greeks(req: GreeksRequest):
  res = greeks_svc.compute_greeks(
    spot=req.spot,
    strike=req.strike,
    days_to_expiry=req.days_to_expiry,
    iv=req.iv,
    option_type=req.option_type,
    rate=req.rate,
  )
  return GreeksResponse(**res)

@router.post("/oi", response_model=OIResponse)
async def post_oi(req: OIRequest):
  oi_series = [1000 + i * 10 for i in range(req.days)]
  vol_series = [100 + i * 5 for i in range(req.days)]
  metrics = oi_svc.compute_oi_metrics(oi_series, vol_series)
  # Mock PCR calculation: simulate put and call OI/volume
  # In production, fetch from option chain data
  put_oi = 1500000.0  # Mock put OI
  call_oi = 1200000.0  # Mock call OI
  put_volume = 500000.0  # Mock put volume
  call_volume = 450000.0  # Mock call volume
  pcr_oi = oi_svc.calculate_pcr(put_oi, call_oi)
  pcr_volume = oi_svc.calculate_pcr_volume(put_volume, call_volume)
  return OIResponse(
    spike_score=metrics["spike_score"],
    volume_oi_ratio=metrics["volume_oi_ratio"],
    trend=metrics["trend"],
    anomaly_score=metrics["anomaly_score"],
    pcr_oi=pcr_oi,
    pcr_volume=pcr_volume,
  )


@router.post("/skew")
async def post_skew():
  strikes = [80, 90, 100, 110, 120]
  ivs = [0.3, 0.25, 0.2, 0.22, 0.28]
  skew = vol_svc.skew_profile(strikes, ivs)
  return skew


@router.post("/consensus", response_model=ConsensusResponse)
async def post_consensus(req: ConsensusRequest):
  return compute_consensus(req.probability, req.volatility, req.oi, req.market)


@router.post("/strategy/run-live")
async def post_strategy_run_live(req: StrategyRunRequest):
  # Build context with all available indicators
  # In production, fetch real-time data from option chain, OI, IV, etc.
  context = {
    "price": 100.0,
    "volume": 100000,
    "iv_rank": 45.0,
    "price_above_vwap": 1.0,
    "pcr_oi": 1.25,  # Mock PCR OI
    "pcr_volume": 1.11,  # Mock PCR Volume
  }
  result = run_live_strategy(req, context)
  return result


_BACKTEST_STORE: dict[str, BacktestResult] = {}


@router.post("/strategy/backtest", response_model=BacktestResult)
async def post_strategy_backtest(req: StrategyBacktestRequest):
  prices = [100 + i * 0.5 for i in range(200)]
  result = run_backtest(req, prices)
  _BACKTEST_STORE[result.id] = result
  return result


@router.post("/strategy/save")
async def post_strategy_save(req: StrategySaveRequest):
  db = get_db()
  await db.strategies.update_one(
    {"name": req.strategy.name},
    {"$set": req.strategy.dict()},
    upsert=True,
  )
  return {"status": "saved"}


# Default strategies that come with the system
DEFAULT_STRATEGIES = [
  {
    "name": "Mean Reversion Call",
    "mode": "LIVE",
    "conditions": [{"indicator": "pcr_oi", "operator": "<", "threshold": 0.7}],
    "filters": [],
    "actions": [{"side": "BUY", "quantity": 1, "instrument": "ATM_CALL"}],
    "exits": [{"type": "take_profit", "value": 0.3}, {"type": "stop_loss", "value": 0.15}],
    "multi_leg": False,
    "is_default": True,
  },
  {
    "name": "Momentum Put",
    "mode": "LIVE",
    "conditions": [{"indicator": "pcr_oi", "operator": ">", "threshold": 1.2}],
    "filters": [],
    "actions": [{"side": "BUY", "quantity": 1, "instrument": "ATM_PUT"}],
    "exits": [{"type": "take_profit", "value": 0.25}, {"type": "stop_loss", "value": 0.2}],
    "multi_leg": False,
    "is_default": True,
  },
]


@router.get("/strategies")
async def get_strategies():
  """List all strategies (user-created + default)"""
  db = get_db()
  user_strategies = []
  try:
    docs = await db.strategies.find({}).to_list(1000)
    for d in docs:
      # Convert MongoDB document to dict, handling ObjectId
      strategy_dict = dict(d)
      # Convert _id to string if it exists
      if "_id" in strategy_dict:
        strategy_dict["_id"] = str(strategy_dict["_id"])
      strategy_dict["is_default"] = False
      user_strategies.append(strategy_dict)
  except Exception as e:
    print(f"Error fetching strategies from DB: {e}")
  
  # Combine with default strategies
  all_strategies = DEFAULT_STRATEGIES + user_strategies
  return {"strategies": all_strategies}


@router.get("/strategies/{name}")
async def get_strategy(name: str):
  """Get a specific strategy by name"""
  # Check default strategies first
  default = next((s for s in DEFAULT_STRATEGIES if s["name"] == name), None)
  if default:
    return {"strategy": default}
  
  # Check user strategies
  db = get_db()
  doc = await db.strategies.find_one({"name": name})
  if not doc:
    raise HTTPException(status_code=404, detail=f"Strategy '{name}' not found")
  
  # Convert MongoDB document to dict, handling ObjectId
  strategy_dict = dict(doc)
  # Convert _id to string if it exists
  if "_id" in strategy_dict:
    strategy_dict["_id"] = str(strategy_dict["_id"])
  
  return {"strategy": strategy_dict}


@router.delete("/strategies/{name}")
async def delete_strategy(name: str):
  """Delete a user-created strategy (cannot delete default strategies)"""
  # Check if it's a default strategy
  if any(s["name"] == name for s in DEFAULT_STRATEGIES):
    raise HTTPException(status_code=400, detail="Cannot delete default strategies")
  
  db = get_db()
  result = await db.strategies.delete_one({"name": name})
  if result.deleted_count == 0:
    raise HTTPException(status_code=404, detail=f"Strategy '{name}' not found")
  
  return {"status": "deleted"}


class StrategyRenameRequest(BaseModel):
  new_name: str


@router.put("/strategies/{name}")
async def update_strategy_name(name: str, req: StrategyRenameRequest):
  """Update a strategy's name (cannot rename default strategies)"""
  # Check if it's a default strategy
  if any(s["name"] == name for s in DEFAULT_STRATEGIES):
    raise HTTPException(status_code=400, detail="Cannot rename default strategies")
  
  db = get_db()
  result = await db.strategies.update_one(
    {"name": name},
    {"$set": {"name": req.new_name}}
  )
  if result.matched_count == 0:
    raise HTTPException(status_code=404, detail=f"Strategy '{name}' not found")
  
  return {"status": "updated", "old_name": name, "new_name": req.new_name}


@router.get("/backtest/results/{id}", response_model=BacktestResult)
async def get_backtest_result(id: str):
  if id in _BACKTEST_STORE:
    return _BACKTEST_STORE[id]
  db = get_db()
  doc = await db.backtest_results.find_one({"id": id})
  if not doc:
    return BacktestResult(
      id=id,
      symbol="N/A",
      strategy_name="N/A",
      equity_curve=[],
      trades=[],
      stats=BacktestStats(total_trades=0, win_rate=0.0, profit_factor=0.0, max_drawdown=0.0, sharpe=0.0),  # type: ignore
    )
  return BacktestResult(**doc)


@router.get("/models/insights", response_model=ModelsInsightsResponse)
async def get_models_insights():
  return ModelsInsightsResponse(
    models={
      "probability": {"description": "Black-Scholes d2, lognormal, binomial, Monte Carlo, expected move"},
      "volatility": {"description": "IV, IV rank/percentile, HV, surface, term structure, skew"},
      "oi": {"description": "OI spike detector, volume/OI ratio, trend, anomaly"},
      "market": {"description": "ATR trend, VWAP, Bollinger squeeze, trend, mean reversion, regime"},
      "consensus": {"description": "Weighted fusion of all model scores into 0–100 confidence"},
      "strategy": {"description": "Multi-leg, conditions/filters/actions/exits, SL/TP/trailing/time exits, live/backtest"},
      "backtest": {"description": "Fee model, slippage, spread sim, walk-forward, optimization hooks, stats"},
    }
  )


async def fetch_fii_dii_from_nse(date: Optional[datetime] = None) -> List[FiiDiiDay]:
  """
  Fetch FII/DII data from NSE website for a specific date or today.
  NSE provides this data via their API endpoint.
  Note: NSE requires proper session cookies and headers.
  """
  try:
    # NSE FII/DII data endpoint - using their API endpoint
    # Note: NSE requires proper headers and session cookies to avoid blocking
    base_headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    }
    
    # Try NSE's FII/DII API endpoint
    # Format: https://www.nseindia.com/api/fiidiiTradeReact
    async with httpx.AsyncClient(
      timeout=15.0,
      headers=base_headers,
      follow_redirects=True,
      cookies={}
    ) as client:
      # First, get a session cookie by visiting the main page (required by NSE)
      try:
        main_response = await client.get("https://www.nseindia.com/", timeout=5.0)
        # Update headers with referer
        client.headers.update({"Referer": "https://www.nseindia.com/"})
      except Exception as e:
        print(f"Warning: Could not establish NSE session: {e}")
      
      # Fetch FII/DII data - try multiple endpoints with date range
      # NSE API might support date parameters for historical data
      from datetime import datetime, timedelta
      end_date = datetime.utcnow().strftime("%d-%m-%Y")
      start_date = (datetime.utcnow() - timedelta(days=7)).strftime("%d-%m-%Y")
      
      endpoints = [
        f"https://www.nseindia.com/api/fiidiiTradeReact?from={start_date}&to={end_date}",
        f"https://www.nseindia.com/api/fiidiiTradeReact",
        "https://www.nseindia.com/api/fiidiiTrade",
        "https://www.nseindia.com/api/fii-dii-data",
      ]
      
      data = None
      for endpoint in endpoints:
        try:
          response = await client.get(endpoint, timeout=10.0)
          if response.status_code == 200:
            try:
              data = response.json()
              print(f"Successfully fetched from {endpoint}, got {len(data) if isinstance(data, list) else 'dict'} items")
              break
            except Exception as e:
              print(f"Error parsing JSON from {endpoint}: {e}")
              continue
          else:
            print(f"Status {response.status_code} from {endpoint}")
        except Exception as e:
          print(f"Error fetching from {endpoint}: {e}")
          continue
      
      if not data:
        print("Could not fetch from any NSE endpoint - check logs above for details")
        return []
      
      # Debug: print response structure and count
      data_str = str(data)[:1000]
      print(f"NSE API response structure (first 1000 chars): {data_str}")
      if isinstance(data, list):
        print(f"Total items in response: {len(data)}")
        if len(data) > 0:
          print(f"Sample item keys: {list(data[0].keys()) if isinstance(data[0], dict) else 'Not a dict'}")
      
      # Parse NSE response format
      # NSE returns data in various formats - handle multiple structures
      days = []
      
      # Try different response structures
      data_list = None
      if isinstance(data, dict):
        # Try common keys
        data_list = data.get("data") or data.get("fiiDiiData") or data.get("result") or data.get("records") or data.get("fiiDii")
        # Also check if it's nested
        if not data_list and "fiiDii" in data:
          nested = data.get("fiiDii")
          if isinstance(nested, dict):
            data_list = nested.get("data") or nested.get("records")
      elif isinstance(data, list):
        data_list = data
      
      if not data_list:
        print(f"No data list found in response. Response keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
        return []
      
      print(f"Found {len(data_list)} items in data list")
      
      if data_list:
        # NSE returns FII and DII as separate entries, need to group by date
        # Format: [{'category': 'DII **', 'date': '28-Nov-2025', 'netValue': '4148.48'}, ...]
        date_to_data = {}  # date -> {fii_net: ..., dii_net: ...}
        
        for item in data_list:
          try:
            # Get date - handle both dict and object
            if isinstance(item, dict):
              date_str = item.get("date") or item.get("tradeDate") or item.get("trade_date")
              category = item.get("category") or item.get("type") or ""
              net_value_str = item.get("netValue") or item.get("net_value") or item.get("net")
            else:
              date_str = getattr(item, "date", None) or getattr(item, "tradeDate", None)
              category = getattr(item, "category", "") or getattr(item, "type", "")
              net_value_str = getattr(item, "netValue", None) or getattr(item, "net_value", None)
            
            if not date_str:
              continue
            
            # Parse date (NSE format: "DD-MMM-YYYY" like "28-Nov-2025")
            date_obj = None
            try:
              # Try using dateutil parser first (handles most formats)
              from dateutil import parser
              date_obj = parser.parse(str(date_str))
            except Exception:
              # Fallback: try common formats manually
              try:
                date_obj = datetime.strptime(str(date_str), "%d-%b-%Y")
              except Exception:
                try:
                  date_obj = datetime.strptime(str(date_str), "%Y-%m-%d")
                except Exception:
                  try:
                    date_obj = datetime.strptime(str(date_str), "%d-%m-%Y")
                  except Exception:
                    pass
            
            if not date_obj:
              print(f"Could not parse date: {date_str}")
              continue
            
            # Parse net value
            net_value = None
            if net_value_str:
              try:
                net_value = float(str(net_value_str).replace(",", ""))
              except Exception:
                pass
            
            if net_value is None:
              # Try to calculate from buy/sell if available
              if isinstance(item, dict):
                buy_val = item.get("buyValue") or item.get("buy_value") or 0
                sell_val = item.get("sellValue") or item.get("sell_value") or 0
              else:
                buy_val = getattr(item, "buyValue", 0) or getattr(item, "buy_value", 0)
                sell_val = getattr(item, "sellValue", 0) or getattr(item, "sell_value", 0)
              
              try:
                buy = float(str(buy_val).replace(",", "")) if buy_val else 0
                sell = float(str(sell_val).replace(",", "")) if sell_val else 0
                net_value = buy - sell
              except Exception:
                continue
            
            # Group by date and category
            date_key = date_obj.date().isoformat()
            if date_key not in date_to_data:
              date_to_data[date_key] = {"date": date_obj, "fii_net": None, "dii_net": None}
            
            # Determine if this is FII or DII based on category
            category_upper = str(category).upper()
            if "FII" in category_upper or "FPI" in category_upper:
              date_to_data[date_key]["fii_net"] = net_value
            elif "DII" in category_upper:
              date_to_data[date_key]["dii_net"] = net_value
            
          except Exception as e:
            print(f"Error parsing FII/DII entry: {e}, item: {item}")
            import traceback
            traceback.print_exc()
            continue
        
        # Convert grouped data to FiiDiiDay objects
        # Sort by date descending and take up to 10 days (or all available if less)
        sorted_dates = sorted(date_to_data.items(), key=lambda x: x[1]["date"], reverse=True)
        print(f"Grouped into {len(date_to_data)} unique dates: {[d[0] for d in sorted_dates]}")
        
        for date_key, data in sorted_dates[:10]:  # Last 10 days
          if data["fii_net"] is not None or data["dii_net"] is not None:
            days.append(FiiDiiDay(
              date=data["date"],
              fii_net=data["fii_net"] if data["fii_net"] is not None else 0.0,
              dii_net=data["dii_net"] if data["dii_net"] is not None else 0.0,
            ))
        
        print(f"Successfully parsed {len(days)} FII/DII days from {len(date_to_data)} unique dates")
        
        # If we only got today's data, the API might only return latest day
        # In that case, we should return what we have (it will be cached)
        if len(days) <= 1:
          print(f"Note: Only got {len(days)} day(s) of data. NSE API may only return latest day.")
          print(f"Available dates in response: {list(date_to_data.keys())}")
        
        return days
  except Exception as e:
    print(f"Error fetching FII/DII from NSE: {e}")
  
  return []


@router.get("/flows/fii-dii", response_model=FiiDiiResponse)
async def get_fii_dii_flows():
  """
  Return recent FII / DII flows from real NSE data only.
  Combines today's data from NSE with historical data from MongoDB cache.
  Returns only real data - no sample/mock data.
  """
  # Try to fetch today's data from NSE first
  nse_data = await fetch_fii_dii_from_nse()
  
  # If NSE only returned today, try to get historical data from MongoDB
  # Over time, MongoDB will accumulate data as we cache each day
  
  # Get historical data from MongoDB (past week)
  historical_data = []
  try:
    db = get_db()
    # Get last 7 days from MongoDB
    docs = await db.fii_dii.find().sort("date", -1).limit(7).to_list(7)
    if docs:
      historical_data = [FiiDiiDay(**d) for d in docs]
      print(f"Found {len(historical_data)} days in MongoDB cache")
  except Exception as e:
    print(f"Error fetching from MongoDB: {e}")
  
  # Combine NSE data (today) with historical data (past days)
  all_days = {}
  
  # Add historical data first
  for day in historical_data:
    date_key = day.date.date().isoformat() if isinstance(day.date, datetime) else str(day.date)
    all_days[date_key] = day
  
  # Add/update with today's NSE data (overwrites if exists)
  if nse_data:
    for day in nse_data:
      date_key = day.date.date().isoformat() if isinstance(day.date, datetime) else str(day.date)
      all_days[date_key] = day
      # Cache today's data in MongoDB
      try:
        db = get_db()
        await db.fii_dii.update_one(
          {"date": day.date},
          {"$set": {"date": day.date, "fii_net": day.fii_net, "dii_net": day.dii_net}},
          upsert=True
        )
      except Exception as e:
        print(f"Error caching FII/DII data: {e}")
  
  # Sort by date descending and return available real data (up to 7 days)
  if all_days:
    sorted_days = sorted(all_days.values(), key=lambda d: d.date if isinstance(d.date, datetime) else datetime.fromisoformat(str(d.date)), reverse=True)
    return FiiDiiResponse(days=sorted_days[:7])  # Return up to 7 days of real data
  
  # No data available - return empty array (no sample data)
  print("No FII/DII data available - returning empty array")
  return FiiDiiResponse(days=[])


@router.get("/quote")
async def get_quote(symbol: str):
  """
  Return spot/underlying price for the instrument via Upstox if live; 
  If market is closed (price None/0), return last close price instead.
  """
  gw = get_upstox_gateway()
  instrument_key = None
  # Try to map symbol to instrument_key using live instruments list
  if gw:
    try:
      for ins in gw.list_instruments():
        if ins.get("symbol") == symbol:
          instrument_key = ins.get("instrument_key") or ins.get("tradingsymbol")
          break
    except Exception as e:
      print(f"/quote list_instruments error: {e}")
  # Fallback: use static config mapping from instruments.json
  if not instrument_key:
    inst_cfg = find_instrument_by_symbol(symbol)
    if inst_cfg:
      instrument_key = inst_cfg.instrumentKey
  price_type = "live"
  price = None
  ts = None
  change = None
  change_percent = None
  if gw and instrument_key:
    quote = gw.get_quote(instrument_key)
    print(f"[DEBUG /quote] symbol={symbol} instrument_key={instrument_key} quote={quote}")
    price = quote.get("ltp")
    ts = quote.get("timestamp")
    # Try to get change from quote if available
    change = quote.get("change") or quote.get("net_change")
    change_percent = quote.get("change_percent") or quote.get("net_change_percentage")
    # If price not available or market is closed, try to get previous close
    if not price or float(price) == 0.0:
      price_type = "close"
      try:
        # Try get last close from historical candles (if implemented)
        import datetime
        end = datetime.datetime.utcnow().strftime("%Y-%m-%d")
        start = (datetime.datetime.utcnow() - datetime.timedelta(days=3)).strftime("%Y-%m-%d")
        candles = []
        if hasattr(gw, 'get_historical_candles'):
          candles = gw.get_historical_candles(
            instrument_key=instrument_key,
            start=start,
            end=end,
            interval="1D",
          )
        if candles:
          candle = candles[-1] if isinstance(candles[-1], dict) and 'close' in candles[-1] else None
          if not candle:  # fallback: pick last dict with 'close'
            candle = next((c for c in reversed(candles) if isinstance(c, dict) and 'close' in c), None)
          prev_close = candle['close'] if candle else None
          if prev_close and price:
            # Calculate change from previous close
            try:
              change = float(price) - float(prev_close)
              change_percent = (change / float(prev_close)) * 100 if float(prev_close) != 0 else 0
            except Exception:
              pass
          price = candle['close'] if candle and not price else price
          ts = candle.get('timestamp') if candle and candle.get('timestamp') else ts
      except Exception as e:
        print(f"historical fallback error: {e}")
  if not price or float(price) == 0.0:
    price_type = "mock"
    sample_prices = build_mock_price_map(base=24000.0, step=8000.0)
    price = sample_prices.get(symbol, 20000.0)
    ts = datetime.utcnow().isoformat()
    # Mock change for demo
    change = -12.60
    change_percent = -0.05
  return {
    "symbol": symbol,
    "price": price,
    "price_type": price_type,
    "timestamp": ts,
    "change": change,
    "change_percent": change_percent,
  }


@router.get("/upstox/test")
async def upstox_test():
    resp = {
        'sdk_available': False,
        'live_mode': False,
        'api_configured': False,
        'example_quote_success': False,
        'details': {}
    }
    try:
        from app.utils import upstox
        resp['sdk_available'] = bool(upstox.upstox_client)
        resp['live_mode'] = getattr(upstox, 'USE_UPSTOX_LIVE', False)
        cfg = None
        try:
            cfg = upstox.load_upstox_config()
            resp['api_configured'] = cfg is not None and cfg.upstox_api_key and cfg.upstox_access_token
            resp['details']['api_key'] = cfg.upstox_api_key
            resp['details']['access_token'] = cfg.upstox_access_token[:6] + '...'
        except Exception as e:
            resp['details']['config_error'] = str(e)
        try:
            gw = upstox.get_upstox_gateway()
            if gw:
                quote = gw.get_quote('NSE_INDEX|Nifty 50')
                resp['example_quote_success'] = quote is not None and 'ltp' in quote and quote['ltp']
                resp['details']['quote'] = quote
        except Exception as e:
            resp['details']['quote_error'] = str(e)
    except Exception as e:
        resp['details']['import_error'] = str(e)
    return resp

# ---- Probability Heatmap ----------------------------------------------------

class HeatmapRequest(BaseModel):
  symbol: str
  spot: Optional[float] = None
  dte: int
  ivSource: str = "chain"  # 'chain' | 'manualAnnual' | 'manualMonthly'
  ivUnit: str = "annual"  # 'annual' | 'monthly'
  use_chain_strikes: bool = True


class HeatmapRow(BaseModel):
  strike: float
  d2_probability: float  # Black-Scholes-Merton
  monte_carlo_itm_probability: float  # Monte Carlo
  expected_move: float
  iv: float
  # Additional model probabilities
  gbm_probability: Optional[float] = None  # Geometric Brownian Motion
  binomial_probability: Optional[float] = None  # Binomial Tree
  trinomial_probability: Optional[float] = None  # Trinomial Tree
  heston_probability: Optional[float] = None  # Heston Stochastic Volatility
  sabr_probability: Optional[float] = None  # SABR
  jump_diffusion_probability: Optional[float] = None  # Jump-Diffusion (Merton)
  garch_probability: Optional[float] = None  # GARCH
  rnd_probability: Optional[float] = None  # Risk-Neutral Density
  ml_probability: Optional[float] = None  # Machine Learning


class HeatmapSummary(BaseModel):
  strike: float
  d2: float
  mc: float
  expectedMove: float
  lower: float
  upper: float


class HeatmapResponse(BaseModel):
  spot: float
  dte: int
  rows: List[HeatmapRow]
  summary: Optional[HeatmapSummary] = None
  greeks: Optional[GreeksResponse] = None  # type: ignore
  # Action hint from backend
  action: Optional[str] = None
  rationale: Optional[str] = None
  probAboveAtm: Optional[float] = None
  probBelowAtm: Optional[float] = None


@router.post("/probability/heatmap", response_model=HeatmapResponse)
async def post_probability_heatmap(req: HeatmapRequest):
  # 1) Resolve spot if not provided
  spot_val: Optional[float] = req.spot
  if not spot_val or spot_val <= 0:
    try:
      gw = get_upstox_gateway()
      instrument_key = None
      if gw:
        try:
          for ins in gw.list_instruments():
            if ins.get("symbol") == req.symbol:
              instrument_key = ins.get("instrument_key") or ins.get("tradingsymbol")
              break
        except Exception:
          instrument_key = None
      if not instrument_key:
        inst_cfg = find_instrument_by_symbol(req.symbol)
        if inst_cfg:
          instrument_key = inst_cfg.instrumentKey
      if gw and instrument_key:
        q = gw.get_quote(instrument_key)
        spot_val = float(q.get("ltp")) if q.get("ltp") else None
    except Exception:
      spot_val = None
  if not spot_val:
    # use a reasonable default
    spot_val = 100.0

  # 2) Get strikes from chain if requested; else generate around spot
  chain: Optional[OptionChainResponse] = None
  strikes: List[float] = []
  if req.use_chain_strikes:
    try:
      chain = await get_live_chain(req.symbol)  # type: ignore
      chain_strikes = list(
        sorted(
          set(
            float(e.strike)
            for e in chain.entries  # type: ignore
            if isinstance(e.get("strike") if isinstance(e, dict) else getattr(e, "strike", None), (int, float))
          )
        )
      )
      strikes = chain_strikes
    except Exception:
      chain = None
  if not strikes:
    # generate around spot +/- 20% in 9 points
    low = spot_val * 0.8
    high = spot_val * 1.2
    step = (high - low) / 8.0
    k = low
    while k <= high + 1e-6:
      strikes.append(round(k))
      k += step

  # OPTIMIZATION: Filter to only ATM + 2 strikes up/down (5 total) to speed up calculation
  if strikes:
    # Find ATM strike (nearest to spot)
    atm_strike = min(strikes, key=lambda k: abs(k - spot_val))
    atm_idx = strikes.index(atm_strike)
    # Get only 2 strikes below and 2 strikes above ATM (plus ATM itself = 5 total)
    start_idx = max(0, atm_idx - 2)
    end_idx = min(len(strikes) - 1, atm_idx + 2)
    strikes = strikes[start_idx:end_idx + 1]

  # Helper: find annualised IV for a strike
  def iv_for_strike(strike: float) -> float:
    if req.ivSource == "chain" and chain is not None:
      vals = []
      for e in chain.entries:  # type: ignore
        s = e.get("strike") if isinstance(e, dict) else getattr(e, "strike", None)
        ivv = e.get("iv") if isinstance(e, dict) else getattr(e, "iv", None)
        if isinstance(s, (int, float)) and float(s) == float(strike) and isinstance(ivv, (int, float)) and ivv > 0:
          # Normalize chain IV: if API returns percent (e.g., 9.02) convert to decimal (0.0902)
          iv_norm = float(ivv)
          if iv_norm > 1.0:
            iv_norm = iv_norm / 100.0
          vals.append(iv_norm)
      if vals:
        return float(sum(vals) / len(vals))
    # manual routes
    iv_input = getattr(req, "manualIv", None)
    if iv_input is None:
      # be robust to snake_case or missing field
      iv_input = getattr(req, "manual_iv", None)
    # Default: if no manual IV given, prefer ATM chain IV (nearest to spot) when available
    used_chain_fallback = False
    if iv_input is None and chain is not None:
      nearest_iv = None
      nearest_diff = None
      for e in chain.entries:  # type: ignore
        s = e.get("strike") if isinstance(e, dict) else getattr(e, "strike", None)
        ivv = e.get("iv") if isinstance(e, dict) else getattr(e, "iv", None)
        if isinstance(s, (int, float)) and isinstance(ivv, (int, float)) and ivv and s:
          diff = abs(float(s) - float(spot_val))
          if nearest_diff is None or diff < nearest_diff:
            iv_norm = float(ivv)
            if iv_norm > 1.0:
              iv_norm = iv_norm / 100.0
            nearest_iv = iv_norm
            nearest_diff = diff
      if nearest_iv is not None:
        iv_val = float(nearest_iv)
        used_chain_fallback = True
      else:
        iv_val = 0.2
    else:
      iv_val = float(iv_input) if iv_input is not None else 0.2
    # Normalize manual IV as well: accept either percent (>1) or decimal (<=1)
    if iv_val > 1.0:
      iv_val = iv_val / 100.0
    # If the value came from chain fallback, treat it as annual already; only scale true manual-monthly inputs
    if req.ivSource == "manualMonthly" and not used_chain_fallback:
      return iv_val * (12.0 ** 0.5)
    return iv_val

  # 3) Build rows with probabilities from all models
  result_rows: List[HeatmapRow] = []
  for k in strikes:
    iv_ann = iv_for_strike(float(k))
    
    # Calculate probabilities from all models
    try:
      d2_prob = prob_svc.black_scholes_d2_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
        option_type="CALL",
      )
    except Exception:
      d2_prob = 0.0
    
    try:
      mc_prob = prob_svc.monte_carlo_itm_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      mc_prob = 0.0
    
    try:
      gbm_prob = prob_svc.geometric_brownian_motion_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      gbm_prob = None
    
    try:
      binomial_prob = prob_svc.binomial_itm_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      binomial_prob = None
    
    try:
      trinomial_prob = prob_svc.trinomial_tree_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      trinomial_prob = None
    
    try:
      heston_prob = prob_svc.heston_stochastic_volatility_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      heston_prob = None
    
    try:
      sabr_prob = prob_svc.sabr_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      sabr_prob = None
    
    try:
      jump_diffusion_prob = prob_svc.jump_diffusion_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      jump_diffusion_prob = None
    
    try:
      garch_prob = prob_svc.garch_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      garch_prob = None
    
    try:
      rnd_prob = prob_svc.risk_neutral_density_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      rnd_prob = None
    
    try:
      ml_prob = prob_svc.machine_learning_probability(
        spot=spot_val,
        strike=float(k),
        days_to_expiry=req.dte,
        iv=iv_ann,
      )
    except Exception:
      ml_prob = None
    
    exp_move = prob_svc.expected_move(spot_val, req.dte, iv_ann)
    result_rows.append(
      HeatmapRow(
        strike=float(k),
        d2_probability=float(d2_prob),
        monte_carlo_itm_probability=float(mc_prob),
        expected_move=float(exp_move),
        iv=float(iv_ann),
        gbm_probability=float(gbm_prob) if gbm_prob is not None else None,
        binomial_probability=float(binomial_prob) if binomial_prob is not None else None,
        trinomial_probability=float(trinomial_prob) if trinomial_prob is not None else None,
        heston_probability=float(heston_prob) if heston_prob is not None else None,
        sabr_probability=float(sabr_prob) if sabr_prob is not None else None,
        jump_diffusion_probability=float(jump_diffusion_prob) if jump_diffusion_prob is not None else None,
        garch_probability=float(garch_prob) if garch_prob is not None else None,
        rnd_probability=float(rnd_prob) if rnd_prob is not None else None,
        ml_probability=float(ml_prob) if ml_prob is not None else None,
      )
    )

  # 4) ATM summary: strike nearest to spot
  atm_row = min(result_rows, key=lambda r: abs(r.strike - spot_val)) if result_rows else None
  summary: Optional[HeatmapSummary] = None
  greeks_resp: Optional[GreeksResponse] = None
  action_txt: Optional[str] = None
  rationale_txt: Optional[str] = None
  prob_above_atm: Optional[float] = None
  prob_below_atm: Optional[float] = None
  if atm_row:
    iv_atm = iv_for_strike(atm_row.strike)
    em = prob_svc.expected_move(spot_val, req.dte, iv_atm)
    summary = HeatmapSummary(
      strike=atm_row.strike,
      d2=atm_row.d2_probability,
      mc=atm_row.monte_carlo_itm_probability,
      expectedMove=float(em),
      lower=float(spot_val - em),
      upper=float(spot_val + em),
    )
    # Greeks at ATM
    try:
      g = greeks_svc.compute_greeks(
        spot=spot_val,
        strike=atm_row.strike,
        days_to_expiry=req.dte,
        iv=iv_atm,
        option_type="CALL",
        rate=0.0,
      )
      greeks_resp = GreeksResponse(**g)  # type: ignore
    except Exception:
      greeks_resp = None
    # Action hint and probabilities at ATM
    try:
      d2p = float(atm_row.d2_probability or 0.0)
      mcp = float(atm_row.monte_carlo_itm_probability or 0.0)
      prob_above_atm = float((d2p + mcp) / 2.0)
      prob_below_atm = float(1.0 - prob_above_atm)
      iv_level = "low" if iv_atm <= 0.12 else ("medium" if iv_atm <= 0.25 else "high")
      if prob_above_atm >= 0.6:
        action_txt = "Buy Call" if iv_level != "high" else "Bull Call Spread"
        rationale_txt = f"P(>K)≈{prob_above_atm*100:.1f}%, IV {iv_level}"
      elif prob_below_atm >= 0.6:
        action_txt = "Buy Put" if iv_level != "high" else "Bear Put Spread"
        rationale_txt = f"P(<K)≈{prob_below_atm*100:.1f}%, IV {iv_level}"
      else:
        action_txt = "Sell Iron Condor" if iv_level == "high" else "Neutral / Wait"
        rationale_txt = f"P near 50/50, IV {iv_level}"
    except Exception:
      pass

  return HeatmapResponse(
    spot=float(spot_val),
    dte=req.dte,
    rows=result_rows,
    summary=summary,
    greeks=greeks_resp,
    action=action_txt,
    rationale=rationale_txt,
    probAboveAtm=prob_above_atm,
    probBelowAtm=prob_below_atm,
  )


@router.get("/probability/heatmap", response_model=HeatmapResponse)
async def get_probability_heatmap(
  symbol: Optional[str] = "NIFTY",
  dte: int = 7,
  spot: Optional[float] = None,
  ivSource: str = "chain",
  manualIv: Optional[float] = None,
  use_chain_strikes: bool = True,
):
  """
  Convenience GET wrapper so you can test in the browser.
  For production/clients use POST /probability/heatmap.
  """
  req = HeatmapRequest(
    symbol=symbol,
    spot=spot,
    dte=dte,
    ivSource=ivSource,
    manualIv=manualIv,
    use_chain_strikes=use_chain_strikes,
  )
  return await post_probability_heatmap(req)


# ---- OI / IV Analytics (live from option chain) ------------------------------

class OiIvAnalyticsResponse(BaseModel):
  symbol: str
  pcr_oi: Optional[float] = None
  pcr_volume: Optional[float] = None
  iv_atm: Optional[float] = None           # annualised, decimal (e.g., 0.1925)
  strikes: List[float] = []                # for skew display
  skew_iv: List[float] = []                # same order as strikes, annualised decimal
  spike_score: Optional[float] = None
  volume_oi_ratio: Optional[float] = None
  trend: Optional[str] = None
  anomaly_score: Optional[float] = None
  # Volatility metrics
  hv: Optional[float] = None               # Historical Volatility (annualised, decimal)
  iv_rank: Optional[float] = None          # IV Rank (0-100)
  iv_percentile: Optional[float] = None    # IV Percentile (0-100)
  # Probability snapshot and action hint
  atm_strike: Optional[float] = None
  dte_used: Optional[int] = None
  prob_above_atm: Optional[float] = None
  prob_below_atm: Optional[float] = None
  action: Optional[str] = None
  rationale: Optional[str] = None
  buy_call_score: Optional[float] = None
  buy_put_score: Optional[float] = None
  sell_premium_score: Optional[float] = None


@router.get("/analytics/oi-iv", response_model=OiIvAnalyticsResponse)
async def get_oi_iv_analytics(symbol: str, expiry: Optional[str] = None):
  """
  Build OI/IV snapshot from the latest live option chain:
  - PCR (OI and Volume)
  - ATM IV (nearest strike to live spot)
  - IV skew around ATM (±4 nearest strikes)
  - OI metrics lightweight proxy (volume/OI ratio etc.)
  """
  chain: Optional[OptionChainResponse] = None
  try:
    chain = await get_live_chain(symbol, expiry)  # type: ignore
  except Exception:
    chain = None
  if not chain or not getattr(chain, "entries", None):
    return OiIvAnalyticsResponse(symbol=symbol)

  entries = chain.entries  # type: ignore
  # Helper: robust numeric parse
  def to_num(x) -> Optional[float]:
    try:
      if isinstance(x, (int, float)):
        return float(x)
      if isinstance(x, str):
        xs = x.strip().replace(',', '')
        if xs == '':
          return None
        return float(xs)
    except Exception:
      return None
    return None
  # Aggregate OI and volume by side
  put_oi = 0.0
  call_oi = 0.0
  put_vol = 0.0
  call_vol = 0.0
  strikes_set: set[float] = set()
  strike_to_iv_vals: dict[float, list[float]] = {}
  for e in entries:
    # Handle Pydantic model objects (OptionChainEntry)
    s_raw = getattr(e, "strike", None)
    s = to_num(s_raw)
    
    # Get option_type - handle both enum and string
    opt_type = getattr(e, "option_type", None)
    if opt_type is not None:
      # If it's an enum, get its value
      if hasattr(opt_type, "value"):
        t = str(opt_type.value).upper()
      else:
        t = str(opt_type).upper()
    else:
      t = ""
    
    vol = getattr(e, "volume", None)
    oi = getattr(e, "open_interest", None)
    ivv = getattr(e, "iv", None)
    
    if s is not None:
      strikes_set.add(float(s))
      ivn = to_num(ivv)
      if ivn is not None and ivn > 0:
        iv_norm = float(ivn)
        if iv_norm > 1.0:
          iv_norm = iv_norm / 100.0
        strike_to_iv_vals.setdefault(float(s), []).append(iv_norm)
    
    vn = to_num(vol)
    if vn is not None:
      if t.startswith("P") or t == "PUT":
        put_vol += float(vn)
      else:
        call_vol += float(vn)
    
    oin = to_num(oi)
    if oin is not None:
      if t.startswith("P") or t == "PUT":
        put_oi += float(oin)
      else:
        call_oi += float(oin)

  pcr_oi = (put_oi / call_oi) if call_oi else None
  pcr_volume = (put_vol / call_vol) if call_vol else None

  # Resolve live spot and pick ATM strike
  spot_val: Optional[float] = None
  try:
    quote = await get_quote(symbol)  # type: ignore
    if quote and quote.get("price"):
      spot_val = float(quote["price"])
  except Exception:
    spot_val = None
  strikes = sorted(list(strikes_set))
  atm_strike = None
  if strikes:
    atm_strike = min(strikes, key=lambda k: abs(k - (spot_val or strikes[len(strikes)//2])))

  # ATM IV: mean of available IV values at ATM strike
  iv_atm = None
  if atm_strike is not None and strike_to_iv_vals.get(float(atm_strike)):
    vals = strike_to_iv_vals[float(atm_strike)]
    if vals:
      iv_atm = float(sum(vals) / len(vals))

  # Collect all IV values from chain to use as proxy historical series
  all_iv_values: List[float] = []
  for strike_ivs in strike_to_iv_vals.values():
    all_iv_values.extend(strike_ivs)
  
  # Calculate IV Rank and IV Percentile using chain IVs as proxy history
  iv_rank = None
  iv_percentile = None
  if iv_atm is not None and all_iv_values:
    iv_rank = vol_svc.iv_rank(iv_atm, all_iv_values)
    iv_percentile = vol_svc.iv_percentile(iv_atm, all_iv_values)
  
  # Calculate HV: Try to get from historical price data, or use a simple estimate
  hv = None
  if spot_val:
    try:
      # Try to get historical candles for HV calculation
      gw = get_upstox_gateway()
      if gw:
        from app.utils.instruments_config import find_instrument_by_symbol
        inst_cfg = find_instrument_by_symbol(symbol)
        if inst_cfg:
          instrument_key = inst_cfg.instrumentKey
          from datetime import datetime, timedelta
          end_date = datetime.utcnow().strftime("%Y-%m-%d")
          start_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
          try:
            candles = gw.get_historical_candles(
              instrument_key=instrument_key,
              start=start_date,
              end=end_date,
              interval="1D"
            )
            if candles and len(candles) > 1:
              # Calculate returns from close prices
              closes = []
              for c in candles:
                if isinstance(c, dict):
                  close = to_num(c.get("close") or c.get("c"))
                  if close:
                    closes.append(close)
              if len(closes) > 1:
                returns = []
                for i in range(1, len(closes)):
                  if closes[i-1] > 0:
                    ret = (closes[i] - closes[i-1]) / closes[i-1]
                    returns.append(ret)
                if returns:
                  hv = vol_svc.historical_volatility(returns)
          except (NotImplementedError, Exception):
            # If historical data not available, estimate HV as ~80% of ATM IV (common relationship)
            if iv_atm:
              hv = iv_atm * 0.8
    except Exception:
      # Fallback: estimate HV from IV if available
      if iv_atm:
        hv = iv_atm * 0.8

  # Skew: collect up to 5 strikes around ATM (±2 on both sides)
  skew_strikes: List[float] = []
  skew_iv_vals: List[float] = []
  if strikes:
    if atm_strike is None:
      atm_idx = len(strikes) // 2
    else:
      atm_idx = max(0, strikes.index(atm_strike))
    start = max(0, atm_idx - 2)
    end = min(len(strikes) - 1, atm_idx + 2)
    for k in strikes[start:end + 1]:
      skew_strikes.append(float(k))
      vals = strike_to_iv_vals.get(float(k), [])
      if vals:
        skew_iv_vals.append(float(sum(vals) / len(vals)))
      else:
        skew_iv_vals.append(0.0)

  # Lightweight OI metrics proxy
  volume_oi_ratio = (put_vol + call_vol) / (put_oi + call_oi) if (put_oi + call_oi) else None
  spike_score = (max(put_oi, call_oi) / (min(put_oi, call_oi) + 1e-6)) if (put_oi and call_oi) else None
  trend = "RISING" if (put_oi + call_oi) and (put_vol + call_vol) and (put_vol + call_vol) / (put_oi + call_oi) > 0.1 else "NEUTRAL"
  anomaly_score = (abs((pcr_oi or 1.0) - 1.0)) * 1.5 if pcr_oi is not None else None

  # Probability snapshot at ATM (pick nearest expiry days if available)
  dte_used = None
  try:
    # Try to infer nearest expiry days from entries if expiry present
    expiries: List[datetime] = []
    for e in entries:
      expiry_raw = getattr(e, "expiry", None)
      if isinstance(expiry_raw, datetime):
        expiries.append(expiry_raw)
      elif isinstance(expiry_raw, str):
        try:
          # Try common formats
          expiries.append(datetime.fromisoformat(expiry_raw.replace("Z", "")))
        except Exception:
          pass
    if expiries:
      nearest_expiry = min(expiries, key=lambda x: abs((x - datetime.utcnow()).total_seconds()))
      dte_used = max(1, (nearest_expiry - datetime.utcnow()).days)
  except Exception:
    dte_used = None
  if dte_used is None:
    dte_used = 7
  prob_above_atm = None
  prob_below_atm = None
  action = None
  rationale = None
  buy_call_score = None
  buy_put_score = None
  sell_premium_score = None
  if spot_val and atm_strike and iv_atm:
    try:
      above = prob_svc.black_scholes_d2_probability(
        spot=float(spot_val),
        strike=float(atm_strike),
        days_to_expiry=int(dte_used),
        iv=float(iv_atm),
        option_type="CALL",
      )
      prob_above_atm = float(above)
      prob_below_atm = float(1 - above)
      iv_level = "low" if iv_atm <= 0.12 else ("medium" if iv_atm <= 0.25 else "high")
      # Simple scores
      buy_call_score = max(0.0, (prob_above_atm - 0.5) * (1.0 if iv_level != "high" else 0.7))
      buy_put_score = max(0.0, (prob_below_atm - 0.5) * (1.0 if iv_level != "high" else 0.7))
      sell_premium_score = max(0.0, (0.55 - abs(prob_above_atm - 0.5)) * (1.0 if iv_level == "high" else 0.5))
      # Action hint
      if prob_above_atm >= 0.6:
        action = "Buy Call" if iv_level != "high" else "Bull Call Spread"
        rationale = f"P(>ATM)≈{prob_above_atm*100:.1f}%, IV {iv_level}"
      elif prob_below_atm >= 0.6:
        action = "Buy Put" if iv_level != "high" else "Bear Put Spread"
        rationale = f"P(<ATM)≈{prob_below_atm*100:.1f}%, IV {iv_level}"
      else:
        action = "Sell Iron Condor" if iv_level == "high" else "Neutral / Wait"
        rationale = f"P near 50/50, IV {iv_level}"
    except Exception:
      pass

  return OiIvAnalyticsResponse(
    symbol=symbol,
    pcr_oi=pcr_oi,
    pcr_volume=pcr_volume,
    iv_atm=iv_atm,
    strikes=skew_strikes,
    skew_iv=skew_iv_vals,  # type: ignore
    spike_score=spike_score,
    volume_oi_ratio=volume_oi_ratio,
    trend=trend,
    anomaly_score=anomaly_score,
    hv=hv,
    iv_rank=iv_rank,
    iv_percentile=iv_percentile,
    atm_strike=float(atm_strike) if atm_strike is not None else None,
    dte_used=int(dte_used) if dte_used is not None else None,
    prob_above_atm=prob_above_atm,
    prob_below_atm=prob_below_atm,
    action=action,
    rationale=rationale,
    buy_call_score=buy_call_score,
    buy_put_score=buy_put_score,
    sell_premium_score=sell_premium_score,
  )
