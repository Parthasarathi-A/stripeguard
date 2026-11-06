import { Webhooks } from '@octokit/webhooks';
import { prisma } from '../db.js';

/**
 * Registers all installation.* webhook handlers on the given Webhooks instance.
 * Handles: created, deleted, suspend, unsuspend
 */
export function registerInstallationHandlers(webhooks: Webhooks): void {
  // When StripeGuard is installed on an account (or re-installed with same ID)
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

  // When StripeGuard is uninstalled from an account
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

  // When StripeGuard is suspended on an account (temporary, not uninstalled)
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

  // When StripeGuard is unsuspended on an account (reactivated)
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
}