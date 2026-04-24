'use client';

import { useEffect, useState } from 'react';
import { fetchPageJson } from '../lib/atlas-rpc';

type User = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: Array<{ id: string; name: string }>;
  createdAt: string;
};

type AuditLog = {
  id: string;
  actorEmail: string;
  action: string;
  entityId: string;
  createdAt: string;
};

type RoleOption = {
  id: string;
  name: string;
};

function formatRoleName(role: string) {
  const normalized = String(role || '').trim().toUpperCase();
  if (normalized.includes('SUPER')) return 'Super Admin';
  if (normalized === 'ADMIN' || normalized.includes('IT_OPS') || normalized.includes('IT OPS')) return 'Admin';
  if (['USER', 'WFH', 'WFO', 'WFH_WFO'].includes(normalized)) return 'User';
  return normalized.replaceAll('_', ' ');
}

export function AdminPortal() {
  const [activeTab, setActiveTab] = useState<'users' | 'audit' | 'itstaff'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState('');
  const [itSigners, setItSigners] = useState<Array<{ id: string; email: string; fullName: string | null; isActive: boolean }>>([]);
  const [itSearchQuery, setItSearchQuery] = useState('');
  const [itSearchResults, setItSearchResults] = useState<Array<{ id: string; email: string; fullName: string | null }>>([]);
  const [itSignerMsg, setItSignerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUsers = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: searchQuery,
        page: String(page),
        pageSize: '25'
      });
      const result = await fetchPageJson<{ items: User[]; meta: { total: number } }>(`/api/app/admin/users?${params.toString()}`, {
        method: 'POST'
      });
      if (result?.items) setUsers(result.items);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '50'
      });
      const result = await fetchPageJson<{ items: AuditLog[] }>(`/api/app/admin/audit-logs?${params.toString()}`);
      if (result?.items) setAuditLogs(result.items);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load audit logs' });
    } finally {
      setLoading(false);
    }
  };

  const loadItSigners = async () => {
    try {
      const result = await fetchPageJson<{ ok: boolean; items: Array<{ id: string; email: string; fullName: string | null; isActive: boolean }> }>('/api/app/admin/it-signers');
      if (result?.items) setItSigners(result.items);
    } catch {
      setItSignerMsg({ type: 'error', text: 'Failed to load IT signers' });
    }
  };

  const searchItUsers = async (q: string) => {
    setItSearchQuery(q);
    if (!q.trim()) { setItSearchResults([]); return; }
    try {
      const params = new URLSearchParams({ search: q, page: '1', pageSize: '8' });
      const result = await fetchPageJson<{ items: Array<{ id: string; email: string; fullName: string | null }> }>(`/api/app/admin/users?${params.toString()}`, { method: 'POST' });
      setItSearchResults(result?.items ?? []);
    } catch {
      setItSearchResults([]);
    }
  };

  const addItSigner = async (userId: string, displayName: string) => {
    try {
      await fetchPageJson('/api/app/admin/it-signers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      setItSearchQuery('');
      setItSearchResults([]);
      setItSignerMsg({ type: 'success', text: `"${displayName}" assigned IT_OPS role.` });
      await loadItSigners();
    } catch {
      setItSignerMsg({ type: 'error', text: 'Failed to assign role' });
    }
  };

  const deleteItSigner = async (userId: string, displayName: string) => {
    if (!confirm(`Remove IT_OPS role from "${displayName}"?`)) return;
    try {
      await fetchPageJson(`/api/app/admin/it-signers/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      setItSignerMsg({ type: 'success', text: `"${displayName}" removed from IT signers.` });
      await loadItSigners();
    } catch {
      setItSignerMsg({ type: 'error', text: 'Failed to remove role' });
    }
  };

  const loadRoles = async () => {
    try {
      const result = await fetchPageJson<{ items: RoleOption[] }>('/api/app/admin/roles');
      setRoles(Array.isArray(result?.items) ? result.items : []);
    } catch {
      setRoles([]);
    }
  };

  const toggleUserStatus = async (userId: string, newStatus: boolean) => {
    if (!confirm(`${newStatus ? 'Activate' : 'Deactivate'} this user?`)) return;

    try {
      await fetchPageJson(`/api/app/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isActive: newStatus })
      });
      setMessage({ type: 'success', text: `User ${newStatus ? 'activated' : 'deactivated'}` });
      await loadUsers();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update user status' });
    }
  };

  const assignRole = async () => {
    if (!selectedUser || !selectedRole) return;

    try {
      await fetchPageJson(`/api/app/admin/users/${encodeURIComponent(selectedUser.id)}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ roleId: selectedRole })
      });
      setMessage({ type: 'success', text: 'Role assigned successfully' });
      setShowRoleModal(false);
      await loadUsers();
      await loadAuditLogs();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to assign role' });
    }
  };

  const removeRole = async (userId: string, roleId: string) => {
    if (!confirm('Remove this role?')) return;

    try {
      await fetchPageJson(`/api/app/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, {
        method: 'DELETE'
      });
      setMessage({ type: 'success', text: 'Role removed successfully' });
      await loadUsers();
      await loadAuditLogs();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to remove role' });
    }
  };

  useEffect(() => {
    void loadUsers();
    void loadRoles();
    void loadItSigners();
  }, []);

  return (
    <div className="admin-portal-container">
      {message && (
        <div className={`ho-form-message ${message.type === 'error' ? 'is-error' : 'is-success'}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'users' ? 'is-active' : ''}`}
          onClick={() => {
            setActiveTab('users');
            loadUsers();
          }}
        >
          Users Management
        </button>
        <button
          className={`admin-tab ${activeTab === 'audit' ? 'is-active' : ''}`}
          onClick={() => {
            setActiveTab('audit');
            loadAuditLogs();
          }}
        >
          Audit Logs
        </button>
        <button
          className={`admin-tab ${activeTab === 'itstaff' ? 'is-active' : ''}`}
          onClick={() => {
            setActiveTab('itstaff');
            void loadItSigners();
          }}
        >
          IT Staff
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="admin-section">
          <div className="admin-search-bar">
            <input
              type="text"
              className="admin-search-input"
              placeholder="Search by email or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              className="admin-search-btn"
              onClick={() => loadUsers()}
              disabled={loading}
            >
              Search
            </button>
          </div>

          {loading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <div className="admin-table-scroll">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Full Name</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.fullName || '-'}</td>
                    <td>
                      <div className="admin-role-list">
                        {user.roles.map((role) => (
                          <div key={role.id} className="admin-role-badge">
                            <span>{formatRoleName(role.name)}</span>
                            <button
                              className="admin-role-remove"
                              onClick={() => removeRole(user.id, role.id)}
                              title="Remove role"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          className="admin-role-add-btn"
                          onClick={() => {
                            setSelectedUser(user);
                            setShowRoleModal(true);
                          }}
                        >
                          + Add
                        </button>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`admin-status-badge ${user.isActive ? 'is-active' : 'is-inactive'}`}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="admin-action-btn"
                        onClick={() => toggleUserStatus(user.id, !user.isActive)}
                      >
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Audit Logs Tab */}
      {activeTab === 'audit' && (
        <div className="admin-section">
          {loading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <div className="admin-table-scroll">
            <table className="admin-audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity ID</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.actorEmail}</td>
                    <td>{log.action}</td>
                    <td>{log.entityId || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
      {/* IT Staff Tab */}
      {activeTab === 'itstaff' && (
        <div className="admin-section">
          {itSignerMsg && (
            <div className={`ho-form-message ${itSignerMsg.type === 'error' ? 'is-error' : 'is-success'}`}>
              {itSignerMsg.text}
            </div>
          )}
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.75rem' }}>
            Users with the <strong>IT_OPS</strong> role appear as signers in the Handover (BAST) form.
            Assign or remove the role below to manage who can sign.
          </p>
          <div className="admin-table-scroll">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {itSigners.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: '#9ca3af', padding: '1rem' }}>No IT_OPS users assigned yet.</td></tr>
                ) : itSigners.map((signer) => (
                  <tr key={signer.id}>
                    <td>{signer.fullName || '-'}</td>
                    <td>{signer.email}</td>
                    <td>
                      <span style={{ color: signer.isActive ? '#16a34a' : '#dc2626', fontWeight: 600, fontSize: '0.8rem' }}>
                        {signer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="admin-action-btn danger"
                        onClick={() => void deleteItSigner(signer.id, signer.fullName || signer.email)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '1.25rem' }}>
            <div className="admin-search-bar">
              <input
                type="text"
                className="admin-search-input"
                placeholder="Search user by name or email to assign IT_OPS role..."
                value={itSearchQuery}
                onChange={(e) => void searchItUsers(e.target.value)}
              />
            </div>
            {itSearchResults.length > 0 && (
              <div className="admin-table-scroll" style={{ marginTop: '0.5rem' }}>
                <table className="admin-users-table">
                  <tbody>
                    {itSearchResults.map((u) => (
                      <tr key={u.id}>
                        <td>{u.fullName || '-'}</td>
                        <td>{u.email}</td>
                        <td>
                          <button
                            className="admin-search-btn"
                            onClick={() => void addItSigner(u.id, u.fullName || u.email)}
                          >
                            Assign IT_OPS
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showRoleModal && selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setShowRoleModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Assign Role to {selectedUser.email}</h3>
            <select
              className="admin-role-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              <option value="">Select a role...</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {formatRoleName(role.name)}
                </option>
              ))}
            </select>
            <div className="admin-modal-actions">
              <button
                className="admin-modal-btn primary"
                onClick={assignRole}
                disabled={!selectedRole}
              >
                Assign
              </button>
              <button className="admin-modal-btn cancel" onClick={() => setShowRoleModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
