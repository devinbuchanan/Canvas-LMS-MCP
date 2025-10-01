import { z, ZodTypeAny } from 'zod';

export type ToolParams<Schema extends ZodTypeAny> = z.infer<Schema>;

export interface ToolDefinition<Schema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  paramsSchema: Schema;
  handler: (params: ToolParams<Schema>) => Promise<unknown> | unknown;
}

export const toolRegistry = new Map<string, ToolDefinition>();

export function registerTool<Schema extends ZodTypeAny>(
  method: string,
  definition: ToolDefinition<Schema>,
): void {
  toolRegistry.set(method, definition);
}

registerTool('system.ping', {
  name: 'system.ping',
  description: 'Lightweight heartbeat that confirms the dispatcher is reachable.',
  paramsSchema: z.object({}).optional(),
  handler: async (_params) => ({ ok: true }),
});
