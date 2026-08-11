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
  AudioLines,
  AudioWaveform,
  Blocks,
  BookOpen,
  Bot,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleStop,
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
  HardDrive,
  History,
  Image,
  Info,
  Languages,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  PanelRight,
  Pause,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Play,
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
  Square,
  Sun,
  Terminal,
  Trash2,
  Upload,
  Video,
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
    <path d="M3.5 5.25c3.2-.25 5.95.55 8.5 2.45v11c-2.4-1.7-5.2-2.45-8.5-2.15V5.25Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M20.5 5.25c-3.2-.25-5.95.55-8.5 2.45v11c2.4-1.7 5.2-2.45 8.5-2.15V5.25Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M12 7.7v11" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
  </svg>;
}

/** A seal mark containing the literal “汉” for the 汉语新解 plugin. */
function HanyuJinjie({ className, ...props }: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
    <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <text x="12" y="16.2" textAnchor="middle" fill="currentColor" fontSize="11.5" fontWeight="600" fontFamily="'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif">汉</text>
  </svg>;
}

export {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  AudioWaveform,
  Blocks,
  BookOpen,
  Bot,
  Calendar,
  Camera,
  Check,
  Circle,
  CircleCheck as CheckCircle,
  ChevronDown,
  CircleStop,
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
  HardDrive,
  History,
  Image,
  Info,
  Languages,
  Loader2,
  Weread,
  HanyuJinjie,
  Maximize2,
  Menu,
  Minus,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  PanelRight,
  Pause,
  Paperclip,
  Pencil as Draw,
  Phone,
  Pin,
  Play,
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
  Square,
  Sun,
  Terminal,
  Trash2,
  Upload,
  Video,
  Wrench,
  X,
  CircleX as XCircle,
  ZoomIn,
  ZoomOut,
  Bot as Robot,
};
