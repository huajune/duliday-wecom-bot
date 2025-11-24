import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* 背景装饰 */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-[15%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.15),transparent_70%)] blur-[120px] animate-float" />
        <div className="absolute -bottom-[20%] -right-[15%] w-[50vw] h-[50vw] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.15),transparent_70%)] blur-[120px] animate-float [animation-delay:-10s]" />
      </div>

      <div className="flex">
        <Sidebar />
        <main className="flex-1 ml-64 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
