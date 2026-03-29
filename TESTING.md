# Testing Guide — TindaPos Backend

## Quick Start

```bash
cd TindaPos-Backend
npm test
```

---

## Commands

| Command | When to Use |
|---|---|
| `npm test` | Run all tests once — use before every `git push` |
| `npm run test:watch` | Auto re-run on file save — use while writing code |
| `npm run test:coverage` | See which code is untested |

---

## Current Test Files

```
src/tests/
├── vat.test.ts    — VAT computation + OR number generation
├── fifo.test.ts   — FIFO batch costing weighted average
└── auth.test.ts   — Login validation + SKU generation
```

Run a specific file only:
```bash
npm test -- vat.test.ts
npm test -- fifo.test.ts
npm test -- auth.test.ts
```

---

## Understanding the Output

```
PASS src/tests/vat.test.ts       ← all tests in this file passed
PASS src/tests/auth.test.ts
PASS src/tests/fifo.test.ts

Tests:       26 passed, 26 total  ← total individual test cases
Test Suites: 3 passed, 3 total    ← total test files
```

If a test fails:
```
FAIL src/tests/vat.test.ts

  ● VAT Computation › all vatable items — VAT is 12/112 of total

    Expected: 36
    Received: 0        ← what your code actually returned

    at src/tests/vat.test.ts:24:5
```
The `●` shows exactly which test failed, what value was expected, and what was received.

---

## How to Write a New Test

### 1. Create the file
```
src/tests/yourfeature.test.ts
```

### 2. Basic structure
```typescript
describe('Feature Name', () => {

  test('should do something specific', () => {
    // Arrange — set up your data
    const input = 100

    // Act — call the function
    const result = input * 1.12

    // Assert — check the result
    expect(result).toBe(112)
  })

})
```

### 3. Common assertions
```typescript
expect(value).toBe(42)              // exact match (numbers, strings, booleans)
expect(value).toEqual({ a: 1 })     // deep match (objects, arrays)
expect(value).toBeNull()            // is null
expect(value).not.toBeNull()        // is not null
expect(value).toBeTruthy()          // is truthy
expect(value).toContain('text')     // string/array contains
expect(fn).toThrow()                // function throws an error
expect(value).toBeGreaterThan(0)    // number comparison
expect(arr).toHaveLength(3)         // array/string length
```

---

## What to Test (Priority Order)

### ✅ High Priority — Test These
- **Business logic** (VAT computation, FIFO cost, OR number generation)
- **Input validation** (required fields, type checks, null guards)
- **Edge cases** (zero qty, empty cart, missing data)

### ⚠️ Medium Priority — Test if Time Allows
- **Controller logic** (using mocked Supabase)
- **Auth middleware** (valid token, expired token, missing token)

### ❌ Skip These
- Supabase queries directly (test the DB in staging, not unit tests)
- Express routing (covered by integration tests)
- UI behavior (use Playwright for that)

---

## Mocking Supabase

Since tests don't connect to the real database, mock Supabase like this:

```typescript
const mockSupabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: { id: '123', name: 'Test Product', cost_price: 50 },
          error: null
        })
      })
    }),
    insert: () => Promise.resolve({ error: null }),
    update: () => ({
      eq: () => Promise.resolve({ error: null })
    })
  })
} as any
```

For error scenarios:
```typescript
const mockSupabaseError = {
  from: () => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: null, error: { message: 'Not found' } })
      })
    })
  })
} as any
```

---

## Adding Tests for New Features

When you add a new feature, ask:
> "What are the rules this feature must follow?"

Then write one test per rule.

**Example — new discount logic:**
```
Rules:
1. Discount cannot exceed the item total
2. Percentage discount must be between 0–100
3. Zero discount returns original price

→ Write 3 tests, one per rule
```

**Example — new payment method:**
```
Rules:
1. Valid methods: cash, card, gcash, credit
2. Invalid method returns 400 error
3. Credit payment requires customer_id

→ Write 3 tests
```

---

## Running Tests Before Deployment

Make this a habit:

```bash
# 1. Run tests
npm test

# 2. Only push if all pass
git add .
git commit -m "your message"
git push
```

If any test fails — **fix the code first**, then push.

---

## Coverage Report

```bash
npm run test:coverage
```

Output example:
```
File                          | % Stmts | % Branch | % Funcs |
------------------------------|---------|----------|---------|
services/fifoService.ts       |   85.2  |   75.0   |  100.0  |
controllers/salesController.ts|   12.5  |   10.0   |   20.0  |  ← needs more tests
```

- **% Stmts** — % of code lines executed by tests
- **% Branch** — % of if/else branches covered
- **% Funcs** — % of functions called

Aim for **>70% on services/**, controllers can be lower since they depend on DB.
