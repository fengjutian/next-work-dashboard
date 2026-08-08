import { runKnowledgeCli } from './knowledge-cli';

runKnowledgeCli().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`Knowledge CLI failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
