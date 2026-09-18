/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test", "<rootDir>/lambda"],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/frontend/", "/cdk.out/", "/dist/"],
};
