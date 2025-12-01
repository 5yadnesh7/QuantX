import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { saveStrategy, getStrategy } from '../api/client';

const initialBlocks = [
  { id: 'cond-price-gt-vwap', type: 'condition', label: 'Price > VWAP', payload: { indicator: 'price_above_vwap', operator: '>', threshold: 0 } },
  { id: 'cond-iv-rank', type: 'condition', label: 'IV Rank > 50', payload: { indicator: 'iv_rank', operator: '>', threshold: 50 } },
  { id: 'cond-pcr-low', type: 'condition', label: 'PCR (OI) < 0.7 (Bullish)', payload: { indicator: 'pcr_oi', operator: '<', threshold: 0.7 } },
  { id: 'cond-pcr-high', type: 'condition', label: 'PCR (OI) > 1.2 (Bearish)', payload: { indicator: 'pcr_oi', operator: '>', threshold: 1.2 } },
  { id: 'cond-pcr-extreme', type: 'condition', label: 'PCR (OI) > 1.5 (Extreme)', payload: { indicator: 'pcr_oi', operator: '>', threshold: 1.5 } },
  { id: 'filter-volume', type: 'filter', label: 'Volume > 100k', payload: { name: 'min_volume', params: { value: 100000 } } },
  { id: 'action-buy-call', type: 'action', label: 'Buy 1x ATM Call', payload: { side: 'BUY', quantity: 1, instrument: 'ATM_CALL' } },
  { id: 'action-buy-put', type: 'action', label: 'Buy 1x ATM Put', payload: { side: 'BUY', quantity: 1, instrument: 'ATM_PUT' } },
  { id: 'exit-tp', type: 'exit', label: 'TP 30%', payload: { type: 'take_profit', value: 0.3 } },
  { id: 'exit-sl', type: 'exit', label: 'SL 15%', payload: { type: 'stop_loss', value: 0.15 } },
];

// Helper function to convert payload back to block format
const payloadToBlock = (payload, type, index) => {
  let label = '';
  if (type === 'condition') {
    const { indicator, operator, threshold } = payload;
    if (indicator === 'pcr_oi') {
      if (operator === '<') label = `PCR (OI) < ${threshold} (Bullish)`;
      else if (operator === '>') {
        if (threshold >= 1.5) label = `PCR (OI) > ${threshold} (Extreme)`;
        else label = `PCR (OI) > ${threshold} (Bearish)`;
      }
    } else if (indicator === 'iv_rank') {
      label = `IV Rank ${operator} ${threshold}`;
    } else if (indicator === 'price_above_vwap') {
      label = `Price > VWAP`;
    }
  } else if (type === 'filter') {
    const { name: filterName, params } = payload;
    if (filterName === 'min_volume') {
      label = `Volume > ${params?.value || 0}`;
    }
  } else if (type === 'action') {
    const { side, quantity, instrument } = payload;
    label = `${side} ${quantity}x ${instrument}`;
  } else if (type === 'exit') {
    const { type: exitType, value } = payload;
    if (exitType === 'take_profit') label = `TP ${(value * 100).toFixed(0)}%`;
    else if (exitType === 'stop_loss') label = `SL ${(value * 100).toFixed(0)}%`;
  }
  
  return {
    id: `${type}-${index}-${Date.now()}`,
    type,
    label: label || `${type} ${index}`,
    payload,
  };
};

export default function StrategyBuilder() {
  const [searchParams] = useSearchParams();
  const strategyNameParam = searchParams.get('strategy');
  const newNameParam = searchParams.get('name');
  
  const [name, setName] = useState(newNameParam || 'Mean Reversion Call');
  const [available, setAvailable] = useState(initialBlocks);
  const [conditions, setConditions] = useState([]);
  const [filters, setFilters] = useState([]);
  const [actions, setActions] = useState([]);
  const [exits, setExits] = useState([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load strategy if name is provided in URL
  useEffect(() => {
    if (strategyNameParam) {
      loadStrategy(strategyNameParam);
    } else if (newNameParam) {
      setName(newNameParam);
    }
  }, [strategyNameParam, newNameParam]);

  const loadStrategy = async (strategyName) => {
    try {
      setLoading(true);
      const res = await getStrategy(strategyName);
      const strategy = res.data.strategy;
      
      setName(strategy.name || strategyName);
      
      // Convert strategy JSON back to blocks
      const loadedConditions = (strategy.conditions || []).map((c, i) => payloadToBlock(c, 'condition', i));
      const loadedFilters = (strategy.filters || []).map((f, i) => payloadToBlock(f, 'filter', i));
      const loadedActions = (strategy.actions || []).map((a, i) => payloadToBlock(a, 'action', i));
      const loadedExits = (strategy.exits || []).map((e, i) => payloadToBlock(e, 'exit', i));
      
      setConditions(loadedConditions);
      setFilters(loadedFilters);
      setActions(loadedActions);
      setExits(loadedExits);
      
      setStatus(`Loaded strategy "${strategyName}"`);
    } catch (e) {
      console.error(e);
      setStatus(`Failed to load strategy "${strategyName}" – check backend / network.`);
    } finally {
      setLoading(false);
    }
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const sourceId = result.source.droppableId;
    const destId = result.destination.droppableId;
    if (sourceId === destId) return;

    const findBlock = (id) => available.find((b) => b.id === id);
    const block = findBlock(result.draggableId);
    if (!block) return;

    const appendTo = (setter, arr) => setter([...arr, block]);

    if (destId === 'conditions') appendTo(setConditions, conditions);
    if (destId === 'filters') appendTo(setFilters, filters);
    if (destId === 'actions') appendTo(setActions, actions);
    if (destId === 'exits') appendTo(setExits, exits);
  };

  const strategyJson = {
    name,
    mode: 'LIVE',
    conditions: conditions.map((b) => b.payload),
    filters: filters.map((b) => b.payload),
    actions: actions.map((b) => b.payload),
    exits: exits.map((b) => b.payload),
    multi_leg: false,
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setStatus(null);
      await saveStrategy({ strategy: strategyJson });
      setStatus('Strategy saved to backend. Live Runner / Backtest will use this definition when wired.');
    } catch (e) {
      console.error(e);
      setStatus('Failed to save strategy – check backend / network.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Strategy Builder</h1>
          <p className="text-[11px] text-slate-400">
            Drag conditions, filters, actions and exits into the lanes to define a rule-based
            options strategy. Save it so the backend can evaluate it in live or backtest mode.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] w-56"
            placeholder="Strategy name"
          />
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="bg-accent hover:bg-accentSoft text-black text-xs font-semibold px-3 py-1 rounded disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save strategy'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-blue-900/20 border border-blue-700/50 rounded px-2 py-1 text-[11px] text-blue-300">
          Loading strategy...
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-4 gap-3">
          <Droppable droppableId="library">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="bg-surface rounded border border-slate-800 p-3 space-y-2"
              >
                <div className="text-slate-400 mb-1">Block Library</div>
                {available.map((b, idx) => (
                  <Draggable key={b.id} draggableId={b.id} index={idx}>
                    {(prov) => (
                      <div
                        ref={prov.innerRef}
                        {...prov.draggableProps}
                        {...prov.dragHandleProps}
                        className="border border-slate-800 rounded px-2 py-1 mb-1 bg-slate-900 flex justify-between"
                      >
                        <span>{b.label}</span>
                        <span className="uppercase text-[10px] text-slate-500">
                          {b.type}
                        </span>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          {[
            { id: 'conditions', title: 'Conditions', items: conditions },
            { id: 'filters', title: 'Filters', items: filters },
            { id: 'actions', title: 'Actions', items: actions },
            { id: 'exits', title: 'Exits', items: exits },
          ].map((col) => (
            <Droppable key={col.id} droppableId={col.id}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="bg-surface rounded border border-dashed border-slate-700 p-3 min-h-[120px] space-y-1"
                >
                  <div className="text-slate-400 mb-1">{col.title}</div>
                  {col.items.map((b, idx) => (
                    <div
                      key={b.id + idx}
                      className="border border-slate-800 rounded px-2 py-1 bg-slate-900 text-[11px]"
                    >
                      {b.label}
                    </div>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      <div className="bg-surface rounded border border-slate-800 p-3">
        <div className="text-slate-400 mb-1">Generated Strategy JSON</div>
        <pre className="bg-slate-900 border border-slate-800 rounded p-2 text-[10px] overflow-auto max-h-64">
          {JSON.stringify(strategyJson, null, 2)}
        </pre>
        {status && (
          <div className="mt-2 text-[11px] text-slate-300">
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

