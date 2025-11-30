import React from 'react';
import useStore from '../state/store';

export default function Trades() {
  const { backtestResult } = useStore();

  const trades = backtestResult?.trades || [];

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trades</h1>
      </div>

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="text-slate-400 mb-1">
          Backtest trades ({trades.length}) – run a backtest in Backtest Studio to populate.
        </div>
        <div className="max-h-[75vh] overflow-y-auto text-[11px]">
          {trades.map((t, idx) => (
            <div
              key={idx}
              className="grid grid-cols-6 gap-2 border-b border-slate-800/60 py-1"
            >
              <span>{t.symbol}</span>
              <span className={t.side === 'BUY' ? 'text-positive' : 'text-negative'}>
                {t.side}
              </span>
              <span>{t.quantity}</span>
              <span>{t.price.toFixed(2)}</span>
              <span className="text-slate-500 text-[10px]">{t.time}</span>
              <span className="text-slate-400">{t.pnl.toFixed(2)}</span>
            </div>
          ))}
          {trades.length === 0 && (
            <div className="text-slate-600">
              No trades to show yet. Run a backtest to generate a trade list.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

