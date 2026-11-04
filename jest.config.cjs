module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/a/**/*.test.ts", "<rootDir>/tests/c/**/*.test.ts", "<rootDir>/tests/integration/**/*.test.ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      {
        jsc: { target: "es2022", parser: { syntax: "typescript" } },
        module: { type: "commonjs" },
      },
    ],
  },
  testTimeout: 30_000,
};
