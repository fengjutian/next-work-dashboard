/**
 * prompt-lab wrapper for @next-work-dashboard/pdf-preview.
 *
 * Hosts in @next-work-dashboard/pdf-preview are host-agnostic; this file
 * wires the published panel to prompt-lab's Vite-bundled pdfjs worker.
 *
 * Keep this file thin. The host's only job is to provide a configured
 * pdfjs-dist instance via `getPdfJs`.
 */

import React, { useMemo } from "react";
import { PdfPreviewPanel as PublishedPdfPreviewPanel, PdfPreviewProvider, type PdfPreviewAdapter } from "@next-work-dashboard/pdf-preview/react";
import "@next-work-dashboard/pdf-preview/styles.css";
import { getPdfJs } from "@/lib/pdfjs";

function createPromptLabAdapter(): PdfPreviewAdapter {
  return { getPdfJs };
}

export const PdfPreviewPanel: React.FC = () => {
  const adapter = useMemo(() => createPromptLabAdapter(), []);
  return (
    <PdfPreviewProvider adapter={adapter}>
      <PublishedPdfPreviewPanel />
    </PdfPreviewProvider>
  );
};
