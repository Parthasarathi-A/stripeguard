import { Webhooks } from '@octokit/webhooks';
import { prisma } from '../db.js';

/**
 * Registers all installation_repositories.* webhook handlers on the given Webhooks instance.
 * Handles: added, removed
 *
 * These events fire when a user adds or removes repos from an EXISTING installation,
 * without uninstalling the app entirely.
 */
export function registerRepositoryHandlers(webhooks: Webhooks): void {
  // When repos are added to an existing StripeGuard installation
  webhooks.on('installation_repositories.added', async ({ id, payload }) => {
    const account = payload.installation.account as any;

    console.log('');
    console.log('📩 Repos added to installation');
    console.log(`   Event ID: ${id}`);
    console.log(`   Account: ${account?.login}`);
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

  // When repos are removed from an existing StripeGuard installation
  webhooks.on('installation_repositories.removed', async ({ id, payload }) => {
    const account = payload.installation.account as any;

    console.log('');
    console.log('📩 Repos removed from installation');
    console.log(`   Event ID: ${id}`);
    console.log(`   Account: ${account?.login}`);
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
}