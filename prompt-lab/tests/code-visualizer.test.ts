import { describe, expect, it } from 'vitest';
import { analyzeArchitectureHealth, analyzeDatabaseQueries, analyzeRepositoryFiles, analyzeSecurity, analyzeTypeScriptFiles, buildQualityGate, buildSmartInsights, calculateGitImpact, compareOpenApi, compareOpenApiDocuments, diagnoseFrontendBackend, diffRepositorySnapshots, enrichRepositoryArchitecture, extractFrontendCalls, gitImpactMarkdown, normalizeApiPath, parseArchitectureConfig, parseExplain, parseSqlStructure } from '../src/core/code-visualizer';
import { analyzePythonWithAst } from '../src/main/code-visualizer/python-ast';
import { executeApiDebugRequest } from '../src/main/code-visualizer/api-debug';

describe('code visualizer', () => {
  it('extracts Python routes and contracts with the native AST', async () => {
    const result = await analyzePythonWithAst([{ path: 'api.py', content: `PREFIX = '/api'\nrouter = APIRouter(prefix=PREFIX)\n@router.post('/users', response_model=UserOut, status_code=201)\nasync def create_user(payload: UserIn = Body(...)):\n    return payload` }]);
    expect(result.report.engine).toBe('semantic');
    expect(result.endpoints[0]).toMatchObject({ method: 'POST', path: '/api/users', handler: 'create_user', contract: { responseModel: 'UserOut', statusCodes: [201] } });
  });

  it('resolves include_router prefixes across Python modules with AST imports', async () => {
    const result = await analyzePythonWithAst([
      { path: 'main.py', content: `from api.users import router as users_router\napp.include_router(users_router, prefix='/v1')` },
      { path: 'api/users.py', content: `router = APIRouter(prefix='/users')\n@router.get('/{user_id}')\ndef get_user(user_id: int):\n    return user_id` },
    ]);
    expect(result.endpoints[0]?.path).toBe('/v1/users/{user_id}');
  });

  it('compares OpenAPI operations and required parameters', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users(limit: int):\n    return []` }]);
    const report = compareOpenApi(result, { openapi: '3.0.0', info: { title: 'Demo', version: '1' }, paths: { '/users': { get: { parameters: [{ in: 'query', name: 'page', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'ok' } } } }, '/missing': { post: { responses: { 204: { description: 'ok' } } } } } });
    expect(report.missingImplementation).toContain('POST /missing');
    expect(report.contractMismatches[0]?.changes).toContain('规范必填参数未在代码契约中体现：query:page');
  });

  it('calculates Git impact through endpoint nodes and tests', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users():\n    return []` }, { path: 'tests/test_users.py', content: `def test_users():\n    client.get('/users')` }]);
    const impact = calculateGitImpact(result, ['app.py'], 'main');
    expect(impact.endpoints).toContain('GET /users');
    expect(impact.tests).toContain('tests/test_users.py');
    expect(gitImpactMarkdown(impact)).toContain('## 接口变更影响');
  });

  it('detects field-level OpenAPI breaking changes', () => {
    const operation = (schema: unknown) => ({ openapi: '3.0.0', paths: { '/users': { post: { requestBody: { content: { 'application/json': { schema } } }, responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } } } } } } } } });
    const before = operation({ type: 'object', properties: { name: { type: 'string' } } });
    const after = operation({ type: 'object', required: ['email'], properties: { name: { type: 'string' }, email: { type: 'string' } } });
    expect(compareOpenApiDocuments(before, after)[0]).toMatchObject({ endpoint: 'POST /users', breaking: true, changes: ['新增必填请求字段：email'] });
  });

  it('maps coverage onto endpoints and builds a quality gate', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users():\n    return []` }]);
    const gate = buildQualityGate(result, { source: 'lcov.info', files: [{ file: 'app.py', linesFound: 10, linesHit: 5, lineRate: .5 }], linesFound: 10, linesHit: 5, lineRate: .5 });
    expect(gate.passed).toBe(false);
    expect(gate.failures.map((item) => item.rule)).toEqual(expect.arrayContaining(['missing-test', 'low-coverage']));
  });

  it('scores architecture health and explains direct controller database access', () => {
    const result = enrichRepositoryArchitecture(analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `class User(Base):\n    __tablename__ = 'users'\n@app.get('/users')\ndef users():\n    return session.query(User).all()` }]));
    result.architectureHealth = analyzeArchitectureHealth(result);
    expect(result.architectureHealth.findings).toContainEqual(expect.objectContaining({ rule: 'layer-violation' }));
    result.smartInsights = buildSmartInsights(result);
    expect(result.smartInsights[0]?.recommendation).toContain('Repository');
  });

  it('extracts SQL, risks and table-to-endpoint reverse indexes', () => {
    const files = [{ path: 'reports.py', content: `@app.get('/reports')\ndef reports():\n    return db.execute("SELECT * FROM reports")` }];
    const result = analyzeRepositoryFiles('demo', files);
    const database = analyzeDatabaseQueries(result, files);
    expect(database.queries[0]).toMatchObject({ operation: 'SELECT', tables: ['reports'], risks: ['select-star', 'unbounded-select'] });
    expect(database.tableToEndpoints.reports).toContain(result.endpoints[0].id);
  });

  it('rejects non-HTTP protocols in the API debugger', async () => {
    await expect(executeApiDebugRequest({ method: 'GET', url: 'file:///etc/passwd' })).rejects.toThrow('HTTP/HTTPS');
  });

  it('parses SQL structure with joins, columns and parameters', () => {
    expect(parseSqlStructure('SELECT u.id, p.name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = :id LIMIT 1')).toMatchObject({ operation: 'SELECT', tables: ['users', 'profiles'], selectedColumns: ['u.id', 'p.name'], hasWhere: true, hasLimit: true, parameters: [':id'] });
  });

  it('recognizes PostgreSQL and SQLite EXPLAIN risks', () => {
    expect(parseExplain('Seq Scan on users (cost=0.00..12000.00 rows=200000)')).toMatchObject({ engine: 'postgresql', findings: expect.arrayContaining([expect.objectContaining({ rule: 'sequential-scan' }), expect.objectContaining({ rule: 'high-cost' })]) });
    expect(parseExplain('QUERY PLAN\nSCAN TABLE users\nUSE TEMP B-TREE')).toMatchObject({ engine: 'sqlite', findings: expect.arrayContaining([expect.objectContaining({ rule: 'temporary-sort' })]) });
  });

  it('loads architecture thresholds from code-map configuration', () => {
    expect(parseArchitectureConfig({ architecture: { maxDepth: 4, maxFanOut: 3, ignore: ['shared-database'], forbidden: [{ from: 'controller', to: 'repository' }] }, coverage: { minimum: 90 } })).toMatchObject({ maxDepth: 4, maxFanOut: 3, minimumCoverage: .9, ignoredRules: ['shared-database'] });
  });

  it('finds missing auth, unsafe uploads and wildcard CORS', () => {
    const files = [{ path: 'app.py', content: `app.add_middleware(CORSMiddleware, allow_origins=['*'])\n@app.post('/upload')\ndef upload(file):\n    return file` }];
    const result = analyzeRepositoryFiles('demo', files);
    result.databaseAnalysis = analyzeDatabaseQueries(result, files);
    const security = analyzeSecurity(result, files);
    expect(security.findings.map((item) => item.rule)).toEqual(expect.arrayContaining(['missing-auth', 'unsafe-upload', 'cors-wildcard']));
  });
  it('extracts axios and fetch calls with the TypeScript AST', () => {
    const analysis = analyzeTypeScriptFiles([
      { path: 'src/api.ts', content: `const client = axios.create({ baseURL: '/api/v2' });\nclient.get(\`/users/\${id}\`);\nfetch('/health', { method: 'HEAD' });` },
      { path: 'src/View.vue', content: `<template><div /></template><script setup lang="ts">axios.post('/jobs')</script>` },
    ]);
    expect(analysis.calls.map((call) => [call.method, call.normalizedPath])).toEqual(expect.arrayContaining([
      ['GET', '/api/v2/users/:param'], ['HEAD', '/health'], ['POST', '/jobs'],
    ]));
    expect(analysis.report).toMatchObject({ engine: 'ast', files: 2 });
  });

  it('reports frontend URLs that cannot be statically resolved', () => {
    const analysis = analyzeTypeScriptFiles([{ path: 'src/api.ts', content: `axios.get(buildUrl(resource))` }]);
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ kind: 'dynamic-url', severity: 'warning' }));
  });
  it('normalizes frontend and backend route parameters', () => {
    expect(normalizeApiPath('/api/users/${id}?detail=1')).toBe('/api/users/:param');
    expect(normalizeApiPath('/api/users/{user_id}/')).toBe('/api/users/:param');
  });

  it('links FastAPI endpoints to Vue requests and database tables', () => {
    const result = analyzeRepositoryFiles('demo', [
      { path: 'backend/users.py', content: `
from fastapi import APIRouter
router = APIRouter(prefix="/api")

class User(Base):
    __tablename__ = "users"

def load_user(user_id):
    return session.query(User).filter(User.id == user_id).first()

@router.get("/users/{user_id}")
def get_user(user_id):
    return load_user(user_id)
` },
      { path: 'frontend/UserView.vue', content: `<script setup>\naxios.get(\`/api/users/\${id}\`)\n</script>` },
    ]);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0]).toMatchObject({ method: 'GET', path: '/api/users/{user_id}', handler: 'get_user', tables: ['users'] });
    expect(result.endpoints[0].frontendCalls).toHaveLength(1);
    expect(result.endpoints[0].nodes.some((node) => node.label === 'load_user')).toBe(true);
  });

  it('extracts Flask routes', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `
@app.route('/login', methods=['POST'])
def login():
    return {'ok': True}
` }]);
    expect(result.endpoints[0]).toMatchObject({ framework: 'flask', method: 'POST', path: '/login' });
  });

  it('resolves mounted router prefixes and imported calls', () => {
    const result = analyzeRepositoryFiles('demo', [
      { path: 'main.py', content: `from api.users import router as users_router\napp.include_router(users_router, prefix="/api/v1")` },
      { path: 'api/users.py', content: `from fastapi import APIRouter\nfrom services.users import load_user\nrouter = APIRouter(prefix="/users")\n@router.get("/{user_id}")\ndef get_user(user_id):\n    return load_user(user_id)` },
      { path: 'services/users.py', content: `def load_user(user_id):\n    return user_id` },
      { path: 'web/api.ts', content: `const client = axios.create({ baseURL: '/api/v1' })\nclient.get(\`/users/\${id}\`)` },
    ]);
    expect(result.endpoints[0].path).toBe('/api/v1/users/{user_id}');
    expect(result.endpoints[0].frontendCalls).toHaveLength(1);
    const importedEdge = result.endpoints[0].edges.find((edge) => edge.target.includes('services/users.py'));
    expect(importedEdge).toMatchObject({ confidence: 'exact', evidence: '由 import services.users.load_user 解析' });
  });

  it('follows FastAPI Depends dependencies', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `
def current_user():
    return 'user'

@app.get('/me')
def me(user = Depends(current_user)):
    return user
` }]);
    expect(result.endpoints[0].nodes.some((node) => node.label === 'current_user')).toBe(true);
  });

  it('extracts endpoint contracts', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `
@app.post('/users/{user_id}', response_model=UserResponse, status_code=201)
def update_user(user_id: int, payload: UserInput = Body(...), trace: str = Header(None)):
    return payload
` }]);
    expect(result.endpoints[0].contract).toMatchObject({ requestModel: 'UserInput', responseModel: 'UserResponse', statusCodes: [201] });
    expect(result.endpoints[0].contract.parameters.map((item) => [item.name, item.source])).toEqual([['user_id', 'path'], ['payload', 'body'], ['trace', 'header']]);
  });

  it('diagnoses missing backend routes and method mismatches', () => {
    const files = [
      { path: 'app.py', content: `@app.get('/users')\ndef users():\n    return []` },
      { path: 'web.ts', content: `axios.post('/users')\naxios.get('/missing')` },
    ];
    const result = analyzeRepositoryFiles('demo', files);
    const diagnostics = diagnoseFrontendBackend(result, files.flatMap(extractFrontendCalls));
    expect(diagnostics.some((item) => item.kind === 'method-mismatch')).toBe(true);
    expect(diagnostics.some((item) => item.kind === 'missing-backend')).toBe(true);
  });

  it('extracts complete ORM fields and ignores Pydantic models', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'users.py', content: `
class UserInput(BaseModel):
    name: str

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey('teams.id'), nullable=True)

@app.get('/users')
def users():
    return session.query(User).all()
` }]);
    expect(result.endpoints[0].databaseTables).toHaveLength(1);
    expect(result.endpoints[0].databaseTables[0].name).toBe('users');
    expect(result.endpoints[0].databaseTables[0].fields).toMatchObject([
      { name: 'id', primaryKey: true, nullable: false },
      { name: 'name', type: 'str', nullable: false },
      { name: 'team_id', foreignKey: 'teams.id', nullable: true },
    ]);
  });

  it('builds ER relations, data flow, test coverage and performance findings', () => {
    const files = [
      { path: 'models.py', content: `class Team(Base):\n    __tablename__ = 'teams'\n    id: Mapped[int] = mapped_column(Integer, primary_key=True)\n\nclass User(Base):\n    __tablename__ = 'users'\n    id: Mapped[int] = mapped_column(Integer, primary_key=True)\n    team_id: Mapped[int] = mapped_column(ForeignKey('teams.id'))` },
      { path: 'api.py', content: `from models import User\n@app.get('/users/{user_id}')\ndef get_user(user_id: int):\n    for item in items:\n        session.query(User).filter(User.id == item).all()\n    return user_id` },
      { path: 'tests/test_users.py', content: `def test_get_user():\n    client.get('/users/1')` },
    ];
    const result = enrichRepositoryArchitecture(analyzeRepositoryFiles('demo', files));
    expect(result.databaseRelations).toContainEqual(expect.objectContaining({ sourceTable: 'users', sourceField: 'team_id', targetTable: 'teams', targetField: 'id' }));
    expect(result.endpoints[0].dataFlow.some((step) => step.stage === 'parameter')).toBe(true);
    expect(result.endpoints[0].tests).toHaveLength(1);
    expect(result.endpoints[0].performanceRisks.some((risk) => risk.rule === 'query-in-loop')).toBe(true);
  });

  it('detects repository queries, external calls in loops and unbounded SQL', () => {
    const result = analyzeRepositoryFiles('demo', [{ path: 'api.py', content: `@app.get('/reports')\nasync def reports():\n    for item in items:\n        await repo.find(item.id)\n        requests.get(item.url)\n    rows = session.execute("SELECT * FROM reports")\n    return rows` }]);
    const rules = result.endpoints[0].performanceRisks.map((risk) => risk.rule);
    expect(rules).toContain('query-in-loop');
    expect(rules).toContain('external-call-in-loop');
    expect(rules).toContain('unbounded-sql');
    expect(rules).toContain('blocking-in-async');
    expect(rules).toContain('sync-db-in-async');
  });

  it('diffs endpoint contracts and database fields between snapshots', () => {
    const before = enrichRepositoryArchitecture(analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users():\n    return []` }]));
    const after = enrichRepositoryArchitecture(analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users(limit: int = 10):\n    return []\n@app.post('/users')\ndef create_user():\n    return {}` }]));
    const diff = diffRepositorySnapshots(before, after);
    expect(diff.addedEndpoints).toContain('POST /users');
    expect(diff.changedContracts).toContain('GET /users');
  });
});
