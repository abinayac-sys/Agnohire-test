import { ToolRegistry } from '../../toolRegistry/index.js';
import { signAccessToken } from '../../../utils/tokenHelper.js';
import { PERMISSIONS } from '@agnohire/shared';

ToolRegistry.register({
  name: 'getJobStats',
  category: 'job',
  permissions: [PERMISSIONS.JOB_VIEW],
  description: 'Auto-generated tool for GET /api/jobs/stats',
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
    let url = `http://localhost:${port}/api/jobs/stats`;

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
  name: 'listApprovers',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for GET /api/jobs/approvers',
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
    let url = `http://localhost:${port}/api/jobs/approvers`;

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
  name: 'generateJd',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs/generate-jd',
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
    let url = `http://localhost:${port}/api/jobs/generate-jd`;

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
  name: 'generateCompleteRequisition',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs/ai/generate-complete',
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
    let url = `http://localhost:${port}/api/jobs/ai/generate-complete`;

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
  name: 'jobCopilot',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs/ai/copilot',
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
    let url = `http://localhost:${port}/api/jobs/ai/copilot`;

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
  name: 'reviewRequisition',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs/ai/review',
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
    let url = `http://localhost:${port}/api/jobs/ai/review`;

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
  name: 'listTemplates',
  category: 'job',
  permissions: [PERMISSIONS.JOB_VIEW],
  description: 'Auto-generated tool for GET /api/jobs/templates',
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
    let url = `http://localhost:${port}/api/jobs/templates`;

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
  name: 'createTemplate',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs/templates',
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
    let url = `http://localhost:${port}/api/jobs/templates`;

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
  name: 'getTemplate',
  category: 'job',
  permissions: [PERMISSIONS.JOB_VIEW],
  description: 'Auto-generated tool for GET /api/jobs/templates/:id',
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
    let url = `http://localhost:${port}/api/jobs/templates/:id`;

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
  name: 'updateTemplate',
  category: 'job',
  permissions: [PERMISSIONS.JOB_EDIT],
  description: 'Auto-generated tool for PATCH /api/jobs/templates/:id',
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
    let url = `http://localhost:${port}/api/jobs/templates/:id`;

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
  name: 'deleteTemplate',
  category: 'job',
  permissions: [PERMISSIONS.JOB_DELETE],
  description: 'Auto-generated tool for DELETE /api/jobs/templates/:id',
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
    let url = `http://localhost:${port}/api/jobs/templates/:id`;

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
  name: 'listJobs',
  category: 'job',
  permissions: [PERMISSIONS.JOB_VIEW],
  description: 'Auto-generated tool for GET /api/jobs',
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
    let url = `http://localhost:${port}/api/jobs`;

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
  name: 'createJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs',
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
    let url = `http://localhost:${port}/api/jobs`;

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
  name: 'getJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_VIEW],
  description: 'Auto-generated tool for GET /api/jobs/:id',
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
    let url = `http://localhost:${port}/api/jobs/:id`;

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
  name: 'downloadJobPdf',
  category: 'job',
  permissions: [PERMISSIONS.JOB_VIEW],
  description: 'Auto-generated tool for GET /api/jobs/:id/pdf',
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
    let url = `http://localhost:${port}/api/jobs/:id/pdf`;

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
  name: 'updateJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_EDIT],
  description: 'Auto-generated tool for PATCH /api/jobs/:id',
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
    let url = `http://localhost:${port}/api/jobs/:id`;

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
  name: 'deleteJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_DELETE],
  description: 'Auto-generated tool for DELETE /api/jobs/:id',
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
    let url = `http://localhost:${port}/api/jobs/:id`;

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
  name: 'submitJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Auto-generated tool for POST /api/jobs/:id/submit',
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
    let url = `http://localhost:${port}/api/jobs/:id/submit`;

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
  name: 'approveJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_APPROVE],
  description: 'Auto-generated tool for POST /api/jobs/:id/approve',
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
    let url = `http://localhost:${port}/api/jobs/:id/approve`;

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
  name: 'rejectJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_APPROVE],
  description: 'Auto-generated tool for POST /api/jobs/:id/reject',
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
    let url = `http://localhost:${port}/api/jobs/:id/reject`;

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
  name: 'closeJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_EDIT],
  description: 'Auto-generated tool for POST /api/jobs/:id/close',
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
    let url = `http://localhost:${port}/api/jobs/:id/close`;

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
  name: 'reopenJob',
  category: 'job',
  permissions: [PERMISSIONS.JOB_EDIT],
  description: 'Auto-generated tool for POST /api/jobs/:id/reopen',
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
    let url = `http://localhost:${port}/api/jobs/:id/reopen`;

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

    