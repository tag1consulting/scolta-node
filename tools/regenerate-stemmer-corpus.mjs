// Regenerate tests/fixtures/stemmer-corpus/<lang>/expected-stems.txt from the
// vendored pagefind_stem WASM (the Pagefind query-stemmer oracle). Run after
// re-vendoring the WASM for a new Pagefind release, then update PROVENANCE.md.
//
//   node tools/regenerate-stemmer-corpus.mjs
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { stem } = require("../src/index/stemmer-wasm/stemmer_wasm.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = path.join(root, "tests", "fixtures", "stemmer-corpus");
const ALGO = { en: "english", fr: "french", de: "german", es: "spanish", ru: "russian" };

for (const [lang, algo] of Object.entries(ALGO)) {
  const words = fs.readFileSync(path.join(corpus, lang, "words.txt"), "utf-8").split("\n");
  if (words.at(-1) === "") words.pop();
  const out = words.map((w) => stem(algo, w.toLowerCase())).join("\n") + "\n";
  fs.writeFileSync(path.join(corpus, lang, "expected-stems.txt"), out);
  console.log(`${lang}: ${words.length} words`);
}
console.log("done — now update tests/fixtures/stemmer-corpus/PROVENANCE.md");
