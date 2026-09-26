import { runInventoryDemo } from './demo';

runInventoryDemo().catch((error) => {
  console.error('DEMO FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
