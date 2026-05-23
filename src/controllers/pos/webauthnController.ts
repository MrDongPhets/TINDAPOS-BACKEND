import { Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { getDb } from '../../config/database';

const RP_NAME = 'TindaPOS';

// In-memory challenge store (TTL: 5 min)
const challengeStore = new Map<string, { challenge: string; expires: number }>();
const CHALLENGE_TTL = 5 * 60 * 1000;

function saveChallenge(staffId: string, challenge: string) {
  challengeStore.set(staffId, { challenge, expires: Date.now() + CHALLENGE_TTL });
}

function consumeChallenge(staffId: string): string | null {
  const entry = challengeStore.get(staffId);
  if (!entry || Date.now() > entry.expires) {
    challengeStore.delete(staffId);
    return null;
  }
  challengeStore.delete(staffId);
  return entry.challenge;
}

function getRpId(req: Request): string {
  const origin = req.headers.origin || req.headers.referer || '';
  try {
    return new URL(origin).hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

function getOrigin(req: Request): string {
  return req.headers.origin || 'http://localhost:5173';
}

// ─── Registration: Step 1 — generate options ────────────────────────────────

async function getRegistrationOptions(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const supabase = getDb();

    const { data: staff, error } = await supabase
      .from('staff')
      .select('id, name, staff_id')
      .eq('id', staffId)
      .single();

    if (error || !staff) { res.status(404).json({ error: 'Staff not found' }); return; }

    // Existing credentials for this staff (to exclude)
    const { data: existing } = await supabase
      .from('staff_webauthn_credentials')
      .select('credential_id')
      .eq('staff_id', staffId);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userName: staff.name,
      userID: Buffer.from(staffId),
      attestationType: 'none',
      excludeCredentials: (existing || []).map((c: { credential_id: string }) => ({
        id: c.credential_id,
        type: 'public-key' as const,
      })),
      authenticatorSelection: {
        residentKey: 'discouraged',
        userVerification: 'preferred',
      },
    });

    saveChallenge(staffId, options.challenge);
    console.log(`🔐 WebAuthn registration options generated for staff ${staffId}`);
    res.json(options);
  } catch (error) {
    console.error('❌ getRegistrationOptions error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
}

// ─── Registration: Step 2 — verify + store ──────────────────────────────────

async function verifyRegistration(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const companyId = req.user!.company_id!;
    const { credential, device_name } = req.body;

    const expectedChallenge = consumeChallenge(staffId);
    if (!expectedChallenge) {
      res.status(400).json({ error: 'Challenge expired or not found. Please try again.' });
      return;
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: 'Biometric registration failed' });
      return;
    }

    const { credential: cred } = verification.registrationInfo;
    const supabase = getDb();

    const { error } = await supabase.from('staff_webauthn_credentials').insert({
      staff_id: staffId,
      company_id: companyId,
      credential_id: cred.id,
      public_key: isoBase64URL.fromBuffer(cred.publicKey),
      counter: cred.counter,
      device_name: device_name || null,
    });

    if (error) throw error;

    console.log(`✅ WebAuthn credential registered for staff ${staffId}`);
    res.json({ verified: true });
  } catch (error) {
    console.error('❌ verifyRegistration error:', error);
    res.status(500).json({ error: 'Failed to verify registration' });
  }
}

// ─── Authentication: Step 1 — generate options ──────────────────────────────

async function getAuthOptions(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const supabase = getDb();

    const { data: credentials, error } = await supabase
      .from('staff_webauthn_credentials')
      .select('credential_id')
      .eq('staff_id', staffId);

    if (error) throw error;
    if (!credentials || credentials.length === 0) {
      res.status(404).json({ error: 'No biometric credentials registered', code: 'NO_CREDENTIALS' });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials: credentials.map((c: { credential_id: string }) => ({
        id: c.credential_id,
        type: 'public-key' as const,
      })),
      userVerification: 'preferred',
    });

    saveChallenge(staffId, options.challenge);
    console.log(`🔐 WebAuthn auth options generated for staff ${staffId}`);
    res.json(options);
  } catch (error) {
    console.error('❌ getAuthOptions error:', error);
    res.status(500).json({ error: 'Failed to generate auth options' });
  }
}

// ─── Authentication: Step 2 — verify ────────────────────────────────────────

async function verifyAuthentication(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const { credential } = req.body;

    const expectedChallenge = consumeChallenge(staffId);
    if (!expectedChallenge) {
      res.status(400).json({ error: 'Challenge expired or not found. Please try again.' });
      return;
    }

    const supabase = getDb();

    const { data: stored, error: fetchError } = await supabase
      .from('staff_webauthn_credentials')
      .select('id, credential_id, public_key, counter')
      .eq('staff_id', staffId)
      .eq('credential_id', credential.id)
      .single();

    if (fetchError || !stored) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: stored.counter,
      },
    });

    if (!verification.verified) {
      res.status(401).json({ error: 'Biometric verification failed' });
      return;
    }

    // Update counter
    await supabase
      .from('staff_webauthn_credentials')
      .update({
        counter: verification.authenticationInfo.newCounter,
        updated_at: new Date().toISOString(),
      })
      .eq('id', stored.id);

    console.log(`✅ WebAuthn authentication verified for staff ${staffId}`);
    res.json({ verified: true });
  } catch (error) {
    console.error('❌ verifyAuthentication error:', error);
    res.status(500).json({ error: 'Failed to verify biometric' });
  }
}

// ─── List registered devices ────────────────────────────────────────────────

async function getRegisteredDevices(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const supabase = getDb();

    const { data, error } = await supabase
      .from('staff_webauthn_credentials')
      .select('id, device_name, created_at')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ devices: data });
  } catch (error) {
    console.error('❌ getRegisteredDevices error:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
}

// ─── Remove a registered device ─────────────────────────────────────────────

async function removeDevice(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const { id } = req.params;
    const supabase = getDb();

    const { error } = await supabase
      .from('staff_webauthn_credentials')
      .delete()
      .eq('id', id)
      .eq('staff_id', staffId);

    if (error) throw error;
    console.log(`✅ Removed WebAuthn credential ${id} for staff ${staffId}`);
    res.json({ removed: true });
  } catch (error) {
    console.error('❌ removeDevice error:', error);
    res.status(500).json({ error: 'Failed to remove device' });
  }
}

export {
  getRegistrationOptions,
  verifyRegistration,
  getAuthOptions,
  verifyAuthentication,
  getRegisteredDevices,
  removeDevice,
};
