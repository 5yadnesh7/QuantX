import { create } from 'zustand';
import {
  getInstruments,
  getLiveChain,
  getModelsInsights,
  runBacktest,
} from '../api/client';

const useStore = create((set, get) => ({
  instruments: [],
  selectedSymbol: null,
  selectedExpiry: null,
  optionChain: null,
  modelsInsights: null,
  backtestResult: null,
  liveSignals: [],
  lastTickAt: null,
  loading: false,
  error: null,

  setSelectedSymbol: (symbol) =>
    set((state) => {
      const inst = state.instruments.find((i) => i.symbol === symbol) || null;
      return {
        selectedSymbol: symbol,
        selectedExpiry: inst && Array.isArray(inst.nextExpiries) && inst.nextExpiries.length
          ? inst.nextExpiries[0]
          : state.selectedExpiry,
      };
    }),

  setSelectedExpiry: (expiry) => set({ selectedExpiry: expiry }),

  loadInstruments: async () => {
    const state = get();
    // Avoid refetching if instruments are already loaded or a load is in progress
    if (state.instruments && state.instruments.length) {
      return;
    }
    if (state.loading) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const res = await getInstruments();
      const instruments = res.data;
      const first = instruments[0] || null;
      set({
        instruments,
        selectedSymbol: first ? first.symbol : null,
        selectedExpiry:
          first && Array.isArray(first.nextExpiries) && first.nextExpiries.length
            ? first.nextExpiries[0]
            : null,
        loading: false,
      });
    } catch (e) {
      console.error(e);
      set({ error: 'Failed to load instruments', loading: false });
    }
  },

  loadLiveChain: async (symbol) => {
    const state = get();
    const sym = symbol || state.selectedSymbol;
    if (!sym) return;
    set({ loading: true, error: null });
    try {
      const res = await getLiveChain(sym, state.selectedExpiry);
      set({ optionChain: res.data, loading: false });
    } catch (e) {
      console.error(e);
      set({ error: 'Failed to load option chain', loading: false });
    }
  },

  loadModelsInsights: async () => {
    try {
      const res = await getModelsInsights();
      set({ modelsInsights: res.data });
    } catch (e) {
      console.error(e);
    }
  },

  runBacktestAndStore: async (payload) => {
    set({ loading: true, error: null });
    try {
      const res = await runBacktest(payload);
      set({ backtestResult: res.data, loading: false });
    } catch (e) {
      console.error(e);
      set({ error: 'Backtest failed', loading: false });
    }
  },

  pushLiveSignal: (signal) =>
    set((state) => ({
      liveSignals: [signal, ...state.liveSignals].slice(0, 200),
      lastTickAt: Date.now(),
    })),
}));

export default useStore;

