'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Body } from '@assembly-js/design-system';
import type { CompanyOption } from '@/utils/files';

// Internal-only: choose which company's files to view. Writes the choice to the
// URL (?companyId=) while preserving the existing params (notably ?token=), so
// it survives auto-refresh and server re-renders.
export function CompanyPicker({
  companies,
  companyId,
}: {
  companies: CompanyOption[];
  companyId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('companyId', id);
    params.delete('path'); // reset to the new company's root
    router.push(`${pathname}?${params.toString()}`);
  }

  if (companies.length === 0) return null;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Body size="sm" className="text-gray-500 shrink-0">
        Viewing
      </Body>
      <select
        value={companyId ?? ''}
        onChange={(e) => select(e.target.value)}
        aria-label="Select company"
        className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white max-w-xs min-w-0"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
