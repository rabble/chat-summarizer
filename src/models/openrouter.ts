import { z } from 'zod';

type OpenRouterRequestInput = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
};

type OpenRouterCompletionInput = OpenRouterRequestInput & {
  apiKey: string;
  endpoint?: string;
};

function buildChatRequest(input: OpenRouterRequestInput) {
  return {
    model: input.model,
    messages: [
      { role: 'system' as const, content: input.system },
      { role: 'user' as const, content: input.user },
    ],
    max_tokens: input.maxTokens,
  };
}

export function buildOpenRouterRequest(input: OpenRouterRequestInput) {
  return {
    ...buildChatRequest(input),
    reasoning: {
      effort: 'none' as const,
      exclude: true,
    },
    provider: {
      zdr: true,
      data_collection: 'deny' as const,
      require_parameters: true,
    },
  };
}

const textResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().trim().min(1),
      }),
    }),
  ).min(1),
});

export function parseOpenRouterTextResponse(response: unknown): string {
  const result = textResponseSchema.safeParse(response);
  if (!result.success) {
    throw new Error('Model response did not contain usable text');
  }

  return result.data.choices[0]!.message.content;
}

export async function completeOpenRouterText(
  input: OpenRouterCompletionInput,
): Promise<string> {
  const lunaroute = input.apiKey.startsWith('lr_');
  const response = await fetch(
    input.endpoint ?? (lunaroute
      ? 'https://gw.lunaroute.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions'),
    {
      method: 'POST',
      headers: {
        ...(lunaroute
          ? { 'LUNAROUTE-API-KEY': input.apiKey }
          : { authorization: `Bearer ${input.apiKey}`, 'x-openrouter-title': 'Community Brief' }),
        'content-type': 'application/json',
      },
      body: JSON.stringify(lunaroute
        ? { ...buildChatRequest(input), reasoning_effort: 'none' }
        : buildOpenRouterRequest(input)),
    },
  );

  if (!response.ok) {
    throw new Error(`${lunaroute ? 'Lunaroute' : 'OpenRouter'} request failed with HTTP ${response.status}`);
  }

  return parseOpenRouterTextResponse(await response.json());
}
