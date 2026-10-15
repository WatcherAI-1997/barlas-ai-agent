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
}

