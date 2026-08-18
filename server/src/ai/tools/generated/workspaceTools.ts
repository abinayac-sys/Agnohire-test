import { ToolRegistry } from '../../toolRegistry/index.js';
import { signAccessToken } from '../../../utils/tokenHelper.js';

ToolRegistry.register({
  name: 'listWorkspaces',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/workspaces',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'GET',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('GET') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'createWorkspace',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for POST /api/workspaces',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('POST') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'getWorkspace',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/workspaces/:id',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'GET',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('GET') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'updateWorkspace',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for PATCH /api/workspaces/:id',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('PATCH') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'deleteWorkspace',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for DELETE /api/workspaces/:id',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'DELETE',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('DELETE') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'listWorkspaceMembers',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/workspaces/:id/members',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id/members`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'GET',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('GET') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'addWorkspaceMember',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for POST /api/workspaces/:id/members',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id/members`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('POST') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'updateWorkspaceMemberRole',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for PATCH /api/workspaces/:id/members/:userId',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id/members/:userId`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('PATCH') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});


ToolRegistry.register({
  name: 'removeWorkspaceMember',
  category: 'workspace',
  publicTool: true,
  description: 'Auto-generated tool for DELETE /api/workspaces/:id/members/:userId',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'object', description: 'Request payload' },
      query: { type: 'object', description: 'Query parameters' },
      params: { type: 'object', description: 'Path parameters like ID' }
    }
  },
  execute: async (args, ctx, _req) => {
    const port = process.env.PORT || 4000;
    let url = `http://localhost:${port}/api/workspaces/:id/members/:userId`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (args.query) {
      const qs = new URLSearchParams(args.query as Record<string, string>).toString();
      if (qs) url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Generate an ephemeral token for the tool execution.
    // IMPORTANT: Use the caller's actual role — NOT SUPERADMIN.
    // Using SUPERADMIN sets bypass=true in the tenant context, which
    // causes requireTenantId() to throw on all write operations.
    if (ctx?.userId) {
      const token = signAccessToken({ sub: ctx.userId, email: '', role: (ctx.role ?? 'HR_MANAGER') as any, sectorId: ctx.sectorId ?? null, tenantId: ctx.tenantId ?? null, permissions: (ctx.permissions ?? []) as any }, 5);
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: 'DELETE',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('DELETE') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text;
    }
  }
});

    