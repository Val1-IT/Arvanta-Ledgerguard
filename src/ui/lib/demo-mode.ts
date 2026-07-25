export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export function assertDemoMode(actionLabel: string): void {
  if (!isDemoModeEnabled()) {
    throw new Error(`${actionLabel} is disabled because DEMO_MODE is not exactly "true".`);
  }
}
