#!/usr/bin/env node
'use strict';

/**
 * DalaTech guardrails — a Claude Code PreToolUse hook, committed so cloud
 * sessions follow it too (wired in .claude/settings.json).
 *
 * ASK (a person confirms) before:
 *   - `supabase db push` (and the Supabase MCP's apply_migration / merge_branch);
 *   - `npm audit fix --force`;
 *   - merging into, or pushing to, main/master (git push/merge, `gh pr merge`,
 *     the GitHub MCP's merge_pull_request, MCP file writes on main);
 *   - Vercel Production changes: `vercel env add|rm|update … production`,
 *     `vercel --prod`, `vercel promote|rollback`, and the Vercel MCP's env /
 *     deployment / promote / rollback calls that target production.
 * DENY:
 *   - writing the blocked number (FORBIDDEN_NUMBER below) into any file (Write, Edit, MultiEdit, NotebookEdit,
 *     MCP file writes, or a shell command that writes).
 *
 * Reads the hook's JSON on stdin; prints a decision only when a rule fires.
 * A hook that cannot parse its input lets the call through (it must never
 * block ordinary work by crashing) — the rules are a safety net, not the
 * only control.
 */

const { execFileSync } = require('child_process');

// Built from two halves so this file never contains the number it blocks
// (and can still be edited under its own rule).
const FORBIDDEN_NUMBER = ['9927', '3339'].join('');
const MAIN = '(?:main|master)';

function decide(decision, reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: `DalaTech guardrail: ${reason}` } };
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch (_) {
    return null;
  }
}

/** Every string inside a value (tool inputs nest: edits[], files[], …). */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const WRITES_IN_SHELL = /(^|[^<0-9])>{1,2}(?!&)|\btee\b|\bsed\b[^|;&]*\s-[a-zA-Z]*i|\bperl\b[^|;&]*\s-[a-zA-Z]*i|\bdd\b[^|;&]*\bof=|writeFile|appendFile|\.write\(|\bopen\([^)]*['"][wa]/;

function checkBash(command, cwd) {
  const cmd = String(command || '');
  if (cmd.includes(FORBIDDEN_NUMBER) && WRITES_IN_SHELL.test(cmd)) {
    return decide('deny', `writing ${FORBIDDEN_NUMBER} into a file is not allowed.`);
  }
  if (/\bsupabase\s+(?:--?\S+\s+)*db\s+push\b/.test(cmd)) {
    return decide('ask', '`supabase db push` changes the database. Confirm before it runs.');
  }
  if (/\bnpm\s+audit\s+fix\b[^;&|]*--force\b/.test(cmd)) {
    return decide('ask', '`npm audit fix --force` can install breaking major versions. Confirm before it runs.');
  }
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) {
    return decide('ask', 'merging a pull request. Confirm before it runs.');
  }
  if (/\bgit\b[^;&|]*\bpush\b/.test(cmd)) {
    const pushToMain = new RegExp(`\\bpush\\b[^;&|]*(?:\\s|:|\\+|/)(?:refs/heads/)?${MAIN}(?=$|[\\s;&|])`).test(cmd)
      || /\bpush\b[^;&|]*\s--(?:all|mirror)\b/.test(cmd);
    const bare = /\bgit\s+push\s*(?:$|[;&|])|\bgit\s+push\s+(?:-[-\w]+\s*)*(?:origin|upstream)?\s*(?:$|[;&|])/.test(cmd);
    const onMain = new RegExp(`^${MAIN}$`).test(currentBranch(cwd) || '');
    if (pushToMain || (bare && onMain) || (onMain && /\bgit\s+push\s+(?:-[-\w]+\s+)*\w+\s+HEAD\b/.test(cmd))) {
      return decide('ask', 'pushing to main/master. Confirm before it runs.');
    }
  }
  if (/\bgit\b[^;&|]*\bmerge\b/.test(cmd) && !/\bmerge-base\b/.test(cmd)) {
    const switchesToMain = new RegExp(`\\b(?:checkout|switch)\\s+${MAIN}\\b`).test(cmd);
    const onMain = new RegExp(`^${MAIN}$`).test(currentBranch(cwd) || '');
    if (switchesToMain || onMain) return decide('ask', 'merging into main/master. Confirm before it runs.');
  }
  if (/\bvercel\b[^;&|]*\benv\s+(?:add|rm|remove|update)\b[^;&|]*\bproduction\b/.test(cmd)
    || /\bvercel\b[^;&|]*(?:\s--prod\b|\s--target[= ]production\b)/.test(cmd)
    || /\bvercel\s+(?:promote|rollback)\b/.test(cmd)) {
    return decide('ask', 'a Vercel Production change. Confirm before it runs.');
  }
  return null;
}

function targetsProduction(input) {
  return strings(input).some((s) => /^production$/i.test(s));
}

function checkMcp(tool, input) {
  if (strings(input).some((s) => s.includes(FORBIDDEN_NUMBER)) && /(create_or_update_file|push_files|write|upload|update_doc|create_file)/i.test(tool)) {
    return decide('deny', `writing ${FORBIDDEN_NUMBER} into a file is not allowed.`);
  }
  if (/^mcp__github__merge_pull_request$|^mcp__github__enable_pr_auto_merge$/.test(tool)) {
    return decide('ask', 'merging a pull request. Confirm before it runs.');
  }
  if (/^mcp__github__(create_or_update_file|push_files|delete_file)$/.test(tool)
    && new RegExp(`^(?:refs/heads/)?${MAIN}$`).test(String((input && input.branch) || ''))) {
    return decide('ask', 'writing to main/master on GitHub. Confirm before it runs.');
  }
  if (/^mcp__supabase__(apply_migration|merge_branch)$/.test(tool)) {
    return decide('ask', 'a database migration (the MCP form of `supabase db push`). Confirm before it runs.');
  }
  if (/^mcp__[Vv]ercel__(request_promote|request_rollback|promote|rollback)/.test(tool)) {
    return decide('ask', 'a Vercel Production change. Confirm before it runs.');
  }
  if (/^mcp__[Vv]ercel__(create_project_env|edit_project_env|update_shared_env_variable|delete_project_env|create_deployment)$/.test(tool) && targetsProduction(input)) {
    return decide('ask', 'a Vercel Production change. Confirm before it runs.');
  }
  return null;
}

function checkFileWrite(input) {
  if (strings(input).some((s) => s.includes(FORBIDDEN_NUMBER))) {
    return decide('deny', `writing ${FORBIDDEN_NUMBER} into a file is not allowed.`);
  }
  return null;
}

function evaluate(event) {
  const tool = String((event && event.tool_name) || '');
  const input = (event && event.tool_input) || {};
  if (tool === 'Bash') return checkBash(input.command, event.cwd);
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const { file_path: _f, notebook_path: _n, old_string: _o, ...written } = input;
    return checkFileWrite(written);
  }
  if (tool.startsWith('mcp__')) return checkMcp(tool, input);
  return null;
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let event;
    try { event = JSON.parse(raw); } catch (_) { process.exit(0); }
    const result = evaluate(event);
    if (result) process.stdout.write(JSON.stringify(result));
    process.exit(0);
  });
}

module.exports = { evaluate, FORBIDDEN_NUMBER };
