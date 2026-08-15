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
});
