/**
 * SavePageDialog — 保存页面确认弹窗
 */
import { Modal, Form, Input, Select, Typography, Alert } from '../ui';

export interface SavePageDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (input: { url: string; title?: string; workspaceId: string }) => Promise<void>;
  workspaces: Array<{ id: string; name: string; icon?: string }>;
  defaultWorkspaceId?: string;
  initialUrl?: string;
  initialTitle?: string;
}

export function SavePageDialog({ open, onCancel, onConfirm, workspaces, defaultWorkspaceId, initialUrl, initialTitle }: SavePageDialogProps) {
  const [form] = Form.useForm();
  const submit = async () => {
    const v = await form.validateFields();
    await onConfirm(v);
    form.resetFields();
  };
  return (
    <Modal
      title="保存页面到 Workspace"
      open={open}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="主进程会抓取目标 URL → Readability 净化 → 输出 Markdown + 归档原 HTML；版本变更会自动产生 diff。"
      />
      <Form form={form} layout="vertical" initialValues={{ workspaceId: defaultWorkspaceId, url: initialUrl, title: initialTitle }}>
        <Form.Item label="Workspace" name="workspaceId" rules={[{ required: true, message: '请选择 Workspace' }]}>
          <Select options={workspaces.map((w) => ({ label: `${w.icon || '🌊'} ${w.name}`, value: w.id }))} />
        </Form.Item>
        <Form.Item label="URL" name="url" rules={[{ required: true, type: 'url', message: '请输入有效 URL' }]}>
          <Input placeholder="https://..." />
        </Form.Item>
        <Form.Item label="标题（可选）" name="title">
          <Input placeholder="留空将自动从页面提取" />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          隐私模式为「本地」的 Workspace，文档永远不会离开本机。
        </Typography.Text>
      </Form>
    </Modal>
  );
}
