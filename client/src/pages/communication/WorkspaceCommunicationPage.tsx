import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Hash,
  Lock,
  Plus,
  Phone,
  Video,
  X,
  Search,
  Users,
  MessageSquare,
  Check,
  CheckCheck,
  Megaphone,
  Folder,
  Pencil,
  SlidersHorizontal,
  MoreVertical,
  UserPlus,
  Archive,
  Trash2,
  FileText,
  Download,
  LayoutGrid,
  History,
  Pin
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { communicationApi, CommChannel, CommUser, CommMessage } from '../../services/communicationApi.js';
import { fetchUsers as fetchAdminUsers } from '../../services/adminApi.js';
import { useWebRTC } from '../../hooks/useWebRTC.js';
import { WebRTCCallModal } from '../../components/communication/WebRTCCallModal.js';
import { DirectMessageModal } from '../../components/communication/DirectMessageModal.js';
import { UserProfileDrawer } from '../../components/communication/UserProfileDrawer.js';
import { ChatInput } from '../../components/communication/ChatInput.js';
import { connectSocket } from '../../services/socket.js';
import { apiErrorMessage } from '../../services/api.js';

export const WorkspaceCommunicationPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [channels, setChannels] = useState<CommChannel[]>([]);
  const [users, setUsers] = useState<CommUser[]>([]);
  const [activeTab, setActiveTab] = useState<'channel' | 'dm'>('channel');
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeTargetUser, setActiveTargetUser] = useState<CommUser | null>(null);

  type HubTab = 'chat' | 'dms' | 'groups' | 'meetings' | 'notifications' | 'history';
  const [activeHubTab, setActiveHubTab] = useState<HubTab>('chat');

  const [messages, setMessages] = useState<CommMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isStartDMOpen, setIsStartDMOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [isGifOpen, setIsGifOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [replyingToMessageId, setReplyingToMessageId] = useState<string | null>(null);

  const [inviteEmails, setInviteEmails] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [userPresence, setUserPresence] = useState<'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE'>('ONLINE');
  const [activeDMs, setActiveDMs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('activeDMs') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('activeDMs', JSON.stringify(activeDMs));
  }, [activeDMs]);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Attachment / Image Preview
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);

  // Channel details & shared files
  const [channelDetails, setChannelDetails] = useState<any | null>(null);

  // Typing state
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef<boolean>(false);

  // Unread badge counters
  const [unreadChannels, setUnreadChannels] = useState<Record<string, number>>({});
  const [unreadDMs, setUnreadDMs] = useState<Record<string, number>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { callState, startCall, answerCall, rejectCall, endCall, toggleMic, toggleCamera, toggleScreenShare } = useWebRTC(user?.id);

  // Sample GIFs for GIF Picker
  const sampleGifs = [
    { name: 'Thumbs Up', url: 'https://media.giphy.com/media/26brv0thRZ3PPRIlm/giphy.gif' },
    { name: 'Celebration', url: 'https://media.giphy.com/media/l0HlHJGHe3yAMhdQY/giphy.gif' },
    { name: 'Clapping', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
    { name: 'Mind Blown', url: 'https://media.giphy.com/media/xT0xezQGU5xCDJuCPe/giphy.gif' }
  ];

  // Emojis list
  const emojiList = ['😀', '😂', '🔥', '👍', '❤️', '🎉', '🚀', '🙏', '💯', '😊', '😍', '👏'];

  // Load the communication hub's channels and users automatically on mount
  useEffect(() => {
    loadCommHub();
  }, []);

  const loadCommHub = async () => {
    try {
      await communicationApi.getHubInfo();
    } catch (err) {
      console.error('Failed to provision communication hub info:', err);
    }

    try {
      const chs = await communicationApi.listChannels();
      setChannels(chs);
      if (chs.length > 0 && !activeChannelId) {
        setActiveChannelId(chs[0].id);
        setActiveTab('channel');
      }
    } catch (err) {
      console.error('Failed to list channels:', err);
    }

    try {
      let usrs = await communicationApi.getHubUsers();
      if (!usrs || usrs.length === 0) {
        const adminRes = await fetchAdminUsers({ page: 1, limit: 100, isActive: true });
        usrs = (adminRes.items || []).map((u: any) => ({
          id: u.id,
          user_id: u.id,
          name: u.fullName,
          fullName: u.fullName,
          full_name: u.fullName,
          email: u.email,
          avatarUrl: null,
          profile_image: null,
          jobTitle: u.roleName || 'Member',
          department: u.sectorName || 'General',
          role: u.roleName || 'Member',
          status: 'ONLINE',
          online_status: 'ONLINE',
          customStatus: null,
          lastSeenAt: null,
          last_seen: null,
        }));
      }
      setUsers(usrs);
      if (usrs.length > 0 && !activeTargetUser) {
        const firstOtherUser = usrs.find((u: any) => (u.id || u.user_id) !== user?.id) || usrs[0];
        if (firstOtherUser) {
          setActiveTargetUser(firstOtherUser);
        }
      }
    } catch (err) {
      console.error('Failed to load communication users:', err);
    }
  };

  // Switch Active Channel or DM
  useEffect(() => {
    const socket = connectSocket();

    if (activeTab === 'channel' && activeChannelId) {
      loadChannelMessages(activeChannelId);
      socket.emit('join_channel', activeChannelId);
      socket.emit('comm:join_channel', activeChannelId);

      setUnreadChannels(prev => ({ ...prev, [activeChannelId]: 0 }));
      communicationApi.markAsRead(activeChannelId, undefined).catch(() => {});

      communicationApi.getChannelDetails(activeChannelId).then(setChannelDetails).catch(() => {});
    } else if (activeTab === 'dm' && activeTargetUser) {
      const targetId = activeTargetUser.id || activeTargetUser.user_id;
      if (targetId) {
        loadDMMessages(targetId);
        socket.emit('join_dm', { targetUserId: targetId });

        setUnreadDMs(prev => ({ ...prev, [targetId]: 0 }));
        communicationApi.markAsRead(undefined, targetId).catch(() => {});
      }
    }

    setTypingUsers({});
  }, [activeTab, activeChannelId, activeTargetUser]);

  const loadChannelMessages = async (chId: string) => {
    try {
      const msgs = await communicationApi.getChannelMessages(chId);
      setMessages(msgs);
      scrollToBottom();
    } catch {}
  };

  const loadDMMessages = async (targetId: string) => {
    try {
      const msgs = await communicationApi.getDMMessages(targetId);
      setMessages(msgs);
      scrollToBottom();
    } catch {}
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // Socket.IO Real-time Events Listener
  useEffect(() => {
    const socket = connectSocket();

    const handleReceiveMessage = (msg: CommMessage) => {
      const targetId = activeTargetUser?.id || activeTargetUser?.user_id;
      const isForCurrentChannel = activeTab === 'channel' && msg.channelId === activeChannelId;
      const isForCurrentDM = activeTab === 'dm' && (
        (msg.sender.id === targetId && (msg.targetUserId === user?.id || !msg.targetUserId)) ||
        (msg.sender.id === user?.id && msg.targetUserId === targetId) ||
        (msg.dmPairId && targetId && msg.dmPairId.includes(targetId))
      );

      if (isForCurrentChannel || isForCurrentDM) {
        if (isForCurrentDM) {
          const sId = msg.sender.id === user?.id ? msg.targetUserId : msg.sender.id;
          if (sId) {
            setActiveDMs(prev => prev.includes(sId) ? prev : [...prev, sId]);
          }
        }
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        scrollToBottom();

        if (msg.sender.id !== user?.id) {
          socket.emit('message_read', {
            messageId: msg.id,
            channelId: msg.channelId ?? undefined,
            targetUserId: msg.sender.id
          });
        }
      } else {
        if (msg.channelId) {
          const chId = msg.channelId;
          setUnreadChannels(prev => ({ ...prev, [chId]: (prev[chId] || 0) + 1 }));
        } else if (msg.sender.id !== user?.id) {
          const sId = msg.sender.id;
          setActiveDMs(prev => prev.includes(sId) ? prev : [...prev, sId]);
          setUnreadDMs(prev => ({ ...prev, [sId]: (prev[sId] || 0) + 1 }));
        }
      }
    };

    const handleMessageEdited = (msg: CommMessage) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, editedAt: msg.editedAt } : m));
    };

    const handleMessageDeleted = (msgId: string) => {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, deletedAt: new Date().toISOString() } : m));
    };

    const handleMessagePinned = (msg: CommMessage) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isPinned: msg.isPinned } : m));
    };

    const handlePresenceUpdated = (data: { userId: string; status: string }) => {
      setUsers(prev => prev.map(u => (u.id === data.userId || u.user_id === data.userId) ? { ...u, status: data.status as any, online_status: data.status as any } : u));
    };

    const handleMessageRead = (data: { messageId: string; readByUserId: string; status: string }) => {
      setMessages(prev => prev.map(m => {
        if (m.id === data.messageId) {
          const statuses = m.statuses || [];
          if (!statuses.some(s => s.userId === data.readByUserId && s.status === 'READ')) {
            return {
              ...m,
              statuses: [...statuses, { userId: data.readByUserId, status: 'READ' as any }]
            };
          }
        }
        return m;
      }));
    };

    const handleTypingStart = (data: { userId: string; channelId?: string; targetUserId?: string }) => {
      if (data.userId === user?.id) return;
      const targetId = activeTargetUser?.id || activeTargetUser?.user_id;

      const matchesContext = (activeTab === 'channel' && data.channelId === activeChannelId) ||
        (activeTab === 'dm' && data.userId === targetId);

      if (matchesContext) {
        const senderUser = users.find(u => (u.id || u.user_id) === data.userId);
        const name = senderUser?.fullName || senderUser?.full_name || senderUser?.name || 'Someone';
        setTypingUsers(prev => ({ ...prev, [data.userId]: name }));

        setTimeout(() => {
          setTypingUsers(prev => {
            const copy = { ...prev };
            delete copy[data.userId];
            return copy;
          });
        }, 2500);
      }
    };

    const handleTypingStop = (data: { userId: string }) => {
      setTypingUsers(prev => {
        const copy = { ...prev };
        delete copy[data.userId];
        return copy;
      });
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('comm:message_received', handleReceiveMessage);
    socket.on('new_message', handleReceiveMessage);
    socket.on('message_edited', handleMessageEdited);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('message_pinned', handleMessagePinned);
    socket.on('comm:presence_updated', handlePresenceUpdated);
    socket.on('user_online', handlePresenceUpdated);
    socket.on('user_offline', handlePresenceUpdated);
    socket.on('typing_start', handleTypingStart);
    socket.on('comm:user_typing', (data) => data.isTyping ? handleTypingStart(data) : handleTypingStop(data));
    socket.on('typing_stop', handleTypingStop);
    socket.on('message_read', handleMessageRead);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('comm:message_received', handleReceiveMessage);
      socket.off('new_message', handleReceiveMessage);
      socket.off('message_edited', handleMessageEdited);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('message_pinned', handleMessagePinned);
      socket.off('comm:presence_updated', handlePresenceUpdated);
      socket.off('user_online', handlePresenceUpdated);
      socket.off('user_offline', handlePresenceUpdated);
      socket.off('typing_start', handleTypingStart);
      socket.off('comm:user_typing');
      socket.off('typing_stop', handleTypingStop);
      socket.off('message_read', handleMessageRead);
    };
  }, [activeTab, activeChannelId, activeTargetUser, user?.id, users, activeDMs]);

  // Handle Typing
  const handleTyping = () => {
    const socket = connectSocket();

    const targetId = activeTargetUser?.id || activeTargetUser?.user_id;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing_start', {
        channelId: activeTab === 'channel' ? activeChannelId : undefined,
        targetUserId: activeTab === 'dm' ? targetId : undefined
      });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit('typing_stop', {
        channelId: activeTab === 'channel' ? activeChannelId : undefined,
        targetUserId: activeTab === 'dm' ? targetId : undefined
      });
    }, 2000);
  };

  // Some pickers (older OS dialogs, iOS HEIC files, etc.) report an empty or
  // generic MIME type for images, so fall back to the file extension rather
  // than trusting `file.type` alone — otherwise those images get classified
  // and rendered as generic document attachments instead of inline images.
  const isImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    if (file.type) return false;
    return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif)$/i.test(file.name);
  };

  // Handle File Selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (isImageFile(file)) {
        setFilePreviewUrl(URL.createObjectURL(file));
      } else {
        setFilePreviewUrl(null);
      }
    }
  };

  const handleSendMessage = async (type: 'TEXT' | 'IMAGE' | 'FILE' | 'GIF' = 'TEXT', _explicitMediaUrl?: string) => {
    if (editingMessageId) {
      if (!editingContent.trim()) return;
      try {
        const res = await communicationApi.editMessage(editingMessageId, editingContent);
        setMessages(prev => prev.map(m => m.id === res.id ? { ...m, content: res.content, editedAt: res.editedAt } : m));
        setEditingMessageId(null);
        setEditingContent('');
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Failed to edit message'));
      }
      return;
    }

    let currentInput = inputText.trim();
    if (type === 'TEXT' && !currentInput && !selectedFile) return;

    let mediaUrl: string | undefined = undefined;
    let fileName: string | undefined = undefined;
    let fileSize: number | undefined = undefined;
    let msgType: any = type;

    if (selectedFile) {
      try {
        const fileRes = await communicationApi.uploadFile(selectedFile);
        mediaUrl = fileRes.fileUrl;
        fileName = fileRes.fileName;
        fileSize = fileRes.fileSize;
        msgType = isImageFile(selectedFile) ? 'IMAGE' :
               selectedFile.type.startsWith('video/') ? 'VIDEO' :
               selectedFile.type.startsWith('audio/') ? 'AUDIO' : 'FILE';
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Failed to upload the attachment — sending without it'));
      }
    }

    // Sending is done purely via the socket.emit('send_message', ...) call
    // below. A REST communicationApi.sendMessage(...) call used to run here
    // too — its result was never used (fire-and-forget, no .then()) — which
    // created a second, separate message row and broadcast for every single
    // send, showing every message sent twice.
    setInputText('');
    setReplyingToMessageId(null);
    setSelectedFile(null);
    setFilePreviewUrl(null);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    isTypingRef.current = false;
    const socket = connectSocket();
    const targetId = activeTargetUser?.id || activeTargetUser?.user_id;

    socket.emit('typing_stop', {
      channelId: activeTab === 'channel' ? activeChannelId : undefined,
      targetUserId: activeTab === 'dm' ? targetId : undefined
    });

    try {
      if (activeTab === 'channel' && activeChannelId) {
        socket.emit('send_message', {
          channelId: activeChannelId,
          content: currentInput,
          type: msgType,
          mediaUrl,
          fileName,
          fileSize,
          replyToId: replyingToMessageId || undefined
        });
      } else if (activeTab === 'dm' && targetId) {
        socket.emit('send_message', {
          targetUserId: targetId,
          content: currentInput,
          type: msgType,
          mediaUrl,
          fileName,
          fileSize,
          replyToId: replyingToMessageId || undefined
        });
      }
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleSendGif = (gifUrl: string) => {
    setIsGifOpen(false);
    const socket = connectSocket();
    const targetId = activeTargetUser?.id || activeTargetUser?.user_id;

    if (activeTab === 'channel' && activeChannelId) {
      socket.emit('send_message', {
        channelId: activeChannelId,
        content: 'Sent a GIF',
        type: 'GIF',
        mediaUrl: gifUrl
      });
    } else if (activeTab === 'dm' && targetId) {
      socket.emit('send_message', {
        targetUserId: targetId,
        content: 'Sent a GIF',
        type: 'GIF',
        mediaUrl: gifUrl
      });
    }
    scrollToBottom();
  };

  const handleOpenStartDM = async () => {
    setIsStartDMOpen(true);
    try {
      let usrs = await communicationApi.getHubUsers();
      if (!usrs || usrs.length === 0) {
        const adminRes = await fetchAdminUsers({ page: 1, limit: 100, isActive: true });
        usrs = (adminRes.items || []).map((u: any) => ({
          id: u.id,
          user_id: u.id,
          name: u.fullName,
          fullName: u.fullName,
          full_name: u.fullName,
          email: u.email,
          avatarUrl: null,
          profile_image: null,
          jobTitle: u.roleName || 'Member',
          department: u.sectorName || 'General',
          role: u.roleName || 'Member',
          status: 'ONLINE',
          online_status: 'ONLINE',
          customStatus: null,
          lastSeenAt: null,
          last_seen: null,
        }));
      }
      setUsers(usrs);
    } catch (err) {
      console.error('Failed to load communication users:', err);
    }
  };

  const handleStartDM = (selectedUser: any) => {
    const uid = selectedUser.id || selectedUser.user_id;
    setActiveDMs(prev => prev.includes(uid) ? prev : [...prev, uid]);
    setActiveTargetUser(selectedUser);
    setActiveTab('dm');
    setIsStartDMOpen(false);
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    try {
      const ch = await communicationApi.createChannel({
        name: newChannelName,
        type: 'GENERAL',
        description: newChannelDesc,
        isPrivate
      });
      setChannels(prev => [...prev, ch]);
      setActiveChannelId(ch.id);
      setActiveTab('channel');
      setIsCreatingChannel(false);
      setNewChannelName('');
      setNewChannelDesc('');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to create channel'));
    }
  };

  const handleSendInvites = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmails.trim()) return;
    try {
      const emailsList = inviteEmails.split(',').map(s => s.trim()).filter(Boolean);
      await communicationApi.inviteUsers(emailsList, activeChannelId || undefined);
      toast.success(`Invitations sent successfully to ${emailsList.length} user(s).`);
      setIsInviteOpen(false);
      setInviteEmails('');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to send invitations'));
    }
  };

  const handleArchiveChannel = async () => {
    if (!activeChannelId) return;
    if (confirm('Are you sure you want to archive this channel?')) {
      try {
        await communicationApi.archiveChannel(activeChannelId);
        toast.success('Channel archived.');
        loadCommHub();
      } catch (err: any) {
        toast.error(apiErrorMessage(err, 'Failed to archive channel'));
      }
    }
  };

  const handleDeleteChannel = async () => {
    if (!activeChannelId) return;
    if (confirm('Are you sure you want to delete this channel?')) {
      try {
        await communicationApi.deleteChannel(activeChannelId);
        toast.success('Channel deleted.');
        loadCommHub();
      } catch (err: any) {
        toast.error(apiErrorMessage(err, 'Failed to delete channel'));
      }
    }
  };

  const handlePinMessage = async (messageId: string, isPinned: boolean) => {
    try {
      const updated = await communicationApi.pinMessage(messageId, isPinned);
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isPinned: updated.isPinned } : m));
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update pin state'));
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm('Delete this message? This cannot be undone.')) return;
    try {
      await communicationApi.deleteMessage(messageId);
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: null } : m));
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to delete message'));
    }
  };

  const handlePresenceChange = async (status: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE') => {
    setUserPresence(status);
    try {
      await communicationApi.updatePresence({ status });
      const socket = connectSocket();
      socket.emit('comm:presence_change', { status });
    } catch {}
  };

  const activeChannel = channels.find(c => c.id === activeChannelId);

  // Search Filtered Users for Left Sidebar
  const filteredUsers = users.filter(u => {
    const name = u.fullName || u.full_name || u.name || '';
    const email = u.email || '';
    const query = userSearchQuery.toLowerCase();
    return !query || name.toLowerCase().includes(query) || email.toLowerCase().includes(query);
  });

  const getChannelIcon = (type?: string) => {
    switch (type) {
      case 'ANNOUNCEMENT':
        return <Megaphone className="w-4 h-4 text-amber-500 flex-shrink-0" />;
      case 'PROJECT':
        return <Folder className="w-4 h-4 text-indigo-500 flex-shrink-0" />;
      case 'TEAM':
        return <Users className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
      default:
        return <Hash className="w-4 h-4 text-slate-400 flex-shrink-0" />;
    }
  };

  // `activeTargetUser` is a snapshot captured at the moment the DM was opened
  // (handleStartDM) — it never gets touched again, so its `status` field goes
  // stale the instant that person's presence changes. `users`, on the other
  // hand, IS kept live by handlePresenceUpdated. Re-resolving against `users`
  // here (falling back to the snapshot for the synthetic/no-user case) is
  // what keeps the header and profile drawer's presence in sync with the
  // sidebar instead of freezing at whatever it was when the DM was opened.
  const liveTargetUser = activeTargetUser
    ? users.find((u) => (u.id || u.user_id) === (activeTargetUser.id || activeTargetUser.user_id)) ?? activeTargetUser
    : null;

  const activeRecipientName = activeTab === 'channel'
    ? `# ${activeChannel?.name || 'general'}`
    : (liveTargetUser?.fullName || liveTargetUser?.full_name || liveTargetUser?.name || 'User');

  const activeRecipientAvatar = liveTargetUser?.avatarUrl || liveTargetUser?.profile_image;
  const activeRecipientStatus = liveTargetUser?.status || liveTargetUser?.online_status || 'ONLINE';

  const PRIMARY_TABS = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'dms', label: 'Direct Messages', icon: Users },
    { id: 'groups', label: 'Groups', icon: Hash },
    { id: 'history', label: 'Call History', icon: History }
  ] as const;

  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 antialiased shadow-sm">
      {/* Icon rail */}
      <nav className="flex w-16 flex-col items-center border-r border-slate-200 bg-white py-4 flex-shrink-0 z-10">
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm">
          AH
        </div>
        <ul className="flex flex-1 min-h-0 flex-col items-center gap-2 w-full px-3 overflow-y-auto no-scrollbar">
          {PRIMARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeHubTab === tab.id;
            return (
              <li key={tab.id} className="group relative w-full flex justify-center">
                <button
                  title={tab.label}
                  onClick={() => setActiveHubTab(tab.id as HubTab)}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                    isActive
                      ? "bg-blue-50 text-blue-600 shadow-sm"
                      : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                  }`}
                >
                  <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
                </button>
                {/* Tooltip */}
                <div className="absolute left-14 top-2 bg-slate-800 text-white text-xs font-medium px-2 py-1 rounded-md opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                  {tab.label}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto px-3 w-full flex flex-col items-center gap-4">
          <div className="relative group cursor-pointer" onClick={() => handlePresenceChange(userPresence === 'ONLINE' ? 'AWAY' : 'ONLINE')} title="Toggle presence">
            <img
              src={user?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.fullName || 'User')}&background=1d4ed8&color=fff`}
              alt="Profile"
              className="w-10 h-10 rounded-full border border-slate-200 object-cover"
            />
            <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-white ${
              userPresence === 'ONLINE' ? 'bg-emerald-500' :
              userPresence === 'AWAY' ? 'bg-amber-500' :
              userPresence === 'BUSY' ? 'bg-red-500' : 'bg-slate-400'
            }`} />
          </div>
        </div>
      </nav>

      {/* Sidebar */}
      <aside className="flex w-72 flex-col border-r border-slate-200 bg-white flex-shrink-0 z-10">
        <div className="flex items-center justify-between px-5 pt-6 pb-4">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">{PRIMARY_TABS.find(t => t.id === activeHubTab)?.label || 'Messages'}</h1>
          {(activeHubTab === 'chat' || activeHubTab === 'dms') && (
            <button onClick={handleOpenStartDM} title="New message" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors">
              <Plus size={20} strokeWidth={2} />
            </button>
          )}
          {activeHubTab === 'groups' && (
            <button onClick={() => setIsCreatingChannel(true)} title="New Group" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors">
              <Plus size={20} strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
            <Search size={16} className="text-slate-400" />
            <input
              placeholder="Search channels or people"
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
            <button className="shrink-0 text-slate-400 hover:text-slate-600"><SlidersHorizontal size={16} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 no-scrollbar pb-6 space-y-6">
          {(activeHubTab === 'chat' || activeHubTab === 'groups') && (
          <div>
            <div className="mb-2 px-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Channels
              </span>
              <button onClick={() => setIsCreatingChannel(true)} className="text-slate-300 hover:text-slate-500 transition-colors">
                <Plus size={14} strokeWidth={2.5} />
              </button>
            </div>
            <ul className="space-y-0.5">
              {channels.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => { setActiveChannelId(c.id); setActiveTab('channel'); }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                      activeTab === 'channel' && activeChannelId === c.id
                        ? "bg-blue-50/80 text-blue-700 font-semibold"
                        : "text-slate-600 hover:bg-slate-50 font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {c.isPrivate ? <Lock size={16} className="text-slate-400 flex-shrink-0" /> : getChannelIcon(c.type)}
                      <span className="truncate">{c.name}</span>
                    </div>
                    {unreadChannels[c.id] > 0 && (
                      <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[1.25rem] text-center shadow-xs flex-shrink-0">
                        {unreadChannels[c.id]}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          )}

          {(activeHubTab === 'chat' || activeHubTab === 'dms') && (
          <div>
            <div className="mb-2 px-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                People · {filteredUsers.length}
              </span>
            </div>
            <ul className="space-y-0.5">
              {filteredUsers.map((p) => {
                const uid = p.id || p.user_id;
                const name = p.fullName || p.full_name || p.name || 'User';
                const avatar = p.avatarUrl || p.profile_image;
                const status = p.status || p.online_status || 'ONLINE';
                const role = p.role || p.jobTitle || 'Member';
                const isActive = activeTab === 'dm' && activeTargetUser?.id === uid;

                return (
                <li key={uid}>
                  <button
                    onClick={() => handleStartDM(p)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                      isActive ? "bg-blue-50/80" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-sm font-medium border border-slate-200">
                      {avatar ? <img src={avatar} className="w-full h-full rounded-full object-cover" /> : name.charAt(0)}
                      <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                        status === 'ONLINE' ? 'bg-emerald-500' :
                        status === 'AWAY' ? 'bg-amber-500' :
                        status === 'BUSY' ? 'bg-red-500' : 'bg-slate-300'
                      }`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${isActive ? 'font-semibold text-blue-900' : 'font-medium text-slate-700'}`}>
                        {name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">{role}</span>
                    </span>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-[10px] ${status === 'ONLINE' ? 'text-emerald-500 font-medium' : 'text-slate-400'}`}>
                        {status === 'ONLINE' ? 'Online' : 'Offline'}
                      </span>
                      {uid && unreadDMs[uid] > 0 && (
                        <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0 rounded-full shadow-xs">
                          {unreadDMs[uid]}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )})}
            </ul>
          </div>
          )}

          {/* MOCK TABS */}
          {!(activeHubTab === 'chat' || activeHubTab === 'dms' || activeHubTab === 'groups') && (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
                <LayoutGrid className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">{PRIMARY_TABS.find(t => t.id === activeHubTab)?.label}</h3>
              <p className="text-xs text-slate-500">This module is currently in development.</p>
            </div>
          )}
        </div>

        <div className="px-4 py-4 border-t border-slate-100">
          <button onClick={() => setIsInviteOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-blue-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm">
            <UserPlus size={16} />
            Invite people
          </button>
        </div>
      </aside>

      {/* Conversation */}
      <main className="flex flex-1 flex-col bg-white min-w-0 min-h-0 relative">
        {(activeHubTab === 'chat' || activeHubTab === 'dms' || activeHubTab === 'groups') ? (
        <>
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-3 cursor-pointer min-w-0 group" onClick={() => setIsInfoOpen(true)}>
            {activeTab === 'channel' ? (
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-slate-50 text-slate-600 border border-slate-200 group-hover:border-slate-300 transition-colors">
                <Hash size={20} />
              </div>
            ) : (
              <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-600 text-sm font-bold border border-slate-200 group-hover:border-slate-300 transition-colors">
                {activeRecipientAvatar ? <img src={activeRecipientAvatar} className="w-full h-full rounded-full object-cover" /> : activeRecipientName.charAt(0)}
                <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white ${
                  activeRecipientStatus === 'ONLINE' ? 'bg-emerald-500' :
                  activeRecipientStatus === 'AWAY' ? 'bg-amber-500' :
                  activeRecipientStatus === 'BUSY' ? 'bg-red-500' : 'bg-slate-300'
                }`} />
              </span>
            )}
            <div className="min-w-0 flex flex-col justify-center">
              <h2 className="text-base font-bold text-slate-900 truncate leading-tight group-hover:text-blue-600 transition-colors">{activeRecipientName}</h2>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                {activeTab === 'channel' ? activeChannel?.description || 'Group conversation' : (
                  <><span className={activeRecipientStatus === 'ONLINE' ? 'text-emerald-500 font-medium' : ''}>{activeRecipientStatus === 'ONLINE' ? 'Online' : 'Offline'}</span> · {activeTargetUser?.department || activeTargetUser?.jobTitle || 'General'}</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 relative">
            <button
              title="Voice call"
              onClick={() => { const targetId = activeTargetUser?.id || activeTargetUser?.user_id; if (targetId) startCall(targetId, activeRecipientName, 'AUDIO'); }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <Phone size={18} strokeWidth={2} />
            </button>
            <button
              title="Video call"
              onClick={() => { const targetId = activeTargetUser?.id || activeTargetUser?.user_id; if (targetId) startCall(targetId, activeRecipientName, 'VIDEO'); }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <Video size={18} strokeWidth={2} />
            </button>
            <button
              title="More options"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <MoreVertical size={18} strokeWidth={2} />
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-11 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1.5 space-y-0.5">
                {activeTab === 'channel' && (
                  <>
                    <button onClick={handleArchiveChannel} className="w-full px-3 py-2 text-left text-xs font-semibold text-amber-600 hover:bg-slate-50 flex items-center gap-2">
                      <Archive size={15} /> Archive Channel
                    </button>
                    <button onClick={handleDeleteChannel} className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-slate-50 flex items-center gap-2">
                      <Trash2 size={15} /> Delete Channel
                    </button>
                  </>
                )}
                <button onClick={() => setIsMenuOpen(false)} className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                  <X size={15} /> Close Menu
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 min-h-0 space-y-6 overflow-y-auto overflow-x-hidden px-8 py-6 no-scrollbar relative bg-white">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 pb-20">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
                <MessageSquare className="w-8 h-8" />
              </div>
              <div className="text-center">
                <h4 className="text-sm font-bold text-slate-900">Start the conversation</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-[250px] leading-relaxed">Send a message or share a file to get started with {activeRecipientName}.</p>
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const mine = m.sender.id === user?.id;
              // Date divider logic could go here based on previous message date
              const prevMsg = i > 0 ? messages[i-1] : null;
              const showDateDivider = !prevMsg || new Date(m.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

              return (
                <React.Fragment key={m.id}>
                  {showDateDivider && (
                    <div className="flex items-center justify-center my-6">
                      <span className="px-3 py-1 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider rounded-full border border-slate-100">
                        {new Date(m.createdAt).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  )}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"} group relative mb-4`}
                       onMouseEnter={() => setHoveredMessageId(m.id)}
                       onMouseLeave={() => setHoveredMessageId(null)}>
                    <div className={`flex max-w-[70%] gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                      {!mine && (
                        <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-600 text-xs font-bold border border-slate-200 mt-5">
                          {m.sender.avatarUrl ? <img src={m.sender.avatarUrl} className="w-full h-full rounded-full object-cover" /> : m.sender.fullName.charAt(0)}
                        </span>
                      )}

                      <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                        <span className="mb-1.5 text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                          {mine ? "You" : m.sender.fullName}
                          <span className="w-0.5 h-0.5 rounded-full bg-slate-300" />
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {m.editedAt && <span className="opacity-70 italic">(edited)</span>}
                          {m.isPinned && <Pin size={10} className="text-amber-500" />}
                        </span>

                        {editingMessageId === m.id ? (
                          <div className="flex flex-col gap-2 min-w-[250px] bg-white p-3 rounded-xl border border-blue-200 shadow-sm shadow-blue-50">
                            <input
                              type="text"
                              className="w-full bg-slate-50 border border-slate-200 text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg px-3 py-2 text-sm outline-none transition-all"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSendMessage();
                                if (e.key === 'Escape') { setEditingMessageId(null); setEditingContent(''); }
                              }}
                              autoFocus
                            />
                            <div className="flex justify-end gap-3 text-xs">
                              <button onClick={() => { setEditingMessageId(null); setEditingContent(''); }} className="font-medium text-slate-500 hover:text-slate-700">Cancel</button>
                              <button onClick={() => handleSendMessage()} className="font-bold text-blue-600 hover:text-blue-700">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className={`relative ${mine ? "items-end" : "items-start"} flex flex-col`}>
                            {m.type === "TEXT" && (
                              <div className={`px-4 py-3 text-[14px] leading-relaxed shadow-sm max-w-full break-words ${m.isPinned ? 'ring-2 ring-amber-400 ring-offset-1' : ''} ${
                                  mine
                                    ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm"
                                    : "bg-white border border-slate-200 text-slate-700 rounded-2xl rounded-tl-sm"
                                }`}
                              >
                                {m.deletedAt ? <span className="italic opacity-70">Message deleted</span> : m.content}
                              </div>
                            )}

                            {m.type === 'GIF' && m.mediaUrl && (
                              <img src={m.mediaUrl} alt="GIF" className={`max-w-xs w-full h-auto min-h-[100px] min-w-[100px] bg-slate-100 rounded-2xl ${mine ? 'rounded-tr-sm' : 'rounded-tl-sm'} border border-slate-200 shadow-sm text-center text-xs text-slate-400 flex items-center justify-center`} />
                            )}

                            {m.type === "IMAGE" && (
                              <div className={`overflow-hidden rounded-2xl ${mine ? 'rounded-tr-sm' : 'rounded-tl-sm'} border border-slate-200 bg-white shadow-sm max-w-sm w-full`}>
                                {m.mediaUrl && <img src={m.mediaUrl} alt="Image attachment" className="max-w-sm w-full h-auto min-h-[150px] bg-slate-50 object-cover border-b border-slate-100 text-center text-sm text-slate-400 flex flex-col items-center justify-center p-4" />}
                                {m.content && (
                                  <div className={`px-4 py-3 text-[14px] max-w-full break-words ${mine ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>
                                    {m.content}
                                  </div>
                                )}
                              </div>
                            )}

                            {(m.type === "FILE" || (m.mediaUrl && m.type !== 'IMAGE' && m.type !== 'GIF')) && (
                              <div className={`flex items-center gap-4 rounded-2xl ${mine ? 'rounded-tr-sm' : 'rounded-tl-sm'} px-4 py-3.5 shadow-sm ${
                                  mine ? "bg-blue-600 text-white" : "border border-slate-200 bg-white"
                                }`}
                              >
                                <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${mine ? "bg-blue-500/50" : "bg-slate-100"}`}>
                                  <FileText size={16} className={mine ? "text-white" : "text-slate-500"} />
                                </div>
                                <div className="min-w-0 max-w-[200px]">
                                  <p className="truncate text-sm font-semibold">{m.fileName || 'Attachment'}</p>
                                  {m.fileSize && (
                                    <p className={`text-[11px] mt-0.5 ${mine ? "text-blue-100" : "text-slate-500"}`}>
                                      {(m.fileSize / 1024).toFixed(1)} KB
                                    </p>
                                  )}
                                </div>
                                <a href={m.mediaUrl || undefined} target="_blank" rel="noopener noreferrer" className={`p-2 rounded-lg transition-colors ${mine ? "hover:bg-blue-500/50 text-white" : "hover:bg-slate-100 text-slate-500"}`}>
                                  <Download size={16} />
                                </a>
                              </div>
                            )}

                            {/* Read Receipt */}
                            {mine && (() => {
                              const isRead = m.statuses?.some(s => s.status === 'READ');
                              return (
                                <span className={`absolute -right-5 bottom-1 flex items-center gap-1 text-xs`} title={isRead ? "Read" : "Sent"}>
                                  {isRead ? <CheckCheck size={14} className="text-blue-500" /> : <Check size={14} className="text-slate-300" />}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Hover Actions Menu */}
                      <div className={`absolute top-0 ${mine ? '-left-32' : '-right-32'} bg-white border border-slate-200 rounded-xl shadow-sm flex items-center p-1 transition-all duration-200 ${hoveredMessageId === m.id ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
                        <button onClick={() => setReplyingToMessageId(m.id)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors" title="Reply">
                          <MessageSquare size={15} />
                        </button>
                        {mine && m.type === 'TEXT' && (
                          <button onClick={() => { setEditingMessageId(m.id); setEditingContent(m.content || ''); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors" title="Edit">
                            <Pencil size={15} />
                          </button>
                        )}
                        <button onClick={() => handlePinMessage(m.id, !m.isPinned)} className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-slate-50 rounded-lg transition-colors" title={m.isPinned ? "Unpin" : "Pin"}>
                          <Pin size={15} />
                        </button>
                        {mine && (
                          <button onClick={() => handleDeleteMessage(m.id)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-50 rounded-lg transition-colors" title="Delete">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}

          {Object.values(typingUsers).length > 0 && (
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-2 absolute bottom-4 left-8 bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-100 z-10">
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              {Object.values(typingUsers).join(', ')} is typing
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Replying Indicator Bar */}
        {replyingToMessageId && (
          <div className="px-6 py-2 bg-blue-50/50 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Replying to message...</span>
            </div>
            <button onClick={() => setReplyingToMessageId(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-200/50 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input Container */}
        <ChatInput
          inputText={inputText}
          setInputText={setInputText}
          handleSendMessage={handleSendMessage}
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          filePreviewUrl={filePreviewUrl}
          setFilePreviewUrl={setFilePreviewUrl}
          handleFileSelect={handleFileSelect}
          isEmojiOpen={isEmojiOpen}
          setIsEmojiOpen={setIsEmojiOpen}
          isGifOpen={isGifOpen}
          setIsGifOpen={setIsGifOpen}
          emojiList={emojiList}
          sampleGifs={sampleGifs}
          handleSendGif={handleSendGif}
          handleTyping={handleTyping}
        />
        </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white rounded-3xl m-8 border border-dashed border-slate-200">
            <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-slate-100">
              <LayoutGrid className="w-8 h-8 text-slate-300" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{PRIMARY_TABS.find(t => t.id === activeHubTab)?.label}</h2>
            <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
              This module is currently in development. Soon you will be able to manage {PRIMARY_TABS.find(t => t.id === activeHubTab)?.label?.toLowerCase()} directly from this centralized hub.
            </p>
          </div>
        )}
      </main>

      {/* User Profile Side Drawer */}
      <UserProfileDrawer
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        user={liveTargetUser || {
          id: user?.id || '1',
          fullName: user?.fullName || 'Hari',
          email: user?.email || 'hari@agnohire.com',
          avatarUrl: null,
          role: 'Admin',
          department: 'Human Resources',
          status: 'ONLINE'
        }}
        members={users.map(u => ({ id: u.id || u.user_id || '', fullName: u.fullName || u.full_name || u.name || '', email: u.email, avatarUrl: u.avatarUrl || u.profile_image, role: u.role || 'Member' }))}
        sharedFiles={channelDetails?.sharedFiles || []}
        onStartDM={(targetUser) => {
          setActiveTargetUser(targetUser);
          setActiveTab('dm');
        }}
        onStartCall={(targetId, targetName, callType) => {
          startCall(targetId, targetName, callType);
        }}
      />

      {/* Direct Message User Selection Modal */}
      <DirectMessageModal
        isOpen={isStartDMOpen}
        onClose={() => setIsStartDMOpen(false)}
        users={users}
        currentUserId={user?.id}
        onSelectUser={(u) => {
          handleStartDM(u);
        }}
      />

      {/* Create Group Channel Modal */}
      {isCreatingChannel && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Create Group Channel</h3>
              <button onClick={() => setIsCreatingChannel(false)} className="text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 p-1.5 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Channel Name</label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="e.g. project-alpha"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(Optional)</span></label>
                <input
                  type="text"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  placeholder="What's this channel about?"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="isPrivate"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-50 border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="isPrivate" className="text-sm text-slate-700 cursor-pointer font-medium select-none">Make Private Group</label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-2">
                <button type="button" onClick={() => setIsCreatingChannel(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-sm transition-colors">
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Users Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Invite People</h3>
              <button onClick={() => setIsInviteOpen(false)} className="text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 p-1.5 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSendInvites} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Addresses</label>
                <textarea
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                  placeholder="collin@agnohire.com, sarah@agnohire.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 h-28 transition-all resize-none"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-2">Separate multiple emails with commas.</p>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-2">
                <button type="button" onClick={() => setIsInviteOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-sm transition-colors">
                  Send Invites
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WebRTC Call Modal Overlay */}
      <WebRTCCallModal
        callState={callState}
        onAnswer={answerCall}
        onReject={rejectCall}
        onEnd={endCall}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
      />
    </div>
  );
};
