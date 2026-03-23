import { create } from 'zustand';
import api from '../api/client';

export const useStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────
  user:       null,
  workspaces: [],
  activeWs:   null,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('gb_access',  data.access);
    localStorage.setItem('gb_refresh', data.refresh);
    set({ user: data.user, workspaces: data.workspaces, activeWs: data.workspaces[0] || null });
    return data;
  },

  register: async (email, password, fullName) => {
    const { data } = await api.post('/auth/register', { email, password, fullName });
    localStorage.setItem('gb_access',  data.access);
    localStorage.setItem('gb_refresh', data.refresh);
    set({ user: data.user, workspaces: [], activeWs: null });
    return data;
  },

  logout: async () => {
    const rt = localStorage.getItem('gb_refresh');
    await api.post('/auth/logout', { refreshToken: rt }).catch(() => {});
    localStorage.removeItem('gb_access');
    localStorage.removeItem('gb_refresh');
    set({ user: null, workspaces: [], activeWs: null });
  },

  hydrate: async () => {
    const token = localStorage.getItem('gb_access');
    if (!token) return;
    try {
      const { data } = await api.get('/auth/me');
      const { data: wsList } = await api.get('/workspaces');
      set({ user: data.user, workspaces: wsList, activeWs: wsList[0] || null });
    } catch { /* token invalid — stay logged out */ }
  },

  setActiveWs: ws => set({ activeWs: ws }),

  // ── Bases / Tables (loaded per workspace) ────────────────
  bases:       [],
  activeBases: null,
  tables:      [],
  activeTable: null,
  fields:      [],
  records:     [],

  loadBases: async (wsId) => {
    const { data } = await api.get(`/workspaces/${wsId}/bases`);
    set({ bases: data, activeBases: data[0] || null });
    if (data[0]) get().loadTables(data[0].id);
  },

  loadTables: async (baseId) => {
    const { data } = await api.get(`/bases/${baseId}/tables`);
    set({ tables: data, activeTable: data[0] || null });
    if (data[0]) get().loadTableData(data[0].id);
  },

  setActiveTable: async (table) => {
    set({ activeTable: table });
    await get().loadTableData(table.id);
  },

  loadTableData: async (tableId) => {
    const [{ data: fields }, { data: records }] = await Promise.all([
      api.get(`/tables/${tableId}/fields`),
      api.get(`/tables/${tableId}/records`),
    ]);
    set({ fields, records });
  },

  // ── Record mutations ──────────────────────────────────────
  addRecord: async () => {
    const { activeTable, fields } = get();
    const cells = {};
    fields.forEach(f => {
      if (f.type === 'checkbox')    cells[f.id] = false;
      else if (f.type === 'multiSelect') cells[f.id] = [];
      else cells[f.id] = '';
    });
    const { data: rec } = await api.post(`/tables/${activeTable.id}/records`, { cells });
    set(s => ({ records: [...s.records, rec] }));
    return rec;
  },

  updateCell: async (recordId, fieldId, value) => {
    set(s => ({
      records: s.records.map(r => r.id === recordId ? { ...r, [fieldId]: value } : r),
    }));
    await api.patch(`/records/${recordId}`, { cells: { [fieldId]: value } });
  },

  // Apply a remote cell update (from Socket.io)
  applyRemoteCell: (recordId, fieldId, value) => {
    set(s => ({
      records: s.records.map(r => r.id === recordId ? { ...r, [fieldId]: value } : r),
    }));
  },

  deleteRecord: async (recordId) => {
    set(s => ({ records: s.records.filter(r => r.id !== recordId) }));
    await api.delete(`/records/${recordId}`);
  },

  addField: async (name, type, options) => {
    const { activeTable } = get();
    const { data: f } = await api.post(`/tables/${activeTable.id}/fields`, { name, type, options });
    set(s => ({ fields: [...s.fields, f] }));
  },

  deleteField: async (fieldId) => {
    set(s => ({ fields: s.fields.filter(f => f.id !== fieldId) }));
    await api.delete(`/fields/${fieldId}`);
  },
}));
