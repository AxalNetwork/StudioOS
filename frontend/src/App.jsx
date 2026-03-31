import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Target, FileText, Users, DollarSign,
  Ticket, Menu, X, Zap, Handshake, Rocket, UserCircle,
  Globe, Brain, Activity, LogOut, Shield,
  ChevronDown, Eye, ArrowLeft, Code
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
import AdminPage from './pages/AdminPage';
import ApiBridgePage from './pages/ApiBridgePage';
import LandingPage from './pages/LandingPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';

const ALL_NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'founder', 'partner'] },
  { to: '/admin', icon: Shield, label: 'Admin Console', roles: ['admin'] },
  { to: '/scoring', icon: Target, label: 'Scoring Engine', roles: ['admin', 'partner'] },
  { to: '/projects', icon: Zap, label: 'Projects', roles: ['admin', 'founder', 'partner'] },
  { to: '/deals', icon: Handshake, label: 'Deal Flow', roles: ['admin', 'partner'] },
  { to: '/market-intel', icon: Globe, label: 'Market Intelligence', roles: ['admin', 'partner'] },
  { to: '/advisory', icon: Brain, label: 'AI Advisory Suite', roles: ['admin', 'founder'] },
  { to: '/legal', icon: FileText, label: 'Legal & Compliance', roles: ['admin', 'founder'] },
  { to: '/partners', icon: Users, label: 'Partners', roles: ['admin', 'partner'] },
  { to: '/capital', icon: DollarSign, label: 'Capital & Investment', roles: ['admin', 'partner'] },
  { to: '/tickets', icon: Ticket, label: 'Support', roles: ['admin', 'founder', 'partner'] },
  { to: '/activity', icon: Activity, label: 'Activity Log', roles: ['admin'] },
  { to: '/api-bridge', icon: Code, label: 'API Bridge', roles: ['admin'] },
  { to: '/founder', icon: Rocket, label: 'Founder Portal', roles: ['admin', 'founder'], divider: true },
  { to: '/partner-portal', icon: UserCircle, label: 'Partner / Investor Portal', roles: ['admin', 'partner'] },
];

const ROLE_LABELS = {
  admin: 'Admin',
  founder: 'Founder',
  partner: 'Partner / Investor',
};

const ROLE_COLORS = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
};

const ROLE_DEFAULT_PATH = {
  admin: '/dashboard',
  founder: '/founder',
  partner: '/partner-portal',
};

const ViewModeContext = createContext(null);
export const useViewMode = () => useContext(ViewModeContext);

function getNavItems(role) {
  return ALL_NAV_ITEMS.filter(item => item.roles.includes(role));
}

function PortalSwitcher({ viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, impersonatedUser }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-gradient-to-r from-violet-700 to-indigo-700 text-white px-4 py-2 flex items-center gap-3 text-sm relative z-[60]">
      <Shield size={14} className="opacity-80" />
      <span className="font-medium opacity-90">Admin Mode</span>

      {isImpersonating ? (
        <div className="ml-2 flex items-center gap-2 bg-amber-500/20 px-3 py-1.5 rounded-lg">
          <Eye size={13} />
          <span>Impersonating: {impersonatedUser?.name} ({ROLE_LABELS[impersonatedUser?.role]})</span>
        </div>
      ) : (
        <div className="ml-2 relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Eye size={13} />
            <span>View as: {ROLE_LABELS[viewMode]}</span>
            <ChevronDown size={13} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] z-50">
                {Object.entries(ROLE_LABELS).map(([role, label]) => (
                  <button
                    key={role}
                    onClick={() => { onViewModeChange(role); setOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                      viewMode === role ? 'text-violet-700 font-medium bg-violet-50' : 'text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isImpersonating && (
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs opacity-75">
            Logged in as {realUser?.name}
          </span>
          <button
            onClick={onExitImpersonation}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium"
          >
            <ArrowLeft size={12} />
            Exit Impersonation
          </button>
        </div>
      )}
    </div>
  );
}

function ProtectedLayout({ children, user, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAdmin = (realUser || user)?.role === 'admin';
  const activeRole = isImpersonating ? user?.role : (isAdmin ? viewMode : user?.role);
  const navItems = getNavItems(activeRole || 'founder');

  return (
    <ViewModeContext.Provider value={{ viewMode: activeRole, isAdmin, isImpersonating }}>
      <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
        {isAdmin && (
          <PortalSwitcher
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            isImpersonating={isImpersonating}
            onExitImpersonation={onExitImpersonation}
            realUser={realUser}
            impersonatedUser={isImpersonating ? user : null}
          />
        )}

        <div className="flex flex-1 overflow-hidden">
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
  return (
    <ProtectedLayout
      user={user}
      onLogout={onLogout}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      isImpersonating={isImpersonating}
      onExitImpersonation={onExitImpersonation}
      realUser={realUser}
      onImpersonate={onImpersonate}
    >
      {children}
    </ProtectedLayout>
  );
}

function RoleGuard({ user, allowedRoles, children, viewMode, realUser, isImpersonating }) {
  const effectiveRole = isImpersonating ? user?.role : ((realUser || user)?.role === 'admin' ? viewMode : user?.role);
  if (!allowedRoles.includes(effectiveRole)) {
    const defaultPath = ROLE_DEFAULT_PATH[effectiveRole] || '/dashboard';
    return <Navigate to={defaultPath} replace />;
  }
  return children;
}

export default function App() {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const [realUser, setRealUser] = useState(() => {
    const stored = localStorage.getItem('realUser');
    return stored ? JSON.parse(stored) : null;
  });

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('viewMode') || 'admin';
  });

  const isImpersonating = !!realUser;
  const navigate = useNavigate();

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('viewMode', mode);
    const defaultPath = ROLE_DEFAULT_PATH[mode] || '/dashboard';
    navigate(defaultPath);
  };

  const handleImpersonate = (token, impersonatedUser) => {
    const currentUser = JSON.parse(localStorage.getItem('user'));
    const currentToken = localStorage.getItem('token');
    localStorage.setItem('realUser', JSON.stringify(currentUser));
    localStorage.setItem('realToken', currentToken);
    setRealUser(currentUser);

    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(impersonatedUser));
    setUser(impersonatedUser);
    setViewMode(impersonatedUser.role);
    localStorage.setItem('viewMode', impersonatedUser.role);
    navigate(ROLE_DEFAULT_PATH[impersonatedUser.role] || '/dashboard');
  };

  const exitImpersonation = () => {
    const origToken = localStorage.getItem('realToken');
    const origUser = JSON.parse(localStorage.getItem('realUser'));
    localStorage.setItem('token', origToken);
    localStorage.setItem('user', JSON.stringify(origUser));
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    setUser(origUser);
    setRealUser(null);
    setViewMode('admin');
    localStorage.setItem('viewMode', 'admin');
    navigate('/admin');
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    localStorage.removeItem('viewMode');
    setUser(null);
    setRealUser(null);
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

  const authProps = {
    user, onLogout: logout, viewMode, onViewModeChange: handleViewModeChange,
    isImpersonating, onExitImpersonation: exitImpersonation, realUser, onImpersonate: handleImpersonate,
  };

  const guard = (roles, component) => (
    <RequireAuth {...authProps}>
      <RoleGuard user={user} allowedRoles={roles} viewMode={viewMode} realUser={realUser} isImpersonating={isImpersonating}>
        {component}
      </RoleGuard>
    </RequireAuth>
  );

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={ROLE_DEFAULT_PATH[user.role] || '/dashboard'} replace /> : <LandingPage />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route path="/dashboard" element={guard(['admin', 'founder', 'partner'], <Dashboard />)} />
      <Route path="/admin" element={guard(['admin'], <AdminPage onImpersonate={handleImpersonate} />)} />
      <Route path="/scoring" element={guard(['admin', 'partner'], <ScoringPage />)} />
      <Route path="/projects" element={guard(['admin', 'founder', 'partner'], <ProjectsPage />)} />
      <Route path="/projects/:id" element={guard(['admin', 'founder', 'partner'], <ProjectDetail />)} />
      <Route path="/legal" element={guard(['admin', 'founder'], <LegalPage />)} />
      <Route path="/partners" element={guard(['admin', 'partner'], <PartnersPage />)} />
      <Route path="/capital" element={guard(['admin', 'partner'], <CapitalPage />)} />
      <Route path="/tickets" element={guard(['admin', 'founder', 'partner'], <TicketsPage />)} />
      <Route path="/deals" element={guard(['admin', 'partner'], <DealsPage />)} />
      <Route path="/market-intel" element={guard(['admin', 'partner'], <MarketIntelPage />)} />
      <Route path="/advisory" element={guard(['admin', 'founder'], <AdvisoryPage />)} />
      <Route path="/activity" element={guard(['admin'], <ActivityPage />)} />
      <Route path="/api-bridge" element={guard(['admin'], <ApiBridgePage />)} />
      <Route path="/founder" element={guard(['admin', 'founder'], <FounderPortal />)} />
      <Route path="/partner-portal" element={guard(['admin', 'partner'], <PartnerPortal />)} />
    </Routes>
  );
}
