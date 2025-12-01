import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStrategies, deleteStrategy, updateStrategyName } from '../api/client';

export default function AllStrategies() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [newName, setNewName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getStrategies();
      setStrategies(res.data.strategies || []);
    } catch (e) {
      console.error(e);
      setError('Could not load strategies – check backend / network.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    const name = prompt('Enter strategy name:');
    if (name && name.trim()) {
      navigate(`/strategy-builder?name=${encodeURIComponent(name.trim())}`);
    }
  };

  const handleEdit = (strategy) => {
    navigate(`/strategy-builder?strategy=${encodeURIComponent(strategy.name)}`);
  };

  const handleDelete = async (strategy) => {
    if (strategy.is_default) {
      alert('Cannot delete default strategies');
      return;
    }
    if (window.confirm(`Are you sure you want to delete "${strategy.name}"?`)) {
      try {
        await deleteStrategy(strategy.name);
        await fetchStrategies();
      } catch (e) {
        console.error(e);
        alert('Failed to delete strategy – check backend / network.');
      }
    }
  };

  const handleStartEditName = (strategy) => {
    if (strategy.is_default) {
      alert('Cannot rename default strategies');
      return;
    }
    setEditingName(strategy.name);
    setNewName(strategy.name);
  };

  const handleSaveName = async (oldName) => {
    if (!newName.trim()) {
      alert('Name cannot be empty');
      return;
    }
    if (newName.trim() === oldName) {
      setEditingName(null);
      return;
    }
    try {
      await updateStrategyName(oldName, newName.trim());
      setEditingName(null);
      await fetchStrategies();
    } catch (e) {
      console.error(e);
      alert('Failed to update strategy name – check backend / network.');
    }
  };

  const handleCancelEditName = () => {
    setEditingName(null);
    setNewName('');
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">All Strategies</h1>
          <p className="text-[11px] text-slate-400">
            View, create, edit, and manage your trading strategies. Default strategies are read-only.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="bg-accent hover:bg-accentSoft text-black text-xs font-semibold px-4 py-2 rounded"
        >
          + Create Strategy
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 rounded px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="bg-surface rounded border border-slate-800 p-3">
        {loading ? (
          <div className="text-center py-8 text-slate-400">Loading strategies...</div>
        ) : strategies.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            No strategies found. Create your first strategy to get started.
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left py-2 px-2">Name</th>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-left py-2 px-2">Mode</th>
                <th className="text-left py-2 px-2">Conditions</th>
                <th className="text-left py-2 px-2">Actions</th>
                <th className="text-right py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => {
                const isDefault = strategy.is_default || false;
                const isEditing = editingName === strategy.name;
                
                return (
                  <tr
                    key={strategy.name}
                    className="border-b border-slate-900/60 hover:bg-slate-900/30"
                  >
                    <td className="py-2 px-2">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveName(strategy.name);
                              if (e.key === 'Escape') handleCancelEditName();
                            }}
                          />
                          <button
                            onClick={() => handleSaveName(strategy.name)}
                            className="text-positive text-[10px] px-2 py-1 hover:bg-slate-800 rounded"
                          >
                            ✓
                          </button>
                          <button
                            onClick={handleCancelEditName}
                            className="text-negative text-[10px] px-2 py-1 hover:bg-slate-800 rounded"
                          >
                            ✗
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300">{strategy.name}</span>
                          {isDefault && (
                            <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                              Default
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-slate-400">
                      {strategy.multi_leg ? 'Multi-leg' : 'Single-leg'}
                    </td>
                    <td className="py-2 px-2 text-slate-400">
                      {strategy.mode || 'LIVE'}
                    </td>
                    <td className="py-2 px-2 text-slate-400">
                      {Array.isArray(strategy.conditions) ? strategy.conditions.length : 0}
                    </td>
                    <td className="py-2 px-2 text-slate-400">
                      {Array.isArray(strategy.actions) ? strategy.actions.length : 0}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(strategy)}
                          className="text-accent hover:text-accentSoft text-[10px] px-2 py-1 hover:bg-slate-800 rounded"
                          title="Edit strategy"
                        >
                          Edit
                        </button>
                        {!isDefault && (
                          <>
                            <button
                              onClick={() => handleStartEditName(strategy)}
                              className="text-blue-400 hover:text-blue-300 text-[10px] px-2 py-1 hover:bg-slate-800 rounded"
                              title="Rename strategy"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleDelete(strategy)}
                              className="text-negative hover:text-red-400 text-[10px] px-2 py-1 hover:bg-slate-800 rounded"
                              title="Delete strategy"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {isDefault && (
                          <span className="text-[10px] text-slate-600">Read-only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

