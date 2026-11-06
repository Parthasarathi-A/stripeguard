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
    const installation = await prisma.installation.upsert({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
      update: {
        accountName: payload.installation.account?.login ?? 'unknown',
        accountType: payload.installation.account?.type ?? 'User',
        repos: payload.repositories?.map(r => r.name) ?? [],
        status: 'active',
      },
      create: {
        githubInstallationId: BigInt(payload.installation.id),
        accountName: payload.installation.account?.login ?? 'unknown',
        accountType: payload.installation.account?.type ?? 'User',
        repos: payload.repositories?.map(r => r.name) ?? [],
        status: 'active',
      },
    });
    console.log(`   ✅ Saved to DB with id=${installation.id} (${installation.status})`);
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

// Handler: when StripeGuard is suspended on an account (temporary, not uninstalled)
webhooks.on('installation.suspend', async ({ id, payload }) => {
  console.log('');
  console.log('📩 Installation suspended');
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
    console.error('   ❌ Failed to suspend installation:', err);
  }
});

// Handler: when StripeGuard is unsuspended on an account (reactivated)
webhooks.on('installation.unsuspend', async ({ id, payload }) => {
  console.log('');
  console.log('📩 Installation unsuspended');
  console.log(`   Event ID: ${id}`);
  console.log(`   Account: ${payload.installation.account?.login}`);

  try {
    const updated = await prisma.installation.updateMany({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
      data: {
        status: 'active',
      },
    });
    console.log(`   ✅ Marked ${updated.count} installation(s) as active`);
  } catch (err) {
    console.error('   ❌ Failed to unsuspend installation:', err);
  }
});

// Handler: when repos are added to an existing StripeGuard installation
webhooks.on('installation_repositories.added', async ({ id, payload }) => {
  console.log('');
  console.log('📩 Repos added to installation');
  console.log(`   Event ID: ${id}`);
  console.log(`   Account: ${payload.installation.account?.login}`);
  console.log(`   Added repos: ${payload.repositories_added.map(r => r.name).join(', ')}`);

  try {
    const existing = await prisma.installation.findUnique({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
    });

    if (!existing) {
      console.warn(`   ⚠️  Installation ${payload.installation.id} not found in DB — skipping`);
      return;
    }

    const newRepos = payload.repositories_added.map(r => r.name);
    const mergedRepos = Array.from(new Set([...existing.repos, ...newRepos]));

    const updated = await prisma.installation.update({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
      data: {
        repos: mergedRepos,
      },
    });
    console.log(`   ✅ Updated repos: ${updated.repos.join(', ')}`);
  } catch (err) {
    console.error('   ❌ Failed to add repos:', err);
  }
});

// Handler: when repos are removed from an existing StripeGuard installation
webhooks.on('installation_repositories.removed', async ({ id, payload }) => {
  console.log('');
  console.log('📩 Repos removed from installation');
  console.log(`   Event ID: ${id}`);
  console.log(`   Account: ${payload.installation.account?.login}`);
  console.log(`   Removed repos: ${payload.repositories_removed.map(r => r.name).join(', ')}`);

  try {
    const existing = await prisma.installation.findUnique({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
    });

    if (!existing) {
      console.warn(`   ⚠️  Installation ${payload.installation.id} not found in DB — skipping`);
      return;
    }

    const removedNames = payload.repositories_removed.map(r => r.name);
    const filteredRepos = existing.repos.filter(name => !removedNames.includes(name));

    const updated = await prisma.installation.update({
      where: {
        githubInstallationId: BigInt(payload.installation.id),
      },
      data: {
        repos: filteredRepos,
      },
    });
    console.log(`   ✅ Updated repos: ${updated.repos.join(', ') || '(empty)'}`);
  } catch (err) {
    console.error('   ❌ Failed to remove repos:', err);
  }
});

// Catch-all: log other events for visibility (wrapped so a weird payload can't crash us)
webhooks.onAny(({ id, name, payload }) => {
  try {
    // Skip the ones we handle specifically above
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

// Webhook endpoint — receives events from GitHub
fastify.post('/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const eventName = request.headers['x-github-event'] as string;
  const deliveryId = request.headers['x-github-delivery'] as string;

  // Validate required headers upfront
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