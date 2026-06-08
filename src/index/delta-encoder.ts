/**
 * Delta + weight-marker integer encoding (port of `DeltaEncoder`).
 *
 * Delta encoding stores differences between consecutive sorted values. Weight
 * markers signal weight-group changes as negative values `-(weight + 1)`. This
 * is the wire encoding for CBOR position lists — NOT a build-delta mechanism.
 */

export class DeltaEncoder {
  static readonly DEFAULT_WEIGHT = 25;

  static deltaEncode(values: number[]): number[] {
    if (values.length === 0) {
      return [];
    }
    const result = [values[0]!];
    for (let i = 1; i < values.length; i++) {
      result.push(values[i]! - values[i - 1]!);
    }
    return result;
  }

  static encodePositions(positionsByWeight: Map<number, number[]>): number[] {
    const pbw = new Map<number, number[]>();
    for (const [w, p] of positionsByWeight) {
      if (p.length > 0) {
        pbw.set(w, p);
      }
    }
    if (pbw.size === 0) {
      return [];
    }

    let result: number[] = [];
    if (pbw.has(DeltaEncoder.DEFAULT_WEIGHT)) {
      result = DeltaEncoder.deltaEncode(pbw.get(DeltaEncoder.DEFAULT_WEIGHT)!);
      pbw.delete(DeltaEncoder.DEFAULT_WEIGHT);
    }

    for (const weight of [...pbw.keys()].sort((a, b) => a - b)) {
      result.push(-(weight + 1));
      result.push(...DeltaEncoder.deltaEncode(pbw.get(weight)!));
    }

    return result;
  }
}
