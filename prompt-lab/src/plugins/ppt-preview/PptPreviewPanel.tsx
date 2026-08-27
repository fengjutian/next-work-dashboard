/**
 * prompt-lab wrapper for @next-work-dashboard/ppt-preview.
 *
 * The package is self-contained (no host adapter needed). This file is
 * a thin re-export so the existing plugin entry point keeps working.
 */

import { PptPreviewPanel } from "@next-work-dashboard/ppt-preview/react";
import "@next-work-dashboard/ppt-preview/styles.css";

export { PptPreviewPanel };
