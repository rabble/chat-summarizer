type ConsoleInfo = (...arguments_: unknown[]) => void;

let installed = false;

export function buildRedactedConsoleInfo(original: ConsoleInfo): ConsoleInfo {
  return (...arguments_: unknown[]) => {
    if (arguments_[0] === 'Closing session:') return;
    original(...arguments_);
  };
}

export function installDependencyLogRedaction(): void {
  if (installed) return;
  console.info = buildRedactedConsoleInfo(console.info.bind(console));
  installed = true;
}
