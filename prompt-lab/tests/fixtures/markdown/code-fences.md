# Code Fences

JavaScript:

```javascript
function add(a, b) {
  return a + b;
}

const result = add(1, 2);
console.log(result);
```

TypeScript with generics:

```typescript
interface Pair<T, U> {
  first: T;
  second: U;
}

const pair: Pair<number, string> = { first: 1, second: 'one' };
```

Python:

```python
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

No language:

```
plain text
no highlighting
```

End.
