import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const checkBudget = process.argv.includes('--check');
const budgetMb = Number(process.env.NWD_PACKAGE_BUDGET_MB || 650);

function directorySize(target) {
  if (!fs.existsSync(target)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    total += entry.isDirectory() ? directorySize(child) : fs.statSync(child).size;
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

if (!fs.existsSync(outRoot)) {
  throw new Error(`Package output does not exist: ${outRoot}. Run npm run package first.`);
}

const applications = fs.readdirSync(outRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('next-work-dashboard-'))
  .map((entry) => path.join(outRoot, entry.name));

if (applications.length === 0) {
  throw new Error(`No packaged application found below ${outRoot}. Run npm run package first.`);
}

let failed = false;
for (const application of applications) {
  const resources = path.join(application, 'resources');
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const rows = [
    ['total', directorySize(application)],
    ['resources', directorySize(resources)],
    ['app.asar', fs.existsSync(path.join(resources, 'app.asar')) ? fs.statSync(path.join(resources, 'app.asar')).size : 0],
    ['native unpacked', directorySize(path.join(unpacked, 'node_modules'))],
  ];

  console.log(`\n${path.basename(application)}`);
  for (const [label, bytes] of rows) console.log(`${label.padEnd(18)} ${mb(bytes)}`);

  const totalMb = rows[0][1] / 1024 / 1024;
  if (checkBudget && totalMb > budgetMb) {
    console.error(`Package budget exceeded: ${totalMb.toFixed(1)} MB > ${budgetMb.toFixed(1)} MB`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
