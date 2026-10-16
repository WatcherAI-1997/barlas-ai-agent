export interface AgentSchedule {
  id: string;
  userId: string;
  name: string;
  objective: string;
  cronExpression: string;
  timezone: string;
  taskClass: "fast" | "deep" | "private";
  allowedTools?: string[];
  maxSteps: number;
  maxTotalTokens: number;
  deliveryChannel: "web" | "telegram";
  status: "active" | "paused" | "disabled";
  nextRunAt: string;
  lastRunAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface ScheduleStore {
  createSchedule(input: Omit<AgentSchedule, "id" | "status" | "nextRunAt" | "lastRunAt" | "lastError" | "createdAt"> & { nextRunAt: Date }): Promise<AgentSchedule>;
  listSchedules(userId: string, limit: number): Promise<AgentSchedule[]>;
  setScheduleStatus(userId: string, id: string, status: "active" | "paused" | "disabled", nextRunAt?: Date): Promise<AgentSchedule | null>;
  claimDueSchedules(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<AgentSchedule[]>;
  advanceSchedule(input: { id: string; workerId: string; occurrence: Date; nextRunAt: Date }): Promise<boolean>;
  failSchedule(input: { id: string; workerId: string; error: string; retryAt: Date }): Promise<boolean>;
}
