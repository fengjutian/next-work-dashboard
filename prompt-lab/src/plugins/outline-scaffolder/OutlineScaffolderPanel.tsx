import React, { useMemo } from "react";
import {
  OutlineScaffolderPanel as PublishedOutlineScaffolderPanel,
  type OutlineScaffolderAdapter,
  type OutlineScaffolderHostApi,
} from "@next-work-dashboard/outline-scaffolder/react";
import "@next-work-dashboard/outline-scaffolder/styles.css";
import { useStore } from "@/store/store";

function createPromptLabAdapter(
  aiConfig: OutlineScaffolderAdapter["aiConfig"],
): OutlineScaffolderAdapter {
  const workspace = window.electronAPI.workspace;
  return {
    api: window.electronAPI as unknown as OutlineScaffolderHostApi,
    aiConfig,
    files: {
      openFolder: () => workspace.openFolder(),
      readText: (root, path) => workspace.readTextFile(root, path),
      writeText: (root, path, content) => workspace.writeTextFile(root, path, content),
      readBinary: (root, path) => workspace.readBinaryFile(root, path),
      writeBinary: (root, path, contentBase64) => workspace.writeBinaryFile(root, path, contentBase64),
      listFiles: (root) => workspace.listFiles(root),
      listDirectory: (root, path) => workspace.listDirectory(root, path),
      createDirectory: (root, path) => workspace.createDirectory(root, path),
      mutate: (root, mutations) => workspace.mutateFiles(
        root,
        mutations as Parameters<typeof workspace.mutateFiles>[1],
      ),
      reauthorize: (root) => workspace.reauthorize(root),
    },
  };
}

export const OutlineScaffolderPanel: React.FC = () => {
  const aiConfig = useStore((state) => state.aiApi);
  const adapter = useMemo(() => createPromptLabAdapter(aiConfig), [aiConfig]);
  return <PublishedOutlineScaffolderPanel adapter={adapter} />;
};
