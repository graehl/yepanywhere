import { execFile, type ChildProcess } from "node:child_process";

async function runningMembers(group: number): Promise<boolean> {
  const output = await new Promise<string>((resolve, reject) =>
    execFile(
      "ps",
      ["-axo", "pgid=,stat="],
      { env: { PATH: process.env.PATH, LANG: "C" }, timeout: 2000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    ),
  );
  return output.split("\n").some((line) => {
    const [pgid, state] = line.trim().split(/\s+/);
    return Number(pgid) === group && !state?.startsWith("Z");
  });
}

/** A leader exiting must not cancel termination of its remaining descendants. */
export function ownProcessGroup(child: ChildProcess) {
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let exited = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The exec runner attaches its close handler immediately; keep an early
  // rejection handled too if the OS fails before close is emitted.
  void finished.catch(() => {});
  const signal = (name: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const stop = () => {
    if (settled || exited) return;
    signal("SIGTERM");
    killTimer ??= setTimeout(() => signal("SIGKILL"), 2000);
  };
  child.once("exit", () => {
    exited = true;
    // Kill the remaining group before clearing escalation, even on normal
    // leader exit. 'close' may itself wait for inherited descendant pipes.
    if (killTimer) clearTimeout(killTimer);
    void (async () => {
      signal("SIGKILL");
      if (child.pid) {
        const deadline = Date.now() + 2000;
        while (await runningMembers(child.pid)) {
          if (Date.now() >= deadline)
            throw new Error("Eval process group survived SIGKILL");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      settled = true;
      resolveDone();
    })().catch(rejectDone);
  });
  child.once("error", (error) => {
    if (killTimer) clearTimeout(killTimer);
    settled = true;
    rejectDone(error);
  });
  return { stop, finished };
}
