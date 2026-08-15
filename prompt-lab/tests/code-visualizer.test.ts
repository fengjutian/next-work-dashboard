import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles, diagnoseFrontendBackend, diffRepositorySnapshots, enrichRepositoryArchitecture, extractFrontendCalls, normalizeApiPath } from '../src/core/code-visualizer';

describe('code visualizer', () => {
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

  it('diffs endpoint contracts and database fields between snapshots', () => {
    const before = enrichRepositoryArchitecture(analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users():\n    return []` }]));
    const after = enrichRepositoryArchitecture(analyzeRepositoryFiles('demo', [{ path: 'app.py', content: `@app.get('/users')\ndef users(limit: int = 10):\n    return []\n@app.post('/users')\ndef create_user():\n    return {}` }]));
    const diff = diffRepositorySnapshots(before, after);
    expect(diff.addedEndpoints).toContain('POST /users');
    expect(diff.changedContracts).toContain('GET /users');
  });
});
