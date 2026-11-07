import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

/** One detected Stripe SDK call in the source code */
export interface StripeCall {
  /** Repo-relative file path, e.g. "src/payments/charge.ts" */
  file: string;
  /** 1-indexed line number */
  line: number;
  /** The full method chain, e.g. "customers.create" or "paymentIntents.confirm" */
  method: string;
  /** The raw source text of the call, e.g. "stripe.customers.create({ email })" */
  snippet: string;
}

/** Summary of scanning one repo */
export interface ScanResult {
  /** Absolute path to the repo that was scanned */
  repoPath: string;
  /** Number of TypeScript/JavaScript files found */
  filesScanned: number;
  /** Number of files that import the Stripe SDK */
  filesUsingStripe: number;
  /** Every Stripe SDK call found across the whole repo */
  calls: StripeCall[];
}

/**
 * Scans a local directory for Stripe SDK usage.
 * Walks all .ts/.js files, finds imports of "stripe", traces variables
 * constructed from those imports, and records every method call on them.
 */
export async function scanRepoForStripe(repoPath: string): Promise<ScanResult> {
  console.log(`🔍 Scanning ${repoPath} for Stripe SDK usage...`);

  // Create a ts-morph Project. useInMemoryFileSystem=false means read from disk.
  // skipAddingFilesFromTsConfig=true because we're adding files manually (below).
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true, // scan .js files too, not just .ts
    },
  });

  // Add every .ts/.tsx/.js/.jsx file in the repo, excluding node_modules, .git, dist, build
  const sourceFiles = addAllSourceFiles(project, repoPath);
  console.log(`   📄 Found ${sourceFiles.length} source files`);

  const calls: StripeCall[] = [];
  let filesUsingStripe = 0;

  for (const sourceFile of sourceFiles) {
    const stripeCallsInFile = findStripeCallsInFile(sourceFile, repoPath);
    if (stripeCallsInFile.length > 0) {
      filesUsingStripe++;
      calls.push(...stripeCallsInFile);
    }
  }

  console.log(`   ✅ Scan complete: ${calls.length} Stripe call(s) in ${filesUsingStripe} file(s)`);

  return {
    repoPath,
    filesScanned: sourceFiles.length,
    filesUsingStripe,
    calls,
  };
}

/**
 * Recursively finds all .ts/.tsx/.js/.jsx files in the repo and adds them
 * to the ts-morph Project. Skips common noise folders.
 */
function addAllSourceFiles(project: Project, repoPath: string): SourceFile[] {
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage']);
  const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const files: SourceFile[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip unreadable dirs
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE.has(entry.name) && !entry.name.startsWith('.')) {
          walk(full);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (EXTENSIONS.has(ext)) {
          try {
            const sf = project.addSourceFileAtPath(full);
            files.push(sf);
          } catch {
            // ts-morph might reject unparseable files; skip them
          }
        }
      }
    }
  }

  walk(repoPath);
  return files;
}

/**
 * For a single source file:
 *   1. Find imports of the "stripe" package
 *   2. Collect the local names bound to those imports (e.g. default import "Stripe")
 *   3. Find all variables constructed from those imports (e.g. `new Stripe(...)`)
 *   4. Find all method calls on those variables
 */
function findStripeCallsInFile(sourceFile: SourceFile, repoRoot: string): StripeCall[] {
  const results: StripeCall[] = [];
  const relativePath = path.relative(repoRoot, sourceFile.getFilePath()).replace(/\\/g, '/');

  // Step 1 & 2: find all imports from "stripe" and collect their local names
  const stripeImportNames = new Set<string>();
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleName = importDecl.getModuleSpecifierValue();
    if (moduleName === 'stripe') {
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        stripeImportNames.add(defaultImport.getText());
      }
      for (const namedImport of importDecl.getNamedImports()) {
        stripeImportNames.add(namedImport.getName());
      }
    }
  }

  if (stripeImportNames.size === 0) {
    return results; // this file doesn't import stripe
  }

  // Step 3: find all variable declarations that are `new <stripeImport>(...)`
  // These are the Stripe instance variables, e.g. `const stripe = new Stripe(...)`
  const stripeInstanceNames = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.NewExpression) {
      const newExpr = node.asKindOrThrow(SyntaxKind.NewExpression);
      const constructorName = newExpr.getExpression().getText();
      if (stripeImportNames.has(constructorName)) {
        // Walk up to find the enclosing variable declaration
        const varDecl = newExpr.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (varDecl) {
          stripeInstanceNames.add(varDecl.getName());
        }
      }
    }
  });

  if (stripeInstanceNames.size === 0) {
    return results; // imports stripe but doesn't instantiate it (rare but possible)
  }

  // Step 4: find all method calls on those Stripe instance variables
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;

    const callExpr = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expression = callExpr.getExpression();

    // We only care about property-access calls: foo.bar.baz(...)
    if (expression.getKind() !== SyntaxKind.PropertyAccessExpression) return;

    // Walk the property access chain down to its root identifier
    // e.g. "stripe.customers.create" → root is "stripe"
    const chain = buildAccessChain(expression);
    if (chain.length < 2) return; // need at least stripe.something

    const root = chain[0];
    if (!stripeInstanceNames.has(root)) return;

    // Found a Stripe call. Record it.
    const method = chain.slice(1).join('.'); // "customers.create"
    const { line } = sourceFile.getLineAndColumnAtPos(callExpr.getStart());
    const snippet = callExpr.getText().split('\n')[0].substring(0, 120); // single line, capped length

    results.push({
      file: relativePath,
      line,
      method,
      snippet,
    });
  });

  return results;
}

/**
 * Given a PropertyAccessExpression like `stripe.customers.create`,
 * returns ["stripe", "customers", "create"].
 */
function buildAccessChain(expr: Node): string[] {
  const parts: string[] = [];
  let current: Node = expr;

  while (true) {
    if (current.isKind(SyntaxKind.PropertyAccessExpression)) {
      parts.unshift(current.getName());
      current = current.getExpression();
    } else {
      break;
    }
  }

  if (current.isKind(SyntaxKind.Identifier)) {
    parts.unshift(current.getText());
  }
  return parts;
}