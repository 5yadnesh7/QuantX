import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import LiveOptionChain from './pages/LiveOptionChain';
import ProbabilityHeatmap from './pages/ProbabilityHeatmap';
import OiIvAnalytics from './pages/OiIvAnalytics';
import StrategyBuilder from './pages/StrategyBuilder';
import LiveStrategyRunner from './pages/LiveStrategyRunner';
import BacktestStudio from './pages/BacktestStudio';
import ModelInsights from './pages/ModelInsights';
import Logs from './pages/Logs';
import Trades from './pages/Trades';
import FiiDiiFlows from './pages/FiiDiiFlows';
import AllStrategies from './pages/AllStrategies';
import ShellLayout from './components/ShellLayout';

function App() {
  return (
    <Router>
      <ShellLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/option-chain" element={<LiveOptionChain />} />
          <Route path="/probability" element={<ProbabilityHeatmap />} />
          <Route path="/oi-iv" element={<OiIvAnalytics />} />
          <Route path="/strategies/all" element={<AllStrategies />} />
          <Route path="/strategy-builder" element={<StrategyBuilder />} />
          <Route path="/live-strategy" element={<LiveStrategyRunner />} />
          <Route path="/backtest" element={<BacktestStudio />} />
          <Route path="/models" element={<ModelInsights />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/fii-dii" element={<FiiDiiFlows />} />
        </Routes>
      </ShellLayout>
    </Router>
  );
}

export default App;
