import React from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "../Button";

export type ManagementTab = "overview" | "knowledge" | "evidence" | "editorial" | "advanced" | "quality" | "publish";
export type AdvancedSection = "dashboard" | "analysis" | "sources" | "world" | "drafting" | "visualization" | "collaboration" | "delivery";

const MANAGEMENT_TABS: Array<[ManagementTab, string]> = [
  ["overview", "规划看板"], ["knowledge", "全书知识库"], ["evidence", "史料证据台账"],
  ["editorial", "审校流水线"], ["advanced", "高级审校"], ["quality", "一致性与门禁"], ["publish", "发布状态"],
];
const ADVANCED_SECTIONS: Array<[AdvancedSection, string]> = [
  ["dashboard", "总览"], ["analysis", "全书分析"], ["sources", "史料与引用"], ["world", "人物·地名·年代"],
  ["drafting", "智能成稿"], ["visualization", "图谱与自动化"], ["collaboration", "协作签核"], ["delivery", "交付发布"],
];

export interface ManagementNavigationProps {
  tab: ManagementTab;
  advancedSection: AdvancedSection;
  auditLoading: boolean;
  auditDisabled: boolean;
  onTabChange(tab: ManagementTab): void;
  onAdvancedSectionChange(section: AdvancedSection): void;
  onRunAudit(): void;
}

export function ManagementNavigation(props: ManagementNavigationProps) {
  return <>
    <div className="flex items-center gap-2 border-b border-border bg-card px-6 py-3">
      {MANAGEMENT_TABS.map(([id, label]) => <Button key={id} size="sm" variant={props.tab === id ? "default" : "ghost"} onClick={() => props.onTabChange(id)}>{label}</Button>)}
      <Button size="sm" variant="outline" className="ml-auto" disabled={props.auditLoading || props.auditDisabled} onClick={props.onRunAudit}>
        {props.auditLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}运行全书检查
      </Button>
    </div>
    {props.tab === "advanced" && <nav className="mx-auto mt-5 flex w-[calc(100%-3rem)] max-w-7xl flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
      {ADVANCED_SECTIONS.map(([id, label]) => <Button key={id} size="sm" variant={props.advancedSection === id ? "default" : "ghost"} onClick={() => props.onAdvancedSectionChange(id)}>{label}</Button>)}
    </nav>}
  </>;
}
