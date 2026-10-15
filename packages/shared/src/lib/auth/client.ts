"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/react";

// Create auth client with React hooks support
const authClient = createAuthClient({
  plugins: [apiKeyClient()],
});

// Export commonly used functions
export const { signIn, signOut, signUp, getSession, useSession, apiKey } = authClient;

// Export the full client for advanced usage
export { authClient };
