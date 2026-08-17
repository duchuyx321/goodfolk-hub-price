// Prevents inheritance from parent Remix project
export default {
  test: {
    forceRerunTriggers: [
      '**/tests/fixtures/**',
      '**/src/**',
    ],
  },
};
