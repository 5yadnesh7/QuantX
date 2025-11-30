import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

export default function TimeSeriesChart({ data, height = 260 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: 'solid', color: '#020617' },
        textColor: '#e5e7eb',
      },
      grid: {
        vertLines: { color: '#111827' },
        horzLines: { color: '#111827' },
      },
      timeScale: {
        borderColor: '#111827',
      },
      rightPriceScale: {
        borderColor: '#111827',
      },
    });
    const series = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !data || data.length === 0) return;
    
    // Convert timestamps to seconds (lightweight-charts expects Unix timestamp in seconds)
    const formatted = data
      .filter(d => typeof d.value === 'number' && !isNaN(d.value))
      .map((d) => {
        let timeValue;
        if (typeof d.time === 'number') {
          // If time is already in seconds, use it; if in milliseconds, convert
          timeValue = d.time > 1e10 ? Math.floor(d.time / 1000) : d.time;
        } else {
          // Fallback to current time if no time provided
          timeValue = Math.floor(Date.now() / 1000);
        }
        return {
          time: timeValue,
          value: d.value,
        };
      })
      .sort((a, b) => a.time - b.time); // Sort by time ascending
    
    if (formatted.length > 0) {
      seriesRef.current.setData(formatted);
    }
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}

