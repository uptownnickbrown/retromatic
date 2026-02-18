export default {
  'frontend/src/**/*.{ts,tsx}': (files) => {
    const args = files.join(' ');
    return `frontend/node_modules/.bin/eslint --config frontend/eslint.config.js --no-warn-ignored ${args}`;
  },
  'backend/src/**/*.ts': (files) => {
    const args = files.join(' ');
    return `backend/node_modules/.bin/eslint --config backend/eslint.config.js --no-warn-ignored ${args}`;
  },
};
