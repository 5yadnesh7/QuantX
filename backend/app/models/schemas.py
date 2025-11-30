from datetime import datetime
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field

from .enums import OptionType, StrategyMode, TrendDirection, MarketRegime


class Instrument(BaseModel):
  symbol: str
  name: Optional[str] = None
  exchange: Optional[str] = None
  instrument_type: Optional[str] = Field(None, alias="type")


class OptionChainEntry(BaseModel):
  symbol: str
  expiry: datetime
  strike: float
  option_type: OptionType
  bid: float
  ask: float
  last: float
  volume: float
  open_interest: float
  iv: Optional[float] = None
  delta: Optional[float] = None
  theta: Optional[float] = None
  gamma: Optional[float] = None
  vega: Optional[float] = None


class OptionChainResponse(BaseModel):
  underlying: str
  timestamp: datetime
  entries: List[OptionChainEntry]


class ProbabilityRequest(BaseModel):
  spot: float
  strike: float
  days_to_expiry: int
  iv: float
  option_type: OptionType


class ProbabilityResult(BaseModel):
  d2_probability: float
  lognormal_itm_probability: float
  binomial_itm_probability: float
  monte_carlo_itm_probability: float
  expected_move: float


class GreeksRequest(BaseModel):
  spot: float
  strike: float
  days_to_expiry: int
  iv: float
  option_type: OptionType
  rate: float = 0.0


class GreeksResponse(BaseModel):
  price: float
  delta: float
  gamma: float
  theta: float
  vega: float
  rho: float


class IVRequest(BaseModel):
  spot: float
  strike: float
  option_price: float
  days_to_expiry: int
  option_type: OptionType
  rate: float = 0.0
  historical_iv_series: Optional[List[float]] = None


class IVResponse(BaseModel):
  iv: float
  iv_rank: Optional[float] = None
  iv_percentile: Optional[float] = None
  hv: Optional[float] = None


class OIRequest(BaseModel):
  symbol: str
  days: int = 5


class OIResponse(BaseModel):
  spike_score: float
  volume_oi_ratio: float
  trend: str
  anomaly_score: float
  pcr_oi: Optional[float] = None  # Put-Call Ratio based on OI
  pcr_volume: Optional[float] = None  # Put-Call Ratio based on Volume


class MarketRequest(BaseModel):
  symbol: str
  lookback: int = 20


class MarketResponse(BaseModel):
  atr_trend: TrendDirection
  vwap_signal: str
  bollinger_squeeze: float
  trend_signal: TrendDirection
  mean_reversion_score: float
  regime: MarketRegime


class ConsensusRequest(BaseModel):
  probability: ProbabilityResult
  volatility: IVResponse
  oi: OIResponse
  market: MarketResponse


class ConsensusResponse(BaseModel):
  confidence_score: float
  details: Dict[str, Any]


class Condition(BaseModel):
  indicator: str
  operator: str
  threshold: float


class Filter(BaseModel):
  name: str
  params: Dict[str, Any] = {}


class Action(BaseModel):
  side: str
  quantity: int
  instrument: str


class ExitRule(BaseModel):
  type: str
  value: float


class StrategyDefinition(BaseModel):
  name: str
  mode: StrategyMode
  conditions: List[Condition]
  filters: List[Filter] = []
  actions: List[Action]
  exits: List[ExitRule] = []
  multi_leg: bool = False


class StrategyRunRequest(BaseModel):
  strategy: StrategyDefinition
  symbol: str


class StrategyBacktestRequest(BaseModel):
  strategy: StrategyDefinition
  symbol: str
  start_date: datetime
  end_date: datetime
  initial_capital: float = 100000.0


class StrategySaveRequest(BaseModel):
  strategy: StrategyDefinition


class Trade(BaseModel):
  time: datetime
  symbol: str
  side: str
  quantity: int
  price: float
  pnl: float


class BacktestStats(BaseModel):
  total_trades: int
  win_rate: float
  profit_factor: float
  max_drawdown: float
  sharpe: float


class BacktestResult(BaseModel):
  id: str
  symbol: str
  strategy_name: str
  equity_curve: List[float]
  trades: List[Trade]
  stats: BacktestStats


class FiiDiiDay(BaseModel):
  date: datetime
  fii_net: float
  dii_net: float


class FiiDiiResponse(BaseModel):
  days: List[FiiDiiDay]


class ModelsInsightsResponse(BaseModel):
  models: Dict[str, Any]
