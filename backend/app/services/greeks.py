from math import log, sqrt, exp

import numpy as np
from scipy.stats import norm

from app.models.enums import OptionType


def _d1_d2(spot: float, strike: float, t: float, iv: float, r: float = 0.0):
  if t <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
    return 0.0, 0.0
  d1 = (log(spot / strike) + (r + 0.5 * iv ** 2) * t) / (iv * sqrt(t))
  d2 = d1 - iv * sqrt(t)
  return d1, d2


def black_scholes_price(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  option_type: OptionType,
  rate: float = 0.0,
) -> float:
  t = max(days_to_expiry, 1) / 252.0
  d1, d2 = _d1_d2(spot, strike, t, iv, rate)
  if option_type == OptionType.CALL:
    return float(spot * norm.cdf(d1) - strike * exp(-rate * t) * norm.cdf(d2))
  return float(strike * exp(-rate * t) * norm.cdf(-d2) - spot * norm.cdf(-d1))


def compute_greeks(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  option_type: OptionType,
  rate: float = 0.0,
):
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
    return {"price": 0.0, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}

  d1, d2 = _d1_d2(spot, strike, t, iv, rate)
  price = black_scholes_price(spot, strike, days_to_expiry, iv, option_type, rate)

  if option_type == OptionType.CALL:
    delta = norm.cdf(d1)
    rho = t * strike * exp(-rate * t) * norm.cdf(d2)
  else:
    delta = norm.cdf(d1) - 1
    rho = -t * strike * exp(-rate * t) * norm.cdf(-d2)

  gamma = norm.pdf(d1) / (spot * iv * sqrt(t))
  vega = spot * norm.pdf(d1) * sqrt(t) / 100.0  # per 1% change in vol
  theta = (
    -(spot * norm.pdf(d1) * iv / (2 * sqrt(t)))
    - (rate * strike * exp(-rate * t) * norm.cdf(d2 if option_type == OptionType.CALL else -d2))
  ) / 252.0  # per day

  return {
    "price": float(price),
    "delta": float(delta),
    "gamma": float(gamma),
    "theta": float(theta),
    "vega": float(vega),
    "rho": float(rho),
  }


