'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Keeps every open session current by re-fetching the page's server data on an
// interval (and when the tab regains focus). This surfaces changes made by
// other users — file changes from Assembly and status changes from the DB —
// without anyone manually reloading. Client component state (e.g. a dropdown
// mid-edit) is preserved across refreshes.
export function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router, intervalMs]);

  return null;
}
