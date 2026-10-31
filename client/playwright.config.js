import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    // One local API container serves every browser; Playwright's default (half the
    // CPU cores, 32 here) swamps it and tests time out waiting for heroes
    workers: Number(process.env.WORKERS) || 4,
    retries: process.env.RETRIES ? Number(process.env.RETRIES) : 1,
    use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',     // (tools/preview/test.sh: the preview's)
        // Capture screenshot on failure for debugging
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
