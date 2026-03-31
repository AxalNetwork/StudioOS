import React, { useState, useEffect } from 'react';
import { Code, Copy, Check, Globe, Shield, Key, Server } from 'lucide-react';

const API_BASE = window.location.origin + '/api';

function CopyBlock({ code, language = 'javascript' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
        title="Copy to clipboard"
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function ApiBridgePage() {
  const [activeTab, setActiveTab] = useState('bridge');

  const bridgeSnippet = `// ====================================
// StudioOS Frontend Bridge v1.0
// Paste this into your Jekyll <head> or a shared JS file
// ====================================

const STUDIOOS_API = "${API_BASE}";

class StudioOSBridge {
  constructor(apiBase) {
    this.apiBase = apiBase;
    this.token = localStorage.getItem("studioos_token");
  }

  async _request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
      ...options.headers,
    };

    const res = await fetch(this.apiBase + path, { ...options, headers });

    if (res.status === 401) {
      this.token = null;
      localStorage.removeItem("studioos_token");
      localStorage.removeItem("studioos_user");
      window.location.href = "/login.html";
      throw new Error("Session expired");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Request failed");
    }

    return res.json();
  }

  // ---- Authentication ----

  async login(email, totpCode) {
    const data = await this._request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, totp_code: totpCode }),
    });
    this.token = data.token;
    localStorage.setItem("studioos_token", data.token);
    localStorage.setItem("studioos_user", JSON.stringify(data.user));
    return data;
  }

  logout() {
    this.token = null;
    localStorage.removeItem("studioos_token");
    localStorage.removeItem("studioos_user");
  }

  getUser() {
    const stored = localStorage.getItem("studioos_user");
    return stored ? JSON.parse(stored) : null;
  }

  isLoggedIn() {
    return !!this.token;
  }

  // ---- Private Data Endpoints ----

  async getProfile() {
    return this._request("/private-data/profile");
  }

  async getPrivateSignals() {
    return this._request("/private-data/market/private-signals");
  }

  async getPortfolioMetrics() {
    return this._request("/private-data/portfolio/metrics");
  }

  async getFounderData(userId) {
    return this._request("/private-data/founder/" + userId);
  }

  // ---- Admin Impersonation ----

  async viewAs(userId) {
    const data = await this._request("/admin/impersonate/" + userId, {
      method: "POST",
    });
    localStorage.setItem("studioos_real_token", this.token);
    localStorage.setItem("studioos_real_user",
      localStorage.getItem("studioos_user")
    );
    this.token = data.token;
    localStorage.setItem("studioos_token", data.token);
    localStorage.setItem("studioos_user", JSON.stringify(data.user));
    return data;
  }

  exitImpersonation() {
    const realToken = localStorage.getItem("studioos_real_token");
    const realUser = localStorage.getItem("studioos_real_user");
    if (realToken) {
      this.token = realToken;
      localStorage.setItem("studioos_token", realToken);
      localStorage.setItem("studioos_user", realUser);
      localStorage.removeItem("studioos_real_token");
      localStorage.removeItem("studioos_real_user");
    }
  }
}

// Initialize the bridge
const studioos = new StudioOSBridge(STUDIOOS_API);`;

  const usageSnippet = `<!-- In your Jekyll page (e.g., dashboard.html) -->
<script src="/assets/js/studioos-bridge.js"></script>

<script>
  // Check authentication
  if (!studioos.isLoggedIn()) {
    window.location.href = "/login.html";
  }

  // Load user profile
  studioos.getProfile().then(profile => {
    document.getElementById("user-name").textContent = profile.name;
    document.getElementById("user-role").textContent = profile.role;
  });

  // Load role-specific data
  studioos.getPortfolioMetrics().then(data => {
    if (data.role === "founder") {
      // Render founder metrics (burn multiple, LTV/CAC)
      renderFounderDashboard(data.projects);
    } else if (data.role === "partner") {
      // Render partner deal flow + LP investor data + portfolio
      renderPartnerDashboard(data.deals, data.fund_metrics, data.capital_calls, data.portfolio);
    }
  });

  // Load private market signals (admin/partner only)
  studioos.getPrivateSignals().then(signals => {
    document.getElementById("conviction").textContent =
      signals.global_conviction;
    renderSignalsTable(signals.signals);
  }).catch(err => {
    // User doesn't have permission — hide this section
    document.getElementById("signals-section").style.display = "none";
  });
</script>`;

  const loginSnippet = `<!-- login.html -->
<form id="login-form">
  <input type="email" id="email" placeholder="Email" required />
  <input type="text" id="totp" placeholder="6-digit code" required />
  <button type="submit">Sign In</button>
</form>

<script src="/assets/js/studioos-bridge.js"></script>
<script>
  document.getElementById("login-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const email = document.getElementById("email").value;
        const totp = document.getElementById("totp").value;
        await studioos.login(email, totp);
        // Redirect based on role
        const user = studioos.getUser();
        const redirects = {
          admin: "/admin.html",
          founder: "/founder.html",
          partner: "/partner.html",
        };
        window.location.href = redirects[user.role] || "/dashboard.html";
      } catch (err) {
        alert("Login failed: " + err.message);
      }
    });
</script>`;

  const configSnippet = `# _config.yml (Jekyll configuration)
# Add this to your Jekyll _config.yml

studioos:
  api_url: "${API_BASE}"
  app_name: "Axal Ventures Portal"

# Then reference in templates:
# {{ site.studioos.api_url }}`;

  const tabs = [
    { id: 'bridge', label: 'Bridge Script', icon: Code },
    { id: 'usage', label: 'Usage Examples', icon: Globe },
    { id: 'login', label: 'Login Page', icon: Key },
    { id: 'config', label: 'Jekyll Config', icon: Server },
  ];

  const ENDPOINTS = [
    { method: 'POST', path: '/api/auth/login', auth: false, roles: 'All', desc: 'Authenticate and get JWT' },
    { method: 'GET', path: '/api/private-data/profile', auth: true, roles: 'All', desc: 'Current user profile + linked founder/partner data' },
    { method: 'GET', path: '/api/private-data/market/private-signals', auth: true, roles: 'Admin, Partner', desc: 'Private market signals with conviction status' },
    { method: 'GET', path: '/api/private-data/portfolio/metrics', auth: true, roles: 'All (role-filtered)', desc: 'Portfolio metrics filtered by user role' },
    { method: 'GET', path: '/api/private-data/founder/{user_id}', auth: true, roles: 'Admin, Self', desc: 'Founder-specific project & metrics data' },
    { method: 'POST', path: '/api/admin/impersonate/{user_id}', auth: true, roles: 'Admin only', desc: '"View As" — get JWT scoped to another user' },
    { method: 'GET', path: '/api/admin/users', auth: true, roles: 'Admin only', desc: 'List all users with roles and status' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Code size={24} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900">API Bridge & Jekyll Integration</h1>
      </div>
      <p className="text-gray-600 mb-6">Connect your external Jekyll portal to StudioOS private data</p>

      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-violet-600" />
          <span className="text-sm font-semibold text-violet-800">Clean Room Architecture</span>
        </div>
        <p className="text-sm text-violet-700">
          Private data (PII, financials, auth) stays in the Replit PostgreSQL database.
          Your Jekyll site fetches only what the user's JWT permits. No secrets touch GitHub.
        </p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-violet-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'bridge' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">StudioOS Bridge Script</h3>
            <p className="text-xs text-gray-600 mb-3">
              Save this as <code className="bg-gray-100 px-1 py-0.5 rounded text-violet-700">assets/js/studioos-bridge.js</code> in your Jekyll repo.
              It handles authentication, session management, and all private data fetching.
            </p>
            <CopyBlock code={bridgeSnippet} />
          </div>
        </div>
      )}

      {activeTab === 'usage' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Role-Based Data Loading</h3>
            <p className="text-xs text-gray-600 mb-3">
              Each page calls <code className="bg-gray-100 px-1 py-0.5 rounded text-violet-700">getPortfolioMetrics()</code> — the API automatically returns data scoped to the user's role.
            </p>
            <CopyBlock code={usageSnippet} />
          </div>
        </div>
      )}

      {activeTab === 'login' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Jekyll Login Page</h3>
            <p className="text-xs text-gray-600 mb-3">
              Create a <code className="bg-gray-100 px-1 py-0.5 rounded text-violet-700">login.html</code> in your Jekyll site.
              The bridge handles TOTP authentication and redirects by role.
            </p>
            <CopyBlock code={loginSnippet} />
          </div>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Jekyll Configuration</h3>
            <p className="text-xs text-gray-600 mb-3">
              Add the API URL to your Jekyll <code className="bg-gray-100 px-1 py-0.5 rounded text-violet-700">_config.yml</code> so templates can reference it.
            </p>
            <CopyBlock code={configSnippet} />
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Private Data API Reference</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Method</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Endpoint</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Auth</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Roles</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Description</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((ep, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-mono font-bold ${
                      ep.method === 'GET' ? 'text-green-600' : 'text-blue-600'
                    }`}>{ep.method}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{ep.path}</td>
                  <td className="px-4 py-2.5 text-center">
                    {ep.auth ? (
                      <Key size={14} className="text-amber-500 mx-auto" />
                    ) : (
                      <span className="text-xs text-gray-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{ep.roles}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{ep.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-amber-800 mb-2">CORS Configuration</h3>
        <p className="text-xs text-amber-700">
          Set the <code className="bg-amber-100 px-1 py-0.5 rounded">JEKYLL_ORIGIN</code> environment
          variable to your Jekyll domain (e.g., <code className="bg-amber-100 px-1 py-0.5 rounded">https://your-studio.github.io</code>)
          to restrict API access. Multiple origins can be comma-separated.
          Without it, CORS defaults to allow all origins (development mode).
        </p>
      </div>
    </div>
  );
}
