import { createAppAuth } from '@octokit/auth-app';
import { readFileSync } from 'fs';

// Load credentials once at module load (not per request)
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH;

if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY_PATH) {
  throw new Error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY_PATH in .env');
}

const privateKey = readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf-8');

// Create a single auth instance — it caches internally
const auth = createAppAuth({
  appId: GITHUB_APP_ID,
  privateKey,
});

/**
 * Returns a short-lived installation access token (valid ~1 hour)
 * for the given GitHub installation ID.
 *
 * Use this token in clone URLs like:
 *   https://x-access-token:TOKEN@github.com/owner/repo.git
 *
 * @param installationId - GitHub's installation ID (from the webhook payload or DB)
 * @returns The access token string
 */
export async function getInstallationToken(installationId: number | bigint): Promise<string> {
  const result = await auth({
    type: 'installation',
    installationId: Number(installationId), // BigInt → Number
  });

  return result.token;
}