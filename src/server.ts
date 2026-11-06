import Fastify from 'fastify';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { Webhooks } from '@octokit/webhooks';
import { prisma } from './db.js';
import { registerInstallationHandlers } from './handlers/installation.js';
import { registerRepositoryHandlers } from './handlers/repositories.js';

const fastify = Fastify({
  logger: { level: 'warn' },
});

// Clean one-line request summaries (replaces Fastify's noisy per-request JSON)
fastify.addHook('onResponse', async (request, reply) => {
  const method = request.method;
  const url = request.url;
  const status = reply.statusCode;
  const responseTime = Math.round(reply.elapsedTime);

  // If it's a webhook, include the GitHub event name for context
  const eventName = request.headers['x-github-event'];
  const eventAction = (request.body as any)?.action;
  const eventContext = eventName
    ? ` (${eventName}${eventAction ? `:${eventAction}` : ''})`
    : '';

  // Status emoji for visual scan
  const emoji = status >= 500 ? '🔥' : status >= 400 ? '⚠️' : '→';

  console.log(`${emoji} ${method} ${url}${eventContext} ${status} ${responseTime}ms`);
});

// Load GitHub App credentials from .env
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY_PATH || !GITHUB_WEBHOOK_SECRET) {
  console.error('❌ Missing GitHub App credentials in .env');
  process.exit(1);
}

let privateKey: string;
try {
  privateKey = readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf-8');
} catch (err) {
  console.error(`❌ Could not read private key at ${GITHUB_APP_PRIVATE_KEY_PATH}`);
  process.exit(1);
}

console.log('✅ GitHub App credentials loaded');
console.log(`   App ID: ${GITHUB_APP_ID}`);
console.log(`   Private key length: ${privateKey.length} chars`);
console.log(`   Webhook secret length: ${GITHUB_WEBHOOK_SECRET.length} chars`);

// Initialize the webhooks handler with our secret
const webhooks = new Webhooks({
  secret: GITHUB_WEBHOOK_SECRET,
});

// Register all webhook event handlers
registerInstallationHandlers(webhooks);
registerRepositoryHandlers(webhooks);

// Catch-all: log unhandled events for visibility
webhooks.onAny(({ id, name, payload }) => {
  try {
    // Skip events that have dedicated handlers
    if (
      name === 'installation' &&
      ['created', 'deleted', 'suspend', 'unsuspend'].includes((payload as any).action)
    ) {
      return;
    }
    if (
      name === 'installation_repositories' &&
      ['added', 'removed'].includes((payload as any).action)
    ) {
      return;
    }
    console.log('');
    console.log(`📩 Webhook received: ${name} / ${(payload as any).action || 'N/A'}`);
    console.log(`   Event ID: ${id}`);
    console.log(`   Sender: ${(payload as any).sender?.login || 'unknown'}`);
  } catch (err) {
    console.error('   ❌ Catch-all handler error:', err);
  }
});

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Admin endpoint: list all installations
// Supports optional ?status=active or ?status=suspended filter
fastify.get('/installations', async (request, reply) => {
  const statusFilter = (request.query as any)?.status;

  const where = statusFilter ? { status: statusFilter } : {};

  try {
    const installations = await prisma.installation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Convert BigInt → string for JSON serialization
    const serialized = installations.map(inst => ({
      ...inst,
      githubInstallationId: inst.githubInstallationId.toString(),
    }));

    return {
      count: serialized.length,
      installations: serialized,
    };
  } catch (err) {
    console.error('❌ Failed to list installations:', err);
    reply.code(500).send({ error: 'Failed to fetch installations' });
  }
});

// Webhook endpoint — receives events from GitHub
fastify.post('/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const eventName = request.headers['x-github-event'] as string;
  const deliveryId = request.headers['x-github-delivery'] as string;

  if (!signature || !eventName || !deliveryId) {
    console.warn('⚠️  Webhook rejected: missing required headers');
    reply.code(400).send({ error: 'Missing required webhook headers' });
    return;
  }

  const payload = JSON.stringify(request.body);

  try {
    await webhooks.verifyAndReceive({
      id: deliveryId,
      name: eventName as any,
      signature: signature,
      payload: payload,
    });
    reply.code(200).send({ status: 'ok' });
  } catch (err: any) {
    // Signature errors are permanent — return 400 so GitHub doesn't retry
    if (err?.name === 'WebhookSignatureVerificationError' || /signature/i.test(err?.message || '')) {
      console.error(`❌ Webhook signature invalid (delivery=${deliveryId})`);
      reply.code(400).send({ error: 'Invalid signature' });
      return;
    }

    // Handler threw (e.g. DB down) — log loudly, return 200 to prevent retry storms
    console.error(`❌ Webhook handler failed (delivery=${deliveryId}, event=${eventName}):`, err);
    reply.code(200).send({ status: 'ok', warning: 'processed with errors' });
  }
});

// Start the server
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 StripeGuard server running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();