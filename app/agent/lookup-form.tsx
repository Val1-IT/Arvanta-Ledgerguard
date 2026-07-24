'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

// Small client-side helper so a tester can jump straight to a previously run
// investigation by ID without retyping the URL — native <form> GET can't
// target a dynamic path segment, so this is the minimum JS needed for that.
export function LookupForm() {
  const router = useRouter();
  const [investigationId, setInvestigationId] = useState('');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = investigationId.trim();
    if (trimmed) router.push(`/agent/investigations/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-3">
      <label className="flex-1 text-sm">
        <span className="mb-1 block font-semibold">Investigation ID</span>
        <input
          value={investigationId}
          onChange={(event) => setInvestigationId(event.target.value)}
          placeholder="e.g. 6f2b1c9e-..."
          className="w-full rounded-lg border-2 border-ink bg-cream-panel px-3 py-2 font-mono text-sm"
        />
      </label>
      <button type="submit" className="lg-btn">
        View log
      </button>
    </form>
  );
}
