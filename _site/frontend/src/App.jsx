import React, { useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Target, FileText, Users, DollarSign,
  Ticket, Menu, X, Zap, ChevronRight
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import ScoringPage from './pages/ScoringPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetail from './pages/ProjectDetail';
import LegalPage from './pages/LegalPage';
import PartnersPage from './pages/PartnersPage';
import CapitalPage from './pages/CapitalPage';
import TicketsPage from './pages/TicketsPage';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/scoring', icon: Target, label: 'Scoring Engine' },
  { to: '/projects', icon: Zap, label: 'Projects' },
  { to: '/legal', icon: FileText, label: 'Legal & Compliance' },
  { to: '/partners', icon: Users, label: 'Partners' },
  { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
  { to: '/tickets', icon: Ticket, label: 'Support' },
];

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 border-r border-gray-800
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0 lg:flex lg:flex-col
      `}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-sm">A</div>
          <div>
            <div className="font-semibold text-sm text-white">StudioOS</div>
            <div className="text-[10px] text-gray-400">Axal VC v1.0</div>
          </div>
          <button className="ml-auto lg:hidden text-gray-400" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'text-violet-400 bg-violet-500/10 border-r-2 border-violet-500'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500">
          The 30-Day Spin-Out Engine
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden text-gray-400" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="text-sm font-medium text-gray-300">Axal VC StudioOS</div>
        </header>
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/scoring" element={<ScoringPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/capital" element={<CapitalPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
