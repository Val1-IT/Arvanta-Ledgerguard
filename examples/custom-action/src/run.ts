import { runCustomActionDemo } from './demo';

runCustomActionDemo().catch((error) => {
  console.error('DEMO FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
