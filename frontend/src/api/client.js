import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE,
});

export const getInstruments = () => api.get('/instruments');
export const getLiveChain = (symbol, expiry) =>
  api.get('/chain/live', { params: { symbol, expiry } });
export const getDashboardPrediction = (symbol, expiry) =>
  api.get('/analytics/dashboard', { params: { symbol, expiry } });
export const getQuote = (symbol) =>
  api.get('/quote', { params: { symbol } });
export const getChainHistory = (symbol, days = 5) =>
  api.get('/chain/history', { params: { symbol, days } });

export const postProbability = (payload) => api.post('/probability', payload);
export const postIv = (payload) => api.post('/iv', payload);
export const postOi = (payload) => api.post('/oi', payload);
export const postSkew = () => api.post('/skew');
export const postConsensus = (payload) => api.post('/consensus', payload);
export const postGreeks = (payload) => api.post('/greeks', payload);
export const postHeatmap = (payload) => api.post('/probability/heatmap', payload);

export const runLiveStrategy = (payload) => api.post('/strategy/run-live', payload);
export const runBacktest = (payload) => api.post('/strategy/backtest', payload);
export const saveStrategy = (payload) => api.post('/strategy/save', payload);
export const getBacktestResult = (id) => api.get(`/backtest/results/${id}`);

export const getModelsInsights = () => api.get('/models/insights');
export const getFiiDiiFlows = () => api.get('/flows/fii-dii');

