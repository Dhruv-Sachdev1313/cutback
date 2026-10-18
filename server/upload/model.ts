import OpenAI from 'openai';
import type { Response, ResponseInputItem, Tool } from 'openai/resources/responses/responses';
import type { Provider } from '../../shared/upload.js';
import { ChatGPTAuth } from './auth.js';
import { Budget } from './budget.js';
import { uploadConfig } from './config.js';
export class Model {
  constructor(
    private auth: ChatGPTAuth,
    private budget: Budget,
  ) {}
  async respond(
    provider: Provider,
    model: string,
    input: ResponseInputItem[],
    instructions: string,
    tools?: Tool[],
  ): Promise<Response> {
    // No retries or cross-provider fallback: a failed request never starts a second billable request.
    const key = provider === 'chatgpt' ? await this.auth.access() : process.env.OPENAI_API_KEY;
    if (!key)
      throw new Error(
        'No API key is configured in .env.upload. Connect ChatGPT or configure a key.',
      );
    if (provider === 'api' && model !== uploadConfig.model)
      throw new Error('API mode is restricted to GPT-6.1 Sol for predictable cost.');
    const scrubbed = JSON.stringify(input).replace(
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
      '[image]',
    );
    const imageCount = (JSON.stringify(input).match(/"type":"input_image"/g) || []).length;
    // UTF-8 bytes bound text tokens conservatively; reserve 10k tokens per <=768px image.
    const estimate =
      ((Buffer.byteLength(scrubbed + instructions + JSON.stringify(tools || [])) +
        imageCount * 10000) *
        2.5) /
        1e6 +
      (6000 * 10) / 1e6;
    const reserved = provider === 'api' ? await this.budget.reserve(estimate) : 0;
    const client = new OpenAI({
      apiKey: key,
      baseURL: 'https://api.openai.com/v1',
      timeout: 120000,
      maxRetries: 0,
    });
    const stream = await client.responses.create({
      model,
      input,
      instructions,
      store: false,
      stream: true,
      reasoning: { effort: 'low' },
      include: ['reasoning.encrypted_content'],
      ...(provider === 'api' ? { max_output_tokens: 6000 } : {}),
      ...(tools?.length
        ? {
            tools:
              provider === 'chatgpt'
                ? [
                    {
                      type: 'namespace',
                      name: 'cutback',
                      description: 'Tools for graph-backed video corrections',
                      tools,
                    } as unknown as Tool,
                  ]
                : tools,
          }
        : {}),
    });
    let completed: Response | undefined;
    for await (const event of stream) {
      if (event.type === 'response.completed') completed = event.response;
      if (event.type === 'response.failed' || event.type === 'response.incomplete')
        throw new Error(
          'Model response did not complete. ' +
            (event.response.error?.message ||
              'Try again after checking provider access and usage.'),
        );
      if (event.type === 'error') throw new Error(event.message);
    }
    if (!completed) throw new Error('The model stream ended before completion.');
    if (provider === 'api' && completed.usage)
      await this.budget.settle(
        reserved,
        (completed.usage.input_tokens * 2.5) / 1e6 + (completed.usage.output_tokens * 10) / 1e6,
      );
    return completed;
  }
}
