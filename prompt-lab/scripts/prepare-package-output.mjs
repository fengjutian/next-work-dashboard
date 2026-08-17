import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const disposablePaths = [
  path.join(root, 'resources', 'video-player', '.tmp'),
  path.join(root, 'out', `next-work-dashboard-${process.platform}-${process.arch}`),
];

for (const target of disposablePaths) {
  if (!fs.existsSync(target)) continue;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    console.log(`[prepare-package] removed ${path.relative(root, target)}`);
  } catch (error) {
    console.error(`[prepare-package] cannot remove ${target}`);
    console.error('Close the packaged application and any Explorer window opened inside that directory, then retry.');
    throw error;
  }
}
