from enum import Enum


class OptionType(str, Enum):
  CALL = "CALL"
  PUT = "PUT"


class StrategyMode(str, Enum):
  LIVE = "LIVE"
  BACKTEST = "BACKTEST"


class TrendDirection(str, Enum):
  UP = "UP"
  DOWN = "DOWN"
  SIDEWAYS = "SIDEWAYS"


class MarketRegime(str, Enum):
  BULL = "BULL"
  BEAR = "BEAR"
  RANGE = "RANGE"
  VOLATILE = "VOLATILE"
