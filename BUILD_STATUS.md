# Build status

## Validation performed in this handoff

- All repository `.ts` / `.tsx` files passed a TypeScript parser/transpile syntax scan.
- The procedural generator modules compile standalone with TypeScript 5.8.3.
- Determinism smoke test passed: identical slug + difficulty + style produce byte-equivalent generated manifests.
- 1,000-seed sweeps per difficulty completed with no gate/bumper module shortfalls and no checkpoint/module overlaps.
- Current observed path ranges across the sweep:
  - Quick: 52-68 path cells (mean 58.2)
  - Classic: 106-117 path cells (mean 112.0)
  - Brutal: 171-184 path cells (mean 177.9)

## Not run in this environment

The execution environment cannot reach the npm registry reliably, so a complete dependency install / `next build` could not be run here.

After replacing the repo, run or let Vercel run:

```bash
npm install
npm run typecheck
npm run build
```

If Vercel surfaces a compile or bundling issue, preserve the complete build output. The new game code is isolated primarily under `src/game`, `src/components/game`, and `/orb/[slug]/play`, so fixes can remain surgical.
