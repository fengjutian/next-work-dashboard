// PR Delivery — Provider-based remote delivery for Agent worktrees

export interface PRProvider {
  readonly id: string;
  pushBranch(rootPath: string, branch: string, remote: string): Promise<{ pushed: boolean; error?: string }>;
  createPR(rootPath: string, branch: string, baseBranch: string, title: string, body: string): Promise<{ url: string; number?: number; error?: string }>;
}

export interface PRDeliveryConfig { provider: string; remote: string; baseBranch: string; }
export interface PRDeliveryResult { branch: string; remote: string; prUrl?: string; prNumber?: number; pushed: boolean; error?: string; }

const prProviders = new Map<string, PRProvider>();
export function registerPRProvider(p: PRProvider) { prProviders.set(p.id, p); }
export function getPRProvider(id: string) { return prProviders.get(id); }

export async function pushAgentBranch(rootPath: string, branch: string, remote: string) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("git", ["push", "-u", remote, branch], {
      cwd: rootPath, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true,
    });
    return { pushed: true };
  } catch (e) { return { pushed: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function createGitHubPR(
  rootPath: string, branch: string, baseBranch: string, title: string, body: string, token: string,
) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const r = await promisify(execFile)("git", ["config", "--get", "remote.origin.url"], {
      cwd: rootPath, encoding: "utf8", windowsHide: true,
    });
    const url = r.stdout.trim();
    const parts = url.replace(/.git$/, "").split(/github.com[:/]/).pop()?.split("/").filter(Boolean) ?? [];
    if (parts.length < 2) throw new Error("Cannot parse owner/repo from: " + url);
    const owner = parts[0];
    const repo = parts[1];
    const resp = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/pulls", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, head: branch, base: baseBranch }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) throw new Error(data.message || "HTTP " + resp.status);
    return { url: data.html_url || "", number: data.number };
  } catch (e) { return { url: "", error: e instanceof Error ? e.message : String(e) }; }
}

export async function deliverAgentPR(
  rootPath: string, branch: string, config: PRDeliveryConfig, title: string, body: string, token: string,
): Promise<PRDeliveryResult> {
  const push = await pushAgentBranch(rootPath, branch, config.remote);
  if (!push.pushed) return { branch, remote: config.remote, pushed: false, error: push.error };
  const pr = await createGitHubPR(rootPath, branch, config.baseBranch, title, body, token);
  return { branch, remote: config.remote, pushed: true, prUrl: pr.url || undefined, prNumber: pr.number, error: pr.error };
}
