from app.models.schemas import (
  ProbabilityResult,
  IVResponse,
  OIResponse,
  MarketResponse,
  ConsensusResponse,
)


def compute_consensus(
  probability: ProbabilityResult,
  volatility: IVResponse,
  oi: OIResponse,
  market: MarketResponse,
) -> ConsensusResponse:
  prob_score = 100.0 * max(probability.d2_probability, probability.monte_carlo_itm_probability)

  vol_components = []
  if volatility.iv is not None and volatility.hv is not None and volatility.hv > 0:
    vol_components.append(min(2.0, volatility.hv / volatility.iv) * 50.0)
  if volatility.iv_rank is not None:
    vol_components.append(100.0 - abs(volatility.iv_rank - 50.0))
  if volatility.iv_percentile is not None:
    vol_components.append(100.0 - abs(volatility.iv_percentile - 50.0))
  vol_score = sum(vol_components) / len(vol_components) if vol_components else 50.0

  oi_score = 100.0 - min(100.0, abs(oi.spike_score) * 10.0 + oi.anomaly_score * 10.0)
  mr_component = 50.0 + market.mean_reversion_score * 10.0
  trend_component = 70.0 if market.trend_signal.name == "UP" else 30.0 if market.trend_signal.name == "DOWN" else 50.0
  regime_map = {
    "BULL": 70.0,
    "BEAR": 30.0,
    "RANGE": 50.0,
    "VOLATILE": 40.0,
  }
  regime_component = regime_map.get(market.regime.name, 50.0)
  market_score = (mr_component + trend_component + regime_component) / 3.0

  weights = {
    "probability": 0.35,
    "volatility": 0.25,
    "oi": 0.15,
    "market": 0.25,
  }
  raw_score = (
    prob_score * weights["probability"]
    + vol_score * weights["volatility"]
    + oi_score * weights["oi"]
    + market_score * weights["market"]
  )
  confidence_score = max(0.0, min(100.0, raw_score))

  return ConsensusResponse(
    confidence_score=confidence_score,
    details={
      "probability_score": prob_score,
      "volatility_score": vol_score,
      "oi_score": oi_score,
      "market_score": market_score,
    },
  )

