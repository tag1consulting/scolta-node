/**
 * Memory budget profiles (port of `Tag1\Scolta\Index\MemoryBudget`).
 *
 * Advisory budget shaping chunk sizes, flush thresholds and merge fan-in. The
 * runtime default is always conservative; larger profiles are opt-in.
 */

const MIB = 1024 * 1024;

export class MemoryBudget {
  constructor(
    readonly profile: string,
    private readonly _chunkSize: number,
    private readonly _fragmentFlushBytes: number,
    private readonly _wordIndexChunkBytes: number,
    private readonly _mergeOpenFileHandles: number,
    private readonly _totalBudgetBytes: number,
    private readonly _tokenCacheChunkBytes: number,
  ) {}

  static conservative(): MemoryBudget {
    return new MemoryBudget("conservative", 50, 40_000, 40_000, 50, 96 * MIB, 4 * MIB);
  }
  static balanced(): MemoryBudget {
    return new MemoryBudget("balanced", 200, 160_000, 160_000, 200, 384 * MIB, 16 * MIB);
  }
  static aggressive(): MemoryBudget {
    return new MemoryBudget("aggressive", 500, 512_000, 512_000, 500, 1024 * MIB, 64 * MIB);
  }

  static fromBytes(numBytes: number): MemoryBudget {
    if (numBytes >= 768 * MIB) return MemoryBudget.aggressive();
    if (numBytes >= 192 * MIB) return MemoryBudget.balanced();
    return MemoryBudget.conservative();
  }

  static fromString(value: string): MemoryBudget {
    const v = value.trim().toLowerCase();
    if (v === "conservative") return MemoryBudget.conservative();
    if (v === "balanced") return MemoryBudget.balanced();
    if (v === "aggressive") return MemoryBudget.aggressive();
    return MemoryBudget.fromBytes(parseByteString(v));
  }

  static default(): MemoryBudget {
    return MemoryBudget.conservative();
  }

  static fromOptions(memoryBudget = "conservative", chunkSize?: number): MemoryBudget {
    const budget = MemoryBudget.fromString(memoryBudget);
    if (chunkSize !== undefined && chunkSize >= 1) {
      return budget.withChunkSize(chunkSize);
    }
    return budget;
  }

  withChunkSize(chunkSize: number): MemoryBudget {
    return new MemoryBudget(
      this.profile,
      chunkSize,
      this._fragmentFlushBytes,
      this._wordIndexChunkBytes,
      Math.max(chunkSize, this._mergeOpenFileHandles),
      this._totalBudgetBytes,
      this._tokenCacheChunkBytes,
    );
  }

  chunkSize(): number {
    return this._chunkSize;
  }
  fragmentFlushBytes(): number {
    return this._fragmentFlushBytes;
  }
  wordIndexChunkBytes(): number {
    return this._wordIndexChunkBytes;
  }
  mergeOpenFileHandles(): number {
    return this._mergeOpenFileHandles;
  }
  totalBudgetBytes(): number {
    return this._totalBudgetBytes;
  }
  tokenCacheChunkBytes(): number {
    return this._tokenCacheChunkBytes;
  }
}

function parseByteString(value: string): number {
  if (value === "" || value === "0") return 0;
  const m = /^(\d+)/.exec(value);
  const num = m ? parseInt(m[1]!, 10) : 0;
  const unit = value.trim().slice(-1).toLowerCase();
  if (unit === "g") return num * 1024 * 1024 * 1024;
  if (unit === "m") return num * MIB;
  if (unit === "k") return num * 1024;
  return /^\d+$/.test(value) ? parseInt(value, 10) : 0;
}
