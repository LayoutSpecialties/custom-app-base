import { assemblyApi, OpenAPI } from '@assembly-js/node-sdk';
import { need } from '@/utils/need';

// Builds the Assembly SDK client, then re-authenticates it with the STABLE
// workspace-scoped key (`workspaceId/apiKey`) instead of the session-scoped key
// (`workspaceId/apiKey/tokenId`) the SDK uses by default. The session key
// expires as the embedded token ages, which caused intermittent 403s on every
// endpoint; the workspace key does not expire. The token is still used to
// decode identity via getTokenPayload().
export async function assemblyClient(token: string | undefined) {
  const apiKey = need<string>(
    process.env.ASSEMBLY_API_KEY,
    'ASSEMBLY_API_KEY is required',
  );
  const sdk = await assemblyApi({ apiKey, token });
  const payload = await sdk.getTokenPayload?.();
  if (payload?.workspaceId) {
    OpenAPI.HEADERS = {
      ...(OpenAPI.HEADERS as Record<string, string> | undefined),
      'X-API-Key': `${payload.workspaceId}/${apiKey}`,
    };
  }
  return sdk;
}
