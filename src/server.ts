import Fastify from 'fastify';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { Webhooks } from '@octokit/webhooks';
import { prisma } from './db.js';

const fastify = Fastify({
  logger: true,
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

const webhooks = new Webhooks({
  secret: GITHUB_WEBHOOK_SECRET,
});

// Handler: when StripeGuard is installed on an account
webhooks.on('installation.created', async ({ id, payload }) => {
  console.log('');
  console.log('📩 Installation created');
  console.log(`   Event ID: ${id}`);
  console.log(`   Account: ${payload.installation.account?.login}`);
  console.log(`   Repos: ${payload.repositories?.map(r => r.name).join(', ') || 'none'}`);

  try {
    const installation = await prisma.installation.create({
      data: {
        githubInstallationId: BigInt(payload.installation.id),
        accountName: payload.installation.account?.login ?? 'unknown',
        accountType: payload.installation.account?.type ?? 'User',
        repos: payload.repositories?.map(r => r.name) ?? [],
        status: 'active',
      },
    });
    console.log(`   ✅ Saved to DB with id=${installation.id}`);
  } catch (err) {
    console.error('   ❌ Failed to save installation:', err);
  }
});

// Handler: when StripeGuard is uninstalled from an account
webhooks.on('installation.deleted', async ({ id, payload }) => {
  console.log('');
  console.log('📩 Installation deleted');
  console.log(`   Event ID: ${id}`);
  console.log(`   Account: ${payload.installation.account?.login}`);

  try {
    const updated = await prisma.installation.updateMany({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
      data: {
        status: 'suspended',
      },
    });
    console.log(`   ✅ Marked ${updated.count} installation(s) as suspended`);
  } catch (err) {
    console.error('   ❌ Failed to update installation:', err);
  }
});

// Catch-all: still log other events for visibility
webhooks.onAny(({ id, name, payload }) => {
  // Skip the two we handle specifically above
  if (name === 'installation' && ((payload as any).action === 'created' || (payload as any).action === 'deleted')) {
    return;
  }
  console.log('');
  console.log(`📩 Webhook received: ${name} / ${(payload as any).action || 'N/A'}`);
  console.log(`   Event ID: ${id}`);
  console.log(`   Sender: ${(payload as any).sender?.login || 'unknown'}`);
});

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Webhook endpoint
fastify.post('/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const eventName = request.headers['x-github-event'] as string;
  const deliveryId = request.headers['x-github-delivery'] as string;
  const payload = JSON.stringify(request.body);

  if (!signature) {
    reply.code(400).send({ error: 'Missing signature header' });
    return;
  }

  try {
    await webhooks.verifyAndReceive({
      id: deliveryId,
      name: eventName as any,
      signature: signature,
      payload: payload,
    });
    reply.code(200).send({ status: 'ok' });
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err);
    reply.code(401).send({ error: 'Invalid signature' });
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