type ShutdownHook = () => Promise<void>;

let shutdownHook: ShutdownHook | undefined;

export function setRuntimeShutdownHook(hook: ShutdownHook): void {
  shutdownHook = hook;
}

export async function runRuntimeShutdownHook(): Promise<void> {
  await shutdownHook?.();
}
