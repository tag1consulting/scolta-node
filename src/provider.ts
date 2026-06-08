/** AI provider response DTO, ported from `Tag1\Scolta\Provider\AiResponse`. */

export interface AiResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export function aiResponse(
  content: string,
  inputTokens = 0,
  outputTokens = 0,
  model = "",
): AiResponse {
  return { content, inputTokens, outputTokens, model };
}
