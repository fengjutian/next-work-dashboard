/**
 * cytoscape-fcose 极简类型 shim
 *
 * cytoscape-fcose 没有自带 .d.ts，我们只用 `cytoscape.use(ext)` 把它注册成 layout。
 * 完整 fcose 参数请参考：https://github.com/iVis-at-Bilkent/cytoscape.js-fcose
 */
declare module 'cytoscape-fcose' {
  const ext: import('cytoscape').Ext;
  export default ext;
}
