/** Token value object (port of `Tag1\Scolta\Index\Token`). */

export interface Token {
  stem: string;
  original: string;
  position: number;
}

export function token(stem: string, original: string, position: number): Token {
  return { stem, original, position };
}
