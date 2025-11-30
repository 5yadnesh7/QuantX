import React, { useState, useEffect, useMemo } from 'react';
// removed unused client methods
import useStore from '../state/store';
import { api } from '../api/client';

export default function ProbabilityHeatmap() {
  const {
    selectedSymbol,
    selectedExpiry,
    optionChain,
    loadInstruments,
    loadLiveChain,
  } = useStore();
  const [spot, setSpot] = useState(100);
  const [spotIv, setSpotIv] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingChain, setLoadingChain] = useState(false); // Track chain loading
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [greeks, setGreeks] = useState(null);
  const [serverAction, setServerAction] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [currentChainSymbol, setCurrentChainSymbol] = useState(null); // Track which symbol's chain we have
  
  // Auto-calculate DTE from selectedExpiry
  const dte = useMemo(() => {
    if (!selectedExpiry) return 7;
    try {
      const exp = new Date(selectedExpiry + 'T15:30:00Z');
      const now = new Date();
      const diffDays = Math.max(1, Math.round((exp - now) / (24 * 3600 * 1000)));
      return diffDays;
    } catch {
      return 7;
    }
  }, [selectedExpiry]);

  useEffect(() => {
    loadInstruments();
  }, [loadInstruments]);

  useEffect(() => {
    if (selectedSymbol) {
      // Mark as loading chain when symbol/expiry changes
      setLoadingChain(true);
      setCurrentChainSymbol(null);
      
      loadLiveChain(selectedSymbol);
      // Fetch real underlying spot from backend /quote
      api
        .get('/quote', { params: { symbol: selectedSymbol } })
        .then((r) => {
          const px = Number(r?.data?.price);
          if (Number.isFinite(px) && px > 0) {
            setSpot(Number(px.toFixed(2)));
          }
        })
        .catch(() => {
          // silently fallback – optionChain effect below may prefill from chain if available
        });
      // Clear previous results when symbol changes
      setRows([]);
      setSummary(null);
      setGreeks(null);
      setSpotIv(null);
    } else {
      // No symbol selected - disable button
      setLoadingChain(false);
      setCurrentChainSymbol(null);
    }
  }, [selectedSymbol, selectedExpiry, loadLiveChain]);

  // Fallback: if live quote was not available, approximate spot from chain mid entry
  useEffect(() => {
    if (!selectedSymbol) {
      setLoadingChain(false);
      setCurrentChainSymbol(null);
      return;
    }

    if (optionChain) {
      // Check if the chain's underlying matches the selected symbol
      const chainUnderlying = optionChain.underlying || optionChain.symbol;
      const chainMatches = chainUnderlying === selectedSymbol || 
                          chainUnderlying?.toUpperCase() === selectedSymbol?.toUpperCase();
      
      if (chainMatches) {
        // Chain matches current symbol, mark as not loading
        setLoadingChain(false);
        setCurrentChainSymbol(selectedSymbol);
        
        if (optionChain.entries?.length) {
          const midIdx = Math.floor(optionChain.entries.length / 2);
          const ref = optionChain.entries[midIdx];
          if (typeof ref?.last === 'number' && ref.last > 0) {
            // Only set if we don't already have a valid spot
            setSpot((prev) => {
              const prevNum = Number(prev);
              if (Number.isFinite(prevNum) && prevNum > 0 && prevNum !== 100) return prevNum;
              return Number(ref.last.toFixed(2));
            });
          }
        }
      } else {
        // Chain doesn't match - still loading or wrong chain
        setLoadingChain(true);
        setCurrentChainSymbol(null);
      }
    }
  }, [optionChain, selectedSymbol]);

  // Keep IV@spot in sync when spot, chain, or calculation rows update
  useEffect(() => {
    // Prefer IV from backend rows (exact value used in last calculation)
    if (Array.isArray(rows) && rows.length) {
      const nearestFromRows =
        rows.reduce((best, r) => {
          if (!best) return r;
          return Math.abs(Number(r.strike) - Number(spot)) < Math.abs(Number(best.strike) - Number(spot))
            ? r
            : best;
        }, null) || null;
      if (nearestFromRows && typeof nearestFromRows.iv === 'number') {
        setSpotIv(Number(nearestFromRows.iv));
        return;
      }
    }
    // No rows yet – clear IV@spot so the user knows they need to Calculate
    setSpotIv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, optionChain, rows]);

  // Check if strikes are available from option chain for current symbol
  const hasStrikes = useMemo(() => {
    // Must have a selected symbol
    if (!selectedSymbol) {
      return false;
    }
    
    // If chain is loading, no strikes available yet
    if (loadingChain) {
      return false;
    }
    
    // Chain symbol must match current symbol
    if (currentChainSymbol !== selectedSymbol) {
      return false;
    }
    
    // Verify chain underlying matches (double check)
    if (optionChain) {
      const chainUnderlying = optionChain.underlying || optionChain.symbol;
      const chainMatches = chainUnderlying === selectedSymbol || 
                          chainUnderlying?.toUpperCase() === selectedSymbol?.toUpperCase();
      if (!chainMatches) {
        return false;
      }
    }
    
    // Check if we have entries with valid strikes
    if (!optionChain || !optionChain.entries || !Array.isArray(optionChain.entries)) {
      return false;
    }
    
    // Check if we have at least one entry with a valid strike
    return optionChain.entries.some(entry => {
      const strike = entry?.strike ?? entry?.strikePrice;
      return typeof strike === 'number' && strike > 0;
    });
  }, [optionChain, loadingChain, currentChainSymbol, selectedSymbol]);

  // --------- Action hint from backend --------------------------------------
  const actionHint = serverAction;

  // Filter rows to show only nearest 2 strikes up and down from ATM
  const filteredRows = useMemo(() => {
    if (!rows.length || !summary?.strike) return rows;
    
    // Sort rows by strike to ensure proper ordering
    const sortedRows = [...rows].sort((a, b) => Number(a.strike) - Number(b.strike));
    
    // Find ATM strike index
    const atmIdx = sortedRows.findIndex((r) => Number(r.strike) === Number(summary.strike));
    if (atmIdx === -1) return sortedRows;
    
    // Get 2 strikes below and 2 strikes above ATM (plus ATM itself = 5 total)
    const startIdx = Math.max(0, atmIdx - 2);
    const endIdx = Math.min(sortedRows.length - 1, atmIdx + 2);
    
    return sortedRows.slice(startIdx, endIdx + 1);
  }, [rows, summary?.strike]);

  // Calculate combined probability (average of all available models) for each strike
  const getCombinedProbability = (row) => {
    const models = [
      row.d2_probability,
      row.gbm_probability,
      row.monte_carlo_itm_probability,
      row.binomial_probability,
      row.trinomial_probability,
      row.heston_probability,
      row.sabr_probability,
      row.jump_diffusion_probability,
      row.garch_probability,
      row.rnd_probability,
      row.ml_probability,
    ];
    const validProbs = models.filter(p => typeof p === 'number' && !isNaN(p));
    if (validProbs.length === 0) return null;
    return validProbs.reduce((sum, p) => sum + p, 0) / validProbs.length;
  };


  // NOTE: helpers for per-strike IV / nearest strikes were removed from the UI
  // to keep dashboard logic in the dedicated backend endpoint.

  const handleCalculate = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const payload = {
        symbol: selectedSymbol,
        spot: Number(spot),
        dte: Number(dte),
        ivSource: 'chain', // Use chain IV automatically
        use_chain_strikes: true,
      };
      const res = await api.post('/probability/heatmap', payload);
      const data = res.data || {};
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setSummary(data.summary || null);
      setGreeks(data.greeks || null);
      setServerAction(
        data.action
          ? {
              action: data.action,
              rationale: data.rationale,
              k: data?.summary?.strike,
              aboveProb: data.probAboveAtm,
              belowProb: data.probBelowAtm,
              ivPct:
                typeof spotIv === 'number'
                  ? (Number(spotIv) * 100).toFixed(2)
                  : (typeof data?.summary?.iv === 'number' ? (Number(data.summary.iv) * 100).toFixed(2) : null),
            }
          : null,
      );
    } catch (e) {
      console.error(e);
      setRows([]);
      setSummary(null);
      setGreeks(null);
      setServerAction(null);
      setError('Could not calculate probabilities – check backend / network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Probability Heatmap</h1>
            <button
              aria-label="What is this?"
              onClick={() => setShowHelp(true)}
              className="h-5 w-5 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] flex items-center justify-center"
              title="What is this?"
            >
              i
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Estimate the chance that the underlying will finish above each strike at expiry using 11 different probability models.
            All calculations are automatically performed using live market data.
          </p>
        </div>
        <div className="flex items-end gap-2 text-[11px]">
          <div>
            <label className="block text-slate-400">Instrument</label>
            <div className="text-slate-200 font-semibold">
              {selectedSymbol || '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface rounded border border-slate-800 p-3 flex flex-col gap-3 text-[11px]">
        <div className="flex gap-3 items-end">
          <div className="space-y-1">
            <label className="block text-slate-400">
              Spot
              <span className="ml-1 text-slate-500" title="Current underlying price. Fetched from live quote.">ⓘ</span>
            </label>
            <div className="text-slate-200 font-semibold">{typeof spot === 'number' ? spot.toFixed(2) : '—'}</div>
          </div>
          <div className="space-y-1">
            <label className="block text-slate-400">
              Days to expiry
              <span className="ml-1 text-slate-500" title="Auto-calculated from selected expiry date.">ⓘ</span>
              Auto-calculated
            </label>
            <div className="text-slate-200 font-semibold">{dte} days</div>
          </div>
          <div className="flex items-end gap-2">
            {(loadingChain || (!hasStrikes && !loading && selectedSymbol)) && (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <div className="animate-pulse rounded-full h-2 w-2 bg-slate-500"></div>
                <span>{loadingChain ? 'Loading option chain...' : 'Loading strike prices...'}</span>
              </div>
            )}
            <button
              onClick={handleCalculate}
              disabled={loading || loadingChain || !selectedSymbol || !hasStrikes}
              className={`px-6 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                loading || loadingChain || !selectedSymbol || !hasStrikes
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-accent hover:bg-accentSoft text-black hover:shadow-lg hover:scale-105 active:scale-95'
              }`}
              title={
                loadingChain 
                  ? 'Loading option chain for selected instrument...' 
                  : !hasStrikes && selectedSymbol 
                    ? 'Waiting for strike prices from API...' 
                    : ''
              }
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-black border-t-transparent"></div>
                  Calculating...
                </span>
              ) : loadingChain ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-slate-400 border-t-transparent"></div>
                  Loading Chain...
                </span>
              ) : !hasStrikes && selectedSymbol ? (
                'Waiting for Strikes...'
              ) : (
                'Calculate Probabilities'
              )}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-xs flex items-center gap-2">
            <span className="text-red-400">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 lg:col-span-7 text-[11px] text-slate-400 leading-5">
            <span className="font-semibold text-slate-200">How to read this:</span>{' '}
            Each tile shows probabilities from <span className="text-slate-200">11 different models</span> for finishing ITM at each strike (<span className="text-slate-200">K</span>).
            Each model uses different assumptions about price dynamics, volatility, and market behavior.
            Compare probabilities across models to understand consensus and divergence. The <span className="text-yellow-400">highlighted</span> tile is{' '}
            <span className="text-slate-200">ATM (closest to Spot)</span>.
          </div>
          <div className="col-span-12 lg:col-span-5">
            <div className="rounded border border-slate-800 bg-slate-900/40 p-2 text-slate-300 leading-5">
              <div className="text-slate-400 mb-1">Legend</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                <div><span className="text-slate-200 font-semibold">K</span>: strike price</div>
                <div><span className="text-slate-200 font-semibold">BSM</span>: Black-Scholes-Merton</div>
                <div><span className="text-slate-200 font-semibold">GBM</span>: Geometric Brownian Motion</div>
                <div><span className="text-slate-200 font-semibold">MC</span>: Monte Carlo</div>
                <div><span className="text-yellow-400 font-semibold">ATM</span>: nearest strike</div>
              </div>
            </div>
          </div>
        </div>

        {actionHint && (
          <div className="rounded border border-slate-800 bg-slate-900/40 p-2 flex items-center justify-between">
            <div className="text-slate-300">
              <span className="text-slate-400 mr-2">Action hint</span>
              <span className="px-2 py-0.5 rounded bg-accent text-black font-semibold text-[11px]">
                {actionHint.action}
              </span>
              <span className="ml-2 text-slate-400">{actionHint.rationale}</span>
            </div>
            <div className="text-slate-400 text-[11px]">
              Strike used: <span className="text-slate-200">K={actionHint.k}</span>
              {typeof actionHint.aboveProb === 'number' && (
                <span className="ml-3">P(&gt;K): <span className="text-slate-200">{(actionHint.aboveProb * 100).toFixed(1)}%</span></span>
              )}
              {typeof actionHint.belowProb === 'number' && (
                <span className="ml-3">P(&lt;K): <span className="text-slate-200">{(actionHint.belowProb * 100).toFixed(1)}%</span></span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-300 bg-red-900/40 border border-red-700/50 rounded px-2 py-1 text-[11px]">
            {error}
          </div>
        )}
      </div>

      {showHelp && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
          <div className="bg-surface border border-slate-800 rounded p-4 w-[680px] max-h-[80vh] overflow-y-auto text-[12px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-100 font-semibold">What is the Probability Heatmap?</div>
              <button
                onClick={() => setShowHelp(false)}
                className="text-slate-300 hover:text-slate-100 text-[12px]"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 text-slate-300">
              <div>
                This tool estimates the chance that the underlying will finish above each strike
                price at expiry using <span className="text-slate-100 font-semibold">11 different probability models</span>:
              </div>
              <ul className="list-disc pl-5 space-y-1 text-[11px]">
                <li><span className="text-slate-100 font-semibold">BSM (Black-Scholes-Merton)</span> – Lognormal distribution with constant volatility, risk-neutral drift</li>
                <li><span className="text-slate-100 font-semibold">GBM (Geometric Brownian Motion)</span> – Prices evolve by compounding random returns</li>
                <li><span className="text-slate-100 font-semibold">MC (Monte Carlo)</span> – Many random price paths, empirical probabilities</li>
                <li><span className="text-slate-100 font-semibold">Binomial Tree</span> – Discrete steps with up/down moves, risk-neutral probabilities</li>
                <li><span className="text-slate-100 font-semibold">Trinomial Tree</span> – Discrete steps with up/down/flat moves</li>
                <li><span className="text-slate-100 font-semibold">Heston</span> – Stochastic volatility that reverts to long-run mean</li>
                <li><span className="text-slate-100 font-semibold">SABR</span> – Volatility smile model matching market prices</li>
                <li><span className="text-slate-100 font-semibold">Jump-Diffusion (Merton)</span> – Continuous changes plus random jumps</li>
                <li><span className="text-slate-100 font-semibold">GARCH</span> – Volatility clusters, depends on past shocks</li>
                <li><span className="text-slate-100 font-semibold">RND (Risk-Neutral Density)</span> – Extracted from option prices</li>
                <li><span className="text-slate-100 font-semibold">ML (Machine Learning)</span> – Pattern-based probability estimates</li>
              </ul>
              <div className="mt-2 text-slate-400">How to use:</div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Select a <span className="text-slate-100">Symbol</span>. Spot auto‑fills from the live chain.</li>
                <li>Enter <span className="text-slate-100">IV</span> (yearly, e.g. 0.20 = 20%) and <span className="text-slate-100">Days to expiry</span>.</li>
                <li>Click <span className="text-slate-100">Calculate</span>.</li>
              </ol>
              <div className="mt-2 text-slate-400">Reading the results:</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="text-slate-100">ATM snapshot</span> shows probabilities at the strike
                  closest to spot, plus a <span className="text-slate-100">1σ move band</span> (expected move).
                </li>
                <li>
                  Each tile shows probabilities from all 11 models. Each model has a colored bar and percentage.
                  Compare probabilities across models to see consensus (similar values) or divergence (different values).
                </li>
                <li>
                  Models with similar probabilities indicate agreement. Large differences suggest model-specific assumptions
                  (e.g., volatility clustering, jumps, stochastic vol) are affecting estimates.
                </li>
                <li>
                  <span className="text-slate-100">Greeks</span> help interpret risk: Delta (direction), Gamma (curvature),
                  Theta (time decay/day), Vega (per 1% IV change).
                </li>
              </ul>
              <div className="mt-2 text-slate-400">Tips:</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>Compare where probabilities are clustered against option prices and skew.</li>
                <li>Use a realistic IV (e.g. from the chain) for better estimates.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {summary && (() => {
        const atmRow = rows.find(r => r.strike === summary.strike);
        const combinedProb = atmRow ? getCombinedProbability(atmRow) : null;
        return (
          <div className="bg-surface rounded border border-slate-800 p-3 text-[11px]">
            <div className="text-slate-400 mb-1">Combined probability snapshot (ATM)</div>
            <div className="grid grid-cols-6 gap-2">
              <div>
                <div className="text-slate-400">ATM strike</div>
                <div className="text-slate-100 font-semibold">{summary.strike}</div>
              </div>
              <div>
                <div className="text-slate-400">Combined Prob (All Models)</div>
                <div className="text-accent font-semibold text-lg">
                  {combinedProb !== null ? (combinedProb * 100).toFixed(1) : '—'}%
                </div>
                <div className="text-slate-500 text-[10px]">Average of all 11 models</div>
              </div>
              <div>
                <div className="text-slate-400">ITM prob (d₂)</div>
                <div className="text-slate-200 font-semibold">
                  {typeof summary.d2 === 'number' ? (summary.d2 * 100).toFixed(1) : '—'}%
                </div>
              </div>
              <div>
                <div className="text-slate-400">ITM prob (MC)</div>
                <div className="text-slate-200 font-semibold">
                  {typeof summary.mc === 'number' ? (summary.mc * 100).toFixed(1) : '—'}%
                </div>
              </div>
              <div>
                <div className="text-slate-400">1σ move band</div>
                <div className="text-slate-100 font-semibold">
                  {typeof summary.lower === 'number' ? summary.lower.toFixed(2) : '—'} – {typeof summary.upper === 'number' ? summary.upper.toFixed(2) : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Approx. Δ PnL for +1% move</div>
                <div className="text-slate-100 font-semibold">
                  {greeks && typeof greeks.delta === 'number' && typeof spot === 'number'
                    ? (greeks.delta * Number(spot) * 0.01).toFixed(2)
                    : '—'}{' '}
                  (per lot, ignoring gamma)
                </div>
              </div>
            </div>
            {greeks && (
              <div className="mt-2 grid grid-cols-4 gap-2 text-slate-400">
                <div>
                  <div>Delta</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof greeks.delta === 'number' ? greeks.delta.toFixed(3) : '—'}
                  </div>
                </div>
                <div>
                  <div>Gamma</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof greeks.gamma === 'number' ? greeks.gamma.toExponential(2) : '—'}
                  </div>
                </div>
                <div>
                  <div>Theta (per day)</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof greeks.theta === 'number' ? greeks.theta.toFixed(2) : '—'}
                  </div>
                </div>
                <div>
                  <div>Vega (per 1% IV)</div>
                  <div className="text-slate-100 font-semibold">
                    {typeof greeks.vega === 'number' ? greeks.vega.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="bg-surface rounded-lg border border-slate-800 p-4 shadow-lg">
        <div className="mb-3 text-slate-300 font-semibold text-sm">ITM Probability by Strike (Nearest 2 strikes up/down from ATM)</div>
        {filteredRows.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-500">
            Click "Calculate Probabilities" to see results
          </div>
        )}
        <div className="grid 2xl:grid-cols-6 xl:grid-cols-5 lg:grid-cols-4 md:grid-cols-3 grid-cols-2 gap-3 text-[11px]">
          {filteredRows.map((row, idx) => {
            // Define all models with their labels
            const models = [
              { key: 'd2_probability', label: 'BSM', fullName: 'Black-Scholes-Merton', color: 'bg-blue-500' },
              { key: 'gbm_probability', label: 'GBM', fullName: 'Geometric Brownian Motion', color: 'bg-green-500' },
              { key: 'monte_carlo_itm_probability', label: 'MC', fullName: 'Monte Carlo Simulation', color: 'bg-purple-500' },
              { key: 'binomial_probability', label: 'Binomial', fullName: 'Binomial Tree', color: 'bg-orange-500' },
              { key: 'trinomial_probability', label: 'Trinomial', fullName: 'Trinomial Tree', color: 'bg-pink-500' },
              { key: 'heston_probability', label: 'Heston', fullName: 'Heston Stochastic Volatility', color: 'bg-cyan-500' },
              { key: 'sabr_probability', label: 'SABR', fullName: 'SABR Model', color: 'bg-yellow-500' },
              { key: 'jump_diffusion_probability', label: 'Jump-Diff', fullName: 'Jump-Diffusion (Merton)', color: 'bg-red-500' },
              { key: 'garch_probability', label: 'GARCH', fullName: 'GARCH Volatility', color: 'bg-indigo-500' },
              { key: 'rnd_probability', label: 'RND', fullName: 'Risk-Neutral Density', color: 'bg-teal-500' },
              { key: 'ml_probability', label: 'ML', fullName: 'Machine Learning', color: 'bg-rose-500' },
            ];
            
            // Filter to only show models that have values
            const availableModels = models.filter(m => row[m.key] !== null && row[m.key] !== undefined);
            
            // Get combined probability
            const combinedProb = getCombinedProbability(row);
            
            return (
              <div
                key={row.strike}
                className={`rounded-lg bg-slate-900 p-3 flex flex-col gap-2 transition-all duration-200 hover:shadow-lg hover:scale-105 ${
                  summary?.strike === row.strike 
                    ? 'border-2 border-yellow-600 ring-2 ring-yellow-700/50 shadow-lg' 
                    : 'border border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex justify-between items-center text-slate-400">
                  <span title="Strike price" className="font-semibold">K={row.strike}</span>
                  <span className="flex items-center gap-1">
                    {summary?.strike === row.strike && (
                      <span className="text-[10px] px-1 rounded bg-yellow-900/40 text-yellow-300 border border-yellow-800">ATM</span>
                    )}
                    <span title="Expected move to expiry" className="text-[10px]">
                      {typeof row.expected_move === 'number' ? row.expected_move.toFixed(2) : '—'} Δ
                    </span>
                  </span>
                </div>
                
                {/* Combined Probability Display */}
                {combinedProb !== null && (
                  <div className="bg-gradient-to-r from-slate-800/80 to-slate-800/50 rounded-lg px-3 py-2 mb-2 border border-slate-700">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-slate-300 text-xs font-semibold">Combined Probability</span>
                      <span 
                        className="text-base font-bold text-accent" 
                        title={`${(combinedProb * 100).toFixed(1)}% chance the underlying price will finish ABOVE strike ${row.strike} at expiry`}
                      >
                        {(combinedProb * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-700 rounded-full overflow-hidden shadow-inner">
                      <div
                        className="h-full bg-gradient-to-r from-accent to-accentSoft transition-all duration-500"
                        style={{ width: `${combinedProb * 100}%` }}
                        title={`${(combinedProb * 100).toFixed(1)}% ITM probability`}
                      />
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">
                      Average of {availableModels.length} models • {((combinedProb * 100).toFixed(1))}% chance spot finishes above {row.strike}
                    </div>
                  </div>
                )}
                
                {/* Show all available model probabilities */}
                {availableModels.map((model) => {
                  const prob = row[model.key];
                  const probPercent = typeof prob === 'number' ? prob * 100 : 0;
                  
                  return (
                    <div key={model.key} className="space-y-0.5">
                      <div className="flex justify-between items-center text-slate-500">
                        <span title={model.fullName} className="text-[10px] font-medium">{model.label}</span>
                        <span className="text-[10px]">{probPercent.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                        <div
                          className={`h-full ${model.color} ${summary?.strike === row.strike ? 'opacity-90' : 'opacity-70'}`}
                          style={{ width: `${probPercent}%` }}
                          title={`${model.fullName}: ${probPercent.toFixed(1)}%`}
                        />
                      </div>
                    </div>
                  );
                })}
                
                {availableModels.length === 0 && (
                  <div className="text-slate-600 text-[10px]">No model data available</div>
                )}
              </div>
            );
          })}
          {filteredRows.length === 0 && (
            <div className="text-slate-600">Run a calculation to see the heatmap.</div>
          )}
        </div>
        
        {/* Model Legend */}
        <div className="mt-4 pt-3 border-t border-slate-700">
          <div className="text-slate-400 text-[10px] mb-2 font-semibold">Probability Models:</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-blue-500"></div>
              <span className="text-slate-300">BSM: Black-Scholes-Merton</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <span className="text-slate-300">GBM: Geometric Brownian Motion</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-purple-500"></div>
              <span className="text-slate-300">MC: Monte Carlo Simulation</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-orange-500"></div>
              <span className="text-slate-300">Binomial: Binomial Tree</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-pink-500"></div>
              <span className="text-slate-300">Trinomial: Trinomial Tree</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-cyan-500"></div>
              <span className="text-slate-300">Heston: Stochastic Volatility</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-yellow-500"></div>
              <span className="text-slate-300">SABR: Volatility Smile</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-500"></div>
              <span className="text-slate-300">Jump-Diff: Merton Model</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-indigo-500"></div>
              <span className="text-slate-300">GARCH: Volatility Clustering</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-teal-500"></div>
              <span className="text-slate-300">RND: Risk-Neutral Density</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-rose-500"></div>
              <span className="text-slate-300">ML: Machine Learning</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

