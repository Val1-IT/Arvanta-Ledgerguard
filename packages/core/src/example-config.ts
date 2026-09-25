// Scoped defaults for the bundled UNIT_CONVERSION_MISMATCH example.
// Adapters and callers must pass these explicitly when they want demo
// compatibility; core does not treat account 5110 as a universal COGS code.

export const CONVERSION_MISMATCH_EXAMPLE = {
  cogsAccountCode: '5110',
  currency: 'IDR'
} as const;
