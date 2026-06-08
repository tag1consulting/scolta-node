/**
 * Persisted memory-budget configuration (port of `Config\MemoryBudgetConfig`
 * and the `MemoryBudgetRepository` contract).
 */

import { MemoryBudget } from "./memory-budget.js";
import { MemoryBudgetSuggestion, type BudgetSuggestion } from "./memory-telemetry.js";

const NAMED_PROFILES = ["conservative", "balanced", "aggressive"];
const BYTE_STRING = /^\d+[KkMmGg]?$/;

function isValidMemoryString(value: string): boolean {
  return NAMED_PROFILES.includes(value) || BYTE_STRING.test(value);
}

export class MemoryBudgetConfig {
  constructor(
    private readonly _profile: string,
    private readonly _customBytes: number | null = null,
    private readonly _chunkSize: number | null = null,
  ) {}

  static defaults(): MemoryBudgetConfig {
    return new MemoryBudgetConfig("conservative");
  }

  static load(data: Record<string, unknown>): MemoryBudgetConfig {
    let profile = (data["profile"] as string) ?? "conservative";
    const customBytes = data["custom_bytes"] != null ? Number(data["custom_bytes"]) : null;
    const rawChunk = data["chunk_size"];
    const chunkSize = rawChunk != null && Number(rawChunk) >= 1 ? Number(rawChunk) : null;
    if (!isValidMemoryString(String(profile))) profile = "conservative";
    return new MemoryBudgetConfig(profile, customBytes || null, chunkSize);
  }

  toMemoryBudget(): MemoryBudget {
    const memoryStr = this._customBytes !== null ? String(this._customBytes) : this._profile;
    return MemoryBudget.fromOptions(memoryStr, this._chunkSize ?? undefined);
  }

  validate(): string[] {
    const errors: string[] = [];
    if (!isValidMemoryString(this._profile)) {
      errors.push(
        `Invalid memory_budget profile "${this._profile}". Must be a named profile ` +
          `(${NAMED_PROFILES.join(", ")}) or a byte value like "256M".`,
      );
    }
    if (this._customBytes !== null && this._customBytes < 0) {
      errors.push("custom_bytes must be a non-negative integer.");
    }
    if (this._chunkSize !== null && this._chunkSize < 1) {
      errors.push("chunk_size must be a positive integer.");
    }
    return errors;
  }

  static fromCliAndConfig(
    cliBudgetOption: string | null,
    cliChunkOption: string | null,
    configReader: () => Record<string, unknown>,
  ): MemoryBudget {
    const config = configReader();
    const budgetStr = cliBudgetOption ?? (config["profile"] as string) ?? "conservative";
    const rawChunk = cliChunkOption ?? config["chunk_size"];
    const chunkSize = rawChunk != null && Number(rawChunk) >= 1 ? Number(rawChunk) : undefined;
    return MemoryBudget.fromOptions(String(budgetStr), chunkSize);
  }

  suggest(): BudgetSuggestion {
    return MemoryBudgetSuggestion.suggest();
  }

  profile(): string {
    return this._profile;
  }
  customBytes(): number | null {
    return this._customBytes;
  }
  chunkSize(): number | null {
    return this._chunkSize;
  }
  toObject(): { profile: string; custom_bytes: number | null; chunk_size: number | null } {
    return { profile: this._profile, custom_bytes: this._customBytes, chunk_size: this._chunkSize };
  }
}

export interface MemoryBudgetRepository {
  load(): MemoryBudgetConfig;
  save(config: MemoryBudgetConfig): void;
  resolve(): MemoryBudget;
}
