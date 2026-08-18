import React, { useState } from 'react';
import {
  X,
  Mail,
  Calendar,
  MessageSquare,
  Phone,
  Video,
  Download,
  Pin
} from 'lucide-react';
import { CommUser } from '../../services/communicationApi.js';

interface UserProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: CommUser | null;
  channelName?: string;
  members?: Array<{ id: string; fullName: string; email: string; avatarUrl?: string | null; role?: string }>;
  sharedFiles?: Array<{ id: string; fileName?: string | null; mediaUrl?: string | null; fileSize?: number | null; createdAt: string; sender?: { fullName: string } }>;
  onStartDM?: (user: CommUser) => void;
  onStartCall?: (userId: string, userName: string, type: 'AUDIO' | 'VIDEO') => void;
}

export const UserProfileDrawer: React.FC<UserProfileDrawerProps> = ({
  isOpen,
  onClose,
  user,
  members = [],
  sharedFiles = [],
  onStartDM,
  onStartCall
}) => {
  const [activeTab, setActiveTab] = useState<'about' | 'members' | 'files'>('about');

  if (!isOpen || !user) return null;

  const userName = user.fullName || user.full_name || user.name || 'User';
  const avatar = user.avatarUrl || user.profile_image;
  const status = user.status || user.online_status || 'ONLINE';
  const role = user.role || 'Admin';
  const dept = user.department || user.jobTitle || 'Human Resources';
  const email = user.email || `${userName.toLowerCase().replace(/\s+/g, '')}@agnohire.com`;

  // Files for Files tab
  const defaultFiles = [
    { id: '1', fileName: 'Project_Alpha_Update.pdf', fileSize: 2.4 * 1024 * 1024, type: 'pdf', date: 'Today' },
    { id: '2', fileName: 'Roadmap_Q4.xlsx', fileSize: 1.8 * 1024 * 1024, type: 'xlsx', date: '3 days ago' },
    { id: '3', fileName: 'Hiring_Plan.docx', fileSize: 856 * 1024, type: 'docx', date: '1 week ago' }
  ];

  const displayFiles = sharedFiles.length > 0 ? sharedFiles : defaultFiles;

  // Sample activities
  const activities = [
    { id: '1', title: 'Joined #general', time: '2 hours ago', iconColor: 'bg-teal-100 text-teal-600' },
    { id: '2', title: 'Shared Project_Alpha_Update.pdf', time: 'Today, 10:31 AM', iconColor: 'bg-purple-100 text-purple-600' },
    { id: '3', title: 'Started a call', time: 'Yesterday, 04:30 PM', iconColor: 'bg-emerald-100 text-emerald-600' }
  ];

  // Sample pinned message
  const pinnedMessage = {
    senderName: userName,
    senderAvatar: avatar,
    time: 'Yesterday',
    text: 'Team, new hiring workflow is now live!'
  };

  const getFileIcon = (fileName?: string | null) => {
    const name = fileName?.toLowerCase() || '';
    if (name.endsWith('.pdf')) {
      return (
        <div className="w-10 h-10 rounded-[10px] bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 font-bold text-xs">
          📄 PDF
        </div>
      );
    }
    if (name.endsWith('.xlsx') || name.endsWith('.csv')) {
      return (
        <div className="w-10 h-10 rounded-[10px] bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xs">
          📊 XLS
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-[10px] bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
        📝 DOC
      </div>
    );
  };

  return (
    <div className="w-[380px] bg-[#F8FAFC] border-l border-[#E7ECF3] flex flex-col flex-shrink-0 h-full shadow-2xl relative z-30 animate-in slide-in-from-right duration-200">
      {/* Top Header Navigation Tabs with Dark Floating Close Button */}
      <div className="bg-white border-b border-[#E7ECF3] px-5 pt-4 pb-0 flex items-center justify-between relative shadow-[0_2px_8px_rgba(16,24,40,0.03)]">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-6 text-sm font-semibold">
          <button
            onClick={() => setActiveTab('about')}
            className={`pb-3 transition-all relative ${
              activeTab === 'about'
                ? 'text-blue-600 font-bold border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            About
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`pb-3 transition-all relative ${
              activeTab === 'members'
                ? 'text-blue-600 font-bold border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Members ({members.length || 3})
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`pb-3 transition-all relative ${
              activeTab === 'files'
                ? 'text-blue-600 font-bold border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Files ({displayFiles.length})
          </button>
        </div>

        {/* Floating Dark Close Button */}
        <button
          onClick={onClose}
          className="absolute -left-4 top-3 w-8 h-8 rounded-full bg-[#2D3748] hover:bg-slate-900 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 z-40"
          title="Close Profile"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Body Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {activeTab === 'about' && (
          <>
            {/* User Profile Overview Card */}
            <div className="bg-white rounded-[16px] border border-[#E7ECF3] p-5 shadow-[0_2px_8px_rgba(16,24,40,0.04)] text-center flex flex-col items-center space-y-3">
              {/* Profile Avatar with Overlapping Status Badge */}
              <div className="relative">
                {avatar ? (
                  <img
                    src={avatar}
                    alt={userName}
                    className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-[#E8F1FF] border-2 border-blue-200 flex items-center justify-center font-bold text-blue-700 text-2xl shadow-sm">
                    {userName.charAt(0)}
                  </div>
                )}
                <span
                  className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white ${
                    status === 'ONLINE' ? 'bg-[#10B981]' :
                    status === 'AWAY' ? 'bg-[#F59E0B]' :
                    status === 'BUSY' ? 'bg-[#EF4444]' : 'bg-[#94A3B8]'
                  }`}
                />
              </div>

              {/* Name & Presence Status Pill — must reflect the same `status`
                  the avatar badge above uses, not a hardcoded "Online". */}
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">{userName}</h3>
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <span className={`w-2 h-2 rounded-full ${
                    status === 'ONLINE' ? 'bg-[#10B981]' :
                    status === 'AWAY' ? 'bg-[#F59E0B]' :
                    status === 'BUSY' ? 'bg-[#EF4444]' : 'bg-[#94A3B8]'
                  }`} />
                  <span className={`text-xs font-semibold ${
                    status === 'ONLINE' ? 'text-[#10B981]' :
                    status === 'AWAY' ? 'text-[#F59E0B]' :
                    status === 'BUSY' ? 'text-[#EF4444]' : 'text-[#94A3B8]'
                  }`}>
                    {status === 'ONLINE' ? 'Online' : status === 'AWAY' ? 'Away' : status === 'BUSY' ? 'Busy' : 'Offline'}
                  </span>
                </div>
              </div>

              {/* Role & Department Badges */}
              <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-[#F1F5F9] text-slate-700 font-semibold text-xs border border-slate-200">
                  {role}
                </span>
                <span className="px-3 py-1 rounded-full bg-[#F1F5F9] text-slate-700 font-semibold text-xs border border-slate-200">
                  {dept}
                </span>
              </div>

              {/* Email & Joined Date */}
              <div className="w-full pt-2 space-y-2 text-xs text-slate-600 text-left border-t border-[#E7ECF3]">
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <span className="truncate">{email}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>Joined Aug 2026</span>
                </div>
              </div>

              {/* Quick Action Buttons */}
              <div className="grid grid-cols-3 gap-2 w-full pt-2">
                <button
                  onClick={() => { onStartDM?.(user); onClose(); }}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-[12px] bg-[#E8F1FF] hover:bg-blue-100 text-blue-700 text-xs font-semibold border border-blue-200 transition-all shadow-xs"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Message
                </button>
                <button
                  onClick={() => onStartCall?.(user.id || user.user_id || '', userName, 'AUDIO')}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-[12px] bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-[#E7ECF3] transition-all shadow-xs"
                >
                  <Phone className="w-3.5 h-3.5" /> Call
                </button>
                <button
                  onClick={() => onStartCall?.(user.id || user.user_id || '', userName, 'VIDEO')}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-[12px] bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-[#E7ECF3] transition-all shadow-xs"
                >
                  <Video className="w-3.5 h-3.5" /> Video
                </button>
              </div>
            </div>

            {/* Recent Activity Section */}
            <div className="bg-white rounded-[16px] border border-[#E7ECF3] p-4 shadow-[0_2px_8px_rgba(16,24,40,0.04)] space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Recent Activity</h4>
              <div className="space-y-3">
                {activities.map((act) => (
                  <div key={act.id} className="flex items-start gap-3 text-xs">
                    <div className={`w-7 h-7 rounded-full ${act.iconColor} flex items-center justify-center font-bold flex-shrink-0 mt-0.5`}>
                      •
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{act.title}</p>
                      <p className="text-[10px] text-slate-400">{act.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pinned Messages Section */}
            <div className="bg-white rounded-[16px] border border-[#E7ECF3] p-4 shadow-[0_2px_8px_rgba(16,24,40,0.04)] space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Pinned Messages</h4>
              <div className="p-3 rounded-[12px] bg-[#F8FAFC] border border-[#E7ECF3] relative space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {pinnedMessage.senderAvatar ? (
                      <img src={pinnedMessage.senderAvatar} alt={pinnedMessage.senderName} className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center font-bold text-[10px] text-slate-700">
                        {pinnedMessage.senderName.charAt(0)}
                      </div>
                    )}
                    <span className="text-xs font-bold text-slate-900">{pinnedMessage.senderName}</span>
                    <span className="text-[10px] text-slate-400">{pinnedMessage.time}</span>
                  </div>
                  <Pin className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <p className="text-xs text-slate-700 pl-8">{pinnedMessage.text}</p>
              </div>
            </div>
          </>
        )}

        {activeTab === 'members' && (
          <div className="bg-white rounded-[16px] border border-[#E7ECF3] p-4 shadow-[0_2px_8px_rgba(16,24,40,0.04)] space-y-3">
            <h4 className="text-sm font-bold text-slate-900 mb-2">Hub Members</h4>
            <div className="space-y-2">
              {members.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No other members listed.</p>
              ) : (
                members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-2 rounded-[12px] hover:bg-[#F2F7FF]">
                    <div className="flex items-center gap-3">
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt={m.fullName} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700">
                          {m.fullName.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-slate-900">{m.fullName}</p>
                        <p className="text-[10px] text-slate-400">{m.email}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {m.role || 'Member'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <div className="bg-white rounded-[16px] border border-[#E7ECF3] p-4 shadow-[0_2px_8px_rgba(16,24,40,0.04)] space-y-3">
            <h4 className="text-sm font-bold text-slate-900 mb-2">All Shared Files</h4>
            <div className="space-y-2">
              {displayFiles.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between p-2.5 rounded-[12px] border border-[#E7ECF3] hover:bg-[#F2F7FF]">
                  <div className="flex items-center gap-3 min-w-0">
                    {getFileIcon(f.fileName)}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{f.fileName || 'Document'}</p>
                      <p className="text-[10px] text-slate-400">{f.date || 'Today'}</p>
                    </div>
                  </div>
                  <a href={f.mediaUrl || '#'} target="_blank" rel="noopener noreferrer" className="p-1.5 text-slate-400 hover:text-blue-600">
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
