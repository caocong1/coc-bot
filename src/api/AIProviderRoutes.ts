/**
 * AI Provider Admin API Routes
 *
 * REST endpoints for managing AI providers, models, and feature bindings.
 * All routes require ADMIN_SECRET authentication.
 *
 * Base path: /admin/ai
 */

import type { Database } from 'bun:sqlite';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  getProviderReferences,
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  getModelReferences,
  getFeatureBinding,
  listFeatureBindings,
  setFeatureBinding,
  deleteFeatureBinding,
  getConfigSource,
  setConfigSource,
  modelBelongsToProvider,
} from '../storage/ProviderStore';
import { encryptCredentials, maskCredentials } from '../ai/providers/Encryption';
import type {
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateModelRequest,
  UpdateModelRequest,
  UpdateFeatureBindingRequest,
  FeatureId,
  FeatureModelConfig,
} from '../ai/providers/types';
import { FEATURE_REQUIREMENTS } from '../ai/providers/types';

// ─── JSON helpers ────────────────────────────────────────────────────────────

async function parseJson<T>(req: Request): Promise<T> {
  const body = await req.text();
  try { return JSON.parse(body) as T; }
  catch { throw new Error('Invalid JSON'); }
}

function json(res: ServerResponse, data: unknown, status = 200, warning?: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(warning ? { data, warning } : { data }));
}

function error(_res: ServerResponse, message: string, status = 400): void {
  _res.writeHead(status, { 'Content-Type': 'application/json' });
  _res.end(JSON.stringify({ error: message }));
}

// ─── Auth ───────────────────────────────────────────────────────────────────

// Auth is handled by ApiRouter, no need here

// ─── Mask credentials in response ───────────────────────────────────────────

function maskProviderResponse(provider: ReturnType<typeof getProvider>): object | null {
  if (!provider) return null;
  let credMasked: Record<string, string> = {};
  if (provider.credentialsEncrypted) {
    try {
      const { decryptCredentials: _dc } = require('../ai/providers/Encryption');
      const raw = _dc(provider.credentialsEncrypted) as Record<string, string | undefined>;
      credMasked = raw ? maskCredentials(raw) : {};
    } catch { /* ignore */ }
  }
  return {
    ...provider,
    credentialsEncrypted: credMasked.apiKey ? `****${credMasked.apiKey.slice(-4)}` : null,
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export class AIProviderRoutes {
  constructor(private readonly db: Database) {}

  async handle(req: Request, path: string): Promise<Response | null> {
    const url = new URL(req.url, 'http://localhost');
    const pathParts = path.split('/').filter(Boolean);
    // path like: providers, providers/id, providers/id/models, providers/id/models/modelId, features, config-source

    try {
      // GET /providers
      if (req.method === 'GET' && pathParts.length === 1 && pathParts[0] === 'providers') {
        const providers = listProviders(this.db);
        return Response.json({ data: providers.map(p => maskProviderResponse(p)) });
      }

      // POST /providers
      if (req.method === 'POST' && pathParts.length === 1 && pathParts[0] === 'providers') {
        const body = await parseJson<CreateProviderRequest>(req);
        if (!body.type || !body.name) {
          return Response.json({ error: 'type and name are required' }, { status: 400 });
        }
        const provider = createProvider(this.db, {
          id: body.type + '-' + Date.now(),
          type: body.type,
          name: body.name,
          baseUrl: body.baseUrl,
          credentials: body.credentials,
          authType: body.authType,
          providerOptionsJson: body.providerOptionsJson,
        });
        return Response.json({ data: maskProviderResponse(provider) }, { status: 201 });
      }

      // GET /providers/:id
      if (req.method === 'GET' && pathParts.length === 2 && pathParts[0] === 'providers') {
        const provider = getProvider(this.db, pathParts[1]);
        if (!provider) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json({ data: maskProviderResponse(provider) });
      }

      // PUT /providers/:id
      if (req.method === 'PUT' && pathParts.length === 2 && pathParts[0] === 'providers') {
        const body = await parseJson<UpdateProviderRequest>(req);
        const existing = getProvider(this.db, pathParts[1]);
        if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

        // 禁用前检查引用
        if (body.enabled === false) {
          const refs = getProviderReferences(this.db, pathParts[1]);
          if (refs.length > 0) {
            return Response.json({
              error: '无法禁用此 Provider',
              details: `此 Provider 正被以下功能使用: ${refs.join(', ')}，请先更改功能配置后再禁用`,
            }, { status: 409 });
          }
        }

        const updated = updateProvider(this.db, pathParts[1], body);
        return Response.json({ data: maskProviderResponse(updated) });
      }

      // DELETE /providers/:id
      if (req.method === 'DELETE' && pathParts.length === 2 && pathParts[0] === 'providers') {
        const force = url.searchParams.get('force') === 'true';
        const refs = getProviderReferences(this.db, pathParts[1]);
        if (refs.length > 0 && !force) {
          return Response.json({
            error: '无法删除此 Provider',
            details: `此 Provider 正被以下功能使用: ${refs.join(', ')}，请先更改功能配置或使用 ?force=true`,
          }, { status: 409 });
        }
        if (force) {
          // 清除受影响 feature 的绑定
          for (const f of refs) {
            deleteFeatureBinding(this.db, f as FeatureId);
          }
        }
        deleteProvider(this.db, pathParts[1]);
        return Response.json({ data: { deleted: true } });
      }

      // GET /providers/:id/models
      if (req.method === 'GET' && pathParts.length === 3 && pathParts[2] === 'models') {
        const models = listModels(this.db, pathParts[1]);
        return Response.json({ data: models });
      }

      // POST /providers/:id/models
      if (req.method === 'POST' && pathParts.length === 3 && pathParts[2] === 'models') {
        const body = await parseJson<CreateModelRequest>(req);
        if (!body.modelId || !body.name || !body.capabilities) {
          return Response.json({ error: 'modelId, name, capabilities are required' }, { status: 400 });
        }
        const id = `${pathParts[1]}:${body.modelId}`;
        const model = createModel(this.db, {
          id,
          providerId: pathParts[1],
          modelId: body.modelId,
          name: body.name,
          capabilities: body.capabilities,
        });
        return Response.json({ data: model }, { status: 201 });
      }

      // GET /providers/:id/models/:modelId
      if (req.method === 'GET' && pathParts.length === 4 && pathParts[2] === 'models') {
        const model = getModel(this.db, pathParts[3]);
        if (!model) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json({ data: model });
      }

      // PUT /providers/:id/models/:modelId
      if (req.method === 'PUT' && pathParts.length === 4 && pathParts[2] === 'models') {
        const body = await parseJson<UpdateModelRequest>(req);
        const existing = getModel(this.db, pathParts[3]);
        if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

        // 能力降级前检查引用
        if (body.capabilities) {
          const refs = getModelReferences(this.db, pathParts[3]);
          for (const ref of refs) {
            const requiredCaps = FEATURE_REQUIREMENTS[ref] ?? [];
            const errors = requiredCaps
              .filter(cap => {
                const val = body.capabilities![cap];
                return val === false || val === undefined;
              });
            if (errors.length > 0) {
              return Response.json({
                error: `能力降级会影响功能 '${ref}'`,
                details: errors.join(', '),
              }, { status: 409 });
            }
          }
        }

        const updated = updateModel(this.db, pathParts[3], body);
        return Response.json({ data: updated });
      }

      // DELETE /providers/:id/models/:modelId
      if (req.method === 'DELETE' && pathParts.length === 4 && pathParts[2] === 'models') {
        const force = url.searchParams.get('force') === 'true';
        const refs = getModelReferences(this.db, pathParts[3]);
        if (refs.length > 0 && !force) {
          return Response.json({
            error: '无法删除此 Model',
            details: `此 Model 正被以下功能使用: ${refs.join(', ')}，请先更改功能配置或使用 ?force=true`,
          }, { status: 409 });
        }
        if (force) {
          for (const f of refs) {
            deleteFeatureBinding(this.db, f as FeatureId);
          }
        }
        deleteModel(this.db, pathParts[3]);
        return Response.json({ data: { deleted: true } });
      }

      // GET /features
      if (req.method === 'GET' && pathParts.length === 1 && pathParts[0] === 'features') {
        const bindings = listFeatureBindings(this.db);
        return Response.json({ data: bindings });
      }

      // PUT /features
      if (req.method === 'PUT' && pathParts.length === 1 && pathParts[0] === 'features') {
        const body = await parseJson<{ feature: FeatureId } & UpdateFeatureBindingRequest>(req);
        if (!body.feature) return Response.json({ error: 'feature is required' }, { status: 400 });

        // 校验 capability
        const requiredCaps = FEATURE_REQUIREMENTS[body.feature] ?? [];
        const modelId = body.routingPolicy.type === 'single'
          ? body.routingPolicy.modelId
          : body.routingPolicy.primary.modelId;
        const providerId = body.routingPolicy.type === 'single'
          ? body.routingPolicy.providerId
          : body.routingPolicy.primary.providerId;

        if (!modelBelongsToProvider(this.db, modelId, providerId)) {
          return Response.json({ error: `Model '${modelId}' 不属于 Provider '${providerId}'` }, { status: 400 });
        }

        const model = getModel(this.db, modelId);
        if (!model) return Response.json({ error: `Model '${modelId}' 不存在` }, { status: 400 });

        const errors: string[] = [];
        for (const cap of requiredCaps) {
          if (!model.capabilities[cap]) {
            errors.push(`模型不支持 ${cap}（Feature '${body.feature}' 需要）`);
          }
        }
        if (errors.length > 0) {
          return Response.json({ error: errors.join('; ') }, { status: 400 });
        }

        const binding: FeatureModelConfig = {
          feature: body.feature,
          routingPolicy: body.routingPolicy,
          fallbackOnRateLimit: body.fallbackOnRateLimit ?? false,
          updatedAt: Date.now(),
        };
        setFeatureBinding(this.db, binding);

        // knowledge.embedding 变更时返回警告
        if (body.feature === 'knowledge.embedding') {
          return Response.json({
            data: binding,
            warning: "检测到 knowledge.embedding 配置变更，建议运行 'bun run build-indexes' 重建索引以获得最佳检索精度",
          });
        }

        return Response.json({ data: binding });
      }

      // GET /config-source
      if (req.method === 'GET' && pathParts.length === 1 && pathParts[0] === 'config-source') {
        return Response.json({ data: { configSource: getConfigSource(this.db) } });
      }

      // PUT /config-source
      if (req.method === 'PUT' && pathParts.length === 1 && pathParts[0] === 'config-source') {
        const body = await parseJson<{ source: 'legacy' | 'providers' }>(req);
        if (!body.source || !['legacy', 'providers'].includes(body.source)) {
          return Response.json({ error: 'source must be "legacy" or "providers"' }, { status: 400 });
        }
        setConfigSource(this.db, body.source);
        return Response.json({ data: { configSource: body.source } });
      }

      return null; // not handled
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    }
  }
}
