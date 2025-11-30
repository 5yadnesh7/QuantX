import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import useStore from '../state/store';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/option-chain', label: 'Live Option Chain' },
  { to: '/probability', label: 'Probability Heatmap' },
  { to: '/oi-iv', label: 'OI / IV Analytics' },
  { to: '/fii-dii', label: 'FII / DII Flows' },
  { to: '/strategy-builder', label: 'Strategy Builder' },
  { to: '/live-strategy', label: 'Live Strategy Runner' },
  { to: '/backtest', label: 'Backtest Studio' },
  { to: '/models', label: 'Model Insights' },
  { to: '/trades', label: 'Trades' },
  { to: '/logs', label: 'Logs' },
];

export default function ShellLayout({ children }) {
  const {
    instruments,
    selectedSymbol,
    selectedExpiry,
    setSelectedSymbol,
    setSelectedExpiry,
    loadInstruments,
    lastTickAt,
    error,
  } = useStore();
  const hasRecentTicks = lastTickAt && Date.now() - lastTickAt < 10_000;

  useEffect(() => {
    if (!instruments.length) {
      loadInstruments();
    }
  }, [instruments.length, loadInstruments]);

  const currentInstrument =
    instruments.find((i) => i.symbol === selectedSymbol) || instruments[0] || null;
  const availableExpiries =
    (currentInstrument && Array.isArray(currentInstrument.nextExpiries)
      ? currentInstrument.nextExpiries
      : []) || [];

  return (
    <div className="h-screen flex bg-bg text-slate-100">
      <aside className="w-64 border-r border-slate-800 bg-surface flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-lg font-semibold text-accent">QuantX</div>
          <div className="text-xs text-slate-400">Real-Time Options Analytics</div>
        </div>
        <nav className="flex-1 overflow-y-auto text-sm">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-4 py-2 hover:bg-slate-800 transition ${
                  isActive ? 'bg-slate-900 text-accent' : 'text-slate-300'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-2 text-[10px] text-slate-500 border-t border-slate-800">
          Live data via Upstox • Backend: FastAPI • DB: MongoDB
        </div>
      </aside>
      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="h-12 border-b border-slate-800 flex items-center px-4 text-xs justify-between">
          <div className="flex items-center gap-3 text-slate-400">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  hasRecentTicks ? 'bg-positive animate-pulse' : 'bg-slate-600'
                }`}
              />
              <span>
                {hasRecentTicks
                  ? 'Receiving market ticks'
                  : 'No recent ticks – market may be closed or feed not connected'}
              </span>
            </div>
            {error && (
              <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50">
                {error}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Instrument</span>
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                value={selectedSymbol || (instruments[0]?.symbol ?? '')}
                onChange={(e) => setSelectedSymbol(e.target.value)}
              >
                {instruments.map((ins) => (
                  <option key={ins.symbol} value={ins.symbol}>
                    {ins.label || ins.symbol}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Expiry</span>
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                value={selectedExpiry || (availableExpiries[0] ?? '')}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                disabled={!availableExpiries.length}
              >
                {availableExpiries.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-slate-400 hidden sm:block">QuantX Terminal</div>
          </div>
        </header>
        <section className="flex-1 overflow-y-auto p-4 bg-gradient-to-b from-surface to-bg">
          {children}
        </section>
      </main>
    </div>
  );
}


