import React from 'react';
import { CodeEditorWorkspace } from './CodeEditorWorkspace';

export { decodeBase64Utf8, languageFromName, languageIdFromName } from './editor-utils';
export {
  type BottomPanelTab,
  type EditorPreferences,
  type EditorProblem,
  type EditorSymbol,
  type OpenDocument,
  type TreeNode,
  type TreeEditState,
  DEFAULT_PREFERENCES,
  displayError,
  encodingLabel,
} from './editor-types';

/** Stable plugin entry point. Feature logic lives in focused workspace modules. */
export const CodeEditorPanel: React.FC = () => <CodeEditorWorkspace />;
