import React, { useEffect, useState, useRef } from 'react';
import { getFiiDiiFlows } from '../api/client';

export default function FiiDiiFlows() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasFetchedRef = useRef(false); // Prevent double calls in StrictMode

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getFiiDiiFlows();
      setData(res.data.days || []);
    } catch (e) {
      console.error(e);
      setError('Could not load FII / DII flows – check backend / network.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Prevent double calls (React StrictMode runs effects twice in development)
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    fetchData();
  }, []); // Empty deps - FII/DII is market-wide, not instrument-specific

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">FII / DII Flows</h1>
          <p className="text-[11px] text-slate-400">
            Foreign Institutional Investors (FII) and Domestic Institutional Investors (DII) net
            cash flows. Use this to understand where big money has been buying or selling recently.
          </p>
        </div>
      </div>

      {/* Information Card */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded p-3 text-[11px]">
        <div className="flex items-start gap-2">
          <span className="text-blue-400 text-lg">ℹ️</span>
          <div className="flex-1 space-y-1">
            <div className="font-semibold text-blue-300">Market-Wide Data (Not Instrument-Specific)</div>
            <div className="text-slate-300 space-y-1">
              <p>
                <strong>FII/DII flows are aggregate market data</strong> representing overall institutional buying/selling 
                activity across the entire Indian stock market, not specific to any individual option or instrument.
              </p>
              <p className="mt-2">
                <strong>How to use for options trading:</strong>
              </p>
              <ul className="list-disc list-inside ml-2 space-y-0.5 text-slate-400">
                <li><strong>Market Sentiment:</strong> High FII buying often indicates bullish sentiment → may increase call premiums</li>
                <li><strong>Volatility Impact:</strong> Large flows can increase market volatility → affects IV levels</li>
                <li><strong>Directional Bias:</strong> Sustained flows indicate market direction → useful for option strategy selection</li>
                <li><strong>PCR Correlation:</strong> FII/DII flows often correlate with Put-Call Ratio trends</li>
              </ul>
              <p className="mt-2 text-slate-400">
                <strong>Note:</strong> This data does not change when you select different instruments (NIFTY, BANKNIFTY, etc.) 
                because it represents overall market activity, not instrument-specific flows.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 rounded px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-slate-400">
            Recent flows (₹ crores) • Market-wide aggregate data
            {loading && <span className="text-accent ml-2">Loading...</span>}
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-accent hover:bg-accentSoft text-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ⟳ Refresh
          </button>
        </div>
        <table className="w-full text-[11px]">
          <thead className="text-slate-400 border-b border-slate-800">
            <tr>
              <th className="text-left py-1">Date</th>
              <th className="text-right py-1">FII net</th>
              <th className="text-right py-1">DII net</th>
              <th className="text-right py-1">Bias</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const fii = typeof d.fii_net === 'number' ? d.fii_net : 0;
              const dii = typeof d.dii_net === 'number' ? d.dii_net : 0;
              const bias =
                fii > 0 && dii > 0
                  ? 'Strong buy'
                  : fii > 0 && dii < 0
                  ? 'FII buy / DII sell'
                  : fii < 0 && dii > 0
                  ? 'FII sell / DII buy'
                  : 'Strong sell';
              return (
                <tr key={d.date || Math.random()} className="border-b border-slate-900/60">
                  <td className="py-1 text-slate-300">
                    {d.date ? new Date(d.date).toISOString().slice(0, 10) : '—'}
                  </td>
                  <td className={`py-1 text-right ${fii >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {fii.toFixed(1)}
                  </td>
                  <td className={`py-1 text-right ${dii >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {dii.toFixed(1)}
                  </td>
                  <td className="py-1 text-right text-slate-400">{bias}</td>
                </tr>
              );
            })}
            {!data.length && !loading && (
              <tr>
                <td colSpan="4" className="py-3 text-center text-slate-600">
                  No flow data available. Data is fetched from NSE and cached daily.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan="4" className="py-3 text-center text-slate-400">
                  Loading FII/DII flows from NSE...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


