import React, { createContext, useCallback, useContext } from 'react';
import { Toaster, toast as sonnerToast } from 'sonner';
import { useStore } from '@/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastContextType {
  /** Compatibility API for existing callers. New code may also import toast from sonner. */
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => undefined });

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useStore((state) => state.theme);
  const toast = useCallback((message: string, type: ToastType = 'info') => {
    sonnerToast[type](message);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Toaster
        position="bottom-right"
        theme={theme}
        richColors
        closeButton
        visibleToasts={5}
        toastOptions={{ duration: 3500 }}
      />
    </ToastContext.Provider>
  );
};

export { sonnerToast as toast };
