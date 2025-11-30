from math import log, sqrt, exp
from typing import Optional

import numpy as np
from scipy.stats import norm

from app.models.enums import OptionType


def _d1_d2(spot: float, strike: float, t: float, iv: float, r: float = 0.0):
  if t <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
    return 0.0, 0.0
  d1 = (log(spot / strike) + (r + 0.5 * iv ** 2) * t) / (iv * sqrt(t))
  d2 = d1 - iv * sqrt(t)
  return d1, d2


def black_scholes_d2_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  option_type: OptionType,
) -> float:
  t = max(days_to_expiry, 1) / 252.0
  _, d2 = _d1_d2(spot, strike, t, iv)
  if option_type == OptionType.CALL:
    return float(norm.cdf(d2))
  return float(norm.cdf(-d2))


def lognormal_itm_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
) -> float:
  t = max(days_to_expiry, 1) / 252.0
  if spot <= 0 or strike <= 0 or iv <= 0 or t <= 0:
    return 0.0
  mu = log(spot) - 0.5 * iv ** 2 * t
  sigma = iv * sqrt(t)
  z = (log(strike) - mu) / sigma
  return float(1.0 - norm.cdf(z))


def binomial_itm_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  steps: int = 50,
) -> float:
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0:
    return 0.0
  dt = t / steps
  u = exp(iv * sqrt(dt))
  d = 1 / u
  p = 0.5
  probs = []
  for i in range(steps + 1):
    st = spot * (u ** i) * (d ** (steps - i))
    if st >= strike:
      from math import comb
      probs.append(comb(steps, i) * (p ** i) * ((1 - p) ** (steps - i)))
  return float(sum(probs))


def monte_carlo_itm_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  n_paths: int = 10000,
) -> float:
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0:
    return 0.0
  z = np.random.standard_normal(n_paths)
  st = spot * np.exp(-0.5 * iv ** 2 * t + iv * np.sqrt(t) * z)
  return float(np.mean(st >= strike))


def expected_move(spot: float, days_to_expiry: int, iv: float) -> float:
  t = max(days_to_expiry, 1) / 252.0
  if spot <= 0 or iv <= 0 or t <= 0:
    return 0.0
  return float(spot * iv * np.sqrt(t))


# ========== Additional Probability Models ==========

def geometric_brownian_motion_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  r: float = 0.0,
) -> float:
  """Geometric Brownian Motion: dS = r*S*dt + σ*S*dW"""
  t = max(days_to_expiry, 1) / 252.0
  if spot <= 0 or strike <= 0 or iv <= 0 or t <= 0:
    return 0.0
  mu = log(spot) + (r - 0.5 * iv ** 2) * t
  sigma = iv * sqrt(t)
  z = (log(strike) - mu) / sigma
  return float(1.0 - norm.cdf(z))


def trinomial_tree_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  steps: int = 50,
) -> float:
  """Trinomial Tree: price can move up, down, or stay flat"""
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0:
    return 0.0
  dt = t / steps
  u = exp(iv * sqrt(1.5 * dt))
  d = 1 / u
  m = 1.0  # middle (no change)
  
  # Risk-neutral probabilities
  pu = ((exp(0) - d) / (u - d)) ** 2
  pd = ((u - exp(0)) / (u - d)) ** 2
  pm = 1 - pu - pd
  
  # Build tree and calculate ITM probability
  probs = []
  for i in range(steps + 1):
    for j in range(steps - i + 1):
      st = spot * (u ** i) * (m ** (steps - i - j)) * (d ** j)
      if st >= strike:
        # Approximate probability using multinomial (simplified)
        from math import factorial
        if i + j <= steps:
          prob = (factorial(steps) / (factorial(i) * factorial(j) * factorial(steps - i - j))) * \
                 (pu ** i) * (pd ** j) * (pm ** (steps - i - j))
          probs.append(prob)
  return float(min(1.0, sum(probs)))


def heston_stochastic_volatility_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  v0: Optional[float] = None,
  kappa: float = 2.0,
  theta: float = 0.04,
  sigma_v: float = 0.3,
  rho: float = -0.7,
  n_paths: int = 5000,
) -> float:
  """Heston Stochastic Volatility: volatility itself is random"""
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0:
    return 0.0
  
  if v0 is None:
    v0 = iv ** 2  # initial variance
  
  dt = t / 100.0
  n_steps = int(t / dt)
  
  # Simplified Heston simulation
  np.random.seed(42)  # for reproducibility
  itm_count = 0
  
  for _ in range(n_paths):
    s = spot
    v = v0
    
    for _ in range(n_steps):
      z1 = np.random.standard_normal()
      z2 = rho * z1 + sqrt(1 - rho ** 2) * np.random.standard_normal()
      
      # Update variance (CIR process)
      v = max(0.01, v + kappa * (theta - v) * dt + sigma_v * sqrt(v) * sqrt(dt) * z2)
      
      # Update price
      s = s * exp(-0.5 * v * dt + sqrt(v) * sqrt(dt) * z1)
    
    if s >= strike:
      itm_count += 1
  
  return float(itm_count / n_paths)


def sabr_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  alpha: Optional[float] = None,
  beta: float = 0.5,
  rho: float = -0.3,
  nu: float = 0.4,
) -> float:
  """SABR (Stochastic Alpha Beta Rho) model for volatility smile"""
  t = max(days_to_expiry, 1) / 252.0
  if spot <= 0 or strike <= 0 or iv <= 0 or t <= 0:
    return 0.0
  
  if alpha is None:
    alpha = iv * (spot ** (1 - beta))
  
  # Simplified SABR: approximate IV and use Black-Scholes
  f = spot
  k = strike
  z = (nu / alpha) * (f ** (1 - beta) - k ** (1 - beta)) / (1 - beta)
  x_z = log((sqrt(1 - 2 * rho * z + z ** 2) + z - rho) / (1 - rho))
  
  if abs(z) < 1e-6:
    iv_sabr = alpha / (f ** (1 - beta))
  else:
    iv_sabr = alpha / (f ** (1 - beta)) * (z / x_z)
  
  # Use Black-Scholes with SABR IV
  _, d2 = _d1_d2(spot, strike, t, iv_sabr)
  return float(norm.cdf(d2))


def jump_diffusion_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  lambda_jump: float = 0.1,
  mu_jump: float = -0.05,
  sigma_jump: float = 0.15,
  n_paths: int = 5000,
) -> float:
  """Merton Jump-Diffusion: continuous changes + random jumps"""
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0:
    return 0.0
  
  np.random.seed(42)
  itm_count = 0
  
  for _ in range(n_paths):
    s = spot
    n_jumps = np.random.poisson(lambda_jump * t)
    
    # Continuous GBM component
    z = np.random.standard_normal()
    s = s * exp(-0.5 * iv ** 2 * t + iv * sqrt(t) * z)
    
    # Add jumps
    for _ in range(n_jumps):
      jump_size = exp(mu_jump + sigma_jump * np.random.standard_normal())
      s = s * jump_size
    
    if s >= strike:
      itm_count += 1
  
  return float(itm_count / n_paths)


def garch_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  alpha: float = 0.1,
  beta: float = 0.85,
  omega: float = 0.0001,
  n_paths: int = 5000,
) -> float:
  """GARCH(1,1): volatility clusters and depends on past shocks"""
  t = max(days_to_expiry, 1) / 252.0
  if t <= 0 or iv <= 0:
    return 0.0
  
  dt = t / 100.0
  n_steps = int(t / dt)
  
  np.random.seed(42)
  itm_count = 0
  
  for _ in range(n_paths):
    s = spot
    v = iv ** 2  # variance
    
    for _ in range(n_steps):
      z = np.random.standard_normal()
      s = s * exp(-0.5 * v * dt + sqrt(v) * sqrt(dt) * z)
      
      # Update variance using GARCH(1,1)
      shock = (log(s / (s / exp(-0.5 * v * dt + sqrt(v) * sqrt(dt) * z)))) ** 2 if s > 0 else 0
      v = omega + alpha * shock + beta * v
      v = max(0.0001, v)  # ensure positive variance
    
    if s >= strike:
      itm_count += 1
  
  return float(itm_count / n_paths)


def risk_neutral_density_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  option_prices: Optional[dict] = None,
) -> float:
  """Risk-Neutral Density: extract from option prices (second derivative)"""
  t = max(days_to_expiry, 1) / 252.0
  if spot <= 0 or strike <= 0 or iv <= 0 or t <= 0:
    return 0.0
  
  # If option prices provided, use them; otherwise approximate with Black-Scholes
  if option_prices:
    # Simplified: use finite difference to approximate second derivative
    # In practice, this would use actual market option prices
    pass
  
  # Fallback: use Black-Scholes as approximation
  _, d2 = _d1_d2(spot, strike, t, iv)
  return float(norm.cdf(d2))


def machine_learning_probability(
  spot: float,
  strike: float,
  days_to_expiry: int,
  iv: float,
  historical_features: Optional[dict] = None,
) -> float:
  """Machine Learning: simplified regression-based probability"""
  t = max(days_to_expiry, 1) / 252.0
  if spot <= 0 or strike <= 0 or iv <= 0 or t <= 0:
    return 0.0
  
  # Simplified ML model: weighted combination of features
  # In production, this would use a trained model
  moneyness = strike / spot
  time_factor = sqrt(t)
  iv_factor = iv
  
  # Simple logistic-like transformation
  log_odds = -2.0 * (moneyness - 1.0) / (iv_factor * time_factor)
  prob = 1.0 / (1.0 + exp(-log_odds))
  
  # Adjust based on historical features if provided
  if historical_features:
    trend = historical_features.get('trend', 0.0)
    prob = prob * (1.0 + 0.1 * trend)  # simple adjustment
  
  return float(max(0.0, min(1.0, prob)))
