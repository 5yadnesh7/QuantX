import React, { useState, useEffect } from 'react';
import useStore from '../state/store';
import TimeSeriesChart from '../charts/TimeSeriesChart';

const strategyPresets = {
  meanReversion: {
    name: 'Mean Reversion Call',
    mode: 'BACKTEST',
    conditions: [{ indicator: 'iv_rank', operator: '>', threshold: 50 }],
    filters: [{ name: 'min_volume', params: { value: 100000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_CALL' }],
    exits: [{ type: 'take_profit', value: 0.3 }],
    multi_leg: false,
  },
  breakout: {
    name: 'Breakout Call',
    mode: 'BACKTEST',
    conditions: [{ indicator: 'price_above_vwap', operator: '>', threshold: 0 }],
    filters: [{ name: 'min_volume', params: { value: 200000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'OTM_CALL' }],
    exits: [{ type: 'stop_loss', value: 0.2 }],
    multi_leg: false,
  },
  ironCondor: {
    name: 'Iron Condor',
    mode: 'BACKTEST',
    conditions: [{ indicator: 'iv_rank', operator: '>', threshold: 40 }],
    filters: [],
    actions: [
      { side: 'SELL', quantity: 1, instrument: 'SHORT_OTM_CALL' },
      { side: 'SELL', quantity: 1, instrument: 'SHORT_OTM_PUT' },
      { side: 'BUY', quantity: 1, instrument: 'LONG_FURTHER_OTM_CALL' },
      { side: 'BUY', quantity: 1, instrument: 'LONG_FURTHER_OTM_PUT' },
    ],
    exits: [{ type: 'time_exit', value: 5 }],
    multi_leg: true,
  },
  pcrBullish: {
    name: 'PCR Bullish (Low PCR)',
    mode: 'BACKTEST',
    conditions: [{ indicator: 'pcr_oi', operator: '<', threshold: 0.7 }],
    filters: [{ name: 'min_volume', params: { value: 150000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_CALL' }],
    exits: [{ type: 'take_profit', value: 0.25 }, { type: 'stop_loss', value: 0.15 }],
    multi_leg: false,
  },
  pcrBearish: {
    name: 'PCR Bearish (High PCR)',
    mode: 'BACKTEST',
    conditions: [{ indicator: 'pcr_oi', operator: '>', threshold: 1.2 }],
    filters: [{ name: 'min_volume', params: { value: 150000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_PUT' }],
    exits: [{ type: 'take_profit', value: 0.25 }, { type: 'stop_loss', value: 0.15 }],
    multi_leg: false,
  },
  pcrContrarian: {
    name: 'PCR Contrarian (Extreme PCR)',
    mode: 'BACKTEST',
    conditions: [
      { indicator: 'pcr_oi', operator: '>', threshold: 1.5 },
      { indicator: 'iv_rank', operator: '>', threshold: 40 },
    ],
    filters: [{ name: 'min_volume', params: { value: 200000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_CALL' }],
    exits: [{ type: 'take_profit', value: 0.3 }, { type: 'time_exit', value: 3 }],
    multi_leg: false,
  },
};

export default function BacktestStudio() {
  const { instruments, selectedSymbol, loadInstruments, backtestResult, runBacktestAndStore, error } = useStore();
  const [capital, setCapital] = useState(100000);
  const [preset, setPreset] = useState('meanReversion');

  useEffect(() => {
    if (!instruments.length) {
      loadInstruments();
    }
  }, [instruments.length, loadInstruments]);

  const handleRun = () => {
    runBacktestAndStore({
      symbol: selectedSymbol || instruments[0]?.symbol || '',
      start_date: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      end_date: new Date().toISOString(),
      initial_capital: Number(capital),
      strategy: strategyPresets[preset],
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
            <label className="block text-slate-400 text-[11px]">Strategy preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
            >
              <option value="meanReversion">Mean reversion call</option>
              <option value="breakout">Breakout call</option>
              <option value="ironCondor">Iron condor</option>
              <option value="pcrBullish">PCR Bullish (Low PCR)</option>
              <option value="pcrBearish">PCR Bearish (High PCR)</option>
              <option value="pcrContrarian">PCR Contrarian (Extreme)</option>
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

