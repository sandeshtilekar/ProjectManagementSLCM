import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useStore } from './context/store';
import LoginPage    from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AppLayout    from './pages/AppLayout';

function RequireAuth({ children }) {
  const user = useStore(s => s.user);
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const hydrate = useStore(s => s.hydrate);

  useEffect(() => { hydrate(); }, []);

  return (
    <BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#13162b',
            color: '#e4e8ff',
            border: '1px solid #232747',
            fontSize: 13,
          },
        }}
      />
      <Routes>
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/*" element={
          <RequireAuth><AppLayout /></RequireAuth>
        } />
      </Routes>
    </BrowserRouter>
  );
}
