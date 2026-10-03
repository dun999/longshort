'use client';
import type { WebAuthnClient } from '@category-labs/mera';
import { beginCeremony } from './journey';

/** Native WebAuthn bridge using Mera's public client interface, with actual ceremony counting. */
export function measuredPasskeyClient(purpose: 'account' | 'journal') {
  const outputs: Uint8Array[] = [];
  const result = (credential: Credential | null) => {
    if (!credential || credential.type !== 'public-key') throw new Error('Passkey prompt was cancelled or unavailable.');
    const key = credential as PublicKeyCredential;
    const prf = (key.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
      prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
    }).prf;
    const prfOutput = prf?.results?.first ? new Uint8Array(prf.results.first).slice() : undefined;
    if (prfOutput) outputs.push(prfOutput);
    return { key, prf, prfOutput };
  };
  const client: WebAuthnClient = {
    async createCredential(request) {
      const finish = beginCeremony(purpose, 'create');
      try {
        const { key, prf, prfOutput } = result(await navigator.credentials.create({ publicKey: {
          rp: request.rp, user: request.user, challenge: request.challenge,
          pubKeyCredParams: request.algorithms.map((alg) => ({ type: 'public-key', alg })),
          timeout: request.timeout, attestation: request.attestation,
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          extensions: { prf: { eval: { first: request.prfSalt } } } as AuthenticationExtensionsClientInputs,
        } }));
        finish(true);
        const response = key.response as AuthenticatorAttestationResponse;
        return { credentialId: new Uint8Array(key.rawId), transports: response.getTransports?.(), prfEnabled: prf?.enabled === true, prfOutput };
      } catch (error) { finish(false); throw error; }
    },
    async getCredential(request) {
      const finish = beginCeremony(purpose, 'get');
      try {
        const { key, prfOutput } = result(await navigator.credentials.get({ publicKey: {
          rpId: request.rpId, challenge: request.challenge, timeout: request.timeout, userVerification: 'required',
          extensions: { prf: { eval: { first: request.prfSalt } } } as AuthenticationExtensionsClientInputs,
          ...(request.allowCredential ? { allowCredentials: [{ type: 'public-key', id: request.allowCredential.credentialId,
            transports: request.allowCredential.transports as AuthenticatorTransport[] | undefined }] } : {}),
        } }));
        finish(true);
        return { credentialId: new Uint8Array(key.rawId), prfOutput };
      } catch (error) { finish(false); throw error; }
    },
  };
  return { client, dispose: () => { for (const output of outputs) output.fill(0); outputs.length = 0; } };
}
