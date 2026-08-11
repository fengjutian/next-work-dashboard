/**
 * 插件入口 — 与 code-editor 保持同样的稳定边界。
 * 业务逻辑全部下放到 MarkdownWorkspaceController。
 */
import React from 'react';
import { MarkdownWorkspaceController } from './MarkdownWorkspaceController';

export const MarkdownEditorPanel: React.FC = () => <MarkdownWorkspaceController />;
