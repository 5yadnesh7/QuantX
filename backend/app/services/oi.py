from typing import List, Dict

import numpy as np


def oi_spike_detector(oi_series: List[float]) -> float:
  if len(oi_series) < 2:
    return 0.0
  changes = np.diff(oi_series)
  if np.std(changes) == 0:
    return 0.0
  z = (changes[-1] - np.mean(changes)) / np.std(changes)
  return float(z)


def volume_oi_ratio(volume: float, oi: float) -> float:
  if oi <= 0:
    return 0.0
  return float(volume / oi)


def multi_day_trend_classifier(oi_series: List[float]) -> str:
  if len(oi_series) < 2:
    return "flat"
  x = np.arange(len(oi_series))
  coeffs = np.polyfit(x, oi_series, 1)
  slope = coeffs[0]
  if slope > 0:
    return "rising"
  if slope < 0:
    return "falling"
  return "flat"


def oi_anomaly_score(oi_series: List[float]) -> float:
  if not oi_series:
    return 0.0
  z = (oi_series[-1] - np.mean(oi_series)) / (np.std(oi_series) + 1e-8)
  return float(abs(z))


def calculate_pcr(put_oi: float, call_oi: float) -> float:
  """
  Calculate Put-Call Ratio (PCR) based on Open Interest.
  PCR = Put OI / Call OI
  High PCR (> 1.0) = bearish sentiment, low PCR (< 0.7) = bullish sentiment
  """
  if call_oi <= 0:
    return 0.0
  return float(put_oi / call_oi)


def calculate_pcr_volume(put_volume: float, call_volume: float) -> float:
  """
  Calculate Put-Call Ratio based on Volume.
  """
  if call_volume <= 0:
    return 0.0
  return float(put_volume / call_volume)


def compute_oi_metrics(oi_series: List[float], volume_series: List[float]) -> Dict:
  oi_spike = oi_spike_detector(oi_series)
  vol_oi = volume_oi_ratio(volume_series[-1] if volume_series else 0.0, oi_series[-1] if oi_series else 0.0)
  trend = multi_day_trend_classifier(oi_series)
  anomaly = oi_anomaly_score(oi_series)
  return {
    "spike_score": oi_spike,
    "volume_oi_ratio": vol_oi,
    "trend": trend,
    "anomaly_score": anomaly,
  }
