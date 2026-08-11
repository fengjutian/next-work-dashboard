/**
 * AgentPanel — AI Agent 单轮对话 UI
 *
 * 输入 → 调 `agent.run` → 展示：
 *  - steps 流（llm-call / tool-call / tool-result / final）
 *  - 最终 answer
 *  - toolCalls 表格
 *  - availableTools 标签云
 *
 * 危险动作默认拒绝（main 端 default confirm = false），UI 在 toolCalls 表格里用 Tag 标红
 */
import { useState } from 'react';
import { Alert, Button, Empty, Input, Space, Spin, Tag, Typography, message } from 'antd';
import { Bot, Send, ShieldAlert, Wrench } from 'lucide-react';

export interface AgentPanelProps {
  workspaceId: string;
}

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

export function AgentPanel({ workspaceId }: AgentPanelProps) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [history, setHistory] = useState<Array<{ user: string; result: AgentResult }>>([]);

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
      })) as AgentResult;
      setResult(r);
      setHistory((h) => [{ user: text, result: r }, ...h].slice(0, 10));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`Agent 失败：${msg}`);
      if (/未配置|apiKey|baseUrl/i.test(msg)) {
        // 提示用户去 settings 配
      }
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
            {running ? 'Agent 跑中…' : '发送'}
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
                  {tc.denied && <Typography.Text type="danger" style={{ fontSize: 10 }}>已拒绝（危险动作）</Typography.Text>}
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
