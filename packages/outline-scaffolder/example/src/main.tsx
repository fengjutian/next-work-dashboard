import React from "react";
import { createRoot } from "react-dom/client";
import { OutlineScaffolderPanel, type OutlineScaffolderAdapter } from "@next-work/outline-scaffolder/react";
import "@next-work/outline-scaffolder/styles.css";

const unsupported = (name: string) => async () => ({ success: false, error: `${name} is unavailable in the browser demo` });
const group = (name: string) => new Proxy({}, { get: (_, key) => unsupported(`${name}.${String(key)}`) });
const api = {
  workspace: group("workspace"), outlineProjects: group("outlineProjects"),
  outlineSecrets: group("outlineSecrets"), outlineResearch: group("outlineResearch"),
  outlineGithub: group("outlineGithub"), workBrowser: { search: group("workBrowser.search") },
  shell: group("shell"), llmChat: unsupported("llmChat"),
  generateImage: unsupported("generateImage"), copyText: () => undefined,
} as OutlineScaffolderAdapter["api"];
const adapter: OutlineScaffolderAdapter = {
  api,
  aiConfig: { apiKey: "", baseUrl: "https://api.example.test/v1", model: "demo" },
  files: {
    openFolder: unsupported("files.openFolder"), readText: unsupported("files.readText"),
    writeText: unsupported("files.writeText"), readBinary: unsupported("files.readBinary"),
    writeBinary: unsupported("files.writeBinary"), listFiles: unsupported("files.listFiles"),
    listDirectory: unsupported("files.listDirectory"), createDirectory: unsupported("files.createDirectory"),
    mutate: unsupported("files.mutate"), reauthorize: unsupported("files.reauthorize"),
  },
};

createRoot(document.getElementById("root")!).render(<OutlineScaffolderPanel adapter={adapter} />);
