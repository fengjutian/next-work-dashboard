import { useCallback, useMemo, useState } from 'react';
import { STORAGE_KEYS } from '../constants';

export function useWorkbenchLayout() {
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.LEFT_SIDEBAR_COLLAPSED) === 'true');
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.RIGHT_SIDEBAR_COLLAPSED) === 'true');
  const toggleLeftSidebar = useCallback(() => setLeftCollapsed((collapsed) => {
    localStorage.setItem(STORAGE_KEYS.LEFT_SIDEBAR_COLLAPSED, String(!collapsed));
    return !collapsed;
  }), []);
  const toggleRightSidebar = useCallback(() => setRightCollapsed((collapsed) => {
    localStorage.setItem(STORAGE_KEYS.RIGHT_SIDEBAR_COLLAPSED, String(!collapsed));
    return !collapsed;
  }), []);
  const gridTemplateColumns = useMemo(() => leftCollapsed
    ? (rightCollapsed ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(250px, 310px)')
    : (rightCollapsed ? 'minmax(180px, 220px) minmax(0, 1fr)' : 'minmax(180px, 220px) minmax(0, 1fr) minmax(250px, 310px)'), [leftCollapsed, rightCollapsed]);
  return { leftCollapsed, rightCollapsed, toggleLeftSidebar, toggleRightSidebar, gridTemplateColumns };
}
