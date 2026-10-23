// oxlint-disable node/no-process-env

/** The running application origin. Local review runs set E2E_BASE_URL to reuse a dev server. */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
