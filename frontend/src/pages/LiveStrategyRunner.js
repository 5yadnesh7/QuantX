import React, { useState, useEffect } from 'react';
import { runLiveStrategy } from '../api/client';
import useStore from '../state/store';

const livePresets = {
  meanReversion: {
    name: 'Mean Reversion Call',
    mode: 'LIVE',
    conditions: [{ indicator: 'iv_rank', operator: '>', threshold: 50 }],
    filters: [{ name: 'min_volume', params: { value: 100000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_CALL' }],
    exits: [{ type: 'take_profit', value: 0.3 }],
    multi_leg: false,
  },
  breakout: {
    name: 'Breakout Call',
    mode: 'LIVE',
    conditions: [{ indicator: 'price_above_vwap', operator: '>', threshold: 0 }],
    filters: [{ name: 'min_volume', params: { value: 200000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'OTM_CALL' }],
    exits: [{ type: 'stop_loss', value: 0.2 }],
    multi_leg: false,
  },
  pcrBullish: {
    name: 'PCR Bullish (Low PCR)',
    mode: 'LIVE',
    conditions: [{ indicator: 'pcr_oi', operator: '<', threshold: 0.7 }],
    filters: [{ name: 'min_volume', params: { value: 150000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_CALL' }],
    exits: [{ type: 'take_profit', value: 0.25 }, { type: 'stop_loss', value: 0.15 }],
    multi_leg: false,
  },
  pcrBearish: {
    name: 'PCR Bearish (High PCR)',
    mode: 'LIVE',
    conditions: [{ indicator: 'pcr_oi', operator: '>', threshold: 1.2 }],
    filters: [{ name: 'min_volume', params: { value: 150000 } }],
    actions: [{ side: 'BUY', quantity: 1, instrument: 'ATM_PUT' }],
    exits: [{ type: 'take_profit', value: 0.25 }, { type: 'stop_loss', value: 0.15 }],
    multi_leg: false,
  },
  pcrContrarian: {
    name: 'PCR Contrarian (Extreme PCR)',
    mode: 'LIVE',
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

export default function LiveStrategyRunner() {
  const { instruments, selectedSymbol, loadInstruments } = useStore();
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preset, setPreset] = useState('meanReversion');

  useEffect(() => {
    if (!instruments.length) {
      loadInstruments();
    }
  }, [instruments.length, loadInstruments]);

  const handleRunOnce = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        symbol: selectedSymbol || instruments[0]?.symbol || '',
        strategy: livePresets[preset],
      };
      const res = await runLiveStrategy(payload);
      setLog((prev) => [res.data, ...prev].slice(0, 50));
    } catch (e) {
      console.error(e);
      setError('Could not run strategy – check backend / network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Live Strategy Runner</h1>
          <p className="text-[11px] text-slate-400">
            Sends a strategy preset to the backend and asks: “Should we trade now?”
            In this dev build it uses mock price/volume context rather than live Upstox ticks.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-slate-400 text-[11px]">Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
            >
              <option value="meanReversion">Mean reversion call</option>
              <option value="breakout">Breakout call</option>
              <option value="pcrBullish">PCR Bullish (Low PCR)</option>
              <option value="pcrBearish">PCR Bearish (High PCR)</option>
              <option value="pcrContrarian">PCR Contrarian (Extreme)</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px]">Instrument</label>
            <div className="text-slate-200 font-semibold">
              {selectedSymbol || instruments[0]?.symbol || '—'}
            </div>
          </div>
          <button
            onClick={handleRunOnce}
            disabled={loading}
            className="bg-accent hover:bg-accentSoft disabled:opacity-50 text-black text-xs font-semibold px-3 py-1 rounded"
          >
            {loading ? 'Running…' : 'Run once'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 rounded px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="text-slate-400 mb-1">Execution log</div>
        <div className="max-h-[70vh] overflow-y-auto space-y-2 text-[11px]">
          {log.map((entry, idx) => (
            <div
              key={idx}
              className="border border-slate-800 rounded p-2 bg-slate-900/60"
            >
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">
                  {entry.executed ? 'EXECUTED' : 'SKIPPED'}
                </span>
                <span className="text-slate-500">
                  {new Date().toISOString()}
                </span>
              </div>
              <pre className="text-[10px] text-slate-400 overflow-auto">
                {JSON.stringify(entry.trades || [], null, 2)}
              </pre>
            </div>
          ))}
          {log.length === 0 && (
            <div className="text-slate-600">
              Trigger the strategy to see live execution decisions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

