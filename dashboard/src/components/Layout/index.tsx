import { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';

export default function Layout() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  // 监听 Cmd+S (Mac) / Ctrl+S (Windows) 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault(); // 阻止浏览器默认保存行为
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

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

      <div className={`app-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Sidebar isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />
        <main className="content">
          <div className="container">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
