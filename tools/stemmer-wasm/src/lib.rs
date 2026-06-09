//! `stem(algorithm, word)` over Pagefind's own `pagefind_stem` crate, compiled
//! to WASM. `algorithm` is the lowercase Snowball name ("english", "french", …);
//! an unknown name returns the word unchanged (the caller already guards this).

use pagefind_stem::{Algorithm, Stemmer};
use wasm_bindgen::prelude::*;

fn algorithm(name: &str) -> Option<Algorithm> {
    Some(match name {
        "catalan" => Algorithm::Catalan,
        "danish" => Algorithm::Danish,
        "dutch" => Algorithm::Dutch,
        "english" => Algorithm::English,
        "finnish" => Algorithm::Finnish,
        "french" => Algorithm::French,
        "german" => Algorithm::German,
        "italian" => Algorithm::Italian,
        "norwegian" => Algorithm::Norwegian,
        "portuguese" => Algorithm::Portuguese,
        "romanian" => Algorithm::Romanian,
        "russian" => Algorithm::Russian,
        "spanish" => Algorithm::Spanish,
        "swedish" => Algorithm::Swedish,
        _ => return None,
    })
}

#[wasm_bindgen]
pub fn stem(algorithm_name: &str, word: &str) -> String {
    match algorithm(algorithm_name) {
        Some(algo) => Stemmer::create(algo).stem(word).into_owned(),
        None => word.to_string(),
    }
}
