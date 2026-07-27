export function buildWindowsServerLauncher(
  serverScript: string,
  extraEnvironmentJson: string,
): string {
  return (
    `const{spawn}=require('child_process');` +
    `spawn(process.execPath,[${JSON.stringify(serverScript)}],` +
    `{detached:true,stdio:['ignore','ignore','ignore'],env:Object.assign({},process.env,` +
    `${extraEnvironmentJson})}).unref()`
  );
}

export function findBrowserInstaller(
  candidates: string[],
  which: (name: string) => string | null,
): { name: string; executable: string } | null {
  for (const name of candidates) {
    const executable = which(name);
    if (executable) return { name, executable };
  }
  return null;
}
