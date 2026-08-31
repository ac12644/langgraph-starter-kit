import { describe, expect, it, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateEnv,
  generatePackageJson,
  generateTsConfig,
  getPatternFiles,
  type Config,
} from "../../create-langgraph-app/create";

/**
 * The scaffolder's own output is not covered by anything else: CI typechecks
 * the kit, never a generated project. That gap shipped a broken `dev:http` in
 * 1.1.0 and 1.2.0 (a script pointing at a file the generator never wrote), and
 * the same class of bug — a generated file importing a module the generator
 * doesn't emit — has recurred since.
 *
 * These tests generate a project and compile it with the real tsc.
 *
 * The generated project borrows the kit's node_modules, since every provider
 * SDK it can ask for is already a kit dependency. That means these tests catch
 * unresolvable *relative* imports between generated files — the recurring bug —
 * but not a dependency missing from the generated package.json.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function scaffold(config: Config): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgsk-scaffold-"));
  tmpDirs.push(dir);

  const files = [
    { path: "package.json", content: generatePackageJson(config) },
    { path: "tsconfig.json", content: generateTsConfig() },
    { path: ".env", content: generateEnv(config) },
    ...getPatternFiles(config),
  ];
  for (const file of files) {
    const full = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.content);
  }

  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  return dir;
}

/** Compile the generated project; returns tsc's output ("" when clean). */
function typecheck(dir: string): string {
  try {
    execFileSync(path.join(repoRoot, "node_modules/.bin/tsc"), ["--noEmit"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
  }
}

const ALL_PATTERNS = ["supervisor", "swarm", "hitl", "structured", "rag"];

describe("scaffolded projects compile", () => {
  it("with every pattern selected", () => {
    const dir = scaffold({ name: "all-app", provider: "openai", patterns: ALL_PATTERNS });
    expect(typecheck(dir)).toBe("");
  }, 120_000);

  // Each pattern alone: a pattern can be broken in isolation while the
  // combined project still compiles (e.g. its files are emitted by a sibling).
  it.each(ALL_PATTERNS)("with only the %s pattern", (pattern) => {
    const dir = scaffold({ name: `${pattern}-app`, provider: "openai", patterns: [pattern] });
    expect(typecheck(dir)).toBe("");
  }, 120_000);

  it("emits every file its own imports reference", () => {
    const dir = scaffold({ name: "imports-app", provider: "ollama", patterns: ALL_PATTERNS });
    const written = new Set(
      getPatternFiles({ name: "imports-app", provider: "ollama", patterns: ALL_PATTERNS })
        .map((f) => f.path)
    );

    const missing: string[] = [];
    for (const filePath of written) {
      const src = fs.readFileSync(path.join(dir, filePath), "utf-8");
      for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const target = path
          .normalize(path.join(path.dirname(filePath), m[1]))
          .replace(/\\/g, "/");
        if (!written.has(`${target}.ts`)) missing.push(`${filePath} → ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
