import React from 'react';
import { CodeEditorWorkspaceController } from './CodeEditorWorkspaceController';

/**
 * Workspace composition boundary.
 *
 * Domain state and commands are implemented by focused controller modules;
 * this component remains the stable boundary consumed by CodeEditorPanel.
 */
export const CodeEditorWorkspace: React.FC = () => <CodeEditorWorkspaceController />;
