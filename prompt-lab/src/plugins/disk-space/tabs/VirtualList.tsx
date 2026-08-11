import { type CSSProperties, type ReactNode } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';

/**
 * VirtualList —— 基于 react-window 的固定行高虚拟列表。
 *
 * 适用场景：行高确定的纯展示列表（如大文件 Top N、目录变化、清理候选项等）。
 * 5000+ 行不渲染全量 DOM 节点，仅渲染可视区 + 上下 buffer。
 *
 * 嵌套列表（如重复文件工作台：group header + per-file rows）行高不一致，
 * 仍用直接 map 渲染 —— 100 组 × 平均 5 文件 = 500 行 DOM，远不到 5K 阈值。
 */

export interface VirtualListProps<T> {
  items: T[];
  /** 单行高度（px） */
  itemSize: number;
  /** 容器高度（px） */
  height: number;
  /** 自定义宽度，默认 100% */
  width?: number | string;
  /** 渲染单行；style 必须应用到 row 元素上以保证位置正确 */
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
  /** 自定义 className */
  className?: string;
  /** 空态 */
  emptyMessage?: ReactNode;
}

export function VirtualList<T>({
  items,
  itemSize,
  height,
  width = '100%',
  renderItem,
  className,
  emptyMessage,
}: VirtualListProps<T>) {
  if (items.length === 0) {
    return (
      <div className={className} style={{ height, width }}>
        {emptyMessage ?? null}
      </div>
    );
  }
  return (
    <FixedSizeList
      height={height}
      itemCount={items.length}
      itemSize={itemSize}
      width={width}
      className={className}
    >
      {({ index, style }: ListChildComponentProps) => {
        const item = items[index]!;
        return <div style={style}>{renderItem(item, index, style)}</div>;
      }}
    </FixedSizeList>
  );
}
