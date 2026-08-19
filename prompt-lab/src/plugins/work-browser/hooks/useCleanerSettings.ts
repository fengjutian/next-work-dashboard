import { useCallback, useEffect, useState } from 'react';
import { message } from '../ui';
import { STORAGE_KEYS } from '../constants';

export function useCleanerSettings() {
  const [enabled, setEnabled] = useState(true);
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  useEffect(() => {
    void window.electronAPI.workBrowser.cleaner.payload()
      .then((payload) => setBlockedDomains(payload.blockedDomains))
      .catch((error) => console.warn('[work-browser] cleaner payload unavailable:', error));
    const stored = localStorage.getItem(STORAGE_KEYS.CLEANER_OPTIONS);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { enabled?: unknown };
      if (typeof parsed.enabled === 'boolean') setEnabled(parsed.enabled);
    } catch { /* Ignore corrupt optional UI preference. */ }
  }, []);
  const toggle = useCallback(() => setEnabled((current) => {
    const next = !current;
    localStorage.setItem(STORAGE_KEYS.CLEANER_OPTIONS, JSON.stringify({ enabled: next }));
    message.success(next ? '已开启净化' : '已关闭净化');
    return next;
  }), []);
  return { cleanerEnabled: enabled, blockedDomains, toggleCleaner: toggle };
}
