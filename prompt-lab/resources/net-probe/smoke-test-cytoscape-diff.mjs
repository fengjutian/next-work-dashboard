// Verify V2.6.1 cytoscape diff logic — old nodes/edges removed on re-render.
//
// We replicate the LanPanel effect's diff logic directly against a cytoscape
// core and assert:
//  1. The first render adds `self` + 3 hosts + 3 edges.
//  2. The second render (one host removed) removes that host node and its
//     edge, while keeping `self` and the other two hosts intact.
//  3. The fcose layout is only re-run on a real topology change (verified by
//     checking the topologyKey path used by LanPanel).
import cytoscape from 'cytoscape';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import fcose from 'cytoscape-fcose';
import assert from 'node:assert/strict';

cytoscape.use(fcose);

function diffAndRender(cy, hosts) {
  // `self` is added once at init (mirrors LanPanel); here we ensure it
  // exists at the start of each render.
  if (cy.getElementById('self').empty()) {
    cy.add({ data: { id: 'self', label: 'test-host', kind: 'self' } });
  }
  const elements = [
    ...hosts.map((h) => ({ data: { id: h.ip, label: h.ip, color: '#10b981', ports: [] } })),
    ...hosts.map((h) => ({ data: { id: `e-${h.ip}`, source: 'self', target: h.ip } })),
  ];

  const desiredHostIds = hosts.map((h) => h.ip);
  const desiredEdgeIds = hosts.map((h) => `e-${h.ip}`);

  // The fix: use plain `cy.nodes()` (not `cy.elements('node[ip]')`).
  cy.nodes().forEach((n) => {
    const id = n.id();
    if (id === 'self') return;
    if (!desiredHostIds.includes(id)) n.remove();
  });
  cy.edges().forEach((e) => {
    const id = e.id();
    if (id && !desiredEdgeIds.includes(id)) e.remove();
  });
  const existingNodeIds = new Set(cy.nodes().map((n) => n.id()));
  const existingEdgeIds = new Set(cy.edges().map((e) => e.id()));
  elements.forEach((el) => {
    const id = el.data.id;
    if (id === 'self') return;
    if (el.data.source && el.data.target) {
      if (!existingEdgeIds.has(id)) cy.add(el);
    } else {
      if (!existingNodeIds.has(id)) cy.add(el);
    }
  });

  const topologyKey = [...desiredHostIds].sort().join(',');
  return topologyKey;
}

const cy = cytoscape({ headless: true, styleEnabled: false });

// Render #1: 3 hosts
const key1 = diffAndRender(cy, [
  { ip: '10.0.0.1' },
  { ip: '10.0.0.2' },
  { ip: '10.0.0.3' },
]);
assert.equal(cy.nodes().length, 4, '1: self + 3 hosts = 4 nodes');
assert.equal(cy.edges().length, 3, '1: 3 edges');
assert.equal(key1, '10.0.0.1,10.0.0.2,10.0.0.3');

// Render #2: drop 10.0.0.2 — the V2.6 bug would have left it in the graph.
const key2 = diffAndRender(cy, [
  { ip: '10.0.0.1' },
  { ip: '10.0.0.3' },
]);
assert.equal(cy.nodes().length, 3, '2: self + 2 hosts (zombie 10.0.0.2 removed) = 3 nodes');
assert.equal(cy.edges().length, 2, '2: 2 edges (zombie e-10.0.0.2 removed)');
assert.equal(cy.getElementById('10.0.0.2').length, 0, '2: 10.0.0.2 truly gone');
assert.equal(cy.getElementById('e-10.0.0.2').length, 0, '2: e-10.0.0.2 truly gone');
assert.notEqual(key1, key2, '2: topologyKey differs, layout would re-run');

// Render #3: same set as #2 — topologyKey equal, layout should NOT re-run.
const key3 = diffAndRender(cy, [
  { ip: '10.0.0.1' },
  { ip: '10.0.0.3' },
]);
assert.equal(key2, key3, '3: same hosts → same topologyKey → layout skipped');
assert.equal(cy.nodes().length, 3, '3: still 3 nodes');
assert.equal(cy.edges().length, 2, '3: still 2 edges');

// Render #4: empty — should reduce to just self
const key4 = diffAndRender(cy, []);
assert.equal(cy.nodes().length, 1, '4: only self remains');
assert.equal(cy.edges().length, 0, '4: no edges');

console.log('OK: diff removes zombie nodes/edges correctly');
console.log('OK: topologyKey changes on host-set change, equal on no-op re-render');
console.log(`OK: render keys: [${key1}] → [${key2}] → [${key3}] → [${key4}]`);
