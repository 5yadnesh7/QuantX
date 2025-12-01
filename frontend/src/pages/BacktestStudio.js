import React, { useState, useEffect } from 'react';
import useStore from '../state/store';
import TimeSeriesChart from '../charts/TimeSeriesChart';
import { getStrategies } from '../api/client';

export default function BacktestStudio() {
  const { instruments, selectedSymbol, loadInstruments, backtestResult, runBacktestAndStore, error } = useStore();
  const [capital, setCapital] = useState(100000);
  const [selectedStrategyName, setSelectedStrategyName] = useState('');
  const [strategies, setStrategies] = useState([]);
  const [loadingStrategies, setLoadingStrategies] = useState(false);

  useEffect(() => {
    if (!instruments.length) {
      loadInstruments();
    }
  }, [instruments.length, loadInstruments]);

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      setLoadingStrategies(true);
      const res = await getStrategies();
      const allStrategies = res.data.strategies || [];
      setStrategies(allStrategies);
      // Set default to first strategy if available
      if (allStrategies.length > 0 && !selectedStrategyName) {
        setSelectedStrategyName(allStrategies[0].name);
      }
    } catch (e) {
      console.error('Failed to load strategies:', e);
    } finally {
      setLoadingStrategies(false);
    }
  };

  const handleRun = () => {
    // Find the selected strategy
    const strategy = strategies.find(s => s.name === selectedStrategyName);
    if (!strategy) {
      alert('Please select a strategy');
      return;
    }

    // Convert strategy to backtest format (ensure mode is BACKTEST)
    const backtestStrategy = {
      ...strategy,
      mode: 'BACKTEST',
    };

    runBacktestAndStore({
      symbol: selectedSymbol || instruments[0]?.symbol || '',
      start_date: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      end_date: new Date().toISOString(),
      initial_capital: Number(capital),
      strategy: backtestStrategy,
    });
  };

  const curve =
    backtestResult?.equity_curve?.filter(v => typeof v === 'number').map((v, idx) => ({ time: idx, value: v })) || [];

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Backtest Studio</h1>
          <p className="text-[11px] text-slate-400">
            Runs a simplified backtest on synthetic price data to exercise the backend engine.
            In a production setup you would plug in real OHLCV from MongoDB and custom strategies.
          </p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="block text-slate-400 text-[11px]">Instrument</label>
            <div className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] w-32">
              {selectedSymbol || instruments[0]?.symbol || '—'}
            </div>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px]">Initial capital</label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] w-32"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-[11px]">Strategy</label>
            <select
              value={selectedStrategyName}
              onChange={(e) => setSelectedStrategyName(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] min-w-[200px]"
              disabled={loadingStrategies}
            >
              {loadingStrategies ? (
                <option>Loading strategies...</option>
              ) : strategies.length === 0 ? (
                <option>No strategies available</option>
              ) : (
                strategies.map((strategy) => (
                  <option key={strategy.name} value={strategy.name}>
                    {strategy.name} {strategy.is_default ? '(Default)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>
          <button
            onClick={handleRun}
            className="bg-accent hover:bg-accentSoft text-black text-xs font-semibold px-3 py-1 rounded"
          >
            Run backtest
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 rounded px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-surface rounded border border-slate-800 p-3 space-y-1">
          <div className="text-slate-400 mb-1">Summary</div>
          {backtestResult ? (
            <>
              <div className="flex justify-between">
                <span>Trades</span>
                <span>{backtestResult.stats.total_trades}</span>
              </div>
              <div className="flex justify-between">
                <span>Win rate</span>
                <span>{typeof backtestResult.stats.win_rate === 'number' ? (backtestResult.stats.win_rate * 100).toFixed(1) : '—'}%</span>
              </div>
              <div className="flex justify-between">
                <span>Profit factor</span>
                <span>{typeof backtestResult.stats.profit_factor === 'number' ? backtestResult.stats.profit_factor.toFixed(2) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Max drawdown</span>
                <span>{typeof backtestResult.stats.max_drawdown === 'number' ? (backtestResult.stats.max_drawdown * 100).toFixed(1) : '—'}%</span>
              </div>
              <div className="flex justify-between">
                <span>Sharpe</span>
                <span>{typeof backtestResult.stats.sharpe === 'number' ? backtestResult.stats.sharpe.toFixed(2) : '—'}</span>
              </div>
            </>
          ) : (
            <div className="text-slate-600 text-[11px]">
              Run a backtest to see performance metrics.
            </div>
          )}
        </div>

        <div className="col-span-3 bg-surface rounded border border-slate-800 p-3">
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Equity curve</span>
            <span>{backtestResult?.id}</span>
          </div>
          <TimeSeriesChart data={curve} height={260} />
        </div>
      </div>

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="text-slate-400 mb-1">Trades</div>
        <div className="max-h-64 overflow-y-auto text-[11px]">
          {backtestResult?.trades?.map((t, idx) => (
            <div
              key={idx}
              className="flex justify-between border-b border-slate-800/60 py-1"
            >
              <span>{t.symbol}</span>
              <span className={t.side === 'BUY' ? 'text-positive' : 'text-negative'}>
                {t.side}
              </span>
              <span>{t.quantity}</span>
              <span>{typeof t.price === 'number' ? t.price.toFixed(2) : '—'}</span>
              <span className="text-slate-500 text-[10px]">{t.time || '—'}</span>
            </div>
          ))}
          {!backtestResult && (
            <div className="text-slate-600">No trades yet; run a backtest.</div>
          )}
        </div>
      </div>
    </div>
  );
}

