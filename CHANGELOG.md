# Changelog

## Unreleased

- Add the Amazee.ai auto-provisioning subsystem (`ai/amazee/`): control-plane
  client, trial provisioner, idempotent auto-provisioner, model resolver,
  budget decorator, account upgrader, and a filesystem credential store — a
  faithful port of the Python/PHP subsystem. New `AmazeeAiService` provisions a
  free LiteLLM trial on first use when no `ai_api_key` is set (an explicit key
  always wins) and drives the OpenAI-compatible client against the gateway.
- Initial TypeScript port of `scolta-php`: pure-TS Pagefind indexer (default),
  binary-path adapter over the `pagefind` Node API (opt-in), AI client and
  endpoint handler, HTML cleaning, tokenizer/stemmer, and configuration.
