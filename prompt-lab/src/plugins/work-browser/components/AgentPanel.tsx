/**
 * AgentPanel — AI Agent 单轮对话 UI
 *
 * 输入 → 调 `agent.run` → 展示：
 *  - steps 流（llm-call / tool-call / tool-result / final）
 *  - 最终 answer
 *  - toolCalls 表格
 *  - availableTools 标签云
 *
 * 危险动作由 main 端弹 Electron 原生 dialog 真实确认（dialog.showMessageBox）
 * 4 档 context 注入：🌐无 / 📁Workspace / 📄当前页 / 📑指定文档
 */
import { useState, useMemo } from 'react';
import { Alert, Button, Checkbox, Empty, Input, Modal, Segmented, Space, Spin, Tag, Typography, message } from 'antd';
import { Bot, Send, ShieldAlert, Wrench, FileText } from 'lucide-react';
import type { Document, Tab } from '../../../core/work-browser/types';

export interface AgentPanelProps {
  workspaceId: string;
  /** 当前活动 Tab — 「当前页」context 用 */
  activeTab?: Tab | null;
  /** 当前 workspace 文档列表 — 「指定文档」context 选 */
  documents?: Document[];
}

type ContextMode = 'none' | 'workspace' | 'current-page' | 'specific';

interface AgentStep {
  type: 'llm-call' | 'tool-call' | 'tool-result' | 'final';
  [k: string]: any;
}

interface AgentResult {
  answer: string;
  iterations: number;
  toolCalls: Array<{ tool: string; args: any; result: any; iteration: number; denied?: boolean }>;
  steps: AgentStep[];
  availableTools: string[];
}

export function AgentPanel({ workspaceId, activeTab, documents = [] }: AgentPanelProps) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [history, setHistory] = useState<Array<{ user: string; result: AgentResult }>>([]);
  const [ctxMode, setCtxMode] = useState<ContextMode>('workspace');
  const [pickedDocIds, setPickedDocIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [docFilter, setDocFilter] = useState('');

  const ctxSources = useMemo(() => {
    if (ctxMode === 'none') return undefined;
    const out: { workspace?: boolean; currentPage?: { url: string; title: string }; specificDocuments?: Array<{ id: string; title: string; url: string }> } = {};
    if (ctxMode === 'workspace') out.workspace = true;
    if (ctxMode === 'current-page' && activeTab) out.currentPage = { url: activeTab.url, title: activeTab.title || activeTab.url };
    if (ctxMode === 'specific' && pickedDocIds.length) {
      out.specificDocuments = documents
        .filter((d) => pickedDocIds.includes(d.id))
        .map((d) => ({ id: d.id, title: d.title, url: d.url }));
    }
    return out;
  }, [ctxMode, activeTab, pickedDocIds, documents]);

  const ctxHint = useMemo(() => {
    if (ctxMode === 'none') return '（无 context）';
    if (ctxMode === 'workspace') return '当前 Workspace';
    if (ctxMode === 'current-page') return activeTab ? `当前页 · ${activeTab.title || activeTab.url}` : '当前页 · （无活动 Tab）';
    if (ctxMode === 'specific') return pickedDocIds.length ? `${pickedDocIds.length} 篇文档` : '指定文档 · （未选）';
    return '';
  }, [ctxMode, activeTab, pickedDocIds]);

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setRunning(true);
    setResult(null);
    try {
      const r = (await window.electronAPI.workBrowser.agent.run({
        userMessage: text,
        workspaceId,
        maxSteps: 5,
        contextSources: ctxSources,
      })) as AgentResult;
      setResult(r);
      setHistory((h) => [{ user: text, result: r }, ...h].slice(0, 10));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`Agent 失败：${msg}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong><Bot size={12} /> AI Agent</Typography.Text>
            {result && (
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                {result.iterations} 轮 · {result.toolCalls.length} 工具调用
              </Typography.Text>
            )}
          </Space>

          <div>
            <Typography.Text type="secondary" style={{ fontSize: 10 }}>Context</Typography.Text>
            <Segmented<ContextMode>
              size="small"
              block
              value={ctxMode}
              onChange={(v) => setCtxMode(v as ContextMode)}
              options={[
                { value: 'none', label: '🌐 无' },
                { value: 'workspace', label: '📁 WS' },
                { value: 'current-page', label: '📄 页' },
                { value: 'specific', label: '📑 选' },
              ]}
            />
            <Space size={4} style={{ marginTop: 2 }}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>{ctxHint}</Typography.Text>
              {ctxMode === 'specific' && (
                <Button size="small" type="link" style={{ fontSize: 10, padding: 0, height: 'auto' }} onClick={() => setPickerOpen(true)}>
                  选择文档
                </Button>
              )}
            </Space>
          </div>

          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="说一句话… 例：帮我搜一下 Postgres 17 的 release notes，存到 Library"
            autoSize={{ minRows: 2, maxRows: 4 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) { e.preventDefault(); void send(); }
            }}
          />
          <Button
            block
            type="primary"
            icon={running ? <Spin size="small" /> : <Send size={12} />}
            onClick={() => void send()}
            disabled={running || !input.trim()}
          >
            {running ? 'Agent 跑中…（危险动作会弹 dialog）' : '发送'}
          </Button>
          {result && result.availableTools.length > 0 && (
            <Space size={4} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>可用工具：</Typography.Text>
              {result.availableTools.map((t) => (
                <Tag key={t} style={{ fontSize: 10, margin: 0 }}><Wrench size={10} /> {t}</Tag>
              ))}
            </Space>
          )}
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {running && (
          <Space direction="vertical" size={4} style={{ width: '100%', textAlign: 'center', padding: 24 }}>
            <Spin />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Agent 正在思考 / 调用工具…</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 10 }}>危险动作会弹原生 dialog 让你确认</Typography.Text>
          </Space>
        )}

        {!running && !result && history.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={2}>
                <span style={{ fontSize: 12 }}>给 Agent 一个任务</span>
                <span style={{ fontSize: 10, color: '#999' }}>支持搜索 / RAG / 存网页 / 打开 Tab / 加注释</span>
              </Space>
            }
            style={{ marginTop: 24 }}
          />
        )}

        {result && <ResultView result={result} />}

        {history.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>历史</Typography.Text>
            {history.map((h, i) => (
              <div key={i} style={{ marginTop: 4, padding: 4, background: '#fafafa', borderRadius: 4 }}>
                <Typography.Text style={{ fontSize: 11 }} ellipsis>👤 {h.user}</Typography.Text>
                <Typography.Paragraph style={{ fontSize: 11, marginBottom: 0, color: '#555' }} ellipsis>
                  🤖 {h.result.answer.slice(0, 120)}{h.result.answer.length > 120 ? '…' : ''}
                </Typography.Paragraph>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        title="选择文档（注入 Agent context）"
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onOk={() => setPickerOpen(false)}
        okText="完成"
        cancelText="取消"
        width={520}
      >
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            已选 {pickedDocIds.length} / {documents.length}
          </Typography.Text>
          <Input.Search
            size="small"
            placeholder="搜索文档标题 / URL"
            onChange={(e) => setDocFilter(e.target.value)}
            allowClear
          />
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4 }}>
            {documents
              .filter((d) => !docFilter || d.title.toLowerCase().includes(docFilter.toLowerCase()) || d.url.toLowerCase().includes(docFilter.toLowerCase()))
              .map((d) => (
                <div key={d.id} style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>
                  <Checkbox
                    checked={pickedDocIds.includes(d.id)}
                    onChange={(e) => {
                      setPickedDocIds((cur) => e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id));
                    }}
                  >
                    <Space size={4} style={{ width: '100%' }}>
                      <FileText size={11} />
                      <Typography.Text style={{ fontSize: 11 }} ellipsis>{d.title}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 10 }} ellipsis>{d.url}</Typography.Text>
                  </Checkbox>
                </div>
              ))}
          </div>
        </Space>
      </Modal>
    </div>
  );
}

function ResultView({ result }: { result: AgentResult }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Alert
        type="success"
        showIcon
        message="最终回答"
        description={
          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
            {result.answer || '_（无回答）_'}
          </Typography.Paragraph>
        }
      />

      {result.toolCalls.length > 0 && (
        <div>
          <Typography.Text strong style={{ fontSize: 12 }}><Wrench size={12} /> 工具调用</Typography.Text>
          <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 4 }}>
            {result.toolCalls.map((tc, i) => (
              <div key={i} style={{ padding: 4, background: tc.denied ? '#fff2f0' : '#f6ffed', borderRadius: 4, border: '1px solid #f0f0f0' }}>
                <Space size={4} wrap>
                  <Tag color={tc.denied ? 'red' : 'green'} style={{ fontSize: 10, margin: 0 }}>
                    {tc.denied ? <ShieldAlert size={10} /> : <Wrench size={10} />}
                    {' '}iter {tc.iteration} · {tc.tool}
                  </Tag>
                  {tc.denied && <Typography.Text type="danger" style={{ fontSize: 10 }}>已拒绝（dialog 选拒绝）</Typography.Text>}
                </Space>
                <details style={{ marginTop: 2 }}>
                  <summary style={{ fontSize: 10, color: '#888', cursor: 'pointer' }}>args / result</summary>
                  <pre style={{ fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{JSON.stringify({ args: tc.args, result: tc.result }, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </Space>
        </div>
      )}

      {result.steps.length > 0 && (
        <div>
          <Typography.Text strong style={{ fontSize: 12 }}>步骤</Typography.Text>
          <Space direction="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
            {result.steps.map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: '#666' }}>
                <Tag style={{ fontSize: 9, margin: 0 }}>{s.type}</Tag>
                <span style={{ marginLeft: 4 }}>{s.tool || s.content?.slice(0, 60) || s.decision || ''}</span>
              </div>
            ))}
          </Space>
        </div>
      )}
    </Space>
  );
}
