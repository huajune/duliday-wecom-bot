import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Users from '@/pages/Users';
import Config from '@/pages/Config';
import Hosting from '@/pages/Hosting';
import System from '@/pages/System';
import Logs from '@/pages/Logs';
import ConsoleLogs from '@/pages/ConsoleLogs';

function App() {
  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{ top: '50%', transform: 'translateY(-50%)' }}
        toastOptions={{
          duration: 2000,
          style: {
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '12px',
            padding: '12px 16px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            fontSize: '14px',
            color: '#1e293b',
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#fff' },
          },
        }}
      />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="users" element={<Users />} />
          <Route path="hosting" element={<Hosting />} />
          <Route path="config" element={<Config />} />
          <Route path="system" element={<System />} />
          <Route path="logs" element={<Logs />} />
          <Route path="console" element={<ConsoleLogs />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
