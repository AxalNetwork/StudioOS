import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Target, FileText, Users, DollarSign,
  Ticket, Menu, X, Zap, Handshake, Rocket, UserCircle,
  Globe, Brain, Activity, Briefcase, LogOut
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import ScoringPage from './pages/ScoringPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetail from './pages/ProjectDetail';
import LegalPage from './pages/LegalPage';
import PartnersPage from './pages/PartnersPage';
import CapitalPage from './pages/CapitalPage';
import TicketsPage from './pages/TicketsPage';
import DealsPage from './pages/DealsPage';
import FounderPortal from './pages/FounderPortal';
import PartnerPortal from './pages/PartnerPortal';
import MarketIntelPage from './pages/MarketIntelPage';
import AdvisoryPage from './pages/AdvisoryPage';
import ActivityPage from './pages/ActivityPage';
import LPPortalPage from './pages/LPPortalPage';
import LandingPage from './pages/LandingPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/scoring', icon: Target, label: 'Scoring Engine' },
  { to: '/projects', icon: Zap, label: 'Projects' },
  { to: '/deals', icon: Handshake, label: 'Deal Flow' },
  { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
  { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
  { to: '/legal', icon: FileText, label: 'Legal & Compliance' },
  { to: '/partners', icon: Users, label: 'Partners' },
  { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
  { to: '/tickets', icon: Ticket, label: 'Support' },
  { to: '/activity', icon: Activity, label: 'Activity Log' },
  { to: '/founder', icon: Rocket, label: 'Founder Portal', divider: true },
  { to: '/partner-portal', icon: UserCircle, label: 'Partner Portal' },
  { to: '/lp-portal', icon: Briefcase, label: 'LP Investor Portal' },
];

function ProtectedLayout({ children, user, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0 lg:flex lg:flex-col
      `}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-sm text-white">A</div>
          <div>
            <div className="font-semibold text-sm text-gray-900">StudioOS</div>
            <div className="text-[10px] text-gray-500">Axal VC v1.0</div>
          </div>
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
        </header>
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

function RequireAuth({ user, children, onLogout }) {
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <ProtectedLayout user={user} onLogout={onLogout}>{children}</ProtectedLayout>;
}

export default function App() {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.location.href = '/';
  };

  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('user');
      setUser(stored ? JSON.parse(stored) : null);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route path="/dashboard" element={<RequireAuth user={user} onLogout={logout}><Dashboard /></RequireAuth>} />
      <Route path="/scoring" element={<RequireAuth user={user} onLogout={logout}><ScoringPage /></RequireAuth>} />
      <Route path="/projects" element={<RequireAuth user={user} onLogout={logout}><ProjectsPage /></RequireAuth>} />
      <Route path="/projects/:id" element={<RequireAuth user={user} onLogout={logout}><ProjectDetail /></RequireAuth>} />
      <Route path="/legal" element={<RequireAuth user={user} onLogout={logout}><LegalPage /></RequireAuth>} />
      <Route path="/partners" element={<RequireAuth user={user} onLogout={logout}><PartnersPage /></RequireAuth>} />
      <Route path="/capital" element={<RequireAuth user={user} onLogout={logout}><CapitalPage /></RequireAuth>} />
      <Route path="/tickets" element={<RequireAuth user={user} onLogout={logout}><TicketsPage /></RequireAuth>} />
      <Route path="/deals" element={<RequireAuth user={user} onLogout={logout}><DealsPage /></RequireAuth>} />
      <Route path="/market-intel" element={<RequireAuth user={user} onLogout={logout}><MarketIntelPage /></RequireAuth>} />
      <Route path="/advisory" element={<RequireAuth user={user} onLogout={logout}><AdvisoryPage /></RequireAuth>} />
      <Route path="/activity" element={<RequireAuth user={user} onLogout={logout}><ActivityPage /></RequireAuth>} />
      <Route path="/founder" element={<RequireAuth user={user} onLogout={logout}><FounderPortal /></RequireAuth>} />
      <Route path="/partner-portal" element={<RequireAuth user={user} onLogout={logout}><PartnerPortal /></RequireAuth>} />
      <Route path="/lp-portal" element={<RequireAuth user={user} onLogout={logout}><LPPortalPage /></RequireAuth>} />
    </Routes>
  );
}
