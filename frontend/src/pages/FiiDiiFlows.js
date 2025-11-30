import React, { useEffect, useState } from 'react';
import { getFiiDiiFlows } from '../api/client';

export default function FiiDiiFlows() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const res = await getFiiDiiFlows();
        setData(res.data.days || []);
      } catch (e) {
        console.error(e);
        setError('Could not load FII / DII flows – check backend / network.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

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

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 rounded px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="text-slate-400 mb-1">Recent flows (₹ crores, sample or from DB)</div>
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
                  No flow data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


