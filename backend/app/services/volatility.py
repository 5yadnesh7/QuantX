from typing import List, Dict

import numpy as np
from scipy.stats import norm

from app.models.enums import OptionType


def _black_scholes_price(
  spot: float,
  strike: float,
  t: float,
  r: float,
  iv: float,
  option_type: OptionType,
) -> float:
  if t <= 0 or iv <= 0:
    return max(0.0, (spot - strike) if option_type == OptionType.CALL else (strike - spot))
  d1 = (np.log(spot / strike) + (r + 0.5 * iv ** 2) * t) / (iv * np.sqrt(t))
  d2 = d1 - iv * np.sqrt(t)
  if option_type == OptionType.CALL:
    return float(spot * norm.cdf(d1) - strike * np.exp(-r * t) * norm.cdf(d2))
  return float(strike * np.exp(-r * t) * norm.cdf(-d2) - spot * norm.cdf(-d1))


def implied_volatility(
  spot: float,
  strike: float,
  option_price: float,
  days_to_expiry: int,
  option_type: OptionType,
  rate: float = 0.0,
  tol: float = 1e-5,
  max_iter: int = 50,
) -> float:
  t = max(days_to_expiry, 1) / 252.0
  if option_price <= 0 or t <= 0:
    return 0.0

  low, high = 1e-6, 5.0
  for _ in range(max_iter):
    mid = 0.5 * (low + high)
    price = _black_scholes_price(spot, strike, t, rate, mid, option_type)
    if abs(price - option_price) < tol:
      return float(mid)
    if price > option_price:
      high = mid
    else:
      low = mid
  return float(0.5 * (low + high))


def historical_volatility(returns: List[float], trading_days: int = 252) -> float:
  if not returns:
    return 0.0
  return float(np.std(returns, ddof=1) * np.sqrt(trading_days))


def iv_rank(iv: float, history: List[float]) -> float:
  if not history:
    return 0.0
  count = sum(1 for x in history if x <= iv)
  return float(100.0 * count / len(history))


def iv_percentile(iv: float, history: List[float]) -> float:
  if not history:
    return 0.0
  below = sum(1 for x in history if x < iv)
  return float(100.0 * below / len(history))


def build_iv_surface(strikes: List[float], maturities: List[float], iv_matrix: List[List[float]]) -> Dict:
  return {"strikes": strikes, "maturities": maturities, "surface": iv_matrix}


def term_structure(maturities: List[float], ivs: List[float]) -> Dict:
  return {"tenors": maturities, "iv": ivs}


def skew_profile(strikes: List[float], ivs: List[float]) -> Dict:
  return {"strikes": strikes, "iv": ivs}
