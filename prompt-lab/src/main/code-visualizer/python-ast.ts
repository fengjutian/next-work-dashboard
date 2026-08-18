import { spawn } from 'node:child_process';
import type { AnalyzerReport, ApiContract, HttpMethod, RepositorySourceFile, SourceLocation } from '../../core/code-visualizer';

export interface PythonAstEndpoint { method: HttpMethod; path: string; handler: string; routerName?: string; framework: 'fastapi' | 'flask'; location: SourceLocation; contract: ApiContract }
export interface PythonAstResult { endpoints: PythonAstEndpoint[]; report: AnalyzerReport }

const SCRIPT = String.raw`
import ast,json,sys
payload=json.load(sys.stdin); out=[]; failures=[]; mounts=[]
def text(node):
  try: return ast.unparse(node)
  except: return ''
def literal(node, constants):
  if isinstance(node, ast.Constant) and isinstance(node.value,str): return node.value
  if isinstance(node, ast.Name): return constants.get(node.id)
  if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
    a=literal(node.left,constants); b=literal(node.right,constants)
    return a+b if a is not None and b is not None else None
  return None
for f in payload:
 try:
  tree=ast.parse(f['content'], filename=f['path']); constants={}; prefixes={}; imports={}
  for node in tree.body:
   if isinstance(node,ast.ImportFrom):
    for alias in node.names: imports[alias.asname or alias.name]={'module':node.module or '','symbol':alias.name}
   if isinstance(node,(ast.Assign,ast.AnnAssign)):
    target=node.targets[0] if isinstance(node,ast.Assign) else node.target
    if isinstance(target,ast.Name):
     value=literal(node.value,constants)
     if value is not None: constants[target.id]=value
     if isinstance(node.value,ast.Call) and text(node.value.func).split('.')[-1] in ('APIRouter','Blueprint'):
      for kw in node.value.keywords:
       if kw.arg in ('prefix','url_prefix'): prefixes[target.id]=literal(kw.value,constants) or ''
  for call in ast.walk(tree):
   if isinstance(call,ast.Call) and isinstance(call.func,ast.Attribute) and call.func.attr=='include_router' and call.args and isinstance(call.args[0],ast.Name):
    ref=imports.get(call.args[0].id); prefix=''
    for kw in call.keywords:
     if kw.arg=='prefix': prefix=literal(kw.value,constants) or ''
    if ref: mounts.append({'host':f['path'],'module':ref['module'],'symbol':ref['symbol'],'prefix':prefix})
  for node in ast.walk(tree):
   if not isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)): continue
   params=[]
   args=node.args.args; defaults=[None]*(len(args)-len(node.args.defaults))+list(node.args.defaults)
   for arg,default in zip(args,defaults):
    if arg.arg in ('self','cls'): continue
    typ=text(arg.annotation) if arg.annotation else 'Any'; source='query'
    if isinstance(default,ast.Call) and text(default.func).split('.')[-1] in ('Path','Query','Header','Cookie','Body'): source=text(default.func).split('.')[-1].lower()
    params.append({'name':arg.arg,'source':source,'type':typ,'required':default is None or text(default)=='...', 'defaultValue':text(default) if default is not None else None})
   for dec in node.decorator_list:
    if not isinstance(dec,ast.Call) or not isinstance(dec.func,ast.Attribute): continue
    method=dec.func.attr.upper(); owner=text(dec.func.value)
    if method not in ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD') and method!='ROUTE': continue
    route=literal(dec.args[0],constants) if dec.args else None
    if route is None: continue
    methods=[method]
    if method=='ROUTE':
     methods=['GET']
     for kw in dec.keywords:
      if kw.arg=='methods' and isinstance(kw.value,(ast.List,ast.Tuple)): methods=[str(x.value).upper() for x in kw.value.elts if isinstance(x,ast.Constant)]
    response=None; status=200
    for kw in dec.keywords:
     if kw.arg=='response_model': response=text(kw.value)
     if kw.arg=='status_code' and isinstance(kw.value,ast.Constant): status=kw.value.value
    full='/'+'/'.join(x.strip('/') for x in (prefixes.get(owner,''),route) if x.strip('/'))
    route_params=[dict(p,source='path',required=True) if '{'+p['name']+'}' in full or '<'+p['name']+'>' in full else p for p in params]
    for m in methods: out.append({'method':m,'path':full,'handler':node.name,'routerName':owner,'framework':'flask' if method=='ROUTE' else 'fastapi','location':{'file':f['path'],'line':node.lineno,'endLine':getattr(node,'end_lineno',node.lineno),'snippet':text(node).splitlines()[0]},'contract':{'parameters':route_params,'responseModel':response,'statusCodes':[status]}})
 except Exception as e: failures.append({'file':f['path'],'message':str(e)})
json.dump({'endpoints':out,'failures':failures,'mounts':mounts},sys.stdout)
`;

export async function analyzePythonWithAst(files: RepositorySourceFile[]): Promise<PythonAstResult> {
  const pythonFiles = files.filter((file) => file.path.endsWith('.py'));
  if (!pythonFiles.length) return { endpoints: [], report: { id: 'python-ast', language: 'python', engine: 'ast', files: 0, artifacts: 0, failures: [] } };
  for (const executable of ['python', 'python3']) {
    try {
      const parsed = await run(executable, pythonFiles) as { endpoints: PythonAstEndpoint[]; failures: AnalyzerReport['failures']; mounts: Array<{ module: string; symbol: string; prefix: string }> };
      const endpoints = parsed.endpoints.map((endpoint) => {
        const mount = parsed.mounts.find((item) => endpoint.location.file.endsWith(`${item.module.replace(/\./g, '/')}.py`) && endpoint.routerName === item.symbol);
        return mount ? { ...endpoint, path: joinPath(mount.prefix, endpoint.path) } : endpoint;
      });
      return { endpoints, report: { id: 'python-ast', language: 'python', engine: 'semantic', files: pythonFiles.length - parsed.failures.length, artifacts: endpoints.length, failures: parsed.failures } };
    } catch { /* try next executable */ }
  }
  return { endpoints: [], report: { id: 'python-ast', language: 'python', engine: 'regex-fallback', files: 0, artifacts: 0, failures: pythonFiles.map((file) => ({ file: file.path, message: '未找到 Python 运行时，已使用正则回退' })) } };
}

function joinPath(prefix: string, route: string): string { return `/${[prefix, route].join('/').split('/').filter(Boolean).join('/')}`; }

function run(executable: string, files: RepositorySourceFile[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-c', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Python AST 分析超时')); }, 20_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; }); child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject); child.on('close', (code) => { clearTimeout(timer); if (code === 0) { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } } else reject(new Error(stderr || `Python exited ${code}`)); });
    child.stdin.end(JSON.stringify(files));
  });
}
