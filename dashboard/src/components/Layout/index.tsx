import { Outlet } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';

export default function Layout() {
  return (
    <>
      {/* 柔和背景动画 */}
      <div className="background-gradients">
        <span className="bg-blue"></span>
        <span className="bg-purple"></span>
      </div>

      {/* Christmas Garland */}
      <div className="christmas-garland">
        <div className="garland-string" />
        <div className="garland-item" style={{ animationDelay: '0s' }}>🎄</div>
        <div className="garland-item" style={{ animationDelay: '0.5s' }}>⭐</div>
        <div className="garland-item" style={{ animationDelay: '1s' }}>🎁</div>
        <div className="garland-item" style={{ animationDelay: '1.5s' }}>🔔</div>
        <div className="garland-item" style={{ animationDelay: '2s' }}>🎅</div>
        <div className="garland-item" style={{ animationDelay: '2.5s' }}>🦌</div>
        <div className="garland-item" style={{ animationDelay: '3s' }}>🍬</div>
        <div className="garland-item" style={{ animationDelay: '3.5s' }}>❄️</div>
        <div className="garland-item" style={{ animationDelay: '4s' }}>🎀</div>
        <div className="garland-item" style={{ animationDelay: '4.5s' }}>🎈</div>
      </div>

      <div className="app-layout">
        <Sidebar />
        <main className="content">
          <div className="container">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
