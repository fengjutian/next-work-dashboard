/**
 * 跨 tab 共享的可视化组件：Chart / EmptyState / UsageCard。
 */

import { useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, PieChart, TreemapChart } from 'echarts/charts';
import { GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';

import { formatBytes } from './helpers';

echarts.use([LineChart, PieChart, TreemapChart, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function Chart({ option, className }: { option: EChartsCoreOption; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart: EChartsType = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    chart.on('click', (params) => {
      const data = typeof params.data === 'object' && params.data !== null ? params.data as { path?: string } : undefined;
      if (data?.path) window.dispatchEvent(new CustomEvent('disk-space:navigate', { detail: data.path }));
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div ref={ref} className={className} />;
}

export function EmptyState({ children }: PropsWithChildren) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

export function UsageCard({
  title, subtitle, used, total, color,
}: { title: string; subtitle: string; used: number; total: number; color: string }) {
  const percent = total ? Math.round((used / total) * 100) : 0;
  const option = useMemo<EChartsCoreOption>(() => ({
    color: [color, 'rgba(127,127,127,.12)'],
    tooltip: { trigger: 'item', formatter: (item: { name: string; value: number }) => `${item.name}<br/>${formatBytes(item.value)}` },
    series: [{
      type: 'pie', silent: false, radius: ['72%', '90%'], center: ['50%', '50%'], label: { show: false },
      data: [
        { name: '已使用', value: used },
        { name: '可用', value: Math.max(0, total - used), itemStyle: { color: 'rgba(127,127,127,.12)' } },
      ],
    }],
    graphic: [{
      type: 'text', left: 'center', top: '38%',
      style: { text: `${percent}%`, fontSize: 24, fontWeight: 650, fill: 'currentColor', textAlign: 'center' },
    }],
  }), [color, percent, total, used]);
  return (
    <article className="grid min-h-[180px] grid-cols-[170px_minmax(0,1fr)] items-center rounded-2xl border bg-card p-4 shadow-sm">
      <Chart option={option} className="h-[150px] w-[150px]" />
      <div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
        <p className="mt-5 text-2xl font-semibold tabular-nums">{formatBytes(used)}</p>
        <p className="mt-1 text-xs text-muted-foreground">共 {formatBytes(total)} · 可用 {formatBytes(Math.max(0, total - used))}</p>
      </div>
    </article>
  );
}
