import type {
  OutlineAiConfig,
  OutlineScaffolderAdapter,
  OutlineScaffolderHostApi,
} from "../react/adapter";

export type OutlineScaffolderTransport = (
  operation: string,
  args: unknown[],
) => Promise<unknown>;

const namespace = (
  transport: OutlineScaffolderTransport,
  prefix: string,
  methods: readonly string[],
): Record<string, (...args: unknown[]) => Promise<unknown>> =>
  Object.fromEntries(
    methods.map((method) => [
      method,
      (...args: unknown[]) => transport(`${prefix}.${method}`, args),
    ]),
  );

export function createTransportOutlineHostApi(
  transport: OutlineScaffolderTransport,
): OutlineScaffolderHostApi {
  const workspace = namespace(transport, "workspace", [
    "openFolder",
    "readTextFile",
    "writeTextFile",
    "readBinaryFile",
    "writeBinaryFile",
    "listFiles",
    "listDirectory",
    "createDirectory",
    "mutateFiles",
    "reauthorize",
    "gitStatus",
    "gitInit",
    "gitStage",
    "gitCommit",
    "gitOperation",
  ]);

  return {
    workspace: workspace as OutlineScaffolderHostApi["workspace"],
    outlineProjects: namespace(transport, "outlineProjects", ["load", "save"]),
    outlineSecrets: namespace(transport, "outlineSecrets", ["load", "save"]),
    outlineResearch: namespace(transport, "outlineResearch", ["search"]),
    outlineGithub: namespace(transport, "outlineGithub", ["pagesStatus"]),
    workBrowser: {
      search: namespace(transport, "workBrowser.search", ["run"]),
    },
    shell: namespace(transport, "shell", ["openExternal"]),
    llmChat: (...args: unknown[]) => transport("llmChat", args),
    generateImage: (...args: unknown[]) => transport("generateImage", args),
    copyText: (...args: unknown[]) => transport("copyText", args),
  };
}

export function createTransportOutlineScaffolderAdapter(
  transport: OutlineScaffolderTransport,
  aiConfig: Partial<OutlineAiConfig> = {},
): OutlineScaffolderAdapter {
  const api = createTransportOutlineHostApi(transport);
  const workspace = api.workspace;
  return {
    api,
    aiConfig: {
      apiKey: "",
      baseUrl: "",
      model: "",
      ...aiConfig,
    },
    files: {
      openFolder: () => workspace.openFolder(),
      readText: (root, path) => workspace.readTextFile(root, path),
      writeText: (root, path, content) => workspace.writeTextFile(root, path, content),
      readBinary: (root, path) => workspace.readBinaryFile(root, path),
      writeBinary: (root, path, contentBase64) => workspace.writeBinaryFile(root, path, contentBase64),
      listFiles: (root) => workspace.listFiles(root),
      listDirectory: (root, path) => workspace.listDirectory(root, path),
      createDirectory: (root, path) => workspace.createDirectory(root, path),
      mutate: (root, mutations) => workspace.mutateFiles(root, mutations),
      reauthorize: (root) => workspace.reauthorize(root),
    },
  };
}
