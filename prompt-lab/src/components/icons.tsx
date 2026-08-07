/**
 * Application icon gateway.
 *
 * General-purpose UI icons come from Lucide so stroke, sizing, and optical
 * weight stay consistent. Components should import from this module instead
 * of reaching into an icon package directly.
 */

import type { ComponentProps, SVGProps } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Blocks,
  BookOpen,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clipboard,
  Code,
  Copy,
  Columns2,
  Database,
  Download,
  Edit3,
  Ellipsis,
  Eye,
  EyeOff,
  ExternalLink,
  FileChartColumn,
  FileSpreadsheet,
  FileText,
  FileDiff,
  FileSearch,
  FolderOpen,
  GitBranch,
  Globe,
  History,
  Info,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  PanelRight,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Presentation,
  Puzzle,
  RefreshCw,
  Rows3,
  RotateCcw,
  Search,
  Save,
  SaveAll,
  Send,
  Settings,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type LoaderProps = ComponentProps<typeof LoaderCircle>;

/** Loading indicators rotate by default throughout the application. */
function Loader2({ className, ...props }: LoaderProps) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`animate-spin ${className ?? ''}`}
      {...props}
    />
  );
}

function Weread({ className, ...props }: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
    <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#2F7CF6" />
    <path d="M5.4 6.8c2.45-.12 4.55.55 6.6 2.04v8.35c-1.9-1.23-3.96-1.82-6.6-1.7V6.8Z" fill="white" />
    <path d="M18.6 6.8c-2.45-.12-4.55.55-6.6 2.04v8.35c1.9-1.23 3.96-1.82 6.6-1.7V6.8Z" fill="white" opacity=".92" />
    <path d="M12 8.84v8.35" stroke="#2F7CF6" strokeWidth=".65" opacity=".45" />
  </svg>;
}

export {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Blocks,
  BookOpen,
  Bot,
  Calendar,
  Check,
  CircleCheck as CheckCircle,
  ChevronDown,
  Clipboard as StickyNote,
  Code,
  Copy,
  Columns2,
  Database,
  Download,
  Edit3,
  Ellipsis,
  Eye,
  EyeOff,
  ExternalLink,
  FileChartColumn as Pdf,
  FileSpreadsheet as Excel,
  FileText,
  FileDiff,
  FileSearch,
  FileText as Word,
  FolderOpen,
  GitBranch,
  Globe,
  History,
  Info,
  Loader2,
  Weread,
  Maximize2,
  Menu,
  Minus,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  PanelRight,
  Paperclip,
  Pencil as Draw,
  Pin,
  Plus,
  Presentation as Ppt,
  Puzzle,
  RefreshCw,
  Rows3,
  RotateCcw,
  Search,
  Save,
  SaveAll,
  Send,
  Settings,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  X,
  CircleX as XCircle,
  ZoomIn,
  ZoomOut,
  Bot as Robot,
};
