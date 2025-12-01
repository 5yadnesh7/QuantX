import React, { useState, useEffect } from 'react';
import { runLiveStrategy, getStrategies } from '../api/client';
import useStore from '../state/store';

export default function LiveStrategyRunner() {
  const { instruments, selectedSymbol, loadInstruments } = useStore();
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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

  const handleRunOnce = async () => {
    // Find the selected strategy
    const strategy = strategies.find(s => s.name === selectedStrategyName);
    if (!strategy) {
      alert('Please select a strategy');
      return;
    }

    // Convert strategy to live format (ensure mode is LIVE)
    const liveStrategy = {
      ...strategy,
      mode: 'LIVE',
    };

    setLoading(true);
    setError(null);
    try {
      const payload = {
        symbol: selectedSymbol || instruments[0]?.symbol || '',
        strategy: liveStrategy,
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

