import { Project, SyntaxKind, PropertyAccessExpression } from 'ts-morph';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const project = new Project({
  tsConfigFilePath: path.join(__dirname, '../tsconfig.json'),
});

const routesDir = path.join(__dirname, '../src/routes');
const outputDir = path.join(__dirname, '../src/ai/tools/generated');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const globPath = path.join(__dirname, '../src/routes/**/*.ts').replace(/\\/g, '/');
project.addSourceFilesAtPaths(globPath);

// First, parse index.ts to find the mount paths for each route file
const indexFile = project.getSourceFile(path.join(routesDir, 'index.ts').replace(/\\/g, '/'));
const mountMap: Record<string, string> = {};

if (indexFile) {
  indexFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
    if (call.getExpression().getText() === 'router.use') {
      const args = call.getArguments();
      if (args.length >= 2 && args[0].getKind() === SyntaxKind.StringLiteral) {
        const mountPath = args[0].getText().replace(/['"]/g, '');
        const routesVar = args[1].getText();

        const imports = indexFile.getImportDeclarations();
        const imp = imports.find(i => i.getDefaultImport()?.getText() === routesVar);
        if (imp) {
          const modSpec = imp.getModuleSpecifierValue();
          const baseName = path.basename(modSpec, '.routes.js');
          mountMap[baseName] = mountPath;
        }
      }
    }
  });
}

const sourceFiles = project.getSourceFiles(globPath);

function camelCase(str: string) {
  return str.replace(/[-_/:](.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
}

const allTools: { name: string; file: string }[] = [];
// Tracks which generated files ended up referencing PERMISSIONS/ROLES, so
// the import line is only emitted where actually used (avoids unused-import
// errors under noUnusedLocals when a file only needs one of the two).
const filesNeedingPermissionsImport = new Set<string>();
const filesNeedingRolesImport = new Set<string>();

sourceFiles.forEach(file => {
  const baseName = path.basename(file.getFilePath(), '.routes.ts');
  if (baseName === 'index.ts' || baseName === 'index') return;

  console.log(`Processing routes for: ${baseName}`);

  const mountPath = mountMap[baseName] || '/' + baseName;
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  const tools: string[] = [];

  // Router-level gates — `router.use(authenticate, requireRole(ROLES.X))` —
  // apply to EVERY route in the file, not just one. Individual
  // requirePermission()/requireAnyPermission()/requireRole() calls on a
  // specific route are collected separately below and layered on top.
  const fileLevelRoles: string[] = [];
  calls.forEach(call => {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const pae = expr as PropertyAccessExpression;
    if (pae.getExpression().getText() !== 'router' || pae.getName() !== 'use') return;
    for (const useArg of call.getArguments()) {
      if (useArg.getKind() !== SyntaxKind.CallExpression) continue;
      const useCall = useArg.asKindOrThrow(SyntaxKind.CallExpression);
      if (useCall.getExpression().getText() !== 'requireRole') continue;
      fileLevelRoles.push(
        ...useCall.getArguments().map((a) => a.getText()).filter((t) => /^ROLES\./.test(t)),
      );
    }
  });

  calls.forEach(call => {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pae = expr as PropertyAccessExpression;
      const caller = pae.getExpression().getText();
      const method = pae.getName();

      if (caller === 'router' && ['get', 'post', 'patch', 'delete', 'put'].includes(method)) {
        const args = call.getArguments();
        if (args.length < 2) return;

        const routePathArg = args[0];
        let routePath = '';
        if (routePathArg.getKind() === SyntaxKind.StringLiteral) {
          routePath = routePathArg.getText().replace(/['"]/g, '');
        }

        // Harvest requirePermission/requireAnyPermission/requireRole from the
        // middleware args (everything between the path and the final
        // handler) so the generated tool carries the SAME authorization the
        // real HTTP route enforces — the AI layer must never be more
        // permissive than clicking the equivalent button in the UI. Keep the
        // original `PERMISSIONS.X` / `ROLES.X` expression text so it can be
        // re-emitted verbatim as real TS in the generated file (rather than
        // resolving to raw strings here and losing the source-of-truth link).
        const permissions: string[] = [];
        const permissionsAny: string[] = [];
        const allowedRoles: string[] = [];
        const scanAuthCall = (mwCall: ReturnType<typeof call.asKindOrThrow<SyntaxKind.CallExpression>>) => {
          const mwName = mwCall.getExpression().getText();
          const values = mwCall.getArguments().map((a) => a.getText()).filter((t) => /^(PERMISSIONS|ROLES)\./.test(t));
          if (mwName === 'requirePermission') permissions.push(...values);
          else if (mwName === 'requireAnyPermission') permissionsAny.push(...values);
          else if (mwName === 'requireRole') allowedRoles.push(...values);
        };
        for (const mwArg of args.slice(1, -1)) {
          if (mwArg.getKind() === SyntaxKind.CallExpression) {
            scanAuthCall(mwArg.asKindOrThrow(SyntaxKind.CallExpression));
            continue;
          }
          // Handle `...manage` where `const manage = [authenticate, requireRole(...)] as const;`
          // is declared locally in the same route file (tenant.routes.ts, billing.routes.ts).
          if (mwArg.getKind() === SyntaxKind.SpreadElement) {
            const spread = mwArg.asKindOrThrow(SyntaxKind.SpreadElement);
            const inner = spread.getExpression();
            if (inner.getKind() !== SyntaxKind.Identifier) continue;
            const decl = file.getVariableDeclaration(inner.getText());
            const arrLit = decl?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
              ?? decl?.getInitializerIfKind(SyntaxKind.AsExpression)?.getExpression().asKind(SyntaxKind.ArrayLiteralExpression);
            arrLit?.getElements().forEach((el) => {
              if (el.getKind() === SyntaxKind.CallExpression) scanAuthCall(el.asKindOrThrow(SyntaxKind.CallExpression));
            });
          }
        }
        allowedRoles.push(...fileLevelRoles.filter((r) => !allowedRoles.includes(r)));

        const handlerArg = args[args.length - 1];
        let controllerMethod = handlerArg.getText();

        if (controllerMethod.includes('.')) {
          controllerMethod = controllerMethod.split('.').pop() || controllerMethod;
        }

        let toolName = controllerMethod;
        if (!toolName || toolName === 'asyncHandler' || toolName.includes('(')) {
          const cleanPath = routePath.replace(/[^a-zA-Z0-9]/g, '_');
          toolName = camelCase(`${method}_${baseName}_${cleanPath}`);
        }

        // OpenAI requires function names to be alphameric, underscores, dots, colons, or dashes.
        toolName = toolName.replace(/[^a-zA-Z0-9_.:-]/g, '');

        const description = `Auto-generated tool for ${method.toUpperCase()} /api${mountPath}${routePath === '/' ? '' : routePath}`;

        // Carry the SAME authorization the real route enforces. A route
        // with none of these middlewares is still behind `authenticate`
        // (checked per-router) but has no extra permission — mark it
        // publicTool so PermissionChecker's fail-closed default doesn't
        // wrongly deny it to every non-admin caller.
        const hasAuth = permissions.length || permissionsAny.length || allowedRoles.length;
        if (permissions.length || permissionsAny.length) filesNeedingPermissionsImport.add(`${baseName}Tools.ts`);
        if (allowedRoles.length) filesNeedingRolesImport.add(`${baseName}Tools.ts`);
        const authFields = hasAuth
          ? [
              permissions.length ? `  permissions: [${permissions.join(', ')}],` : '',
              permissionsAny.length ? `  permissionsAny: [${permissionsAny.join(', ')}],` : '',
              allowedRoles.length ? `  allowedRoles: [${allowedRoles.join(', ')}],` : '',
            ].filter(Boolean).join('\n')
          : '  publicTool: true,';

        const toolCode = `
ToolRegistry.register({
  name: '${toolName}',
  category: '${baseName}',
${authFields}
  description: '${description}',
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
    let url = \`http://localhost:\${port}/api${mountPath}${routePath === '/' ? '' : routePath}\`;

    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        url = url.replace(\`:\${key}\`, encodeURIComponent(String(value)));
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
      headers['Authorization'] = \`Bearer \${token}\`;
      headers['x-ai-tool'] = 'true';
    }

    const bodyPayload = args.body || (args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'query' && k !== 'params')) : {});

    const res = await fetch(url, {
      method: '${method.toUpperCase()}',
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes('${method.toUpperCase()}') ? JSON.stringify(bodyPayload) : undefined
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.message || data.error || \`HTTP \${res.status}\`);
      return data;
    } catch (e) {
      if (!res.ok) throw new Error(text || \`HTTP \${res.status}\`);
      return text;
    }
  }
});
`;
        tools.push(toolCode);
        allTools.push({ name: toolName, file: `${baseName}Tools.ts` });
      }
    }
  });

  if (tools.length > 0) {
    const authImportNames = [
      filesNeedingPermissionsImport.has(`${baseName}Tools.ts`) ? 'PERMISSIONS' : null,
      filesNeedingRolesImport.has(`${baseName}Tools.ts`) ? 'ROLES' : null,
    ].filter(Boolean);
    const authImport = authImportNames.length
      ? `import { ${authImportNames.join(', ')} } from '@agnohire/shared';\n`
      : '';
    const fileContent = `import { ToolRegistry } from '../../toolRegistry/index.js';
import { signAccessToken } from '../../../utils/tokenHelper.js';
${authImport}${tools.join('\n')}
    `;
    fs.writeFileSync(path.join(outputDir, `${baseName}Tools.ts`), fileContent);
  }
});

const indexContent = allTools
  .map(t => t.file)
  .filter((v, i, a) => a.indexOf(v) === i)
  .map(file => `import './${file.replace('.ts', '.js')}';`)
  .join('\n');

fs.writeFileSync(path.join(outputDir, 'index.ts'), indexContent);

console.log('✅ AI Tools successfully generated with true HTTP bindings.');
