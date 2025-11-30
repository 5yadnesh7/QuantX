import React, { useEffect } from 'react';
import useStore from '../state/store';

export default function ModelInsights() {
  const { modelsInsights, loadModelsInsights } = useStore();

  useEffect(() => {
    loadModelsInsights();
  }, [loadModelsInsights]);

  const models = modelsInsights?.models || {};

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Model Insights</h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {Object.entries(models).map(([key, value]) => (
          <div
            key={key}
            className="bg-surface rounded border border-slate-800 p-3 space-y-2"
          >
            <div className="font-semibold capitalize">{key}</div>
            <div className="text-slate-400 text-[11px]">{value.description}</div>
          </div>
        ))}
        {!Object.keys(models).length && (
          <div className="text-slate-600">Loading model registry…</div>
        )}
      </div>
    </div>
  );
}

