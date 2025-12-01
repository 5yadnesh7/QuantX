import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import useStore from '../state/store';

export default function OiIvAnalytics() {
  const {
    selectedSymbol,
    selectedExpiry,
    loadInstruments,
  } = useStore();
  const [oi, setOi] = useState(null);
  const [iv, setIv] = useState(null);
  const [skew, setSkew] = useState(null);
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadInstruments();
  }, [loadInstruments]);

  // Auto-load data when symbol or expiry changes
  useEffect(() => {
    if (selectedSymbol) {
      handleRun();
    }
  }, [selectedSymbol, selectedExpiry]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/analytics/oi-iv', {
        params: { symbol: selectedSymbol, expiry: selectedExpiry },
      });
      const data = res.data || {};
      setOi({
        spike_score: data.spike_score ?? null,
        volume_oi_ratio: data.volume_oi_ratio ?? null,
        trend: data.trend ?? null,
        anomaly_score: data.anomaly_score ?? null,
        pcr_oi: data.pcr_oi ?? null,
        pcr_volume: data.pcr_volume ?? null,
      });
      setIv({
        iv: typeof data.iv_atm === 'number' ? data.iv_atm : null,
        hv: typeof data.hv === 'number' ? data.hv : null,
        iv_rank: typeof data.iv_rank === 'number' ? data.iv_rank : null,
        iv_percentile: typeof data.iv_percentile === 'number' ? data.iv_percentile : null,
      });
      setSkew({
        strikes: Array.isArray(data.strikes) ? data.strikes : [],
        iv: Array.isArray(data.skew_iv) ? data.skew_iv : [],
      });
      setAction({
        atm: data.atm_strike ?? null,
        dte: data.dte_used ?? null,
        above: data.prob_above_atm ?? null,
        below: data.prob_below_atm ?? null,
        action: data.action ?? null,
        rationale: data.rationale ?? null,
        buy_call_score: data.buy_call_score ?? null,
        buy_put_score: data.buy_put_score ?? null,
        sell_premium_score: data.sell_premium_score ?? null,
      });
    } catch (e) {
      console.error(e);
      setError('Could not fetch OI / IV analytics – check backend / network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">OI / IV Analytics</h1>
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
            Live snapshot from the option chain. See where OI is concentrated and how rich/cheap IV is.
          </p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="block text-slate-400 text-[11px]">Instrument / Expiry</label>
            <div className="text-slate-200 font-semibold">
              {selectedSymbol || '—'} {selectedExpiry ? `• ${selectedExpiry}` : ''}
            </div>
          </div>
          <button
            onClick={handleRun}
            disabled={loading || !selectedSymbol}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
              loading || !selectedSymbol
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-accent hover:bg-accentSoft text-black hover:shadow-lg hover:scale-105 active:scale-95'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-3 w-3 border-2 border-black border-t-transparent"></div>
                Analyzing...
              </span>
            ) : (
              'Refresh Data'
            )}
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 flex items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent border-t-transparent"></div>
          <span className="text-slate-300 text-sm">Loading analytics data...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 rounded px-3 py-2 text-[11px] text-red-300 flex items-center gap-2">
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-surface rounded border border-slate-800 p-3 space-y-2">
          <div className="text-slate-400 mb-1">Open Interest</div>
          {oi ? (
            <>
              <div className="flex justify-between">
                <span>Spike score</span>
                <span className="text-accent">{typeof oi.spike_score === 'number' ? oi.spike_score.toFixed(2) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Volume / OI</span>
                <span>{typeof oi.volume_oi_ratio === 'number' ? oi.volume_oi_ratio.toFixed(2) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Trend</span>
                <span className="uppercase">{oi.trend || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Anomaly</span>
                <span>{typeof oi.anomaly_score === 'number' ? oi.anomaly_score.toFixed(2) : '—'}</span>
              </div>
            </>
          ) : (
            <div className="text-slate-600 text-[11px]">Run analysis to see OI metrics.</div>
          )}
        </div>

        <div className="bg-surface rounded border border-slate-800 p-3 space-y-2">
          <div className="text-slate-400 mb-1">Put-Call Ratio (PCR)</div>
          {oi ? (
            <>
              <div className="flex justify-between">
                <span>PCR (OI)</span>
                <span className={`font-semibold ${
                  (oi.pcr_oi ?? 0) > 1.2 ? 'text-negative' : (oi.pcr_oi ?? 0) < 0.7 ? 'text-positive' : 'text-accent'
                }`}>
                  {typeof oi.pcr_oi === 'number' ? oi.pcr_oi.toFixed(2) : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>PCR (Volume)</span>
                <span className={`font-semibold ${
                  (oi.pcr_volume ?? 0) > 1.2 ? 'text-negative' : (oi.pcr_volume ?? 0) < 0.7 ? 'text-positive' : 'text-accent'
                }`}>
                  {typeof oi.pcr_volume === 'number' ? oi.pcr_volume.toFixed(2) : '—'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-slate-800">
                <div>PCR &gt; 1.2: Bearish (oversold)</div>
                <div>PCR &lt; 0.7: Bullish (overbought)</div>
                <div>0.7–1.2: Neutral</div>
              </div>
            </>
          ) : (
            <div className="text-slate-600 text-[11px]">Run analysis to see PCR metrics.</div>
          )}
        </div>

        <div className="bg-surface rounded border border-slate-800 p-3 space-y-2">
          <div className="text-slate-400 mb-1">Implied / Historical Vol</div>
          {iv ? (
            <>
              <div className="flex justify-between">
                <span>IV (ATM)</span>
                <span className="text-accent">{typeof iv.iv === 'number' ? (iv.iv * 100).toFixed(2) : '—'}%</span>
              </div>
              <div className="flex justify-between">
                <span>HV</span>
                <span>{typeof iv.hv === 'number' ? (iv.hv * 100).toFixed(2) : '—'}%</span>
              </div>
              <div className="flex justify-between">
                <span>IV Rank</span>
                <span>{typeof iv.iv_rank === 'number' ? iv.iv_rank.toFixed(1) : '—'}%</span>
              </div>
              <div className="flex justify-between">
                <span>IV Percentile</span>
                <span>{typeof iv.iv_percentile === 'number' ? iv.iv_percentile.toFixed(1) : '—'}%</span>
              </div>
            </>
          ) : (
            <div className="text-slate-600 text-[11px]">Run analysis to see IV metrics.</div>
          )}
        </div>

        <div className="bg-surface rounded border border-slate-800 p-3 space-y-2">
          <div className="text-slate-400 mb-1">IV Skew</div>
          {skew ? (
            <div className="space-y-1">
              {skew.strikes && skew.iv && skew.strikes.map((k, idx) => (
                <div key={k} className="flex justify-between">
                  <span>K={k}</span>
                  <span>{typeof skew.iv[idx] === 'number' ? (skew.iv[idx] * 100).toFixed(2) : '—'}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-600 text-[11px]">Run analysis to see skew curve.</div>
          )}
        </div>
      </div>
      )}

      {action && !loading && !error && (
        <div className="bg-surface rounded border border-slate-800 p-3 flex items-center justify-between">
          <div className="text-slate-300">
            <span className="text-slate-400 mr-2">Action</span>
            <span className="px-2 py-0.5 rounded bg-accent text-black font-semibold text-[11px]">
              {action.action || '—'}
            </span>
            <span className="ml-2 text-slate-400">{action.rationale || ''}</span>
          </div>
          <div className="text-slate-400 text-[11px] flex gap-4">
            <div>ATM: <span className="text-slate-200">{action.atm ?? '—'}</span></div>
            <div>DTE: <span className="text-slate-200">{action.dte ?? '—'}</span></div>
            <div>P(&gt;ATM): <span className="text-slate-200">{typeof action.above === 'number' ? (action.above * 100).toFixed(1) : '—'}%</span></div>
            <div>P(&lt;ATM): <span className="text-slate-200">{typeof action.below === 'number' ? (action.below * 100).toFixed(1) : '—'}%</span></div>
            <div>Buy Call: <span className="text-slate-200">{typeof action.buy_call_score === 'number' ? (action.buy_call_score * 100).toFixed(0) : '—'}%</span></div>
            <div>Buy Put: <span className="text-slate-200">{typeof action.buy_put_score === 'number' ? (action.buy_put_score * 100).toFixed(0) : '—'}%</span></div>
            <div>Sell Premium: <span className="text-slate-200">{typeof action.sell_premium_score === 'number' ? (action.sell_premium_score * 100).toFixed(0) : '—'}%</span></div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
          <div className="bg-surface border border-slate-800 rounded p-4 w-[680px] max-h-[80vh] overflow-y-auto text-[12px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-100 font-semibold">What is OI / IV Analytics?</div>
              <button
                onClick={() => setShowHelp(false)}
                className="text-slate-300 hover:text-slate-100 text-[12px]"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 text-slate-300">
              <div>
                This panel uses the live option chain to summarize market positioning and option pricing.
              </div>
              <ul className="list-disc pl-5 space-y-1">
                <li><span className="text-slate-100 font-semibold">PCR (OI/Vol)</span>: Put OI or volume divided by Call OI or volume.</li>
                <li><span className="text-slate-100 font-semibold">IV (ATM)</span>: Implied volatility at the strike nearest to spot.</li>
                <li><span className="text-slate-100 font-semibold">IV Skew</span>: IV at a few strikes around ATM to see smile/skew.</li>
                <li><span className="text-slate-100 font-semibold">Open Interest</span>: Basic health metrics from total OI and volume.</li>
              </ul>
              <div className="text-slate-400">Tip: High PCR (&gt;1.2) is often bearish; low PCR (&lt;0.7) often bullish. Use IV level/skew to gauge option richness.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

