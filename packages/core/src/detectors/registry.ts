import { duplicateInventoryMovementDetector } from './duplicate-inventory-movement';
import type { IncidentDetector } from './types';

export const DETECTORS: IncidentDetector[] = [duplicateInventoryMovementDetector];
