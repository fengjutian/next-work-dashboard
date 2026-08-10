/**
 * MarkdownEditorPanel — 插件入口。
 *
 * 只做轻量包装：把 MarkdownWorkspaceController 暴露给插件注册中心。
 * 实际功能全部由 workspace controller 提供。
 */
import React from 'react';
import { MarkdownWorkspaceController } from './MarkdownWorkspaceController';

export const MarkdownEditorPanel: React.FC = () => <MarkdownWorkspaceController />;
