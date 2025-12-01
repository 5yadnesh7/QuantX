import React, { useEffect, useState, useRef } from 'react';
import useStore from '../state/store';
import TimeSeriesChart from '../charts/TimeSeriesChart';
// import { createSignalSocket } from '../api/ws'; // Disabled - will be re-enabled later
import { getDashboardPrediction } from '../api/client';

export default function Dashboard() {
  const {
    selectedSymbol,
    selectedExpiry,
    // liveSignals, // Disabled - will be re-enabled later
    loadInstruments,
    // pushLiveSignal, // Disabled - will be re-enabled later
  } = useStore();

  const [prediction, setPrediction] = useState(null);
  const [history, setHistory] = useState({}); // per symbol history of prediction score
  const [lastUpdate, setLastUpdate] = useState(null);
  const refreshIntervalRef = useRef(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5); // seconds
  const [loadingPrediction, setLoadingPrediction] = useState(false);
  const [error, setError] = useState(null);

  // Simple market-hours gate: only call live dashboard API when Indian market is open
  // NSE eq derivatives regular session: Mon–Fri, 09:15–15:30 IST
  const isMarketOpen = () => {
    try {
      const now = new Date();
      const istNow = new Date(
        now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
      );
      const day = istNow.getDay(); // 0=Sun,6=Sat
      if (day === 0 || day === 6) return false;
      const h = istNow.getHours();
      const m = istNow.getMinutes();
      const minutes = h * 60 + m;
      const open = 9 * 60 + 15;
      const close = 15 * 60 + 30;
      return minutes >= open && minutes <= close;
    } catch {
      // If timezone conversion fails, be safe and allow
      return true;
    }
  };

  useEffect(() => {
    loadInstruments();
  }, [loadInstruments]);

  const fetchPrediction = async () => {
    if (!selectedSymbol) return;
    // Avoid overlapping requests if a previous one is still in flight
    if (loadingPrediction) return;
    try {
      if (!isMarketOpen()) {
        setError('Market appears closed – live dashboard API is paused.');
        return;
      }

      setLoadingPrediction(true);
      setError(null);
      const res = await getDashboardPrediction(selectedSymbol, selectedExpiry);
      const data = res.data || null;
      if (!data) {
        setError('Empty dashboard payload from backend.');
        return;
      }

      // ---- Use backend prediction as the single source of truth ----
      setPrediction(data);

      // Derive a trend score from backend fields (prefer net_delta, else prediction+confidence)
      const nowTs = Date.now();
      const score =
        typeof data?.net_delta === 'number'
          ? data.net_delta
          : typeof data?.confidence === 'number' && data?.prediction
          ? (data.prediction === 'BULLISH' ? 1 : data.prediction === 'BEARISH' ? -1 : 0) *
            data.confidence
          : 0;
      setHistory((prev) => {
        const symbolHistory = prev[selectedSymbol] || [];
        const next = [...symbolHistory, { time: nowTs, value: score }];
        return { ...prev, [selectedSymbol]: next.slice(-200) };
      });
      setLastUpdate(new Date());
    } catch (e) {
      console.error(e);
      setError('Could not fetch dashboard prediction – check backend / network.');
    } finally {
      setLoadingPrediction(false);
    }
  };

  // Auto-refresh: call backend analytics API when market is open and auto-refresh is enabled.
  useEffect(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    if (!selectedSymbol) {
      setPrediction(null);
      setHistory({});
      setLastUpdate(null);
      return;
    }

    // First fetch immediately for this symbol/expiry (if market open)
    fetchPrediction();

    if (autoRefreshEnabled && refreshInterval > 0) {
      refreshIntervalRef.current = setInterval(() => {
        fetchPrediction();
      }, refreshInterval * 1000);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, selectedExpiry, autoRefreshEnabled, refreshInterval]);

  // WebSocket connection disabled - will be re-enabled later with new plan
  // useEffect(() => {
  //   if (!selectedSymbol) return;

  //   const socket = createSignalSocket((msg) => {
  //     if (msg.type === 'tick') {
  //       pushLiveSignal(msg.data);
  //     }
  //   }, selectedSymbol);

  //   // Subscribe when socket is ready (handles both initial connection and reconnection)
  //   const handleSubscribe = () => {
  //     if (selectedSymbol && socket.readyState === WebSocket.OPEN) {
  //       socket.subscribe(selectedSymbol);
  //     }
  //   };

  //   // If socket is already open, subscribe immediately
  //   if (socket.readyState === WebSocket.OPEN) {
  //     handleSubscribe();
  //   } else {
  //     // Otherwise wait for open event
  //     socket.addEventListener('open', handleSubscribe);
  //   }

  //   return () => {
  //     socket.removeEventListener('open', handleSubscribe);
  //     socket.close();
  //   };
  // }, [selectedSymbol, pushLiveSignal]);

  const currentSymbolHistory = selectedSymbol ? history[selectedSymbol] || [] : [];
  // const hasTicks = liveSignals && liveSignals.length > 0; // Disabled - will be re-enabled later

  const p = prediction;
  const titleSymbol = selectedSymbol || 'instrument';
  const titleExpiry = selectedExpiry || (p?.expiry ? new Date(p.expiry).toISOString().slice(0, 10) : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-[11px] text-slate-400">
            Live prediction for {titleSymbol}
              {titleExpiry ? ` • Expiry ${titleExpiry}` : ''}.{' '}
              {autoRefreshEnabled && refreshInterval > 0
                ? `Auto-refresh: ${refreshInterval}s`
                : 'Auto-refresh: Off'}
            {loadingPrediction && <span className="text-accent ml-1">(Loading...)</span>}
          </p>
        </div>
        {lastUpdate && (
          <span className="text-[10px] text-slate-500">
            Updated: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="bg-surface rounded border border-slate-800 p-3 space-y-2">
          <div className="font-semibold mb-1 text-slate-200">🔮 Prediction Snapshot</div>
          {p ? (
            <div className="space-y-1.5 text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Bias</span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    p.prediction === 'BULLISH'
                      ? 'bg-green-500 text-black'
                      : p.prediction === 'BEARISH'
                      ? 'bg-red-500 text-black'
                      : 'bg-slate-600 text-slate-50'
                  }`}
                >
                  {p.prediction || 'NEUTRAL'}
                </span>
                {typeof p.confidence === 'number' && (
                  <span className="text-slate-400">
                    Confidence:{' '}
                    <span className="text-slate-100">{(p.confidence * 100).toFixed(1)}%</span>
                  </span>
                )}
              </div>
              <div className="flex gap-4">
                <div>
                  <div className="text-slate-400">Spot</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof p.spot === 'number' ? p.spot.toFixed(2) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">ATM strike</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof p.atm_strike === 'number' ? p.atm_strike.toFixed(0) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">PCR (OI, window)</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof p.window_pcr_oi === 'number' ? p.window_pcr_oi.toFixed(2) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">PCR (Vol, window)</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof p.window_pcr_volume === 'number' ? p.window_pcr_volume.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
              <div className="text-slate-400 text-[10px]">
                PCR (window) is computed in the frontend from OI &amp; volume of the 11 strikes around ATM (±5 × step).
              </div>
            </div>
          ) : (
            <div className="text-slate-600 text-[11px]">
              Waiting for live option chain and quote. Ensure market is open and credentials are configured.
            </div>
          )}
          {error && (
            <div className="mt-2 text-red-300 bg-red-900/40 border border-red-700/50 rounded px-2 py-1">
              {error}
            </div>
          )}
          {/* Strike-level table removed per request – prediction now focuses on Greeks-based summary only */}
        </div>

        <div className="bg-surface rounded border border-slate-800 p-3 space-y-2">
          <div className="font-semibold mb-1 text-slate-200">⚙️ Controls & Status</div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Prediction controls</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                className={`px-2 py-1 rounded text-[10px] font-semibold ${
                  autoRefreshEnabled
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {autoRefreshEnabled ? '⏸ Stop' : '▶ Start'}
              </button>
              <button
                onClick={fetchPrediction}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-accent hover:bg-accentSoft text-black"
              >
                ⟳ Refresh data
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Refresh interval</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              disabled={!autoRefreshEnabled}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] w-24"
            >
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Prediction status</span>
            <span
              className={
                autoRefreshEnabled && selectedSymbol && refreshInterval > 0
                  ? 'text-positive'
                  : 'text-slate-500'
              }
            >
              {autoRefreshEnabled && selectedSymbol && refreshInterval > 0
                ? `✓ Active (${refreshInterval}s)`
                : '✗ Stopped'}
            </span>
          </div>

          {/* WebSocket ticks status disabled - will be re-enabled later with new plan */}
          {/* <div className="flex items-center justify-between">
            <span className="text-slate-400">Websocket ticks</span>
            <span className={hasTicks ? 'text-positive' : 'text-slate-500'}>
              {hasTicks ? `✓ ${liveSignals.length} ticks` : '✗ No ticks'}
            </span>
          </div> */}

          {selectedSymbol && (
            <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-500">
              💡 Instrument & expiry are controlled from the header. Dashboard always uses that selection.
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="flex items-center justify-between mb-2 text-xs">
          <div className="flex flex-col">
            <div className="text-slate-200 font-semibold">Prediction Trend</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Score ranges from -1 (strongly bearish) to +1 (strongly bullish). Each point is one refresh.
            </div>
          </div>
        </div>
        {currentSymbolHistory.length > 0 ? (
          <TimeSeriesChart
            data={currentSymbolHistory
              .filter((p) => typeof p?.value === 'number' && typeof p?.time === 'number')
              .map((p) => ({
                time: p.time,
                value: p.value,
              }))}
          />
        ) : (
          <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
            {!autoRefreshEnabled ? (
              <div className="text-center">
                <div>Prediction auto-refresh is stopped</div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Click &quot;Start&quot; to begin live prediction updates.
                </div>
              </div>
            ) : loadingPrediction ? (
              'Loading prediction data...'
            ) : (
              'Waiting for first prediction...'
            )}
          </div>
        )}
      </div>

      {/* WebSocket ticks display disabled - will be re-enabled later with new plan */}
      {/* <div className="bg-surface rounded border border-slate-800 p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-slate-200 font-semibold">Recent Live Ticks</div>
          <div className="text-[10px] text-slate-400">
            {liveSignals.length > 0
              ? `Showing last ${Math.min(10, liveSignals.length)} of ${liveSignals.length}`
              : 'No ticks yet'}
          </div>
        </div>
        <div className="max-h-40 overflow-y-auto space-y-1">
          {liveSignals.slice(0, 10).map((s, idx) => (
            <div
              key={idx}
              className="flex justify-between items-center border-b border-slate-800/50 pb-1 text-[11px]"
            >
              <span className="text-slate-300 font-mono">{s.symbol || 'N/A'}</span>
              <span className="text-accent font-semibold">
                {typeof s.ltp === 'number' ? s.ltp.toFixed(2) : s.ltp || '—'}
              </span>
              <span className="text-slate-500 text-[10px]">
                {s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : '—'}
              </span>
            </div>
          ))}
          {liveSignals.length === 0 && (
            <div className="text-slate-600 text-center py-4">
              <div>Waiting for websocket ticks…</div>
              <div className="text-[10px] text-slate-500 mt-1">
                Ticks will appear here when the websocket receives data
              </div>
            </div>
          )}
        </div>
      </div> */}
    </div>
  );
}
