#!/usr/bin/env node
/**
 * Frontmatter lint — enforces the packaging validator's rules before publish.
 *
 * The packaging validator hard-fails on these, and our own internal skills violate
 * some of them (they survive only because they are never packaged). Catch it here.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKILLS = join(ROOT, "skills");

const ALLOWED_KEYS = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);

function findSkillFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findSkillFiles(p));
    else if (entry === "SKILL.md") out.push(p);
  }
  return out;
}

const errors = [];
const files = findSkillFiles(SKILLS);

if (files.length === 0) {
  console.error("FAIL: no SKILL.md found.");
  process.exit(1);
}

for (const file of files) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8");

  if (!text.startsWith("---\n")) {
    errors.push(`${rel}: must start with '---' frontmatter delimiter`);
    continue;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    errors.push(`${rel}: unterminated frontmatter block`);
    continue;
  }
  const block = text.slice(4, end);

  const keys = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
    if (m) keys.push(m[1]);
  }

  for (const k of keys) {
    if (!ALLOWED_KEYS.has(k)) {
      errors.push(`${rel}: key '${k}' is not permitted by the packaging validator (allowed: ${[...ALLOWED_KEYS].join(", ")})`);
    }
  }
  for (const req of ["name", "description"]) {
    if (!keys.includes(req)) errors.push(`${rel}: missing required key '${req}'`);
  }

  const nameMatch = block.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    if (!/^[a-z0-9-]+$/.test(name)) errors.push(`${rel}: name '${name}' must be kebab-case [a-z0-9-]`);
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      errors.push(`${rel}: name '${name}' must not start/end with '-' or contain '--'`);
    }
    if (name.length > 64) errors.push(`${rel}: name exceeds 64 chars`);
    // Must not shadow a built-in skill.
    const BUILTINS = ["run", "init", "review", "verify", "commit", "simplify", "schedule", "loop", "security-review"];
    if (BUILTINS.includes(name)) {
      errors.push(`${rel}: name '${name}' shadows a built-in skill`);
    }
  }

  const descMatch = block.match(/^description:\s*([\s\S]+?)(?=\n[a-z-]+:|$)/m);
  if (descMatch) {
    const desc = descMatch[1].trim();
    if (desc.length > 1024) errors.push(`${rel}: description exceeds 1024 chars (${desc.length})`);
    if (/[<>]/.test(desc)) errors.push(`${rel}: description must not contain '<' or '>' (packaging validator rejects it)`);
  }
}

if (errors.length > 0) {
  console.error("\nFRONTMATTER LINT FAILED:\n");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log(`Frontmatter lint clean — ${files.length} skill file(s).`);
