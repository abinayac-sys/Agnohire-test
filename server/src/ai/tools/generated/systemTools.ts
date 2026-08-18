import { ToolRegistry } from '../../toolRegistry/index.js';
import { signAccessToken } from '../../../utils/tokenHelper.js';
import { PERMISSIONS } from '@agnohire/shared';

ToolRegistry.register({
  name: 'bootstrap',
  category: 'system',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/system/bootstrap',
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
    let url = `http://localhost:${port}/api/system/bootstrap`;

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
  name: 'listThemes',
  category: 'system',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/system/themes',
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
    let url = `http://localhost:${port}/api/system/themes`;

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
  name: 'brandingImage',
  category: 'system',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/system/branding/:key',
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
    let url = `http://localhost:${port}/api/system/branding/:key`;

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
  name: 'maintenanceActive',
  category: 'system',
  publicTool: true,
  description: 'Auto-generated tool for GET /api/system/maintenance-active',
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
    let url = `http://localhost:${port}/api/system/maintenance-active`;

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
  name: 'listConfig',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_CONFIG_MANAGE],
  description: 'Auto-generated tool for GET /api/system/config',
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
    let url = `http://localhost:${port}/api/system/config`;

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
  name: 'updateConfig',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_CONFIG_MANAGE],
  description: 'Auto-generated tool for PUT /api/system/config/:key',
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
    let url = `http://localhost:${port}/api/system/config/:key`;

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
      method: 'PUT',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('PUT') ? JSON.stringify(bodyPayload) : undefined
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
  name: 'connectionInfo',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_CONFIG_MANAGE],
  description: 'Auto-generated tool for GET /api/system/connection-info',
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
    let url = `http://localhost:${port}/api/system/connection-info`;

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
  name: 'testEmail',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_CONFIG_MANAGE],
  description: 'Auto-generated tool for POST /api/system/email/test',
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
    let url = `http://localhost:${port}/api/system/email/test`;

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
  name: 'testCalendar',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_CONFIG_MANAGE],
  description: 'Auto-generated tool for POST /api/system/calendar/test',
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
    let url = `http://localhost:${port}/api/system/calendar/test`;

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
  name: 'updateTheme',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_THEME_MANAGE],
  description: 'Auto-generated tool for PUT /api/system/themes/:name',
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
    let url = `http://localhost:${port}/api/system/themes/:name`;

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
      method: 'PUT',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('PUT') ? JSON.stringify(bodyPayload) : undefined
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
  name: 'setActiveTheme',
  category: 'system',
  permissions: [PERMISSIONS.SYSTEM_THEME_MANAGE],
  description: 'Auto-generated tool for PUT /api/system/active-theme',
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
    let url = `http://localhost:${port}/api/system/active-theme`;

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
      method: 'PUT',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('PUT') ? JSON.stringify(bodyPayload) : undefined
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

    