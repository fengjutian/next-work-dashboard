import React from "react";
import type { NumericClaim, PacingAssessment, PersonPresence, PersonRelation, PlaceMapping, QualitySnapshot } from "../../core/editorial-analysis";
import { Button } from "../Button";

interface HistoricalTermRule { id: string; term: string; fromYear?: number; toYear?: number; replacement: string; notes: string }
interface CharacterArc { id: string; person: string; chapter: string; goal: string; choice: string; cost: string; change: string; evidenceIds: string[] }
interface EditorialTask { id: string; title: string; chapter: string; assignee: string; priority: "low" | "medium" | "high" | "blocker"; status: "todo" | "doing" | "review" | "resolved"; opinions: Array<{ reviewer: string; position: string }>; resolution: string; updatedAt: number }

export interface WorldViewProps {
  activeFile: string;
  personRelations: PersonRelation[];
  setPersonRelations: React.Dispatch<React.SetStateAction<PersonRelation[]>>;
  personPresences: PersonPresence[];
  setPersonPresences: React.Dispatch<React.SetStateAction<PersonPresence[]>>;
  historicalTermRules: HistoricalTermRule[];
  setHistoricalTermRules: React.Dispatch<React.SetStateAction<HistoricalTermRule[]>>;
  placeMappings: PlaceMapping[];
  setPlaceMappings: React.Dispatch<React.SetStateAction<PlaceMapping[]>>;
  numericClaims: NumericClaim[];
  setNumericClaims: React.Dispatch<React.SetStateAction<NumericClaim[]>>;
  pacingAssessments: Record<string, PacingAssessment>;
  characterArcs: CharacterArc[];
  setCharacterArcs: React.Dispatch<React.SetStateAction<CharacterArc[]>>;
  editorialTasks: EditorialTask[];
  setEditorialTasks: React.Dispatch<React.SetStateAction<EditorialTask[]>>;
  qualitySnapshots: QualitySnapshot[];
}

export function WorldView(props: WorldViewProps) {
  const { activeFile, personRelations, setPersonRelations, personPresences, setPersonPresences, historicalTermRules, setHistoricalTermRules, placeMappings, setPlaceMappings, numericClaims, setNumericClaims, pacingAssessments, characterArcs, setCharacterArcs, editorialTasks, setEditorialTasks, qualitySnapshots } = props;
  return (<div className="mx-auto mb-5 max-w-7xl space-y-5">
                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex justify-between">
                      <div>
                        <h3 className="font-semibold">人物关系与行踪</h3>
                        <p className="text-xs text-muted-foreground">
                          关系图数据和同年异地冲突检查。
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPersonRelations((current) => [
                              ...current,
                              {
                                id: `relation-${Date.now()}`,
                                from: "",
                                to: "",
                                kind: "official",
                                evidenceIds: [],
                                notes: "",
                              },
                            ])
                          }
                        >
                          新增关系
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setPersonPresences((current) => [
                              ...current,
                              {
                                person: "",
                                year: 0,
                                place: "",
                                chapter: activeFile || "",
                                excerpt: "",
                              },
                            ])
                          }
                        >
                          新增行踪
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                      {personRelations.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[1fr_100px_1fr] gap-2"
                        >
                          <input
                            value={item.from}
                            onChange={(event) =>
                              setPersonRelations((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? { ...entry, from: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="人物 A"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <select
                            value={item.kind}
                            onChange={(event) =>
                              setPersonRelations((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        kind: event.target
                                          .value as PersonRelation["kind"],
                                      }
                                    : entry,
                                ),
                              )
                            }
                            className="rounded border border-input bg-background p-1 text-xs"
                          >
                            <option value="kinship">亲属</option>
                            <option value="official">君臣</option>
                            <option value="alliance">同盟</option>
                            <option value="conflict">冲突</option>
                            <option value="teacher">师承</option>
                            <option value="appointment">任免</option>
                          </select>
                          <input
                            value={item.to}
                            onChange={(event) =>
                              setPersonRelations((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? { ...entry, to: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="人物 B"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                        </div>
                      ))}
                      {personPresences.map((item, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[1fr_90px_1fr] gap-2"
                        >
                          <input
                            value={item.person}
                            onChange={(event) =>
                              setPersonPresences((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, person: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="人物"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            type="number"
                            value={item.year}
                            onChange={(event) =>
                              setPersonPresences((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        year: Number(event.target.value),
                                      }
                                    : entry,
                                ),
                              )
                            }
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            value={item.place}
                            onChange={(event) =>
                              setPersonPresences((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, place: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="地点"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex justify-between">
                      <div>
                        <h3 className="font-semibold">沿革规则与古今地名</h3>
                        <p className="text-xs text-muted-foreground">
                          限定官职、制度和行政区划的适用年代。
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setHistoricalTermRules((current) => [
                              ...current,
                              {
                                id: `term-${Date.now()}`,
                                term: "",
                                replacement: "",
                                notes: "",
                              },
                            ])
                          }
                        >
                          新增沿革
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setPlaceMappings((current) => [
                              ...current,
                              {
                                id: `place-${Date.now()}`,
                                historicalName: "",
                                modernName: "",
                                jurisdiction: "",
                                evidenceIds: [],
                              },
                            ])
                          }
                        >
                          新增地名
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                      {historicalTermRules.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[1fr_80px_80px_1fr] gap-2"
                        >
                          <input
                            value={item.term}
                            onChange={(event) =>
                              setHistoricalTermRules((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? { ...entry, term: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="官职/区划"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            type="number"
                            value={item.fromYear ?? ""}
                            onChange={(event) =>
                              setHistoricalTermRules((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        fromYear: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="起年"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            type="number"
                            value={item.toYear ?? ""}
                            onChange={(event) =>
                              setHistoricalTermRules((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        toYear: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="止年"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            value={item.replacement}
                            onChange={(event) =>
                              setHistoricalTermRules((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        replacement: event.target.value,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="建议称谓"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                        </div>
                      ))}
                      {placeMappings.map((item) => (
                        <div key={item.id} className="grid grid-cols-5 gap-2">
                          <input
                            value={item.historicalName}
                            onChange={(event) =>
                              setPlaceMappings((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        historicalName: event.target.value,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="古地名"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            value={item.modernName}
                            onChange={(event) =>
                              setPlaceMappings((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        modernName: event.target.value,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="今地名"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            value={item.jurisdiction}
                            onChange={(event) =>
                              setPlaceMappings((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        jurisdiction: event.target.value,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="历史辖属"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            type="number"
                            value={item.longitude ?? ""}
                            onChange={(event) =>
                              setPlaceMappings((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        longitude: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="经度"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                          <input
                            type="number"
                            value={item.latitude ?? ""}
                            onChange={(event) =>
                              setPlaceMappings((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        latitude: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="纬度"
                            className="rounded border border-input bg-background p-1 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
                <div className="grid gap-5 lg:grid-cols-3">
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex justify-between">
                      <h3 className="font-semibold">数字口径对照</h3>
                      <Button
                        size="sm"
                        onClick={() =>
                          setNumericClaims((current) => [
                            ...current,
                            {
                              id: `number-${Date.now()}`,
                              chapter: activeFile || "",
                              topic: "",
                              value: 0,
                              unit: "",
                              expression: "",
                              evidenceIds: [],
                            },
                          ])
                        }
                      >
                        新增
                      </Button>
                    </div>
                    {numericClaims.map((item) => (
                      <div
                        key={item.id}
                        className="mt-2 grid grid-cols-[1fr_80px_70px] gap-2"
                      >
                        <input
                          value={item.topic}
                          onChange={(event) =>
                            setNumericClaims((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, topic: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="人口/兵力/赋税"
                          className="rounded border border-input bg-background p-1 text-xs"
                        />
                        <input
                          type="number"
                          value={item.value}
                          onChange={(event) =>
                            setNumericClaims((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? {
                                      ...entry,
                                      value: Number(event.target.value),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          className="rounded border border-input bg-background p-1 text-xs"
                        />
                        <input
                          value={item.unit}
                          onChange={(event) =>
                            setNumericClaims((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, unit: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="单位"
                          className="rounded border border-input bg-background p-1 text-xs"
                        />
                      </div>
                    ))}
                  </section>
                  <section className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold">章节节奏与问题链</h3>
                    <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                      {Object.values(pacingAssessments).map((item) => (
                        <div
                          key={item.chapter}
                          className="rounded border border-border p-2 text-xs"
                        >
                          <div className="flex justify-between">
                            <span>{item.chapter.split("/").pop()}</span>
                            <span>{item.score} 分</span>
                          </div>
                          <div className="text-muted-foreground">
                            说明占比 {Math.round(item.expositionRatio * 100)}% ·{" "}
                            {item.openingQuestion || "无开篇问题"} ·{" "}
                            {item.resolved ? "已回应" : "未回应"}
                          </div>
                          {item.issues.map((issue) => (
                            <div key={issue} className="text-amber-700">
                              {issue}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex justify-between">
                      <h3 className="font-semibold">人物弧线</h3>
                      <Button
                        size="sm"
                        onClick={() =>
                          setCharacterArcs((current) => [
                            ...current,
                            {
                              id: `arc-${Date.now()}`,
                              person: "",
                              chapter: activeFile || "",
                              goal: "",
                              choice: "",
                              cost: "",
                              change: "",
                              evidenceIds: [],
                            },
                          ])
                        }
                      >
                        新增
                      </Button>
                    </div>
                    {characterArcs.map((item) => (
                      <div
                        key={item.id}
                        className="mt-2 space-y-1 rounded border border-border p-2"
                      >
                        <input
                          value={item.person}
                          onChange={(event) =>
                            setCharacterArcs((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, person: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="人物"
                          className="w-full rounded border border-input bg-background p-1 text-xs"
                        />
                        <div className="grid grid-cols-2 gap-1">
                          {(
                            [
                              ["goal", "目标"],
                              ["choice", "选择"],
                              ["cost", "代价"],
                              ["change", "转变"],
                            ] as const
                          ).map(([field, placeholder]) => (
                            <input
                              key={field}
                              value={item[field]}
                              onChange={(event) =>
                                setCharacterArcs((current) =>
                                  current.map((entry) =>
                                    entry.id === item.id
                                      ? {
                                          ...entry,
                                          [field]: event.target.value,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              placeholder={placeholder}
                              className="rounded border border-input bg-background p-1 text-xs"
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex justify-between">
                      <h3 className="font-semibold">审校任务与意见仲裁</h3>
                      <Button
                        size="sm"
                        onClick={() =>
                          setEditorialTasks((current) => [
                            ...current,
                            {
                              id: `task-${Date.now()}`,
                              title: "待处理问题",
                              chapter: activeFile || "",
                              assignee: "",
                              priority: "medium",
                              status: "todo",
                              opinions: [],
                              resolution: "",
                              updatedAt: Date.now(),
                            },
                          ])
                        }
                      >
                        新增任务
                      </Button>
                    </div>
                    {editorialTasks.map((task) => (
                      <div
                        key={task.id}
                        className="mt-2 grid grid-cols-[1fr_120px_100px] gap-2"
                      >
                        <input
                          value={task.title}
                          onChange={(event) =>
                            setEditorialTasks((current) =>
                              current.map((entry) =>
                                entry.id === task.id
                                  ? {
                                      ...entry,
                                      title: event.target.value,
                                      updatedAt: Date.now(),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          className="rounded border border-input bg-background p-1 text-xs"
                        />
                        <input
                          value={task.assignee}
                          onChange={(event) =>
                            setEditorialTasks((current) =>
                              current.map((entry) =>
                                entry.id === task.id
                                  ? {
                                      ...entry,
                                      assignee: event.target.value,
                                      updatedAt: Date.now(),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="负责人"
                          className="rounded border border-input bg-background p-1 text-xs"
                        />
                        <select
                          value={task.status}
                          onChange={(event) =>
                            setEditorialTasks((current) =>
                              current.map((entry) =>
                                entry.id === task.id
                                  ? {
                                      ...entry,
                                      status: event.target
                                        .value as EditorialTask["status"],
                                      updatedAt: Date.now(),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          className="rounded border border-input bg-background p-1 text-xs"
                        >
                          <option value="todo">待处理</option>
                          <option value="doing">处理中</option>
                          <option value="review">待仲裁</option>
                          <option value="resolved">已解决</option>
                        </select>
                        <input
                          value={task.resolution}
                          onChange={(event) =>
                            setEditorialTasks((current) =>
                              current.map((entry) =>
                                entry.id === task.id
                                  ? {
                                      ...entry,
                                      resolution: event.target.value,
                                      updatedAt: Date.now(),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="冲突意见的最终裁决与理由"
                          className="rounded border border-input bg-background p-1 text-xs lg:col-span-3"
                        />
                      </div>
                    ))}
                  </section>
                  <section className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold">质量趋势</h3>
                    <div className="mt-3 flex h-40 items-end gap-2 overflow-x-auto">
                      {[...qualitySnapshots].reverse().map((item) => (
                        <div
                          key={item.id}
                          className="flex min-w-12 flex-col items-center gap-1"
                          title={new Date(item.createdAt).toLocaleString()}
                        >
                          <div
                            className="w-8 rounded-t bg-primary"
                            style={{
                              height: `${Math.max(4, item.readiness)}px`,
                            }}
                          />
                          <span className="text-[10px]">{item.readiness}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      每次运行高级分析记录出版准备度、证据覆盖率、阻断项和故事性。
                    </div>
                  </section>
                </div>
              </div>
  );
}