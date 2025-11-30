import React from 'react';
import useStore from '../state/store';

export default function Logs() {
  const { liveSignals } = useStore();

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Logs</h1>
      </div>

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="text-slate-400 mb-1">Websocket tick log (latest 200)</div>
        <div className="max-h-[75vh] overflow-y-auto text-[11px]">
          {liveSignals.map((s, idx) => (
            <div
              key={idx}
              className="flex justify-between border-b border-slate-800/60 py-1"
            >
              <span>{s.symbol}</span>
              <span className="text-accent">{s.ltp?.toFixed?.(2) ?? s.ltp}</span>
              <span className="text-slate-500 text-[10px]">{s.timestamp}</span>
            </div>
          ))}
          {liveSignals.length === 0 && (
            <div className="text-slate-600">
              Open Dashboard and connect to websocket to see tick logs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

