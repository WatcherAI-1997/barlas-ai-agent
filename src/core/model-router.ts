import type { GenerateRequest, GenerateResult, ModelProvider } from "./models.js";

export interface ModelRoutes {
  fast: ModelProvider;
  deep: ModelProvider;
  private: ModelProvider;
}

export class ModelRouter implements ModelProvider {
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
}

