import { cloneRepo } from './clone.js';
import { scanRepoForStripe } from './scanner.js';

/**
 * Standalone test script: clone a public Stripe-using repo and scan it.
 * Run with: npx tsx src/scanner/test-scan.ts
 */
async function main() {
  const TEST_REPO = 'https://github.com/stripe-samples/accept-a-payment.git';

  console.log('');
  console.log('🧪 StripeGuard scanner test run');
  console.log('='.repeat(60));
  console.log('');

  const clone = await cloneRepo(TEST_REPO);

  try {
    console.log('');
    const result = await scanRepoForStripe(clone.path);
    console.log('');
    console.log('📊 Results');
    console.log('='.repeat(60));
    console.log(`   Files scanned:       ${result.filesScanned}`);
    console.log(`   Files using Stripe:  ${result.filesUsingStripe}`);
    console.log(`   Total Stripe calls:  ${result.calls.length}`);
    console.log('');

    if (result.calls.length === 0) {
      console.log('   (no Stripe calls found)');
    } else {
      console.log('   Top 20 calls:');
      console.log('');
      for (const call of result.calls.slice(0, 20)) {
        console.log(`   📍 ${call.file}:${call.line}`);
        console.log(`      ${call.method}()`);
        console.log(`      ${call.snippet}`);
        console.log('');
      }
      if (result.calls.length > 20) {
        console.log(`   ...and ${result.calls.length - 20} more`);
      }
    }
  } finally {
    await clone.cleanup();
  }
}

main().catch((err) => {
  console.error('❌ Test run failed:', err);
  process.exit(1);
});