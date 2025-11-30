import { useEffect, useMemo, useState } from 'react';
import useStore from '../state/store';
import { getQuote } from '../api/client';

export default function LiveOptionChain() {
  const {
    selectedSymbol,
    selectedExpiry,
    optionChain,
    loadInstruments,
    loadLiveChain,
  } = useStore();

  // Base cell class for consistent styling (padding, borders, font, box-sizing, numeric alignment)
  const baseCellClass = 'px-2 py-1 box-border text-[11px]';

  // Format number with Indian numbering system (2,60,67,900)
  const formatNumber = (num, decimals = 0) => {
    if (typeof num !== 'number' || !isFinite(num)) return '—';
    
    // Round to specified decimals
    const rounded = decimals > 0 ? num.toFixed(decimals) : Math.round(num).toString();
    
    // Split by decimal point
    const parts = rounded.split('.');
    const integerPart = parts[0];
    const decimalPart = parts[1];
    
    // Format integer part with Indian numbering system
    // Last 3 digits, then groups of 2 digits
    let formatted = '';
    const len = integerPart.length;
    
    if (len <= 3) {
      formatted = integerPart;
    } else {
      // Take last 3 digits
      formatted = integerPart.slice(-3);
      // Process remaining digits in groups of 2 from right to left
      for (let i = len - 3; i > 0; i -= 2) {
        const start = Math.max(0, i - 2);
        formatted = integerPart.slice(start, i) + ',' + formatted;
      }
    }
    
    // Add decimal part if exists
    if (decimalPart) {
      formatted += '.' + decimalPart;
    }
    
    return formatted;
  };

  useEffect(() => {
    loadInstruments();
  }, [loadInstruments]);

  useEffect(() => {
    if (!selectedSymbol || !selectedExpiry) return;
    loadLiveChain(selectedSymbol, selectedExpiry);
  }, [selectedSymbol, selectedExpiry, loadLiveChain]);

  // Fetch spot price
  const [spot, setSpot] = useState(null);
  useEffect(() => {
    if (!selectedSymbol) return;
    getQuote(selectedSymbol).then((response) => {
      const price = response?.data?.price || response?.data?.last || null;
      setSpot(price);
    }).catch(() => {
      setSpot(null);
    });
  }, [selectedSymbol]);

  // Combine CALL and PUT into rows
  const rows = useMemo(() => {
    if (!optionChain?.entries) return [];
    const map = new Map();
    optionChain.entries.forEach((e) => {
      const key = e.strike;
      if (!map.has(key)) map.set(key, { strike: key });
      const ref = map.get(key);
      ref[e.option_type] = e;
    });
    return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
  }, [optionChain]);

  // Find ATM strike (nearest to spot) and its index
  const { atmStrike, atmIdx } = useMemo(() => {
    if (!rows.length || typeof spot !== 'number' || !isFinite(spot)) {
      return { atmStrike: null, atmIdx: 0 };
    }
    
    // Find the highest strike that is less than or equal to spot (floor strike)
    let bestStrike = null;
    let bestIdx = 0;
    let bestStrikeValue = -Infinity;
    
    rows.forEach((r, idx) => {
      if (r.strike <= spot && r.strike > bestStrikeValue) {
        bestStrikeValue = r.strike;
        bestStrike = r.strike;
        bestIdx = idx;
      }
    });
    
    // If no strike is <= spot, use the first strike
    if (bestStrike === null && rows.length > 0) {
      bestStrike = rows[0].strike;
      bestIdx = 0;
    }
    
    return { atmStrike: bestStrike, atmIdx: bestIdx };
  }, [rows, spot]);

  // Group strikes into blocks of 3, starting from ATM
  const groupMeta = useMemo(() => {
    if (!rows.length) return {};
    const meta = {};
    const n = rows.length;
    const blockSize = 3;

    const aggregateBlock = (startIdx, endIdx) => {
      let aggCallOi = 0;
      let aggPutOi = 0;
      let aggCallVol = 0;
      let aggPutVol = 0;
      for (let j = startIdx; j <= endIdx && j < n; j += 1) {
        const r = rows[j];
        if (r?.CALL) {
          aggCallOi += Number(r.CALL.open_interest || 0);
          aggCallVol += Number(r.CALL.volume || 0);
        }
        if (r?.PUT) {
          aggPutOi += Number(r.PUT.open_interest || 0);
          aggPutVol += Number(r.PUT.volume || 0);
        }
      }
      return { aggCallOi, aggPutOi, aggCallVol, aggPutVol };
    };

    // Group blocks starting from ATM and going UP
    for (let i = atmIdx; i >= 0; i -= blockSize) {
      const start = Math.max(0, i - blockSize + 1);
      const end = i;
      const span = end - start + 1;
      const agg = aggregateBlock(start, end);
      meta[start] = { isFirst: true, span, ...agg };
      for (let j = start + 1; j <= end; j += 1) {
        meta[j] = { isFirst: false, span: 0, aggCallOi: 0, aggPutOi: 0, aggCallVol: 0, aggPutVol: 0 };
      }
    }

    // Group blocks starting from ATM+1 and going DOWN
    for (let i = atmIdx + 1; i < n; i += blockSize) {
      const start = i;
      const end = Math.min(n - 1, i + blockSize - 1);
      const span = end - start + 1;
      const agg = aggregateBlock(start, end);
      meta[start] = { isFirst: true, span, ...agg };
      for (let j = start + 1; j <= end; j += 1) {
        meta[j] = { isFirst: false, span: 0, aggCallOi: 0, aggPutOi: 0, aggCallVol: 0, aggPutVol: 0 };
      }
    }

    return meta;
  }, [rows, atmIdx]);

  const isCallITM = (strike) => typeof spot === 'number' && isFinite(spot) && strike <= spot;
  const isPutITM = (strike) => typeof spot === 'number' && isFinite(spot) && strike >= spot;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Live Option Chain</h1>
          <div className="text-[11px] text-slate-400">
            {selectedSymbol || '—'} {selectedExpiry ? `• ${selectedExpiry}` : ''}
          </div>
        </div>
      </div>

      <div className="bg-surface rounded border border-slate-800 overflow-hidden">
        <div className="border-b border-slate-800 px-3 py-2 flex justify-between items-center text-[11px] text-slate-400">
          <span className="flex items-center gap-2">
            <span>{optionChain?.underlying || selectedSymbol || '—'}</span>
            {typeof spot === 'number' && (
              <span className="text-accent font-semibold">Spot: {formatNumber(spot, 2)}</span>
            )}
          </span>
          <span>{optionChain?.timestamp}</span>
        </div>
        <div className="overflow-auto max-h-[70vh] pr-4">
          <table className="w-full text-[11px] border-collapse" style={{ tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
            <colgroup>
              <col style={{ width: '7%' }} /> {/* Agg OI (3) */}
              <col style={{ width: '7%' }} /> {/* Agg Vol (3) */}
              <col style={{ width: '6%' }} /> {/* OI */}
              <col style={{ width: '6%' }} /> {/* Volume */}
              <col style={{ width: '5%' }} /> {/* Gamma */}
              <col style={{ width: '5%' }} /> {/* Vega */}
              <col style={{ width: '5%' }} /> {/* Theta */}
              <col style={{ width: '5%' }} /> {/* Delta */}
              <col style={{ width: '5%' }} /> {/* IV */}
              <col style={{ width: '6%' }} /> {/* Price */}
              <col style={{ width: '8%' }} /> {/* Strike */}
              <col style={{ width: '6%' }} /> {/* Price */}
              <col style={{ width: '5%' }} /> {/* IV */}
              <col style={{ width: '5%' }} /> {/* Delta */}
              <col style={{ width: '5%' }} /> {/* Theta */}
              <col style={{ width: '5%' }} /> {/* Gamma */}
              <col style={{ width: '5%' }} /> {/* Vega */}
              <col style={{ width: '6%' }} /> {/* Volume */}
              <col style={{ width: '6%' }} /> {/* OI */}
              <col style={{ width: '7%' }} /> {/* Agg Vol (3) */}
              <col style={{ width: '7%' }} /> {/* Agg OI (3) */}
            </colgroup>
            <thead className="bg-slate-900 text-slate-300 sticky top-0">
              <tr>
                <th className={`${baseCellClass} text-center text-green-300 font-semibold`} colSpan={10}>
                  Call
                </th>
                <th className={`${baseCellClass} text-center font-semibold border-l-4 border-r-4 border-t-2 border-b-2 border-slate-500 bg-slate-700`}>
                  Strike Price
                </th>
                <th className={`${baseCellClass} text-center text-red-300 font-semibold`} colSpan={10}>
                  Put
                </th>
              </tr>
              <tr className="text-slate-400">
                {/* Call side columns */}
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Agg OI (3)</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Agg Vol (3)</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>OI</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Volume</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Gamma</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Vega</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Theta</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Delta</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>IV</th>
                <th className={`${baseCellClass} text-right border-r border-slate-700`}>Price</th>
                <th className={`${baseCellClass} text-center border-l-4 border-r-4 border-t-2 border-b-2 border-slate-500 bg-slate-700`}>Strike</th>
                {/* Put side columns */}
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Price</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>IV</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Delta</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Theta</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Gamma</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Vega</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Volume</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>OI</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Agg Vol (3)</th>
                <th className={`${baseCellClass} text-right border-l border-slate-700`}>Agg OI (3)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const c = r.CALL || {};
                const p = r.PUT || {};
                const callITM = isCallITM(r.strike);
                const putITM = isPutITM(r.strike);
                
                // Show splitter after the ATM row (before the next row)
                const prevRowWasAtm = idx > 0 && (idx - 1) === atmIdx;
                const shouldShowSplitter = prevRowWasAtm && typeof spot === 'number' && isFinite(spot);

                return (
                  <>
                    {shouldShowSplitter && (
                      <tr key={`splitter-${atmStrike}`} className="border-y-2 border-slate-500">
                        <td colSpan={21} className="bg-slate-700 text-white text-center font-semibold" style={{ padding: '8px 0', border: 'none', margin: 0 }}>
                          <div className="flex items-center justify-center gap-3 text-sm">
                            <span className="font-bold">{formatNumber(spot, 2)}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr key={r.strike} className={`border-b border-slate-700 ${idx === 0 ? 'border-t-2 border-slate-700' : ''} ${idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/10'}`}>
                    {/* CALL aggregated OI */}
                    {(() => {
                      const g = groupMeta[idx] || { isFirst: false, span: 0, aggCallOi: 0, aggPutOi: 0, aggCallVol: 0, aggPutVol: 0 };
                      return g.isFirst ? (
                        <td
                          rowSpan={g.span}
                          className={`${baseCellClass} text-right align-middle border-r border-slate-700 ${
                            callITM ? 'bg-green-900/20' : ''
                          }`}
                        >
                          {formatNumber(g.aggCallOi, 0)}
                        </td>
                      ) : null;
                    })()}
                    {/* CALL aggregated Vol */}
                    {(() => {
                      const g = groupMeta[idx] || { isFirst: false, span: 0, aggCallOi: 0, aggPutOi: 0, aggCallVol: 0, aggPutVol: 0 };
                      return g.isFirst ? (
                        <td
                          rowSpan={g.span}
                          className={`${baseCellClass} text-right align-middle border-r border-slate-700 ${
                            callITM ? 'bg-green-900/20' : ''
                          }`}
                        >
                          {formatNumber(g.aggCallVol, 0)}
                        </td>
                      ) : null;
                    })()}
                    {/* Per-row CALL data */}
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.open_interest, 0)}
                    </td>
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.volume, 0)}
                    </td>
                    {/* CALL Gamma */}
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.gamma, 4)}
                    </td>
                    {/* CALL Vega */}
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.vega, 4)}
                    </td>
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.theta, 4)}
                    </td>
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.delta, 4)}
                    </td>
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {typeof c.iv === 'number' ? formatNumber(c.iv * 100, 2) + '%' : '—'}
                    </td>
                    <td className={`${baseCellClass} text-right border-r border-slate-700 ${callITM ? 'bg-green-900/30' : ''}`}>
                      {formatNumber(c.last, 2)}
                    </td>

                    {/* Strike price */}
                    <td className={`${baseCellClass} text-center border-l-4 border-r-4 border-t-2 border-b-2 border-slate-500 bg-slate-700`}>
                      <span className="font-semibold">{r.strike}</span>
                    </td>

                    {/* Per-row PUT data */}
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.last, 2)}
                    </td>
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {typeof p.iv === 'number' ? formatNumber(p.iv * 100, 2) + '%' : '—'}
                    </td>
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.delta, 4)}
                    </td>
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.theta, 4)}
                    </td>
                    {/* PUT Gamma */}
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.gamma, 4)}
                    </td>
                    {/* PUT Vega */}
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.vega, 4)}
                    </td>
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.volume, 0)}
                    </td>
                    <td className={`${baseCellClass} text-right border-l border-slate-700 ${putITM ? 'bg-red-900/30' : ''}`}>
                      {formatNumber(p.open_interest, 0)}
                    </td>
                    {/* PUT aggregated Vol */}
                    {(() => {
                      const g = groupMeta[idx] || { isFirst: false, span: 0, aggCallOi: 0, aggPutOi: 0, aggCallVol: 0, aggPutVol: 0 };
                      return g.isFirst ? (
                        <td
                          rowSpan={g.span}
                          className={`${baseCellClass} text-right align-middle border-l border-slate-700 ${
                            putITM ? 'bg-red-900/20' : ''
                          }`}
                        >
                          {formatNumber(g.aggPutVol, 0)}
                        </td>
                      ) : null;
                    })()}
                    {/* PUT aggregated OI */}
                    {(() => {
                      const g = groupMeta[idx] || { isFirst: false, span: 0, aggCallOi: 0, aggPutOi: 0, aggCallVol: 0, aggPutVol: 0 };
                      return g.isFirst ? (
                        <td
                          rowSpan={g.span}
                          className={`${baseCellClass} text-right align-middle border-l border-slate-700 ${
                            putITM ? 'bg-red-900/20' : ''
                          }`}
                        >
                          {formatNumber(g.aggPutOi, 0)}
                        </td>
                      ) : null;
                    })()}
                  </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
