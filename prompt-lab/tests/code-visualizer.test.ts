import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles, normalizeApiPath } from '../src/core/code-visualizer';

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
});
