import { z } from "zod";

import type { ActionRisk } from "../policy/approval.js";

export interface ToolContext {
  userId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ActionRisk;
  inputSchema: z.ZodType<unknown>;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
}

export interface ModelToolDefinition {
  modelName: string;
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool ${tool.name} is already registered`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  list(): Array<Pick<ToolDefinition, "name" | "description" | "risk">> {
    return [...this.tools.values()].map(({ name, description, risk }) => ({
      name,
      description,
      risk,
    }));
  }

  listForModel(allowedTools?: string[]): ModelToolDefinition[] {
    const allowed = allowedTools ? new Set(allowedTools) : undefined;
    const usedNames = new Set<string>();
    return [...this.tools.values()]
      .filter((tool) => !allowed || allowed.has(tool.name))
      .map((tool) => {
        const modelName = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        if (usedNames.has(modelName)) throw new Error(`Tool model name collision: ${modelName}`);
        usedNames.add(modelName);
        const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-07" });
        delete schema.$schema;
        return {
          modelName,
          toolName: tool.name,
          description: `${tool.description} Risk: ${tool.risk}.`,
          parameters: schema as Record<string, unknown>,
        };
      });
  }
}
