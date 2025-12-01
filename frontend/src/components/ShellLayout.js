import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import useStore from '../state/store';

// Icons (using Unicode/Emoji for simplicity - can be replaced with icon library later)
const icons = {
  dashboard: '📊',
  'option-chain': '📈',
  probability: '🔥',
  'oi-iv': '📉',
  'fii-dii': '💰',
  strategy: '⚙️',
  'strategy-all': '📋',
  'strategy-builder': '🔨',
  'live-strategy': '▶️',
  backtest: '🧪',
  models: '🧠',
  trades: '💼',
  logs: '📝',
};

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: icons.dashboard },
  { to: '/option-chain', label: 'Live Option Chain', icon: icons['option-chain'] },
  { to: '/probability', label: 'Probability Heatmap', icon: icons.probability },
  { to: '/oi-iv', label: 'OI / IV Analytics', icon: icons['oi-iv'] },
  { to: '/fii-dii', label: 'FII / DII Flows', icon: icons['fii-dii'] },
  {
    type: 'group',
    label: 'Strategy',
    icon: icons.strategy,
    children: [
      { to: '/strategies/all', label: 'All Strategy', icon: icons['strategy-all'] },
      { to: '/strategy-builder', label: 'Builder', icon: icons['strategy-builder'] },
      { to: '/live-strategy', label: 'Live Runner', icon: icons['live-strategy'] },
      { to: '/backtest', label: 'Backtest', icon: icons.backtest },
    ],
  },
  { to: '/models', label: 'Model Insights', icon: icons.models },
  { to: '/trades', label: 'Trades', icon: icons.trades },
  { to: '/logs', label: 'Logs', icon: icons.logs },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const location = useLocation();

  useEffect(() => {
    if (!instruments.length) {
      loadInstruments();
    }
  }, [instruments.length, loadInstruments]);

  // Auto-expand strategy group if on a strategy page
  useEffect(() => {
    if (location.pathname.startsWith('/strategies') || 
        location.pathname.startsWith('/strategy') || 
        location.pathname.startsWith('/backtest') ||
        location.pathname.startsWith('/live-strategy')) {
      setExpandedGroups({ ...expandedGroups, strategy: true });
    }
  }, [location.pathname]);

  const toggleGroup = (groupKey) => {
    setExpandedGroups({ ...expandedGroups, [groupKey]: !expandedGroups[groupKey] });
  };

  const currentInstrument =
    instruments.find((i) => i.symbol === selectedSymbol) || instruments[0] || null;
  const availableExpiries =
    (currentInstrument && Array.isArray(currentInstrument.nextExpiries)
      ? currentInstrument.nextExpiries
      : []) || [];

  const renderNavItem = (item, level = 0) => {
    if (item.type === 'group') {
      const isExpanded = expandedGroups[item.label.toLowerCase()] || false;
      const hasActiveChild = item.children?.some(
        (child) => location.pathname === child.to
      );
      
      return (
        <div key={item.label} className="mb-1">
          <button
            onClick={() => toggleGroup(item.label.toLowerCase())}
            className={`w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800 transition text-sm ${
              hasActiveChild ? 'bg-slate-900 text-accent' : 'text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span>{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </div>
            {!sidebarCollapsed && (
              <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                ▶
              </span>
            )}
          </button>
          {isExpanded && !sidebarCollapsed && item.children && (
            <div className="ml-4 border-l border-slate-800">
              {item.children.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-4 py-2 hover:bg-slate-800 transition text-sm ${
                      isActive ? 'bg-slate-900 text-accent' : 'text-slate-300'
                    }`
                  }
                >
                  <span>{child.icon}</span>
                  <span>{child.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) =>
          `flex items-center gap-2 px-4 py-2 hover:bg-slate-800 transition text-sm ${
            isActive ? 'bg-slate-900 text-accent' : 'text-slate-300'
          }`
        }
      >
        <span>{item.icon}</span>
        {!sidebarCollapsed && <span>{item.label}</span>}
      </NavLink>
    );
  };

  return (
    <div className="h-screen flex bg-bg text-slate-100">
      <aside
        className={`${
          sidebarCollapsed ? 'w-16' : 'w-64'
        } border-r border-slate-800 bg-surface flex flex-col transition-all duration-300`}
      >
        <div className="px-4 py-4 border-b border-slate-800 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div>
              <div className="text-lg font-semibold text-accent">QuantX</div>
              <div className="text-xs text-slate-400">Real-Time Options Analytics</div>
            </div>
          )}
          {sidebarCollapsed && <div className="text-lg font-semibold text-accent">QX</div>}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="text-slate-400 hover:text-slate-200 transition p-1"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto text-sm">
          {navItems.map((item) => renderNavItem(item))}
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


