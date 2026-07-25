'use client';

import { useState } from 'react';

export function CopyIdButton({
  value,
  label = 'Copy ID'
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="lg-btn px-3 py-1.5 text-xs"
      aria-label={`${label}: ${value}`}
      title={value}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
