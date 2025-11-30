from typing import List, Dict

import numpy as np

from app.models.schemas import BacktestResult, BacktestStats, Trade, StrategyBacktestRequest


def _apply_fee_and_slippage(price: float, fee_perc: float, slippage_bps: float, side: str) -> float:
  fee = price * fee_perc
  slip = price * slippage_bps / 10000.0
  if side.upper() == "BUY":
    return price + fee + slip
  return price - fee - slip


def equity_curve_from_trades(initial_capital: float, trades: List[Trade]) -> List[float]:
  equity = initial_capital
  curve = [equity]
  for t in trades:
    direction = 1 if t.side.upper() == "BUY" else -1
    equity += direction * t.quantity * t.price * 0.001
    curve.append(equity)
  return curve


def compute_stats(equity_curve: List[float]) -> BacktestStats:
  if len(equity_curve) < 2:
    return BacktestStats(total_trades=0, win_rate=0.0, profit_factor=0.0, max_drawdown=0.0, sharpe=0.0)
  returns = np.diff(equity_curve) / equity_curve[:-1]
  total_trades = len(returns)
  wins = np.sum(returns > 0)
  losses = np.sum(returns < 0)
  win_rate = float(wins / total_trades) if total_trades else 0.0
  gross_profit = float(np.sum(returns[returns > 0]))
  gross_loss = float(-np.sum(returns[returns < 0])) if losses else 0.0
  if gross_loss > 0:
    profit_factor = float(gross_profit / gross_loss)
  elif gross_profit > 0:
    # Avoid JSON non-compliant Infinity; cap at a large finite number
    profit_factor = 999.0
  else:
    profit_factor = 0.0
  peak = np.maximum.accumulate(equity_curve)
  drawdowns = (equity_curve - peak) / peak
  max_dd = float(drawdowns.min()) if len(drawdowns) else 0.0
  sharpe = float(np.mean(returns) / (np.std(returns) + 1e-8) * np.sqrt(252)) if len(returns) else 0.0
  return BacktestStats(
    total_trades=total_trades,
    win_rate=win_rate,
    profit_factor=profit_factor,
    max_drawdown=max_dd,
    sharpe=sharpe,
  )


def run_backtest(req: StrategyBacktestRequest, prices: List[float]) -> BacktestResult:
  trades: List[Trade] = []
  for i, price in enumerate(prices):
    if i % 10 == 0:
      for a in req.strategy.actions:
        side = a.side.upper()
        exec_price = _apply_fee_and_slippage(price, fee_perc=0.0005, slippage_bps=1.0, side=side)
        trades.append(
          Trade(
            time=req.start_date,
            symbol=a.instrument,
            side=side,
            quantity=a.quantity,
            price=exec_price,
            pnl=0.0,
          )
        )

  equity_curve = equity_curve_from_trades(req.initial_capital, trades)
  stats = compute_stats(equity_curve)

  return BacktestResult(
    id="bt_" + req.strategy.name.replace(" ", "_"),
    symbol=req.symbol,
    strategy_name=req.strategy.name,
    equity_curve=equity_curve,
    trades=trades,
    stats=stats,
  )

