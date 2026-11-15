export function collectSourceFiles(root: string): string[];
export function scanPublicFiles(root: string, files: readonly string[]): Array<{ path: string; reason: string }>;
