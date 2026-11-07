import { simpleGit } from 'simple-git';
import { dir as createTempDir } from 'tmp-promise';

export interface CloneResult {
  /** Absolute path to the cloned repo on local disk */
  path: string;
  /** Cleanup function — call this when done to delete the temp folder */
  cleanup: () => Promise<void>;
}

/**
 * Clones a GitHub repo to a temporary directory.
 * Supports both public repos (no token) and private repos (with installation token).
 *
 * @param repoUrl - Full HTTPS clone URL, e.g. "https://github.com/owner/repo.git"
 * @param token - Optional GitHub installation access token for private repos
 * @returns Object with the local path + a cleanup function
 */
export async function cloneRepo(repoUrl: string, token?: string): Promise<CloneResult> {
  const tempDir = await createTempDir({ prefix: 'stripeguard-', unsafeCleanup: true });

  // If a token is provided, embed it in the URL for authentication.
  // Format: https://x-access-token:TOKEN@github.com/owner/repo.git
  const authenticatedUrl = token
    ? repoUrl.replace('https://', `https://x-access-token:${token}@`)
    : repoUrl;

  // Log the sanitized URL (never log the token itself)
  console.log(`📥 Cloning ${repoUrl}${token ? ' (authenticated)' : ''}`);
  console.log(`   → ${tempDir.path}`);

  try {
    const git = simpleGit();
    await git.clone(authenticatedUrl, tempDir.path, ['--depth', '1']);
    console.log(`   ✅ Clone complete`);

    return {
      path: tempDir.path,
      cleanup: async () => {
        await tempDir.cleanup();
        console.log(`   🧹 Cleaned up ${tempDir.path}`);
      },
    };
  } catch (err) {
    await tempDir.cleanup();
    throw err;
  }
}