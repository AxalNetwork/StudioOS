import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { Menu, X, LogOut } from 'lucide-react';
import { api } from './lib/api';

const ViewModeContext = createContext();

const ROLE_LABELS = {
  admin: 'Admin',
  founder: 'Founder',
  partner: 'Partner',
};

const ROLE_COLORS = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
};

function DashboardShell({ children, user, onLogout, sidebarOpen, setSidebarOpen, isAdmin, activeRole, isImpersonating, onExitImpersonation, realUser, navItems }) {
  return (
    <ViewModeContext.Provider value={{}}>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <div className="flex flex-1 overflow-hidden">
          <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 lg:flex lg:flex-col`}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
              <img src="/axal-mark.png" alt="Axal VC" className="h-8 w-8 rounded-lg object-cover" />
              <div>
                <div className="font-semibold text-sm text-gray-900">Axal VC</div>
                <div className="text-[10px] text-gray-500">StudioOS v1.0</div>
              </div>
              {isAdmin && activeRole !== 'admin' && (
                <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[activeRole]}`}>
                  {ROLE_LABELS[activeRole]} View
                </span>
              )}
              <button className="ml-auto lg:hidden text-gray-600" onClick={() => setSidebarOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 py-3 overflow-y-auto">
              {navItems.map(({ to, icon: Icon, label, divider }) => (
                <React.Fragment key={to}>
                {divider && <div className="mx-5 my-2 border-t border-gray-200" />}
                <NavLink
                  to={to}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'text-violet-600 bg-violet-50 border-r-2 border-violet-600'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
                </React.Fragment>
              ))}
            </nav>
            <div className="px-5 py-3 border-t border-gray-200">
              {user && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-900 font-medium truncate">{user.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{user.email}</div>
                    <span className={`inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  </div>
                  <button onClick={onLogout} className="text-gray-500 hover:text-red-500 transition-colors" title="Sign out">
                    <LogOut size={14} />
                  </button>
                </div>
              )}
            </div>
          </aside>

          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          <main className="flex-1 overflow-y-auto">
            <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-3 flex items-center gap-3">
              <button className="lg:hidden text-gray-600" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} />
              </button>
              <div className="text-sm font-medium text-gray-700">Axal VC StudioOS</div>
              {isImpersonating && (
                <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Impersonating {user.name}
                </span>
              )}
            </header>
            <div className="p-4 md:p-6 max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ViewModeContext.Provider>
  );
}

function RequireAuth({ user, children, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate }) {
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

export default function App() {
  return null;
}
