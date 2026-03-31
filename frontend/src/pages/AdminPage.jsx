import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Shield, Users, UserCheck, UserX, LogIn, ChevronDown } from 'lucide-react';

const ROLE_BADGES = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
  lp: 'bg-amber-100 text-amber-700',
};

export default function AdminPage({ onImpersonate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await api.adminListUsers();
      setUsers(data);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonate = async (userId) => {
    try {
      const res = await api.adminImpersonate(userId);
      if (onImpersonate) {
        onImpersonate(res.token, res.user);
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const handleToggleActive = async (userId) => {
    try {
      await api.adminToggleActive(userId);
      loadUsers();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await api.adminUpdateRole(userId, newRole);
      loadUsers();
    } catch (e) {
      alert(e.message);
    }
  };

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter);
  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    founder: users.filter(u => u.role === 'founder').length,
    partner: users.filter(u => u.role === 'partner').length,
    lp: users.filter(u => u.role === 'lp').length,
  };

  if (loading) return <div className="text-gray-600 text-center py-20">Loading users...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Shield size={24} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
      </div>
      <p className="text-gray-600 mb-6">Manage users, roles, and portal access</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {Object.entries(counts).map(([role, count]) => (
          <button
            key={role}
            onClick={() => setFilter(role)}
            className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              filter === role
                ? 'bg-violet-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300'
            }`}
          >
            <div className="text-lg font-bold">{count}</div>
            <div className="capitalize">{role === 'all' ? 'All Users' : role === 'lp' ? 'LP Investors' : `${role}s`}</div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <Users size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900">User Management</h3>
          <span className="text-xs text-gray-500 ml-auto">{filtered.length} users</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Name</th>
                  <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Email</th>
                  <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                  <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                  <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Verified</th>
                  <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Joined</th>
                  <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-900 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="relative inline-block">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          className={`appearance-none text-xs font-medium px-3 py-1 pr-6 rounded-full cursor-pointer border-0 ${ROLE_BADGES[u.role] || 'bg-gray-100 text-gray-700'}`}
                        >
                          <option value="admin">Admin</option>
                          <option value="founder">Founder</option>
                          <option value="partner">Partner</option>
                          <option value="lp">LP</option>
                        </select>
                        <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.email_verified ? (
                        <UserCheck size={16} className="text-green-500 mx-auto" />
                      ) : (
                        <UserX size={16} className="text-gray-400 mx-auto" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleImpersonate(u.id)}
                          className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                          title="Login as this user"
                        >
                          <LogIn size={12} /> View As
                        </button>
                        <button
                          onClick={() => handleToggleActive(u.id)}
                          className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                            u.is_active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-green-50 text-green-600 hover:bg-green-100'
                          }`}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
