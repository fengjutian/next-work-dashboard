#!/usr/bin/env node
/**
 * Smoke test for the V2.6 cytoscape + fcose integration in the renderer.
 *
 * We can't run the full Electron renderer from a Node script, but we can:
 *  1. Verify cytoscape + cytoscape-fcose load in a Node environment
 *     (cytoscape needs a DOM; we use jsdom).
 *  2. Build the same element list the LanPanel builds, run fcose on it,
 *     confirm the layout produces non-zero positions for every node.
 *
 * This catches:
 *   - Version mismatch (cytoscape 3.34 + fcose 2.2 compatibility)
 *   - Bad layout options (fcose crashes on certain params)
 *   - Element diff logic (node ids unique, edges reference real nodes)
 */
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// jsdom is required because cytoscape looks for window/document.
const dom = new JSDOM('<!doctype html><html><body><div id="cy"></div></body></html>');
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.HTMLElement = window.HTMLElement;
globalThis.SVGElement = window.SVGElement;
globalThis.Element = window.Element;

cytoscape.use(fcose);

const sortedHosts = [
  { ip: '192.168.1.1', ports: [80, 443], hostname: 'router.lan' },
  { ip: '192.168.1.5', ports: [22, 80], hostname: 'nas.lan' },
  { ip: '192.168.1.9', ports: [443], hostname: 'laptop.lan' },
  { ip: '192.168.1.42', ports: [80, 3389], hostname: 'desktop.lan' },
  { ip: '192.168.1.100', ports: [], hostname: null },
];

const cy = cytoscape({
  container: window.document.getElementById('cy'),
  headless: true, // run without rendering — we just want positions
  styleEnabled: false,
  elements: [
    { data: { id: 'self', label: '本机', kind: 'self' } },
    ...sortedHosts.map((h) => ({
      data: {
        id: h.ip,
        label: `${h.ip}\n${h.hostname ?? ''}`,
        color: h.ports.includes(443) || h.ports.includes(80) ? '#10b981'
          : h.ports.length > 0 ? '#f59e0b' : '#94a3b8',
      },
    })),
    ...sortedHosts.map((h) => ({ data: { id: `e-${h.ip}`, source: 'self', target: h.ip } })),
  ],
});

const layout = cy.layout({
  name: 'fcose',
  quality: 'default',
  randomize: true,
  animate: false,
  nodeSeparation: 80,
  idealEdgeLength: () => 90,
  nodeRepulsion: () => 8000,
  gravity: 0.25,
  numIter: 2500,
  fit: true,
  padding: 30,
});
layout.run();

let bad = 0;
const summary = cy.nodes().map((n) => {
  const pos = n.position();
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || isNaN(pos.x) || isNaN(pos.y)) {
    bad++;
  }
  return { id: n.id(), x: pos.x.toFixed(1), y: pos.y.toFixed(1) };
});

if (bad > 0) {
  console.error(`FAIL: ${bad} nodes have invalid positions`);
  process.exit(1);
}

if (cy.edges().length !== sortedHosts.length) {
  console.error(`FAIL: expected ${sortedHosts.length} edges, got ${cy.edges().length}`);
  process.exit(1);
}

console.log('=== cytoscape + fcose layout positions ===');
for (const s of summary) console.log(`  ${s.id.padEnd(16)} (${s.x}, ${s.y})`);

console.log('');
console.log(`OK: ${cy.nodes().length} nodes, ${cy.edges().length} edges laid out successfully`);
console.log(`OK: positions span x=[${Math.min(...summary.map(s => +s.x))}, ${Math.max(...summary.map(s => +s.x))}], y=[${Math.min(...summary.map(s => +s.y))}, ${Math.max(...summary.map(s => +s.y))}]`);
cy.destroy();
