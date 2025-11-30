from typing import List, Dict

import numpy as np

from app.models.enums import TrendDirection, MarketRegime


def atr(high: List[float], low: List[float], close: List[float], period: int = 14) -> float:
  if len(close) < period + 1:
    return 0.0
  trs = []
  for i in range(1, len(close)):
    tr = max(
      high[i] - low[i],
      abs(high[i] - close[i - 1]),
      abs(low[i] - close[i - 1]),
    )
    trs.append(tr)
  return float(np.mean(trs[-period:]))


def atr_trend(high: List[float], low: List[float], close: List[float]) -> TrendDirection:
  if len(close) < 2:
    return TrendDirection.SIDEWAYS
  a = atr(high, low, close)
  if a == 0:
    return TrendDirection.SIDEWAYS
  slope = np.polyfit(np.arange(len(close)), close, 1)[0]
  if slope > 0 and close[-1] - close[0] > a:
    return TrendDirection.UP
  if slope < 0 and close[0] - close[-1] > a:
    return TrendDirection.DOWN
  return TrendDirection.SIDEWAYS


def vwap(prices: List[float], volumes: List[float]) -> float:
  if not prices or not volumes or len(prices) != len(volumes):
    return 0.0
  return float(np.sum(np.array(prices) * np.array(volumes)) / (np.sum(volumes) + 1e-8))


def vwap_signal(prices: List[float], volumes: List[float]) -> str:
  if not prices:
    return "neutral"
  v = vwap(prices, volumes)
  last = prices[-1]
  if last > v * 1.001:
    return "above_vwap"
  if last < v * 0.999:
    return "below_vwap"
  return "near_vwap"


def bollinger_squeeze(close: List[float], period: int = 20, num_std: float = 2.0) -> float:
  if len(close) < period:
    return 0.0
  window = np.array(close[-period:])
  ma = np.mean(window)
  sd = np.std(window)
  upper = ma + num_std * sd
  lower = ma - num_std * sd
  bandwidth = (upper - lower) / (ma + 1e-8)
  return float(bandwidth)


def trend_model(close: List[float]) -> TrendDirection:
  if len(close) < 2:
    return TrendDirection.SIDEWAYS
  slope = np.polyfit(np.arange(len(close)), close, 1)[0]
  if slope > 0:
    return TrendDirection.UP
  if slope < 0:
    return TrendDirection.DOWN
  return TrendDirection.SIDEWAYS


def mean_reversion_score(close: List[float], lookback: int = 20) -> float:
  if len(close) < lookback:
    return 0.0
  window = np.array(close[-lookback:])
  ma = np.mean(window)
  sd = np.std(window) + 1e-8
  z = (window[-1] - ma) / sd
  return float(-z)


def market_regime(close: List[float]) -> MarketRegime:
  if len(close) < 30:
    return MarketRegime.RANGE
  returns = np.diff(np.log(np.array(close)))
  vol = np.std(returns) * np.sqrt(252)
  slope = np.polyfit(np.arange(len(close)), close, 1)[0]
  if vol < 0.15 and slope > 0:
    return MarketRegime.BULL
  if vol < 0.15 and slope < 0:
    return MarketRegime.BEAR
  if vol >= 0.15 and abs(slope) < 1e-6:
    return MarketRegime.VOLATILE
  return MarketRegime.RANGE


def compute_market_metrics(
  high: List[float],
  low: List[float],
  close: List[float],
  volumes: List[float],
) -> Dict:
  atr_dir = atr_trend(high, low, close)
  vwap_sig = vwap_signal(close, volumes)
  squeeze = bollinger_squeeze(close)
  trend_sig = trend_model(close)
  mr_score = mean_reversion_score(close)
  regime = market_regime(close)
  return {
    "atr_trend": atr_dir,
    "vwap_signal": vwap_sig,
    "bollinger_squeeze": squeeze,
    "trend_signal": trend_sig,
    "mean_reversion_score": mr_score,
    "regime": regime,
  }

