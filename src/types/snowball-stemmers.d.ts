declare module "snowball-stemmers" {
  export interface SnowballStemmer {
    stem(word: string): string;
  }
  export function newStemmer(algorithm: string): SnowballStemmer;
  export function algorithms(): string[];
}
