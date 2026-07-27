export function buildWindowsServerLauncher(
  bunPath: string,
  serverScript: string,
  extraEnvironmentJson: string,
): string {
  return (
    `const{spawn}=require('child_process');` +
    `spawn(${JSON.stringify(bunPath)},['run',${JSON.stringify(serverScript)}],` +
    `{detached:true,stdio:['ignore','ignore','ignore'],env:Object.assign({},process.env,` +
    `${extraEnvironmentJson})}).unref()`
  );
}
