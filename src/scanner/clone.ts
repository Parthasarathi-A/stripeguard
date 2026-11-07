import { simpleGit } from 'simple-git';
import { dir as createTempDir } from 'tmp-promise';

export interface CloneResult {
  /** Absolute path to the cloned repo on local disk */
  path: string;
  /** Cleanup function — call this when done to delete the temp folder */
  cleanup: () => Promise<void>;
}

/**
 * Clones a public GitHub repo to a temporary directory.
 * The caller MUST call cleanup() when done to free disk space.
 *
 * @param repoUrl - Full HTTPS clone URL, e.g. "https://github.com/stripe-samples/accept-a-payment.git"
 * @returns Object with the local path + a cleanup function
 */
export async function cloneRepo(repoUrl: string): Promise<CloneResult> {
  // Create a unique temp directory. unsafeCleanup allows rm -rf even if non-empty.
  const tempDir = await createTempDir({ prefix: 'stripeguard-', unsafeCleanup: true });

  console.log(`📥 Cloning ${repoUrl}`);
  console.log(`   → ${tempDir.path}`);

  try {
    const git = simpleGit();
    // --depth 1 = shallow clone, saves bandwidth and disk (we don't need history)
    await git.clone(repoUrl, tempDir.path, ['--depth', '1']);
    console.log(`   ✅ Clone complete`);

    return {
      path: tempDir.path,
      cleanup: async () => {
        await tempDir.cleanup();
        console.log(`   🧹 Cleaned up ${tempDir.path}`);
      },
    };
  } catch (err) {
    // If clone fails, clean up the empty temp dir before rethrowing
    await tempDir.cleanup();
    throw err;
  }
}