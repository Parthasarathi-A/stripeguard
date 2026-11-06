# StripeGuard

A GitHub App that auto-generates migration pull requests when Stripe SDK ships breaking changes. Uses AST analysis (not LLMs) for deterministic, safe code rewrites.

## What it does

When Stripe ships a new API version with breaking changes, StripeGuard:

1. Detects the new release from the Stripe SDK
2. Finds every repo it's installed on that uses Stripe
3. Clones the repo, scans the TypeScript AST for affected Stripe API calls
4. Rewrites the calls per Stripe's official migration guide
5. Opens a merge-ready PR with version bump + code changes + safety checklist

No LLMs. No approximate fixes. Every rewrite is a deterministic AST transformation defined by a codemod rule.