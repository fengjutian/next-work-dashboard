/**
 * 统一图标映射层
 *
 * 策略：
 * - 操作/状态类图标 → react-icons/fa6（面性，视觉有力度）
 * - 导航/辅助类图标 → react-icons/hi2（线性，轻声）
 *
 * 接口完全兼容 lucide-react，按需替换 import 来源即可。
 */

import React from 'react';

// ── Font Awesome 6 (solid / 面性) ──
import {
  FaCircleCheck,
  FaCircleXmark,
  FaXmark,
  FaMagnifyingGlass,
  FaPlus,
  FaStar,
  FaThumbtack,
  FaTrashCan,
  FaPenToSquare,
  FaCopy,
  FaCheck,
  FaEye,
  FaEyeSlash,
  FaSpinner,
  FaPaperPlane,
  FaDownload,
  FaUpload,
  FaCodeBranch,
  FaCode,
  FaShieldHalved,
} from 'react-icons/fa6';

// ── Heroicons v2 (outline / 线性) ──
import {
  HiArrowLeft,
  HiArrowRight,
  HiArrowPath,
  HiGlobeAlt,
  HiChatBubbleLeft,
  HiCog6Tooth,
  HiBars3,
  HiFolderOpen,
  HiDocumentText,
  HiCalendarDays,
  HiCommandLine,
  HiClock,
  HiCircleStack,
  HiClipboardDocument,
  HiPuzzlePiece,
  HiSquares2X2,
  HiComputerDesktop,
  HiMoon,
  HiSun,
  HiInformationCircle,
  HiMagnifyingGlassPlus,
  HiMagnifyingGlassMinus,
  HiArrowsPointingOut,
  HiArrowUturnLeft,
} from 'react-icons/hi2';

// ═══════════════════════════════════════════════
// 类型：兼容 lucide-react 的 className 传参
// ═══════════════════════════════════════════════

interface IconProps {
  className?: string;
}

// ═══════════════════════════════════════════════
// 状态反馈
// ═══════════════════════════════════════════════

export const CheckCircle: React.FC<IconProps> = ({ className }) => (
  <FaCircleCheck className={className} />
);

export const XCircle: React.FC<IconProps> = ({ className }) => (
  <FaCircleXmark className={className} />
);

/** 加载中旋转图标 */
export const Loader2: React.FC<IconProps> = ({ className }) => (
  <FaSpinner className={`animate-spin ${className ?? ''}`} />
);

// ═══════════════════════════════════════════════
// 通用操作
// ═══════════════════════════════════════════════

export const X: React.FC<IconProps> = ({ className }) => (
  <FaXmark className={className} />
);

export const Search: React.FC<IconProps> = ({ className }) => (
  <FaMagnifyingGlass className={className} />
);

export const Plus: React.FC<IconProps> = ({ className }) => (
  <FaPlus className={className} />
);

export const Star: React.FC<IconProps> = ({ className }) => (
  <FaStar className={className} />
);

export const Pin: React.FC<IconProps> = ({ className }) => (
  <FaThumbtack className={className} />
);

export const Trash2: React.FC<IconProps> = ({ className }) => (
  <FaTrashCan className={className} />
);

export const Edit3: React.FC<IconProps> = ({ className }) => (
  <FaPenToSquare className={className} />
);

export const Copy: React.FC<IconProps> = ({ className }) => (
  <FaCopy className={className} />
);

export const Check: React.FC<IconProps> = ({ className }) => (
  <FaCheck className={className} />
);

export const Eye: React.FC<IconProps> = ({ className }) => (
  <FaEye className={className} />
);

export const EyeOff: React.FC<IconProps> = ({ className }) => (
  <FaEyeSlash className={className} />
);

// ═══════════════════════════════════════════════
// 导航 / 工具栏
// ═══════════════════════════════════════════════

export const ArrowLeft: React.FC<IconProps> = ({ className }) => (
  <HiArrowLeft className={className} />
);

export const ArrowRight: React.FC<IconProps> = ({ className }) => (
  <HiArrowRight className={className} />
);

export const RefreshCw: React.FC<IconProps> = ({ className }) => (
  <HiArrowPath className={className} />
);

/** 发送 / 注入 */
export const Send: React.FC<IconProps> = ({ className }) => (
  <FaPaperPlane className={className} />
);

export const Download: React.FC<IconProps> = ({ className }) => (
  <FaDownload className={className} />
);

export const Upload: React.FC<IconProps> = ({ className }) => (
  <FaUpload className={className} />
);

// ═══════════════════════════════════════════════
// 面板 / 菜单 / 辅助
// ═══════════════════════════════════════════════

export const Globe: React.FC<IconProps> = ({ className }) => (
  <HiGlobeAlt className={className} />
);

export const MessageSquare: React.FC<IconProps> = ({ className }) => (
  <HiChatBubbleLeft className={className} />
);

export const Settings: React.FC<IconProps> = ({ className }) => (
  <HiCog6Tooth className={className} />
);

export const PanelLeft: React.FC<IconProps> = ({ className }) => (
  <HiBars3 className={className} />
);

export const PanelRight: React.FC<IconProps> = ({ className }) => (
  <HiBars3 className={`${className ?? ''} rotate-180`} />
);

export const FolderOpen: React.FC<IconProps> = ({ className }) => (
  <HiFolderOpen className={className} />
);

export const FileText: React.FC<IconProps> = ({ className }) => (
  <HiDocumentText className={className} />
);

export const Calendar: React.FC<IconProps> = ({ className }) => (
  <HiCalendarDays className={className} />
);

export const Bot: React.FC<IconProps> = ({ className }) => (
  <HiCommandLine className={className} />
);

export const History: React.FC<IconProps> = ({ className }) => (
  <HiClock className={className} />
);

export const Network: React.FC<IconProps> = ({ className }) => (
  <HiCircleStack className={className} />
);

export const StickyNote: React.FC<IconProps> = ({ className }) => (
  <HiClipboardDocument className={className} />
);

export const Puzzle: React.FC<IconProps> = ({ className }) => (
  <HiPuzzlePiece className={className} />
);

export const Blocks: React.FC<IconProps> = ({ className }) => (
  <HiSquares2X2 className={className} />
);

export const Monitor: React.FC<IconProps> = ({ className }) => (
  <HiComputerDesktop className={className} />
);

export const Moon: React.FC<IconProps> = ({ className }) => (
  <HiMoon className={className} />
);

export const Sun: React.FC<IconProps> = ({ className }) => (
  <HiSun className={className} />
);

export const Info: React.FC<IconProps> = ({ className }) => (
  <HiInformationCircle className={className} />
);

// ═══════════════════════════════════════════════
// 知识图谱专用
// ═══════════════════════════════════════════════

export const GitBranch: React.FC<IconProps> = ({ className }) => (
  <FaCodeBranch className={className} />
);

export const ZoomIn: React.FC<IconProps> = ({ className }) => (
  <HiMagnifyingGlassPlus className={className} />
);

export const ZoomOut: React.FC<IconProps> = ({ className }) => (
  <HiMagnifyingGlassMinus className={className} />
);

export const Maximize2: React.FC<IconProps> = ({ className }) => (
  <HiArrowsPointingOut className={className} />
);

export const RotateCcw: React.FC<IconProps> = ({ className }) => (
  <HiArrowUturnLeft className={className} />
);

// ═══════════════════════════════════════════════
// 插件 SDK
// ═══════════════════════════════════════════════

export const Code: React.FC<IconProps> = ({ className }) => (
  <FaCode className={className} />
);

export const ShieldCheck: React.FC<IconProps> = ({ className }) => (
  <FaShieldHalved className={className} />
);
