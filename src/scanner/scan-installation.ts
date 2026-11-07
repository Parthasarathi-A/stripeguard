import { prisma } from '../db.js';
import { getInstallationToken } from '../github-auth.js';
import { cloneRepo } from './clone.js';
import { scanRepoForStripe } from './scanner.js';

/**
 * Orchestrates a full scan for one installation:
 *   1. Loads installation from DB (must exist and be active)
 *   2. Gets a fresh GitHub access token for the installation
 *   3. For each repo in the installation:
 *      - Clones it with the token
 *      - Scans it for Stripe SDK usage
 *      - Saves a ScanResult row to DB
 *      - Cleans up the temp folder
 *
 * Each repo is scanned independently — if one fails, others still run.
 *
 * @param installationId - Our internal Installation.id (NOT the GitHub installation ID)
 * @returns Summary object with per-repo outcomes
 */
export async function scanInstallation(installationId: number): Promise<{
  installationId: number;
  totalRepos: number;
  successCount: number;
  failedCount: number;
  results: Array<{
    repo: string;
    status: 'success' | 'failed';
    callsFound?: number;
    error?: string;
  }>;
}> {
  console.log('');
  console.log(`🚀 Starting scan for installation id=${installationId}`);

  // Step 1: Load installation from DB
  const installation = await prisma.installation.findUnique({
    where: { id: installationId },
  });

  if (!installation) {
    throw new Error(`Installation with id=${installationId} not found`);
  }

  if (installation.status !== 'active') {
    throw new Error(`Installation id=${installationId} is ${installation.status}, not active`);
  }

  if (installation.repos.length === 0) {
    console.log(`   ⚠️  No repos to scan for this installation`);
    return {
      installationId,
      totalRepos: 0,
      successCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  console.log(`   Account: ${installation.accountName}`);
  console.log(`   Repos to scan: ${installation.repos.join(', ')}`);

  // Step 2: Get a fresh token (valid ~1 hour, reused for all repos in this scan)
  const token = await getInstallationToken(installation.githubInstallationId);
  console.log(`   ✅ Got installation token`);

  // Step 3: Scan each repo independently
  const results: Array<{
    repo: string;
    status: 'success' | 'failed';
    callsFound?: number;
    error?: string;
  }> = [];
  let successCount = 0;
  let failedCount = 0;

  for (const repoName of installation.repos) {
    const repoUrl = `https://github.com/${installation.accountName}/${repoName}.git`;
    let clone: Awaited<ReturnType<typeof cloneRepo>> | null = null;

    try {
      clone = await cloneRepo(repoUrl, token);
      const scanResult = await scanRepoForStripe(clone.path);

      // Save successful result to DB
      await prisma.scanResult.create({
        data: {
          installationId: installation.id,
          repoName,
          filesScanned: scanResult.filesScanned,
          filesUsingStripe: scanResult.filesUsingStripe,
          calls: scanResult.calls as any, // Prisma Json type accepts any serializable value
          status: 'success',
        },
      });

      console.log(`   ✅ ${repoName}: ${scanResult.calls.length} Stripe call(s) found, saved to DB`);
      results.push({
        repo: repoName,
        status: 'success',
        callsFound: scanResult.calls.length,
      });
      successCount++;
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error(`   ❌ ${repoName}: ${errorMessage}`);

      // Save failed result to DB so we have a record of the attempt
      try {
        await prisma.scanResult.create({
          data: {
            installationId: installation.id,
            repoName,
            filesScanned: 0,
            filesUsingStripe: 0,
            calls: [] as any,
            status: 'failed',
            errorMessage: errorMessage.substring(0, 500), // truncate overly long errors
          },
        });
      } catch (dbErr) {
        console.error(`   ❌ Also failed to save error record:`, dbErr);
      }

      results.push({
        repo: repoName,
        status: 'failed',
        error: errorMessage,
      });
      failedCount++;
    } finally {
      // Clean up temp folder regardless of success/failure
      if (clone) {
        await clone.cleanup();
      }
    }
  }

  console.log('');
  console.log(`🏁 Scan complete: ${successCount} succeeded, ${failedCount} failed`);

  return {
    installationId,
    totalRepos: installation.repos.length,
    successCount,
    failedCount,
    results,
  };
}