import "@testing-library/jest-dom/vitest";

// React reports problems (duplicate keys, updates outside act, invalid markup) with
// console.error and carries on, so fail any test that logs an error.
let errors: unknown[][] = [];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
});

afterEach(() => {
  expect(errors, "console.error was called during the test").toEqual([]);
});
