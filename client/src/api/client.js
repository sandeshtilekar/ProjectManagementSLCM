import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// ── Attach access token to every request ────────────────────
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('gb_access');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Auto-refresh on 401 TOKEN_EXPIRED ───────────────────────
let refreshPromise = null;

api.interceptors.response.use(
  res => res,
  async err => {
    const orig = err.config;
    if (err.response?.status === 401 &&
        err.response?.data?.code === 'TOKEN_EXPIRED' &&
        !orig._retry) {
      orig._retry = true;
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const rt = localStorage.getItem('gb_refresh');
            if (!rt) throw new Error('no refresh token');
            const { data } = await axios.post('/api/auth/refresh', { refreshToken: rt });
            localStorage.setItem('gb_access',  data.access);
            localStorage.setItem('gb_refresh', data.refresh);
            return data.access;
          } finally {
            refreshPromise = null;
          }
        })();
      }
      try {
        const newAccess = await refreshPromise;
        orig.headers.Authorization = `Bearer ${newAccess}`;
        return api(orig);
      } catch {
        // Refresh failed — clear session
        localStorage.removeItem('gb_access');
        localStorage.removeItem('gb_refresh');
        window.location.href = '/login';
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
