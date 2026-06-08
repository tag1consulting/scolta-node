/**
 * Memory telemetry + budget suggestion.
 *
 * Ports `MemoryTelemetry` and `MemoryBudgetSuggestion`. Behaviour-matched
 * rather than byte-translated (JS memory model differs): RSS via
 * `process.memoryUsage().rss`, cgroup-aware effective limit, warn at 75% /
 * abort at 90%. Memory closures are injectable for tests (the orchestrator's
 * yield/abort paths rely on this).
 */

import * as fs from "node:fs";
import { MemoryBudget } from "./memory-budget.js";

const MIB = 1024 * 1024;

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

function readProcRss(field: "VmRSS" | "VmHWM"): number | null {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf-8");
    const m = new RegExp(`^${field}:\\s+(\\d+)`, "m").exec(status);
    return m ? parseInt(m[1]!, 10) * 1024 : null;
  } catch {
    return null;
  }
}

function currentRss(): number {
  return readProcRss("VmRSS") ?? process.memoryUsage().rss;
}

function peakRss(): number {
  return readProcRss("VmHWM") ?? process.memoryUsage().rss;
}

export function readCgroupLimit(): number {
  try {
    const v = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf-8").trim();
    if (v !== "max" && /^\d+$/.test(v)) return parseInt(v, 10);
  } catch {
    /* fall through */
  }
  try {
    const val = parseInt(fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf-8").trim(), 10);
    if (val > 0 && val < 1_099_511_627_776) return val;
  } catch {
    /* fall through */
  }
  return 0;
}

export interface MemoryTelemetryOptions {
  getCurrentMemory?: () => number;
  getPeakMemory?: () => number;
  limitBytes?: number;
}

export class MemoryTelemetry {
  readonly limitBytes: number;
  private readonly logger: Logger;
  private readonly getCurrent: () => number;
  private readonly getPeak: () => number;
  private peakSeen = 0;

  constructor(logger?: Logger, _budget?: MemoryBudget, opts: MemoryTelemetryOptions = {}) {
    this.logger = logger ?? console;
    this.limitBytes = opts.limitBytes ?? readCgroupLimit();
    this.getCurrent = opts.getCurrentMemory ?? currentRss;
    this.getPeak = opts.getPeakMemory ?? peakRss;
  }

  emit(phase: string, _extra?: Record<string, unknown>): void {
    const current = this.getCurrent();
    const pct = this.limitBytes > 0 ? Math.round((current / this.limitBytes) * 1000) / 10 : 0;
    if (pct >= 90.0 && this.limitBytes > 0) {
      const limitMb = Math.round((this.limitBytes / MIB) * 10) / 10;
      this.logger.error(`[scolta] Memory at ${pct}% of limit (${limitMb} MB) at phase ${phase}. Aborting.`);
      throw new Error(
        `Memory usage (${pct}% of ${limitMb} MB limit) exceeds safe threshold at phase '${phase}'. ` +
          `Use --memory-budget=conservative or reduce chunk size.`,
      );
    }
    if (pct >= 75.0 && this.limitBytes > 0) {
      this.logger.warn(`[scolta] Memory at ${pct}% of limit at phase ${phase}.`);
    } else {
      this.logger.info(`[scolta] Phase ${phase} (${pct}% of limit).`);
    }
  }

  getCurrentRssBytes(): number {
    return this.getCurrent();
  }

  getPeakRssBytes(): number {
    this.peakSeen = Math.max(this.peakSeen, this.getPeak());
    return this.peakSeen;
  }

  effectiveLimitBytes(): number {
    return this.limitBytes;
  }
}

export interface BudgetSuggestion {
  profile: string;
  reason: string;
  detected_limit_bytes: number | null;
  confidence: string;
}

export class MemoryBudgetSuggestion {
  static suggest(limitBytes?: number): BudgetSuggestion {
    const bytes = limitBytes ?? readCgroupLimit() ?? null;
    if (!bytes) {
      return {
        profile: "conservative",
        reason: "Memory limit could not be determined. The conservative profile is the safe default.",
        detected_limit_bytes: null,
        confidence: "low",
      };
    }
    const mb = Math.round(bytes / MIB);
    if (bytes >= 768 * MIB) {
      return { profile: "aggressive", reason: `Memory limit is ${mb}MB. The aggressive profile will maximise throughput.`, detected_limit_bytes: bytes, confidence: "high" };
    }
    if (bytes >= 192 * MIB) {
      return { profile: "balanced", reason: `Memory limit is ${mb}MB. The balanced profile is recommended.`, detected_limit_bytes: bytes, confidence: "high" };
    }
    const confidence = bytes < 64 * MIB ? "low" : "high";
    return { profile: "conservative", reason: `Memory limit is ${mb}MB. The conservative profile is recommended.`, detected_limit_bytes: bytes, confidence };
  }

  static checkProfileFit(profile: string, limitBytes?: number): { status: string; warning: string | null; profile_budget_bytes: number; limit_bytes: number | null } {
    const budget = MemoryBudget.fromString(profile).totalBudgetBytes();
    const resolved = limitBytes ?? readCgroupLimit() ?? null;
    if (resolved === null || resolved <= 0 || budget <= 0.7 * resolved) {
      return { status: "safe", warning: null, profile_budget_bytes: budget, limit_bytes: resolved };
    }
    const budgetMb = Math.round(budget / MIB);
    const limitMb = Math.round(resolved / MIB);
    return {
      status: "warn",
      warning: `Scolta's internal allocation budget for this profile is approximately ${budgetMb} MB, but the memory limit is only ${limitMb} MB. Choose a smaller profile or raise the limit.`,
      profile_budget_bytes: budget,
      limit_bytes: resolved,
    };
  }

  static getMemoryLimitText(limitBytes?: number): string {
    const resolved = limitBytes ?? readCgroupLimit() ?? null;
    if (resolved === null || resolved === 0) return "unknown (could not read limit)";
    return `${Math.round(resolved / MIB)} MB`;
  }
}
