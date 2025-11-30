from datetime import datetime
from typing import List, Dict, Any

from app.models.schemas import (
  StrategyDefinition,
  StrategyRunRequest,
  StrategyBacktestRequest,
  Trade,
)


def _evaluate_condition(cond, context: Dict[str, Any]) -> bool:
  value = context.get(cond.indicator, 0.0)
  op = cond.operator
  thr = cond.threshold
  if op == ">":
    return value > thr
  if op == "<":
    return value < thr
  if op == ">=":
    return value >= thr
  if op == "<=":
    return value <= thr
  if op == "==":
    return value == thr
  if op == "!=":
    return value != thr
  return False


def _apply_filters(filters, context: Dict[str, Any]) -> bool:
  for f in filters:
    if f.name == "min_volume":
      if context.get("volume", 0) < f.params.get("value", 0):
        return False
    if f.name == "session":
      session = f.params.get("value")
      now = datetime.utcnow().time()
      if session == "opening" and now.hour > 10:
        return False
  return True


def _build_trades_from_actions(actions, price: float) -> List[Trade]:
  trades: List[Trade] = []
  for a in actions:
    side = a.side.upper()
    qty = a.quantity
    trades.append(
      Trade(
        time=datetime.utcnow(),
        symbol=a.instrument,
        side=side,
        quantity=qty,
        price=price,
        pnl=0.0,
      )
    )
  return trades


def run_live_strategy(req: StrategyRunRequest, context: Dict[str, Any]) -> Dict[str, Any]:
  strat: StrategyDefinition = req.strategy
  all_conditions = all(_evaluate_condition(c, context) for c in strat.conditions)
  filters_ok = _apply_filters(strat.filters, context)
  should_trade = all_conditions and filters_ok
  price = context.get("price", 0.0)
  trades = _build_trades_from_actions(strat.actions, price) if should_trade else []
  return {
    "executed": should_trade,
    "trades": [t.dict() for t in trades],
    "context": context,
  }


def simulate_backtest(req: StrategyBacktestRequest, prices: List[float]) -> List[Trade]:
  trades: List[Trade] = []
  if not prices:
    return trades
  for i, p in enumerate(prices):
    ctx = {"price": p}
    if i % 10 == 0:
      for a in req.strategy.actions:
        trades.append(
          Trade(
            time=req.start_date,
            symbol=a.instrument,
            side=a.side,
            quantity=a.quantity,
            price=p,
            pnl=0.0,
          )
        )
  return trades

