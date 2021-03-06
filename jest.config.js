module.exports = {
    silent: false,
    verbose: false,
    testEnvironment: "node",
    collectCoverage: true,
    collectCoverageFrom: [
        "packages/*/src/**/*.{ts}"
    ],
    coverageThreshold: {
        global: {
            branches: 100,
            functions: 100,
            lines: 100,
            statements: 100
        }
    },
    rootDir: ".",
    moduleNameMapper: {
        "@plumier/(.*)": "<rootDir>packages/$1/src",
        "^plumier$": "<rootDir>packages/plumier/src/index.ts",
    },
    transform: {
        "^.+\\.tsx?$": "ts-jest",
    },
    testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(tsx?)$",
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    snapshotSerializers: [
        "<rootDir>script/function-snapshot-serializer.js"
    ]
};