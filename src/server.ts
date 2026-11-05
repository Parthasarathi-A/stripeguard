import Fastify from 'fastify';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { Webhooks } from '@octokit/webhooks';

const fastify = Fastify({
  logger: true,
});

// Load GitHub App credentials from .env
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// Validate all credentials are present — fail fast if misconfigured
if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY_PATH || !GITHUB_WEBHOOK_SECRET) {
  console.error('❌ Missing GitHub App credentials in .env');
  console.error('   Required: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_WEBHOOK_SECRET');
  process.exit(1);
}

// Load the private key from the file path
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

// Log every incoming webhook event for now
webhooks.onAny(({ id, name, payload }) => {
  console.log('');
  console.log('📩 Webhook received');
  console.log(`   Event ID: ${id}`);
  console.log(`   Event name: ${name}`);
  console.log(`   Action: ${(payload as any).action || 'N/A'}`);
  console.log(`   Sender: ${(payload as any).sender?.login || 'unknown'}`);
});

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Webhook endpoint — receives events from GitHub
fastify.post('/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const eventName = request.headers['x-github-event'] as string;
  const deliveryId = request.headers['x-github-delivery'] as string;
  const payload = JSON.stringify(request.body);

  if (!signature) {
    reply.code(400).send({ error: 'Missing signature header' });
    return;
  }

  // Verify signature — rejects requests not actually from GitHub
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