/**
 * report.ts — DB migration trigger (runs web/src/migrate.ts) and result listing
 *
 * Phase 4 artifact: non-fatal if migration fails.
 */

import path from "path";
import fs from "fs";

/**
 * Trigger the DB migration by running web/src/migrate.ts via bun.
 * Non-fatal: returns false if the migration fails.
 */
export function triggerMigration(repoRoot: string): boolean {
  const migrateScript = path.join(repoRoot, "web", "src", "migrate.ts");

  if (!fs.existsSync(migrateScript)) {
    console.error(`  WARN: migration script not found at: ${migrateScript}`);
    return false;
  }

  console.log("Migrating eval results into DB...");
  const proc = Bun.spawnSync(["bun", migrateScript], {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (proc.exitCode !== 0) {
    console.log("  WARN: DB migration failed (non-fatal)");
    return false;
  }

  return true;
}

/**
 * List available eval runs from the results directory.
 */
export function listRuns(resultsDir: string): void {
  if (!fs.existsSync(resultsDir)) {
    console.log(`No results directory found at: ${resultsDir}`);
    return;
  }

  let files: string[];
  try {
    files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    console.log(`No result files found in: ${resultsDir}`);
    return;
  }

  if (files.length === 0) {
    console.log(`No result files found in: ${resultsDir}`);
    return;
  }

  console.log("Available eval runs:");
  console.log();

  for (const fname of files) {
    const fpath = path.join(resultsDir, fname);
    try {
      const data = JSON.parse(fs.readFileSync(fpath, "utf-8"));
      const date = (data.date ?? "").slice(0, 10);
      const isBaseline = data.is_complete_baseline ?? false;
      const resultsList: Array<{ score?: string }> = data.results ?? [];
      const passCount = resultsList.filter((r) => r.score === "pass").length;
      const partialCount = resultsList.filter((r) => r.score === "partial").length;
      const failCount = resultsList.filter((r) => r.score === "fail").length;
      const scenariosRun = data.scenarios_run ?? resultsList.length;
      const baselineLabel = isBaseline ? "[BASELINE]   " : "[partial]    ";
      console.log(
        `  ${date}  ${baselineLabel}  ${passCount}P/${partialCount}p/${failCount}F  (${scenariosRun} scenarios)  ${fname}`
      );
    } catch (e) {
      console.log(`  ERROR reading ${fname}: ${e}`);
    }
  }
}
