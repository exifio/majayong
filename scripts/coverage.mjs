#!/usr/bin/env node
/**
 * 실행 라인 기준 통합 커버리지.
 *
 * Jest(A)와 node:test는 계측기가 달라 단순 합산할 수 없다. 여기서는
 * Jest(Istanbul)의 실행 라인 집합을 분모로 쓰고, node:test의 미커버 라인을
 * 빼서 두 러너가 실제로 실행한 라인의 합집합을 계산한다.
 *
 * - 실행 라인 기준이라 타입 선언·주석·빈 줄은 분모에서 빠진다.
 * - 화면(screens)·템플릿(lib)·부트스트랩/CLI는 커버리지 대상에서 제외한다.
 * - test:a와 같은 TEST_DATABASE_URL/DATABASE_URL이 필요하다.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const MIN = Number(process.env.COVERAGE_MIN ?? 90);

const EXCLUDED_PREFIXES = ["src/screens/", "src/lib/", "src/test-support/"];
const EXCLUDED_FILES = new Set(["src/index.ts", "src/snapshot.ts", "src/check-links.ts"]);

const NODE_TEST_GLOBS = [
  "src/**/*.spec.ts",
  "tests/b/*.test.ts",
  "tests/c/*.test.ts",
  "tests/integration/*.test.ts",
];

const keep = (rel) =>
  rel.startsWith("src/") &&
  !/\.(test|spec)\.ts$/.test(rel) &&
  !EXCLUDED_FILES.has(rel) &&
  !EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix));

const expandLines = (spec) => {
  const lines = new Set();
  for (const part of spec.trim().split(/\s+/)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) continue;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    for (let line = start; line <= end; line += 1) lines.add(line);
  }
  return lines;
};

/** node:test가 출력한 커버리지 표에서 파일별 미커버 라인을 읽는다. */
function parseNodeCoverage(output) {
  const rows = new Map();
  const dirs = [];
  for (const raw of output.split("\n")) {
    if (!raw.startsWith("ℹ ")) continue;
    const body = raw.slice(2);
    const indent = body.length - body.trimStart().length;
    const rest = body.trim();
    if (
      !rest ||
      rest.startsWith("---") ||
      rest.startsWith("start of") ||
      rest.startsWith("end of") ||
      rest.startsWith("file ") ||
      rest.startsWith("all files")
    ) {
      continue;
    }
    const cells = rest.split("|").map((cell) => cell.trim());
    if (cells.length >= 5 && /^\d/.test(cells[1])) {
      rows.set([...dirs.slice(0, indent), cells[0]].join("/"), expandLines(cells[4]));
    } else if (cells[0]) {
      dirs[indent] = cells[0];
    }
  }
  return rows;
}

function runNodeTests() {
  const args = [
    "--experimental-test-coverage",
    "--test-coverage-include=src/**/*.ts",
    "--test-coverage-exclude=src/**/*.test.ts",
    "--test-coverage-exclude=src/**/*.spec.ts",
    "--test-coverage-exclude=src/test-support/**",
    "--test-coverage-include-all",
    "--import",
    "./src/test-support/resolve-ts.mjs",
    "--test",
    ...NODE_TEST_GLOBS,
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    throw new Error("node:test 실행이 실패했습니다.");
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function runJest(coverageDir) {
  const bin = path.join(ROOT, "node_modules", ".bin", "jest");
  execFileSync(
    bin,
    [
      "--runInBand",
      "--coverage",
      "--coverageReporters=json",
      `--coverageDirectory=${coverageDir}`,
      "--collectCoverageFrom=src/**/*.ts",
      "--collectCoverageFrom=!src/**/*.test.ts",
      "--collectCoverageFrom=!src/**/*.spec.ts",
      "--collectCoverageFrom=!src/test-support/**",
    ],
    { cwd: ROOT, env: process.env, stdio: ["ignore", "ignore", "inherit"] },
  );
}

function merge(nodeRows, jestCoverage) {
  const groups = new Map();
  let total = 0;
  let covered = 0;

  for (const [file, coverage] of Object.entries(jestCoverage)) {
    const rel = path.relative(ROOT, file);
    if (!keep(rel)) continue;

    const executable = new Set();
    const jestCovered = new Set();
    for (const [id, statement] of Object.entries(coverage.statementMap)) {
      for (let line = statement.start.line; line <= statement.end.line; line += 1) {
        executable.add(line);
        if (coverage.s[id] > 0) jestCovered.add(line);
      }
    }
    if (executable.size === 0) continue;

    const nodeUncovered = nodeRows.get(rel) ?? new Set();
    const union = new Set(jestCovered);
    for (const line of executable) if (!nodeUncovered.has(line)) union.add(line);

    const key = rel.startsWith("src/modules/") ? rel.split("/").slice(0, 3).join("/") : rel.split("/").slice(0, 2).join("/");
    const group = groups.get(key) ?? { total: 0, covered: 0 };
    group.total += executable.size;
    group.covered += union.size;
    groups.set(key, group);

    total += executable.size;
    covered += union.size;
  }

  return { groups, total, covered };
}

if (!process.env.TEST_DATABASE_URL || !process.env.DATABASE_URL) {
  console.error("test:coverage는 test:a와 같은 TEST_DATABASE_URL·DATABASE_URL이 필요합니다.");
  process.exit(2);
}

const coverageDir = mkdtempSync(path.join(os.tmpdir(), "majayong-coverage-"));
try {
  const nodeOutput = runNodeTests();
  const nodeRows = parseNodeCoverage(nodeOutput);
  runJest(coverageDir);
  const jestCoverage = JSON.parse(readFileSync(path.join(coverageDir, "coverage-final.json"), "utf8"));
  const { groups, total, covered } = merge(nodeRows, jestCoverage);
  const pct = (covered / total) * 100;

  console.log(`\n커버리지 (실행 라인 union): ${pct.toFixed(2)}% (${covered}/${total})`);
  console.log(`임계값: ${MIN}%  ${pct >= MIN ? "PASS" : "FAIL"}`);
  console.log("\n그룹별:");
  for (const [name, group] of [...groups].sort(
    (a, b) => a[1].covered / a[1].total - b[1].covered / b[1].total,
  )) {
    const groupPct = ((group.covered / group.total) * 100).toFixed(1);
    console.log(`  ${name.padEnd(26)} ${groupPct.padStart(5)}% (${group.covered}/${group.total})`);
  }

  if (pct < MIN) process.exitCode = 1;
} finally {
  rmSync(coverageDir, { recursive: true, force: true });
}
