/**
 * Pick the best Claude models from the LiteLLM proxy.
 *
 * Port of `scolta.ai.amazee.model_resolver.AmazeeModelResolver`: highest-version
 * `sonnet` → ai_model, highest-version `haiku` → ai_expansion_model.
 */

import type { AmazeeClient } from "./client.js";

export interface ResolvedModels {
  ai_model: string | null;
  ai_expansion_model: string | null;
}

export class AmazeeModelResolver {
  constructor(private readonly client: AmazeeClient) {}

  async resolve(litellmApiUrl: string, litellmToken: string): Promise<ResolvedModels> {
    const models = await this.client.getAvailableModels(litellmApiUrl, litellmToken);
    const names: string[] = [];
    for (const m of models) {
      if (m && typeof m === "object" && typeof (m as Record<string, unknown>)["model_name"] === "string") {
        names.push((m as Record<string, unknown>)["model_name"] as string);
      }
    }
    return {
      ai_model: this.pickHighestVersion(names, "sonnet"),
      ai_expansion_model: this.pickHighestVersion(names, "haiku"),
    };
  }

  pickHighestVersion(names: string[], family: string): string | null {
    let best: string | null = null;
    let bestVersion: number[] = [];
    for (const name of names) {
      if (!name.toLowerCase().includes(family.toLowerCase())) {
        continue;
      }
      const version = AmazeeModelResolver.extractVersion(name);
      if (AmazeeModelResolver.compare(version, bestVersion) > 0) {
        best = name;
        bestVersion = version;
      }
    }
    return best;
  }

  private static extractVersion(name: string): number[] {
    const out: number[] = [];
    for (const seg of name.split("-")) {
      if (seg !== "" && /^\d+$/.test(seg)) {
        out.push(parseInt(seg, 10));
      }
    }
    return out;
  }

  private static compare(a: number[], b: number[]): number {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const diff = (i < a.length ? a[i]! : 0) - (i < b.length ? b[i]! : 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  }
}
