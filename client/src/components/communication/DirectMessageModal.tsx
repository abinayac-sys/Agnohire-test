import React, { useState } from 'react';
import { Search, X, User as UserIcon, MessageSquare, Clock, Shield } from 'lucide-react';
import { CommUser } from '../../services/communicationApi.js';

interface DirectMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: CommUser[];
  currentUserId?: string;
  onSelectUser: (user: CommUser) => void;
}

export const DirectMessageModal: React.FC<DirectMessageModalProps> = ({
  isOpen,
  onClose,
  users,
  currentUserId,
  onSelectUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  // Filter out current user and match search query
  const hubUsers = users.filter(u => (u.id || u.user_id) !== currentUserId);

  const filteredUsers = hubUsers.filter(u => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const name = u.fullName || u.full_name || '';
    const email = u.email || '';
    const dept = u.department || '';
    const job = u.jobTitle || '';
    const role = u.role || '';

    return (
      name.toLowerCase().includes(query) ||
      email.toLowerCase().includes(query) ||
      dept.toLowerCase().includes(query) ||
      job.toLowerCase().includes(query) ||
      role.toLowerCase().includes(query)
    );
  });

  // Sort users: 1. Online status, 2. Alphabetically by name
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      ONLINE: 1,
      AWAY: 2,
      BUSY: 3,
      INVISIBLE: 4,
      OFFLINE: 5,
    };

    const statusA = a.status || a.online_status || 'OFFLINE';
    const statusB = b.status || b.online_status || 'OFFLINE';

    const scoreA = statusOrder[statusA] || 5;
    const scoreB = statusOrder[statusB] || 5;

    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }

    const nameA = a.fullName || a.full_name || '';
    const nameB = b.fullName || b.full_name || '';

    return nameA.localeCompare(nameB);
  });

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'ONLINE':
        return <span className="w-3 h-3 rounded-full bg-[#10B981] border-2 border-white" title="Online" />;
      case 'AWAY':
        return <span className="w-3 h-3 rounded-full bg-[#F59E0B] border-2 border-white" title="Away" />;
      case 'BUSY':
        return <span className="w-3 h-3 rounded-full bg-[#EF4444] border-2 border-white" title="Busy" />;
      default:
        return <span className="w-3 h-3 rounded-full bg-[#94A3B8] border-2 border-white" title="Offline" />;
    }
  };

  const formatLastSeen = (lastSeen?: string | null, status?: string) => {
    if (status === 'ONLINE') return 'Active now';
    if (!lastSeen) return 'Offline';
    const date = new Date(lastSeen);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Active just now';
    if (diffMins < 60) return `Active ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Active ${diffHours}h ago`;
    return `Last seen ${date.toLocaleDateString()}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#E7ECF3] rounded-[16px] w-full max-w-lg shadow-[0_4px_12px_rgba(16,24,40,0.06)] overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in duration-150">
        {/* Modal Header */}
        <div className="p-5 border-b border-[#E7ECF3] flex items-center justify-between bg-white">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              New Direct Message
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select a team member in your organization to start chatting
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-700 hover:bg-[#F2F7FF] transition-all duration-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-[#E7ECF3] bg-[#FAFBFD]">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, department, or role..."
              className="w-full bg-white border border-[#E7ECF3] rounded-[14px] pl-10 pr-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 shadow-[0_2px_8px_rgba(16,24,40,0.04)] transition-all duration-200"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 divide-y divide-[#E7ECF3]/40">
          {sortedUsers.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <UserIcon className="w-10 h-10 mx-auto mb-2 opacity-30 text-blue-600" />
              <p className="text-sm font-medium text-slate-700">No users found</p>
              <p className="text-xs text-slate-500 mt-1">
                {searchQuery ? 'Try adjusting your search query' : 'Only active members of your organization appear here'}
              </p>
            </div>
          ) : (
            sortedUsers.map((u) => {
              const name = u.fullName || u.full_name || 'User';
              const avatar = u.avatarUrl || u.profile_image;
              const status = u.status || u.online_status || 'OFFLINE';
              const lastSeen = u.lastSeenAt || u.last_seen;

              return (
                <button
                  key={u.id || u.user_id}
                  onClick={() => {
                    onSelectUser(u);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-[12px] hover:bg-[#F2F7FF] text-left transition-all duration-200 group border border-transparent hover:border-[#E7ECF3]"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* User Profile Photo / Avatar */}
                    <div className="relative flex-shrink-0">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={name}
                          className="w-11 h-11 rounded-full object-cover border border-[#E7ECF3]"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-[#E8F1FF] border border-blue-200 flex items-center justify-center font-bold text-blue-700 text-sm">
                          {name.charAt(0)}
                        </div>
                      )}
                      <div className="absolute bottom-0 right-0">
                        {getStatusBadge(status)}
                      </div>
                    </div>

                    {/* User Information */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 truncate">
                          {name}
                        </h4>
                        {u.role && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#FAFBFD] text-slate-600 border border-[#E7ECF3] flex items-center gap-1">
                            <Shield className="w-2.5 h-2.5 text-blue-600" />
                            {u.role}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="truncate">{u.jobTitle || u.email}</span>
                        {u.department && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500 truncate">{u.department}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Presence & Last Active */}
                  <div className="flex flex-col items-end flex-shrink-0 pl-2 text-right">
                    <span className={`text-[11px] font-medium ${
                      status === 'ONLINE' ? 'text-[#10B981]' :
                      status === 'AWAY' ? 'text-[#F59E0B]' :
                      status === 'BUSY' ? 'text-[#EF4444]' : 'text-[#94A3B8]'
                    }`}>
                      {status === 'ONLINE' ? '🟢 Online' :
                       status === 'AWAY' ? '🟡 Away' :
                       status === 'BUSY' ? '🔴 Busy' : '⚫ Offline'}
                    </span>
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {formatLastSeen(lastSeen, status)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[#FAFBFD] border-t border-[#E7ECF3] text-center">
          <p className="text-[11px] text-slate-500">
            Showing active members from the Users module for your organization
          </p>
        </div>
      </div>
    </div>
  );
};
