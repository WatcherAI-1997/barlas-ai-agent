import {
  supportsTools,
  type GenerateRequest,
  type GenerateResult,
  type GenerateToolRequest,
  type GenerateToolResult,
  type ModelProvider,
  type ToolCapableModelProvider,
} from "./models.js";

export interface ModelRoutes {
  fast: ModelProvider;
  deep: ModelProvider;
  private: ModelProvider;
}

export class ModelRouter implements ToolCapableModelProvider {
  readonly name = "barlas-model-router";

  constructor(private readonly routes: ModelRoutes) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const taskClass = request.taskClass ?? "fast";
    const primary = this.routes[taskClass];

    try {
      return await primary.generate(request);
    } catch (error) {
      if (taskClass === "private" || primary === this.routes.deep) throw error;
      return this.routes.deep.generate({ ...request, taskClass: "deep" });
    }
  }

  async generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult> {
    const taskClass = request.taskClass ?? "fast";
    const primary = this.routes[taskClass];
    if (!supportsTools(primary)) throw new Error(`Model provider ${primary.name} does not support tools`);
    try {
      return await primary.generateWithTools(request);
    } catch (error) {
      if (request.previousResponseId || taskClass === "private" || primary === this.routes.deep) throw error;
      if (!supportsTools(this.routes.deep)) throw error;
      return this.routes.deep.generateWithTools({ ...request, taskClass: "deep" });
    }
  }
}
